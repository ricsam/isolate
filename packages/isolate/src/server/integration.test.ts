import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createModuleResolver } from "../index.ts";
import { createTestHost, createTestId, expectResponse, withTimeout } from "../testing/integration-helpers.ts";
import type { IsolateHost } from "../types.ts";

describe("AppServer integration", () => {
  let host: IsolateHost;
  let cleanup: (() => Promise<void>) | undefined;

  before(async () => {
    const testHost = await createTestHost("app-server-integration");
    host = testHost.host;
    cleanup = testHost.cleanup;
  });

  after(async () => {
    await cleanup?.();
  });

  test("handles requests and reload picks up changed module content", async () => {
    let version = "v1";
    let versionLoads = 0;
    const server = await host.createAppServer({
      key: createTestId("server-reload"),
      entry: "/server.ts",
      bindings: {
        modules: createModuleResolver()
          .virtual(
            "/server.ts",
            `
              import { version } from "/version.ts";
              serve({
                fetch() {
                  return new Response(version);
                },
              });
            `,
          )
          .virtual("/version.ts", () => {
            versionLoads += 1;
            return `export const version = ${JSON.stringify(version)};`;
          }),
      },
    });

    try {
      const firstResult = await server.handle(new Request("http://localhost/version"));
      const firstResponse = expectResponse(firstResult);
      assert.equal(await firstResponse.text(), "v1");

      version = "v2";
      await server.reload("test-reload");

      const secondResult = await server.handle(new Request("http://localhost/version"));
      const secondResponse = expectResponse(secondResult);
      assert.equal(await secondResponse.text(), "v2");
    } finally {
      await server.dispose({ reason: "test cleanup" });
    }

    assert.equal(versionLoads, 2);
  });

  test("exposes a live AbortSignal on request objects", async () => {
    const server = await host.createAppServer({
      key: createTestId("server-request-signal"),
      entry: "/server.ts",
      bindings: {
        modules: createModuleResolver().virtual(
          "/server.ts",
          `
            serve({
              fetch(request) {
                return Response.json({
                  isNull: request.signal === null,
                  isAbortSignal: request.signal instanceof AbortSignal,
                  abortedType: typeof request.signal.aborted,
                  aborted: request.signal.aborted,
                });
              },
            });
          `,
        ),
      },
    });

    try {
      const response = expectResponse(await server.handle(new Request("http://localhost/signal")));
      const payload = await response.json() as {
        isNull: boolean;
        isAbortSignal: boolean;
        abortedType: string;
        aborted: boolean;
      };

      assert.equal(payload.isNull, false);
      assert.equal(payload.isAbortSignal, true);
      assert.equal(payload.abortedType, "boolean");
      assert.equal(payload.aborted, false);
    } finally {
      await server.dispose({ hard: true, reason: "test cleanup" });
    }
  });

  test("forwards host abort signals to request.signal inside the isolate", async () => {
    const server = await host.createAppServer({
      key: createTestId("server-abort"),
      entry: "/server.ts",
      bindings: {
        modules: createModuleResolver().virtual(
          "/server.ts",
          `
            serve({
              fetch(request) {
                return new Promise((resolve) => {
                  request.signal.addEventListener("abort", () => {
                    resolve(Response.json({
                      source: "abort",
                      aborted: request.signal.aborted,
                    }));
                  }, { once: true });

                  setTimeout(() => {
                    resolve(Response.json({
                      source: "timeout",
                      aborted: request.signal.aborted,
                    }));
                  }, 300);
                });
              },
            });
          `,
        ),
      },
    });

    try {
      const controller = new AbortController();
      const responsePromise = server.handle(
        new Request("http://localhost/abort"),
        { signal: controller.signal },
      );

      await delay(25);
      controller.abort();

      const response = expectResponse(await withTimeout(responsePromise, 10_000, "abort response"));
      const payload = await response.json() as { source: string; aborted: boolean };
      assert.equal(payload.source, "abort");
      assert.equal(payload.aborted, true);
    } finally {
      await server.dispose({ hard: true, reason: "test cleanup" });
    }
  });

  test("keeps request handling healthy after repeated stream cancellations", { timeout: 120_000 }, async () => {
    const server = await host.createAppServer({
      key: createTestId("server-stream-cancel"),
      entry: "/server.ts",
      bindings: {
        modules: createModuleResolver().virtual(
          "/server.ts",
          `
            serve({
              fetch(request) {
                const pathname = new URL(request.url).pathname;

                if (pathname === "/ping") {
                  return new Response("ok", {
                    headers: { "Content-Type": "text/plain" },
                  });
                }

                if (pathname === "/stream") {
                  const chunkSize = 64 * 1024;
                  const stream = new ReadableStream({
                    start(controller) {
                      controller.enqueue(new Uint8Array(chunkSize));
                    },
                  });

                  return new Response(stream, {
                    headers: { "Content-Type": "application/octet-stream" },
                  });
                }

                return new Response("not found", { status: 404 });
              },
            });
          `,
        ),
      },
    });

    try {
      const iterations = 20;
      for (let iteration = 1; iteration <= iterations; iteration++) {
        const result = await withTimeout(
          server.handle(new Request("http://localhost/stream")),
          8_000,
          `dispatch ${iteration}`,
        );
        const response = expectResponse(result);

        assert.ok(response.body, `expected response body at iteration ${iteration}`);
        const reader = response.body!.getReader();
        const firstRead = await withTimeout(reader.read(), 20_000, `read ${iteration}`);
        assert.equal(firstRead.done, false);
        assert.ok(firstRead.value instanceof Uint8Array);

        await delay(1);
        await withTimeout(reader.cancel(`cancel ${iteration}`), 5_000, `cancel ${iteration}`);

        if (iteration % 5 === 0) {
          const ping = expectResponse(
            await withTimeout(
              server.handle(new Request("http://localhost/ping")),
              5_000,
              `ping ${iteration}`,
            ),
          );
          assert.equal(await ping.text(), "ok");
        }
      }

      const finalPing = expectResponse(
        await withTimeout(
          server.handle(new Request("http://localhost/ping")),
          5_000,
          "final ping",
        ),
      );
      assert.equal(await finalPing.text(), "ok");
    } finally {
      await server.dispose({ hard: true, reason: "test cleanup" });
    }
  });
});
