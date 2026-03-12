import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
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
  it("keeps dispatch healthy after repeated stream cancellations", { timeout: 120000 }, async () => {
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
              const chunkSize = 64 * 1024;
              const stream = new ReadableStream({
                start(controller) {
                  // Produce one chunk and keep the stream open until the reader cancels.
                  controller.enqueue(new Uint8Array(chunkSize));
                },
              });

              return new Response(stream, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }

            return new Response("not found", { status: 404 });
          }
        });
      `);

      const iterations = 25;
      for (let iteration = 1; iteration <= iterations; iteration++) {
        const response: Response = await withTimeout<Response>(
          runtime.fetch.dispatchRequest(new Request("http://localhost/stream")),
          8000,
          `dispatch ${iteration}`
        );
        assert.ok(response.body, `expected response body at iteration ${iteration}`);

        const reader = response.body!.getReader();
        const firstRead = await withTimeout(
          reader.read(),
          20000,
          `read ${iteration}`
        );
        assert.strictEqual(firstRead.done, false, `expected a chunk at iteration ${iteration}`);
        assert.ok(firstRead.value instanceof Uint8Array, `expected Uint8Array chunk at iteration ${iteration}`);

        await new Promise((resolve) => setTimeout(resolve, 1));

        await withTimeout(
          reader.cancel(`cancel ${iteration}`),
          5000,
          `cancel ${iteration}`
        );

        if (iteration % 5 === 0) {
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
      await delay(0);
      await fs.rm(socketPath, { force: true });
    }
  });
});
