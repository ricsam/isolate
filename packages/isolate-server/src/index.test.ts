import assert from "node:assert";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { connect, type DaemonConnection, type RuntimeOptions } from "@ricsam/isolate-client";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { IsolateServer } from "./index.ts";

const TEST_SOCKET = "/tmp/isolate-server-test-daemon.sock";

function testNamespace(name: string): string {
  return `isolate-server/${name}/${Date.now()}/${Math.random().toString(16).slice(2)}`;
}

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

function createRuntimeOptions(sourceMap: Map<string, string>): RuntimeOptions {
  return {
    moduleLoader: (specifier, importer) => {
      const direct = sourceMap.get(specifier);
      if (direct) {
        return {
          code: direct,
          filename: path.posix.basename(specifier),
          resolveDir: "/",
        };
      }

      const resolved = path.posix.normalize(path.posix.join(importer.resolveDir, specifier));
      const normalized = resolved.startsWith("/") ? resolved : `/${resolved}`;
      const code = sourceMap.get(normalized);
      if (code) {
        return {
          code,
          filename: path.posix.basename(normalized),
          resolveDir: path.posix.dirname(normalized),
        };
      }

      throw new Error(`Module not found: ${specifier} (${importer.resolveDir})`);
    },
  };
}

function createInstrumentedConnection(client: DaemonConnection): {
  connection: DaemonConnection;
  getCreateRuntimeCalls: () => number;
} {
  let createRuntimeCalls = 0;

  const connection: DaemonConnection = {
    createRuntime: (options) => client.createRuntime(options),
    createNamespace: (id) => {
      const namespace = client.createNamespace(id);
      return {
        id: namespace.id,
        createRuntime: async (options) => {
          createRuntimeCalls += 1;
          return namespace.createRuntime(options);
        },
      };
    },
    close: () => client.close(),
    isConnected: () => client.isConnected(),
  };

  return {
    connection,
    getCreateRuntimeCalls: () => createRuntimeCalls,
  };
}

