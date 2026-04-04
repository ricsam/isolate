import assert from "node:assert/strict";
import { asyncWrapProviders as hostAsyncWrapProviders } from "node:async_hooks";
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
        import asyncHooks, {
          AsyncLocalStorage,
          AsyncResource,
          asyncWrapProviders,
          createHook,
          executionAsyncId,
          executionAsyncResource,
          triggerAsyncId,
        } from "node:async_hooks";

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
        const topLevel = {
          executionAsyncId: executionAsyncId(),
          sameResource: executionAsyncResource() === executionAsyncResource(),
          triggerAsyncId: triggerAsyncId(),
        };
        const hookEvents = [];
        const hook = createHook({
          init(asyncId, type, hookTriggerAsyncId, resource) {
            if (resource && typeof resource === "object" && !resource.__resourceTag) {
              resource.__resourceTag = type + ":" + asyncId;
            }
            if (hookEvents.length < 200) {
              hookEvents.push({
                asyncId,
                event: "init",
                resourceTag: resource?.__resourceTag ?? null,
                triggerAsyncId: hookTriggerAsyncId,
                type,
              });
            }
          },
          before(asyncId) {
            if (hookEvents.length < 200) {
              hookEvents.push({
                asyncId,
                event: "before",
                executionAsyncId: executionAsyncId(),
                resourceTag: executionAsyncResource()?.__resourceTag ?? null,
                triggerAsyncId: triggerAsyncId(),
              });
            }
          },
          after(asyncId) {
            if (hookEvents.length < 200) {
              hookEvents.push({
                asyncId,
                event: "after",
                executionAsyncId: executionAsyncId(),
                resourceTag: executionAsyncResource()?.__resourceTag ?? null,
                triggerAsyncId: triggerAsyncId(),
              });
            }
          },
          destroy(asyncId) {
            if (hookEvents.length < 200) {
              hookEvents.push({
                asyncId,
                event: "destroy",
              });
            }
          },
          promiseResolve(asyncId) {
            if (hookEvents.length < 200) {
              hookEvents.push({
                asyncId,
                event: "promiseResolve",
              });
            }
          },
        });
        const sameEnable = hook.enable() === hook && hook.enable() === hook;

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
        const timerAsyncInfo = await new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              executionAsyncId: executionAsyncId(),
              resourceTag: executionAsyncResource()?.__resourceTag ?? null,
              triggerAsyncId: triggerAsyncId(),
            });
          }, 0);
        });
        const intervalExecutions = [];
        let intervalResource = null;
        await new Promise((resolve) => {
          const intervalId = setInterval(() => {
            const resource = executionAsyncResource();
            if (!intervalResource) {
              intervalResource = resource;
            }
            intervalExecutions.push({
              executionAsyncId: executionAsyncId(),
              sameResource: resource === intervalResource,
              triggerAsyncId: triggerAsyncId(),
            });
            if (intervalExecutions.length === 2) {
              clearInterval(intervalId);
              resolve();
            }
          }, 0);
        });

        const resourceValue = await storage.run({ requestId: "resource" }, async () => {
          const resource = new AsyncResource("test-resource");
          await Promise.resolve();
          return resource.runInAsyncScope(() => storage.getStore()?.requestId ?? null);
        });
        const resourceLifecycle = (() => {
          const resource = new AsyncResource("hook-resource");
          const inScope = resource.runInAsyncScope(() => ({
            executionAsyncId: executionAsyncId(),
            sameResource: executionAsyncResource() === resource,
            triggerAsyncId: triggerAsyncId(),
          }));
          const propagationResource = new AsyncResource("propagation-resource");
          const propagationValue = propagationResource.runInAsyncScope(() => {
            executionAsyncResource().sharedValue = "persisted";
            return propagationResource.bind(
              () => executionAsyncResource().sharedValue ?? null,
            )();
          });
          propagationResource.emitDestroy();
          const sameResource = resource.emitDestroy() === resource;
          let throwsOnSecondDestroy = false;
          try {
            resource.emitDestroy();
          } catch {
            throwsOnSecondDestroy = true;
          }
          return {
            asyncId: resource.asyncId(),
            inScope,
            propagationValue,
            sameResource,
            throwsOnSecondDestroy,
            triggerAsyncId: resource.triggerAsyncId(),
          };
        })();
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
        const promiseInfo = await Promise.resolve("promise").then(() => ({
          executionAsyncId: executionAsyncId(),
          resourceIsPromise: executionAsyncResource() instanceof Promise,
          resourceTag: executionAsyncResource()?.__resourceTag ?? null,
          triggerAsyncId: triggerAsyncId(),
        }));
        const invalidHookError = (() => {
          try {
            createHook({ init: 1 });
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        })();
        const inheritedHook = createHook(Object.create({
          init() {},
        }));
        const sameDisable = hook.disable() === hook && hook.disable() === hook;

        console.log(JSON.stringify({
          asyncWrapProviders,
          defaultExportKeys: Object.keys(asyncHooks).sort(),
          hasAsyncHooksExports: {
            asyncWrapProviders: typeof asyncWrapProviders === "object",
            createHook: typeof createHook === "function",
            executionAsyncId: typeof executionAsyncId === "function",
            executionAsyncResource: typeof executionAsyncResource === "function",
            triggerAsyncId: typeof triggerAsyncId === "function",
          },
          hasAsyncContext: typeof AsyncContext === "object",
          isConstructor: typeof AsyncLocalStorage === "function",
          hasAsyncResource: typeof AsyncResource === "function",
          hookEvents,
          inheritedHook: typeof inheritedHook.enable === "function",
          invalidHookError,
          sameDisable,
          sameEnable,
          syncValue,
          asyncValue,
          parallelValues,
          boundValue,
          snapshotValue,
          promiseInfo,
          timerValue,
          timerAsyncInfo,
          topLevel,
          intervalExecutions,
          resourceValue,
          resourceLifecycle,
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

    assert.equal(entries.length, 1);
    const result = JSON.parse(collectOutput(entries)[0] ?? "{}") as Record<string, unknown>;

    assert.deepEqual(result.defaultExportKeys, [
      "AsyncLocalStorage",
      "AsyncResource",
      "asyncWrapProviders",
      "createHook",
      "executionAsyncId",
      "executionAsyncResource",
      "triggerAsyncId",
    ]);
    assert.deepEqual(
      Object.entries(result.asyncWrapProviders as Record<string, unknown>).sort(),
      Object.entries(hostAsyncWrapProviders).sort(),
    );
    assert.deepEqual(result.hasAsyncHooksExports, {
      asyncWrapProviders: true,
      createHook: true,
      executionAsyncId: true,
      executionAsyncResource: true,
      triggerAsyncId: true,
    });
    assert.equal(result.hasAsyncContext, true);
    assert.equal(result.isConstructor, true);
    assert.equal(result.hasAsyncResource, true);
    assert.equal(result.inheritedHook, true);
    assert.equal(result.invalidHookError, "hook.init must be a function");
    assert.equal(result.sameEnable, true);
    assert.equal(result.sameDisable, true);
    assert.deepEqual(result.topLevel, {
      executionAsyncId: 1,
      sameResource: true,
      triggerAsyncId: 0,
    });
    assert.equal(result.syncValue, "sync");
    assert.equal(result.asyncValue, "async");
    assert.deepEqual(result.parallelValues, ["A", "B"]);
    assert.equal(result.boundValue, "bind");
    assert.equal(result.snapshotValue, "snapshot");
    assert.equal(result.timerValue, "timer");
    assert.equal(result.resourceValue, "resource");
    assert.deepEqual(result.emitDestroy, {
      sameResource: true,
      throwsOnSecondCall: true,
    });
    assert.equal(result.enterValue, "entered");
    assert.equal(result.exitValue, null);
    assert.equal(result.afterExitValue, "entered");
    assert.equal(result.disabledValue, null);
    assert.equal(result.staleDisabledValue, null);
    assert.equal(result.asyncContextValue, "ctx");

    const promiseInfo = result.promiseInfo as Record<string, unknown>;
    assert.equal(promiseInfo.resourceIsPromise, true);
    assert.equal(typeof promiseInfo.executionAsyncId, "number");
    assert.equal(typeof promiseInfo.triggerAsyncId, "number");
    assert.notEqual(promiseInfo.executionAsyncId, 1);

    const timerAsyncInfo = result.timerAsyncInfo as Record<string, unknown>;
    assert.equal(typeof timerAsyncInfo.executionAsyncId, "number");
    assert.equal(typeof timerAsyncInfo.triggerAsyncId, "number");
    assert.match(String(timerAsyncInfo.resourceTag), /^Timeout:/);

    const intervalExecutions = result.intervalExecutions as Array<Record<string, unknown>>;
    assert.equal(intervalExecutions.length, 2);
    assert.equal(intervalExecutions[0]?.sameResource, true);
    assert.equal(intervalExecutions[1]?.sameResource, true);
    assert.equal(intervalExecutions[0]?.executionAsyncId, intervalExecutions[1]?.executionAsyncId);

    const resourceLifecycle = result.resourceLifecycle as Record<string, unknown>;
    assert.equal(typeof resourceLifecycle.asyncId, "number");
    assert.equal(resourceLifecycle.propagationValue, "persisted");
    assert.equal(resourceLifecycle.sameResource, true);
    assert.equal(resourceLifecycle.throwsOnSecondDestroy, true);
    assert.deepEqual(resourceLifecycle.inScope, {
      executionAsyncId: resourceLifecycle.asyncId,
      sameResource: true,
      triggerAsyncId: resourceLifecycle.triggerAsyncId,
    });

    const hookEvents = result.hookEvents as Array<Record<string, unknown>>;
    assert.ok(hookEvents.some((event) => event.event === "init" && event.type === "PROMISE"));
    assert.ok(hookEvents.some((event) => event.event === "init" && event.type === "Timeout"));
    assert.ok(hookEvents.some((event) => event.event === "init" && event.type === "hook-resource"));
    assert.ok(hookEvents.some((event) => event.event === "before"));
    assert.ok(hookEvents.some((event) => event.event === "after"));
    assert.ok(hookEvents.some((event) => event.event === "destroy"));
    assert.ok(hookEvents.some((event) => event.event === "promiseResolve"));
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
        import {
          AsyncLocalStorage,
          executionAsyncId,
          executionAsyncResource,
          triggerAsyncId,
        } from "node:async_hooks";

        const storage = new AsyncLocalStorage();
        globalThis.__eventValuePromise = storage.run({ requestId: "event" }, () => (
          new Promise((resolve) => {
            __on("demo", () => {
              resolve({
                executionAsyncId: executionAsyncId(),
                hasResource: typeof executionAsyncResource() === "object",
                requestId: storage.getStore()?.requestId ?? null,
                triggerAsyncId: triggerAsyncId(),
              });
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

    assert.equal(entries.length, 1);
    const eventResult = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      eventValue?: {
        executionAsyncId: number;
        hasResource: boolean;
        requestId: string | null;
        triggerAsyncId: number;
      };
    };
    assert.equal(eventResult.eventValue?.requestId, "event");
    assert.equal(eventResult.eventValue?.hasResource, true);
    assert.equal(typeof eventResult.eventValue?.executionAsyncId, "number");
    assert.equal(typeof eventResult.eventValue?.triggerAsyncId, "number");
    assert.ok((eventResult.eventValue?.executionAsyncId ?? 0) > 1);
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
        import {
          AsyncLocalStorage,
          executionAsyncId,
          executionAsyncResource,
          triggerAsyncId,
        } from "node:async_hooks";

        const storage = new AsyncLocalStorage();
        await storage.run({ requestId: "callback" }, async () => {
          await registerCallback(async () => {
            await Promise.resolve();
            return {
              executionAsyncId: executionAsyncId(),
              hasResource: typeof executionAsyncResource() === "object",
              requestId: storage.getStore()?.requestId ?? null,
              triggerAsyncId: triggerAsyncId(),
            };
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

    assert.equal(entries.length, 1);
    const callbackResult = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      callbackValue?: {
        executionAsyncId: number;
        hasResource: boolean;
        requestId: string | null;
        triggerAsyncId: number;
      };
    };
    assert.equal(callbackResult.callbackValue?.requestId, "callback");
    assert.equal(callbackResult.callbackValue?.hasResource, true);
    assert.equal(typeof callbackResult.callbackValue?.executionAsyncId, "number");
    assert.equal(typeof callbackResult.callbackValue?.triggerAsyncId, "number");
    assert.ok((callbackResult.callbackValue?.executionAsyncId ?? 0) > 1);
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
      assert.equal(diagnostics.runtime.pendingFetches, 0);
      assert.equal(diagnostics.runtime.activeResources, 0);
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
      assert.equal(diagnostics.runtime.pendingTools, 0);
      assert.equal(diagnostics.runtime.activeResources, 0);
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

  test("runs tests inside a test runtime", async () => {
    const runtime = await host.createTestRuntime({
      bindings: {},
    });

    try {
      const results = await runtime.run(`
        describe("math", () => {
          test("adds numbers", () => {
            expect(1 + 2).toBe(3);
          });
        });
      `, { timeoutMs: 5_000 });

      assert.equal(results.success, true);
      assert.equal(results.total, 1);
      assert.equal(results.passed, 1);
      assert.equal(results.failed, 0);
      const diagnostics = await runtime.diagnostics();
      assert.equal(diagnostics.test.registeredTests, 1);
      assert.deepEqual(diagnostics.test.lastRun, results);
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
      assert.equal(diagnostics.runtime.reused, true);

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

    assert.equal((await runtime1.diagnostics()).runtime.reused, false);
    await runtime1.dispose({ hard: true });

    const runtime2 = await host.createRuntime({
      key,
      bindings: {},
    });

    try {
      assert.equal((await runtime2.diagnostics()).runtime.reused, false);
    } finally {
      await runtime2.dispose();
    }
  });

  test("imports the synthetic @ricsam/isolate module without a user module resolver", async () => {
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
        import { createIsolateHost } from "@ricsam/isolate";

        const nestedHost = createIsolateHost();
        const before = await nestedHost.diagnostics();
        const child = await nestedHost.createRuntime();
        await child.eval("globalThis.__nestedValue = 42;");
        const during = await nestedHost.diagnostics();
        await child.dispose();
        const afterDispose = await nestedHost.diagnostics();
        await nestedHost.close();

        console.log(JSON.stringify({ before, during, afterDispose }));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.equal(entries.length, 1);
    const result = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      before: { runtimes: number; servers: number; connected: boolean };
      during: { runtimes: number; servers: number; connected: boolean };
      afterDispose: { runtimes: number; servers: number; connected: boolean };
    };

    assert.deepEqual(result.before, {
      runtimes: 0,
      servers: 0,
      connected: true,
    });
    assert.deepEqual(result.during, {
      runtimes: 1,
      servers: 0,
      connected: true,
    });
    assert.deepEqual(result.afterDispose, {
      runtimes: 0,
      servers: 0,
      connected: true,
    });
  });

  test("delivers nested console entries back into the parent isolate", async () => {
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
        import { createIsolateHost } from "@ricsam/isolate";

        const nestedHost = createIsolateHost();
        const seen = [];

        const child = await nestedHost.createRuntime({
          bindings: {
            console: {
              onEntry(entry) {
                seen.push({
                  keys: Object.keys(entry ?? {}),
                  stdout: entry?.stdout ?? null,
                  type: entry?.type ?? null,
                });
              },
            },
          },
        });

        await child.eval('console.log("hello from child")');
        await child.dispose({ hard: true });
        await nestedHost.close();

        console.log(JSON.stringify(seen));
      `);
    } finally {
      await runtime.dispose();
    }

    assert.equal(entries.length, 1);
    const seen = JSON.parse(collectOutput(entries)[0] ?? "[]") as Array<{
      keys: string[];
      stdout: string | null;
      type: string | null;
    }>;

    assert.deepEqual(seen, [{
      keys: ["type", "level", "stdout", "groupDepth"],
      stdout: "hello from child",
      type: "output",
    }]);
  });

  test("reuses isolate-authored bindings across nested runtimes and app servers", async () => {
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
        import { createIsolateHost } from "@ricsam/isolate";

        const nestedHost = createIsolateHost();
        let version = "v1";
        let fileNames = ["note.txt"];
        let runtimeResult = null;

        const bindings = {
          fetch: async (request) => {
            return new Response(
              new URL(request.url).pathname + ":" + request.method,
            );
          },
          files: {
            async readdir(path) {
              return path === "/nested" ? [...fileNames] : [];
            },
            async stat(path) {
              if (path === "/nested") {
                return {
                  isFile: false,
                  isDirectory: true,
                  size: 0,
                };
              }

              return {
                isFile: true,
                isDirectory: false,
                size: path.length,
              };
            },
          },
          modules: {
            async resolve(specifier) {
              if (specifier === "/child.ts") {
                return [
                  'import { version } from "/value.ts";',
                  "",
                  "export async function run() {",
                  '  const response = await fetch("https://nested.test/runtime", {',
                  '    method: "POST",',
                  "  });",
                  '  const root = await getDirectory("/nested");',
                  "  const names = [];",
                  "  for await (const [name] of root.entries()) {",
                  "    names.push(name);",
                  "  }",
                  "  const streamValues = [];",
                  "  for await (const value of toolStream()) {",
                  "    streamValues.push(value);",
                  "  }",
                  '  const formatter = await createFormatter("runtime");',
                  "  const formatted = await formatter(version);",
                  "  await reportRuntime({",
                  "    formatted,",
                  "    names,",
                  "    response: await response.text(),",
                  "    streamValues,",
                  "    version,",
                  "  });",
                  "}",
                ].join("\\n");
              }

              if (specifier === "/server.ts") {
                return [
                  'import { version } from "/value.ts";',
                  "",
                  "serve({",
                  "  async fetch(request) {",
                  '    const response = await fetch("https://nested.test/server");',
                  '    const root = await getDirectory("/nested");',
                  "    const names = [];",
                  "    for await (const [name] of root.entries()) {",
                  "      names.push(name);",
                  "    }",
                  "",
                  "    return Response.json({",
                  "      names,",
                  '      path: new URL(request.url).pathname,',
                  "      response: await response.text(),",
                  "      version,",
                  "    });",
                  "  },",
                  "});",
                ].join("\\n");
              }

              if (specifier === "/value.ts") {
                return "export const version = " + JSON.stringify(version) + ";";
              }

              return null;
            },
          },
          tools: {
            async reportRuntime(payload) {
              runtimeResult = payload;
            },
            async *toolStream() {
              yield "first";
              yield "second";
            },
            async createFormatter(prefix) {
              return async (value) => prefix + ":" + value;
            },
          },
        };

        const child = await nestedHost.createRuntime({
          bindings,
        });

        await child.eval('import { run } from "/child.ts"; await run();');

        const server = await nestedHost.createAppServer({
          key: "nested-server",
          entry: "/server.ts",
          bindings,
        });

        const diagnosticsDuring = await nestedHost.diagnostics();

        const firstResult = await server.handle("http://localhost/version");
        if (firstResult.type !== "response") {
          throw new Error("expected response result");
        }
        const firstPayload = await firstResult.response.json();

        version = "v2";
        fileNames = ["updated.txt"];
        await server.reload("update-version");

        const secondResult = await server.handle("http://localhost/version");
        if (secondResult.type !== "response") {
          throw new Error("expected response result");
        }
        const secondPayload = await secondResult.response.json();

        await child.dispose();
        await server.dispose();

        const diagnosticsAfterDispose = await nestedHost.diagnostics();
        await nestedHost.close();

        console.log(JSON.stringify({
          diagnosticsAfterDispose,
          diagnosticsDuring,
          firstPayload,
          runtimeResult,
          secondPayload,
        }));
      `, { executionTimeout: 20_000 });
    } finally {
      await runtime.dispose();
    }

    assert.equal(entries.length, 1);
    const result = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      diagnosticsDuring: { runtimes: number; servers: number; connected: boolean };
      diagnosticsAfterDispose: { runtimes: number; servers: number; connected: boolean };
      firstPayload: {
        names: string[];
        path: string;
        response: string;
        version: string;
      };
      runtimeResult: {
        formatted: string;
        names: string[];
        response: string;
        streamValues: string[];
        version: string;
      };
      secondPayload: {
        names: string[];
        path: string;
        response: string;
        version: string;
      };
    };

    assert.deepEqual(result.runtimeResult, {
      formatted: "runtime:v1",
      names: ["note.txt"],
      response: "/runtime:POST",
      streamValues: ["first", "second"],
      version: "v1",
    });
    assert.deepEqual(result.diagnosticsDuring, {
      runtimes: 1,
      servers: 1,
      connected: true,
    });
    assert.deepEqual(result.firstPayload, {
      names: ["note.txt"],
      path: "/version",
      response: "/server:GET",
      version: "v1",
    });
    assert.deepEqual(result.secondPayload, {
      names: ["updated.txt"],
      path: "/version",
      response: "/server:GET",
      version: "v2",
    });
    assert.deepEqual(result.diagnosticsAfterDispose, {
      runtimes: 0,
      servers: 0,
      connected: true,
    });
  });
});
