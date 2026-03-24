import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createModuleResolver } from "../index.ts";
import { createTestHost, createTestId } from "../testing/integration-helpers.ts";
import type { ConsoleEntry, HostCallContext, IsolateHost, ToolBindings } from "../types.ts";

function collectOutput(entries: ConsoleEntry[]): string[] {
  return entries.flatMap((entry) => (
    entry.type === "output" ? [entry.stdout] : []
  ));
}

describe("createIsolateHost runtime integration", () => {
  let host: IsolateHost;
  let cleanup: (() => Promise<void>) | undefined;

  before(async () => {
    const testHost = await createTestHost("host-runtime-integration");
    host = testHost.host;
    cleanup = testHost.cleanup;
  });

  after(async () => {
    await cleanup?.();
  });

  test("evaluates code and forwards console output", async () => {
    const entries: ConsoleEntry[] = [];
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            entries.push(entry);
          },
        },
      },
    });

    try {
      await runtime.eval(`
        console.log("hello", "from", "runtime");
        console.warn("careful");
        console.error("still working");
      `);
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(entries), [
      "hello from runtime",
      "careful",
      "still working",
    ]);
  });

  test("bridges outbound fetch callbacks through the public runtime API", async () => {
    const logs: ConsoleEntry[] = [];
    const requests: Array<{
      url: string;
      method: string;
      context: HostCallContext;
    }> = [];
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            logs.push(entry);
          },
        },
        fetch: async (request, context) => {
          requests.push({
            url: request.url,
            method: request.method,
            context,
          });

          return Response.json({
            ok: true,
            requestId: context.requestId ?? null,
          });
        },
      },
    });

    try {
      await runtime.eval(`
        const response = await fetch("https://api.example.com/data", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: 1 }),
        });
        console.log(await response.text());
      `);

      const diagnostics = await runtime.diagnostics();
      assert.equal(diagnostics.pendingFetches, 0);
      assert.equal(diagnostics.activeResources, 0);
    } finally {
      await runtime.dispose();
    }

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://api.example.com/data");
    assert.equal(requests[0]?.method, "POST");
    assert.ok(requests[0]?.context.runtimeId);
    assert.match(requests[0]!.context.resourceId, /^fetch:/);
    assert.equal(requests[0]?.context.requestId, undefined);
    assert.deepEqual(collectOutput(logs), ['{"ok":true,"requestId":null}']);
  });

  test("supports async tool iterators and cleans them up on break", async () => {
    const logs: ConsoleEntry[] = [];
    let cleaned = false;
    const tools: ToolBindings = {
      infinite: async function* (...args: [...unknown[], HostCallContext]) {
        void args.at(-1);
        try {
          while (true) {
            yield 1;
          }
        } finally {
          cleaned = true;
        }
      },
    };

    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            logs.push(entry);
          },
        },
        tools,
      },
    });

    try {
      await runtime.eval(`
        const values = [];
        for await (const value of infinite()) {
          values.push(value);
          break;
        }
        console.log(JSON.stringify(values));
      `);

      const diagnostics = await runtime.diagnostics();
      assert.equal(diagnostics.pendingTools, 0);
      assert.equal(diagnostics.activeResources, 0);
    } finally {
      await runtime.dispose();
    }

    assert.equal(cleaned, true);
    assert.deepEqual(collectOutput(logs), ["[1]"]);
  });

  test("runs tests inside a script runtime", async () => {
    const runtime = await host.createRuntime({
      bindings: {},
      features: {
        tests: true,
      },
    });

    try {
      await runtime.eval(`
        describe("math", () => {
          test("adds numbers", () => {
            expect(1 + 2).toBe(3);
          });
        });
      `);

      assert.equal(await runtime.tests.hasTests(), true);
      const results = await runtime.tests.run({ timeoutMs: 5_000 });
      assert.equal(results.success, true);
      assert.equal(results.total, 1);
      assert.equal(results.passed, 1);
      assert.equal(results.failed, 0);
    } finally {
      await runtime.dispose();
    }
  });

  test("reuses namespaced runtimes and reloads modules on reuse", async () => {
    let version = 1;
    let loadCount = 0;
    const key = createTestId("namespace-reuse");
    const resolver = createModuleResolver().virtual("/config.ts", () => {
      loadCount += 1;
      return `export const version = ${version};`;
    });

    const firstEntries: ConsoleEntry[] = [];
    const runtime1 = await host.createRuntime({
      key,
      bindings: {
        console: {
          onEntry(entry) {
            firstEntries.push(entry);
          },
        },
        modules: resolver,
      },
    });

    await runtime1.eval(`
      import { version } from "/config.ts";
      console.log(JSON.stringify({ version }));
    `);
    await runtime1.dispose();

    version = 2;

    const secondEntries: ConsoleEntry[] = [];
    const runtime2 = await host.createRuntime({
      key,
      bindings: {
        console: {
          onEntry(entry) {
            secondEntries.push(entry);
          },
        },
        modules: resolver,
      },
    });

    try {
      const diagnostics = await runtime2.diagnostics();
      assert.equal(diagnostics.reused, true);

      await runtime2.eval(`
        import { version } from "/config.ts";
        console.log(JSON.stringify({ version }));
      `);
    } finally {
      await runtime2.dispose();
    }

    assert.equal(loadCount, 2);
    assert.deepEqual(collectOutput(firstEntries), ['{"version":1}']);
    assert.deepEqual(collectOutput(secondEntries), ['{"version":2}']);
  });

  test("creates a fresh runtime after hard namespace disposal", async () => {
    const key = createTestId("namespace-hard-dispose");
    const runtime1 = await host.createRuntime({
      key,
      bindings: {},
    });

    assert.equal((await runtime1.diagnostics()).reused, false);
    await runtime1.dispose({ hard: true });

    const runtime2 = await host.createRuntime({
      key,
      bindings: {},
    });

    try {
      assert.equal((await runtime2.diagnostics()).reused, false);
    } finally {
      await runtime2.dispose();
    }
  });
});
