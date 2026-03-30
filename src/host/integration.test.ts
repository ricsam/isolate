import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createModuleResolver } from "../index.ts";
import { createTestHost, createTestId, withTimeout } from "../testing/integration-helpers.ts";
import type { ConsoleEntry, HostCallContext, IsolateHost, ToolBindings } from "../types.ts";

function collectOutput(entries: ConsoleEntry[]): string[] {
  return entries.flatMap((entry) => (
    entry.type === "output" ? [entry.stdout] : []
  ));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  test("provides AsyncContext-backed async_hooks shims", async () => {
    const entries: ConsoleEntry[] = [];
    const resolver = createModuleResolver().mountNodeModules(
      "/node_modules",
      path.resolve(import.meta.dirname, "../../node_modules"),
    );
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            entries.push(entry);
          },
        },
        modules: resolver,
      },
    });

    try {
      await runtime.eval(`
        import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

        function createDeferred() {
          let resolve;
          const promise = new Promise((resolvePromise) => {
            resolve = resolvePromise;
          });
          return { promise, resolve };
        }

        const storage = new AsyncLocalStorage({ name: "requestId" });
        const asyncContextVariable = new AsyncContext.Variable({
          name: "variable",
          defaultValue: "unset",
        });

        const syncValue = storage.run({ requestId: "sync" }, () => storage.getStore()?.requestId ?? null);
        const asyncValue = await storage.run({ requestId: "async" }, async () => {
          await Promise.resolve();
          return storage.getStore()?.requestId ?? null;
        });

        const deferredA = createDeferred();
        const deferredB = createDeferred();
        const promiseA = storage.run({ requestId: "A" }, async () => {
          await deferredA.promise;
          return storage.getStore()?.requestId ?? null;
        });
        const promiseB = storage.run({ requestId: "B" }, async () => {
          await deferredB.promise;
          return storage.getStore()?.requestId ?? null;
        });
        deferredB.resolve();
        deferredA.resolve();
        const parallelValues = await Promise.all([promiseA, promiseB]);

        const boundValue = storage.run({ requestId: "bind" }, () => {
          const bound = AsyncLocalStorage.bind(() => storage.getStore()?.requestId ?? null);
          return bound();
        });

        const snapshotValue = storage.run({ requestId: "snapshot" }, () => {
          const snapshot = AsyncLocalStorage.snapshot();
          return snapshot(() => storage.getStore()?.requestId ?? null);
        });

        const timerValue = await storage.run({ requestId: "timer" }, () => (
          new Promise((resolve) => {
            setTimeout(() => resolve(storage.getStore()?.requestId ?? null), 0);
          })
        ));

        const resourceValue = await storage.run({ requestId: "resource" }, async () => {
          const resource = new AsyncResource("test-resource");
          await Promise.resolve();
          return resource.runInAsyncScope(() => storage.getStore()?.requestId ?? null);
        });
        const emitDestroy = (() => {
          const resource = new AsyncResource("destroy-resource");
          const sameResource = resource.emitDestroy() === resource;
          let throwsOnSecondCall = false;
          try {
            resource.emitDestroy();
          } catch {
            throwsOnSecondCall = true;
          }
          return { sameResource, throwsOnSecondCall };
        })();

        const enterExitStorage = new AsyncLocalStorage({ defaultValue: "default" });
        const disabledDeferred = createDeferred();
        const staleDisabledPromise = enterExitStorage.run("before-disable", async () => {
          await disabledDeferred.promise;
          return enterExitStorage.getStore() ?? null;
        });
        enterExitStorage.enterWith("entered");
        const enterValue = enterExitStorage.getStore();
        const exitValue = enterExitStorage.exit(() => enterExitStorage.getStore() ?? null);
        const afterExitValue = enterExitStorage.getStore();
        enterExitStorage.disable();
        const disabledValue = enterExitStorage.getStore() ?? null;
        enterExitStorage.enterWith("after-disable");
        disabledDeferred.resolve();
        const staleDisabledValue = await staleDisabledPromise;

        const asyncContextValue = await asyncContextVariable.run("ctx", async () => {
          await Promise.resolve();
          return asyncContextVariable.get();
        });

        console.log(JSON.stringify({
          hasAsyncContext: typeof AsyncContext === "object",
          isConstructor: typeof AsyncLocalStorage === "function",
          hasAsyncResource: typeof AsyncResource === "function",
          syncValue,
          asyncValue,
          parallelValues,
          boundValue,
          snapshotValue,
          timerValue,
          resourceValue,
          emitDestroy,
          enterValue,
          exitValue,
          afterExitValue,
          disabledValue,
          staleDisabledValue,
          asyncContextValue,
        }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(entries), [
      '{"hasAsyncContext":true,"isConstructor":true,"hasAsyncResource":true,"syncValue":"sync","asyncValue":"async","parallelValues":["A","B"],"boundValue":"bind","snapshotValue":"snapshot","timerValue":"timer","resourceValue":"resource","emitDestroy":{"sameResource":true,"throwsOnSecondCall":true},"enterValue":"entered","exitValue":null,"afterExitValue":"entered","disabledValue":null,"staleDisabledValue":null,"asyncContextValue":"ctx"}',
    ]);
  });

  test("preserves async context for emitted runtime events", async () => {
    const entries: ConsoleEntry[] = [];
    const resolver = createModuleResolver().mountNodeModules(
      "/node_modules",
      path.resolve(import.meta.dirname, "../../node_modules"),
    );
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            entries.push(entry);
          },
        },
        modules: resolver,
      },
    });

    try {
      await runtime.eval(`
        import { AsyncLocalStorage } from "node:async_hooks";

        const storage = new AsyncLocalStorage();
        globalThis.__eventValuePromise = storage.run({ requestId: "event" }, () => (
          new Promise((resolve) => {
            __on("demo", () => {
              resolve(storage.getStore()?.requestId ?? null);
            });
          })
        ));
      `);

      await runtime.events.emit("demo", { ok: true });
      await runtime.eval(`
        console.log(JSON.stringify({
          eventValue: await globalThis.__eventValuePromise,
        }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(entries), [
      '{"eventValue":"event"}',
    ]);
  });

  test("preserves async context for isolate callbacks invoked by host tools", async () => {
    const entries: ConsoleEntry[] = [];
    const resolver = createModuleResolver().mountNodeModules(
      "/node_modules",
      path.resolve(import.meta.dirname, "../../node_modules"),
    );
    let storedCallback: (() => Promise<unknown>) | undefined;
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            entries.push(entry);
          },
        },
        modules: resolver,
        tools: {
          registerCallback: async (...args: [...unknown[], HostCallContext]) => {
            const callback = args[0] as () => Promise<unknown>;
            storedCallback = callback;
            return "registered";
          },
        },
      },
    });

    try {
      await runtime.eval(`
        import { AsyncLocalStorage } from "node:async_hooks";

        const storage = new AsyncLocalStorage();
        await storage.run({ requestId: "callback" }, async () => {
          await registerCallback(async () => {
            await Promise.resolve();
            return storage.getStore()?.requestId ?? null;
          });
        });
      `);

      assert.ok(storedCallback);
      const callbackValue = await storedCallback!();

      await runtime.eval(`
        console.log(JSON.stringify({
          callbackValue: ${JSON.stringify(callbackValue)},
        }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(entries), [
      '{"callbackValue":"callback"}',
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

  test("treats returned callback refs as promise-returning functions", async () => {
    const logs: ConsoleEntry[] = [];
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            logs.push(entry);
          },
        },
        tools: {
          createMultiplier: () => (
            async (value: number) => value * 2
          ),
        },
      },
    });

    try {
      await runtime.eval(`
        const multiply = await createMultiplier();
        const pending = multiply(21);
        console.log(JSON.stringify({
          isPromise: pending instanceof Promise,
          value: await pending,
        }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(logs), ['{"isPromise":true,"value":42}']);
  });

  test("settles returned promise refs asynchronously", async () => {
    const logs: ConsoleEntry[] = [];
    const firstLog = createDeferred<void>();
    const release = createDeferred<string>();
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            logs.push(entry);
            if (entry.type === "output" && entry.stdout.includes('"isPromise":true')) {
              firstLog.resolve();
            }
          },
        },
        tools: {
          createPromiseHolder: () => ({
            pending: release.promise,
          }),
        },
      },
    });

    try {
      const evalPromise = runtime.eval(`
        const holder = await createPromiseHolder();
        const pending = holder.pending;
        console.log(JSON.stringify({
          isPromise: pending instanceof Promise,
        }));
        console.log(await pending);
      `);

      await withTimeout(firstLog.promise, 5_000, "returned promise ref");
      release.resolve("settled");
      await withTimeout(evalPromise, 10_000, "returned promise ref eval");
    } finally {
      await runtime.dispose();
    }

    assert.deepEqual(collectOutput(logs), [
      '{"isPromise":true}',
      "settled",
    ]);
  });

  test("supports throw() on returned async iterator refs", async () => {
    const logs: ConsoleEntry[] = [];
    let cleaned = false;
    const runtime = await host.createRuntime({
      bindings: {
        console: {
          onEntry(entry) {
            logs.push(entry);
          },
        },
        tools: {
          createIterator: () => (async function* () {
            try {
              yield 1;
              yield 2;
            } finally {
              cleaned = true;
            }
          })(),
        },
      },
    });

    try {
      await runtime.eval(`
        const iterator = await createIterator();
        const first = await iterator.next();
        let thrownMessage = null;
        try {
          const pendingThrow = iterator.throw(new Error("stop"));
          console.log(JSON.stringify({
            throwReturnsPromise: pendingThrow instanceof Promise,
          }));
          await pendingThrow;
        } catch (error) {
          thrownMessage = error.message;
        }
        console.log(JSON.stringify({
          firstValue: first.value,
          firstDone: first.done,
          thrownMessage,
        }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.equal(cleaned, true);
    assert.deepEqual(collectOutput(logs), [
      '{"throwReturnsPromise":true}',
      '{"firstValue":1,"firstDone":false,"thrownMessage":"stop"}',
    ]);
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
