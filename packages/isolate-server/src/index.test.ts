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

function createRuntimeOptions(sourceMap: Map<string, string>): RuntimeOptions {
  return {
    moduleLoader: (specifier, importer) => {
      const direct = sourceMap.get(specifier);
      if (direct) {
        return {
          code: direct,
          resolveDir: "/",
        };
      }

      const resolved = path.posix.normalize(path.posix.join(importer.resolveDir, specifier));
      const normalized = resolved.startsWith("/") ? resolved : `/${resolved}`;
      const code = sourceMap.get(normalized);
      if (code) {
        return {
          code,
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
});