describe("isolate-server", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  it("start + dispatchRequest", async () => {
    const modules = new Map<string, string>([
      ["server.js", `serve({ fetch: () => new Response("ok") });`],
    ]);

    const server = new IsolateServer({
      namespaceId: testNamespace("start-dispatch"),
      getConnection: async () => client,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });

      const response = await server.fetch.dispatchRequest(new Request("http://localhost/test"));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(await response.text(), "ok");
    } finally {
      await server.close();
    }
  });

  it("reload re-imports changed module", async () => {
    const modules = new Map<string, string>([
      [
        "server.js",
        `
          import { getVersion } from "./version.js";
          serve({
            fetch() {
              return new Response(getVersion());
            }
          });
        `,
      ],
      ["/version.js", `export function getVersion() { return "v1"; }`],
    ]);

    const server = new IsolateServer({
      namespaceId: testNamespace("reload"),
      getConnection: async () => client,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });

      const before = await server.fetch.dispatchRequest(new Request("http://localhost/version"));
      assert.strictEqual(await before.text(), "v1");

      modules.set("/version.js", `export function getVersion() { return "v2"; }`);

      await server.reload();

      const after = await server.fetch.dispatchRequest(new Request("http://localhost/version"));
      assert.strictEqual(await after.text(), "v2");
    } finally {
      await server.close();
    }
  });

  it("close + auto-restart on dispatch", async () => {
    const modules = new Map<string, string>([
      ["server.js", `serve({ fetch: () => new Response("auto-restarted") });`],
    ]);

    const server = new IsolateServer({
      namespaceId: testNamespace("auto-restart"),
      getConnection: async () => client,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });
      await server.close();

      const response = await server.fetch.dispatchRequest(new Request("http://localhost/restart"));
      assert.strictEqual(await response.text(), "auto-restarted");
      assert.ok(server.getRuntime(), "Runtime should be recreated on dispatch");
    } finally {
      await server.close();
    }
  });

  it("concurrent dispatch after close creates one effective start", async () => {
    const modules = new Map<string, string>([
      ["server.js", `serve({ fetch: () => new Response("ok") });`],
    ]);

    const instrumented = createInstrumentedConnection(client);
    const server = new IsolateServer({
      namespaceId: testNamespace("concurrent-start"),
      getConnection: async () => instrumented.connection,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });
      assert.strictEqual(instrumented.getCreateRuntimeCalls(), 1);

      await server.close();

      const responses = await Promise.all(
        Array.from({ length: 12 }, () =>
          server.fetch.dispatchRequest(new Request("http://localhost/concurrent"))
        )
      );
      const bodies = await Promise.all(responses.map((response) => response.text()));
      assert.deepStrictEqual(bodies, Array.from({ length: 12 }, () => "ok"));

      // One runtime from initial start + one runtime for concurrent restart path.
      assert.strictEqual(instrumented.getCreateRuntimeCalls(), 2);
    } finally {
      await server.close();
    }
  });

  it("dispatch before first start throws", async () => {
    const server = new IsolateServer({
      namespaceId: testNamespace("not-configured"),
      getConnection: async () => client,
    });

    await assert.rejects(
      () => server.fetch.dispatchRequest(new Request("http://localhost/not-configured")),
      /Server not configured\. Call start\(\) first\./
    );
  });

  it("close idempotency", async () => {
    const modules = new Map<string, string>([
      ["server.js", `serve({ fetch: () => new Response("close") });`],
    ]);

    const server = new IsolateServer({
      namespaceId: testNamespace("close-idempotent"),
      getConnection: async () => client,
    });

    await server.start({
      entry: "server.js",
      runtimeOptions: createRuntimeOptions(modules),
    });

    await server.close();
    await server.close();
  });

  it("start idempotency", async () => {
    const modules = new Map<string, string>([
      ["server.js", `serve({ fetch: () => new Response("start") });`],
    ]);

    const instrumented = createInstrumentedConnection(client);
    const server = new IsolateServer({
      namespaceId: testNamespace("start-idempotent"),
      getConnection: async () => instrumented.connection,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });

      assert.strictEqual(instrumented.getCreateRuntimeCalls(), 1);
    } finally {
      await server.close();
    }
  });

  it("reload remains healthy after stream-cancel churn", { timeout: 90000 }, async () => {
    const modules = new Map<string, string>([
      [
        "server.js",
        `
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
                let cancelled = false;
                const stream = new ReadableStream({
                  async pull(controller) {
                    if (cancelled) {
                      controller.close();
                      return;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    if (cancelled) {
                      controller.close();
                      return;
                    }
                    controller.enqueue(new Uint8Array(chunkSize));
                  },
                  cancel() {
                    cancelled = true;
                  }
                });
                return new Response(stream, {
                  headers: { "Content-Type": "application/octet-stream" }
                });
              }

              return new Response("not found", { status: 404 });
            }
          });
        `,
      ],
    ]);

    const server = new IsolateServer({
      namespaceId: testNamespace("reload-after-cancel-churn"),
      getConnection: async () => client,
    });

    try {
      await server.start({
        entry: "server.js",
        runtimeOptions: createRuntimeOptions(modules),
      });

      const iterations = 20;
      for (let iteration = 1; iteration <= iterations; iteration++) {
        const response = await withTimeout(
          server.fetch.dispatchRequest(new Request("http://localhost/stream")),
          12000,
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
          const pingDuringChurn = await withTimeout(
            server.fetch.dispatchRequest(new Request("http://localhost/ping")),
            5000,
            `ping during churn dispatch ${iteration}`
          );
          assert.strictEqual(
            await withTimeout(
              pingDuringChurn.text(),
              1000,
              `ping during churn text ${iteration}`
            ),
            "ok"
          );
        }
      }

      const pingBeforeReload = await withTimeout(
        server.fetch.dispatchRequest(new Request("http://localhost/ping")),
        3000,
        "ping before reload dispatch"
      );
      assert.strictEqual(
        await withTimeout(
          pingBeforeReload.text(),
          1000,
          "ping before reload text"
        ),
        "ok"
      );

      await withTimeout(server.reload(), 5000, "server reload");

      const pingAfterReload = await withTimeout(
        server.fetch.dispatchRequest(new Request("http://localhost/ping")),
        3000,
        "ping after reload dispatch"
      );
      assert.strictEqual(
        await withTimeout(
          pingAfterReload.text(),
          1000,
          "ping after reload text"
        ),
        "ok"
      );
    } finally {
      await server.close();
    }
  });
});
