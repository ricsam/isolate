import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

describe("stream cancel regression", () => {
  it("keeps dispatch healthy after repeated stream cancellations", { timeout: 60000 }, async () => {
    const socketPath = `/tmp/isolate-streaming-cancel-stress-${Date.now()}.sock`;
    let daemon: DaemonHandle | undefined;
    let client: DaemonConnection | undefined;
    let runtime: Awaited<ReturnType<DaemonConnection["createRuntime"]>> | undefined;

    try {
      await fs.rm(socketPath, { force: true });
      daemon = await startDaemon({ socketPath });
      client = await connect({ socket: socketPath });
      runtime = await client.createRuntime();

      await runtime.eval(`
        serve({
          fetch(request) {
            const pathname = new URL(request.url).pathname;

            if (pathname === "/ping") {
              return new Response("ok", {
                headers: { "Content-Type": "text/plain" }
              });
            }

            if (pathname === "/stream") {
              const chunkSize = 256 * 1024;
              const stream = new ReadableStream({
                async pull(controller) {
                  await new Promise((resolve) => setTimeout(resolve, 1));
                  controller.enqueue(new Uint8Array(chunkSize));
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }

            return new Response("not found", { status: 404 });
          }
        });
      `);

      const iterations = 40;
      for (let iteration = 1; iteration <= iterations; iteration++) {
        const response: Response = await withTimeout<Response>(
          runtime.fetch.dispatchRequest(new Request("http://localhost/stream")),
          8000,
          `dispatch ${iteration}`
        );
        assert.ok(response.body, `expected response body at iteration ${iteration}`);

        const reader = response.body!.getReader();
        await withTimeout(
          reader.read(),
          5000,
          `read ${iteration}`
        );

        await new Promise((resolve) => setTimeout(resolve, 20));

        await withTimeout(
          reader.cancel(`cancel ${iteration}`),
          5000,
          `cancel ${iteration}`
        );

        if (iteration % 10 === 0) {
          const pingResponse: Response = await withTimeout<Response>(
            runtime.fetch.dispatchRequest(new Request("http://localhost/ping")),
            5000,
            `ping dispatch ${iteration}`
          );
          const pingText: string = await withTimeout<string>(
            pingResponse.text(),
            1000,
            `ping text ${iteration}`
          );
          assert.strictEqual(pingText, "ok");
        }
      }

      const finalPingResponse: Response = await withTimeout<Response>(
        runtime.fetch.dispatchRequest(new Request("http://localhost/ping")),
        3000,
        "final ping dispatch"
      );
      const finalPingText: string = await withTimeout<string>(
        finalPingResponse.text(),
        1000,
        "final ping text"
      );
      assert.strictEqual(finalPingText, "ok");
    } finally {
      if (runtime) {
        await runtime.dispose();
      }
      if (client) {
        await client.close();
      }
      if (daemon) {
        await daemon.close();
      }
      await fs.rm(socketPath, { force: true });
    }
  });
});
