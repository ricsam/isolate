import assert from "node:assert/strict";
import { asyncWrapProviders as hostAsyncWrapProviders } from "node:async_hooks";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
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

  beforeEach(async () => {
    const testHost = await createTestHost("host-runtime-integration");
    host = testHost.host;
    cleanup = testHost.cleanup;
  });

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
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

  test("exposes test lifecycle events on public test runtimes", async () => {
    const runtime = await host.createTestRuntime({
      bindings: {},
    });

    const startedSuites: string[] = [];
    const startedTests: string[] = [];
    let sawRunEnd = false;
    const unsubscribe = runtime.test.onEvent((event) => {
      if (event.type === "suiteStart") {
        startedSuites.push(event.suite.fullName);
      }
      if (event.type === "testStart") {
        startedTests.push(event.test.fullName);
      }
      if (event.type === "runEnd") {
        sawRunEnd = true;
      }
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
      assert.deepEqual(startedSuites, ["math"]);
      assert.deepEqual(startedTests, ["math > adds numbers"]);
      assert.equal(sawRunEnd, true);
    } finally {
      unsubscribe();
      await runtime.dispose();
    }
  });

  test("rejects test lifecycle subscriptions after test runtime disposal", async () => {
    const runtime = await host.createTestRuntime({
      bindings: {},
    });

    await runtime.dispose();

    assert.throws(
      () => runtime.test.onEvent(() => {}),
      (error) =>
        error instanceof Error &&
        error.message === "Test runtime has already been disposed.",
    );
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

  test("reuses namespaced sessions with preserved state and fresh bindings", async () => {
    const key = createTestId("namespaced-session-reuse");
    const firstEntries: ConsoleEntry[] = [];
    const firstRuntime = await host.getNamespacedRuntime(key, {
      bindings: {
        console: {
          onEntry(entry) {
            firstEntries.push(entry);
          },
        },
        tools: {
          getValue: async () => 1,
        },
      },
    });

    await firstRuntime.eval(`
      globalThis.__sessionCounter = 41;
      console.log(JSON.stringify({
        counter: globalThis.__sessionCounter,
        value: await getValue(),
      }));
    `);
    await firstRuntime.dispose();

    const secondEntries: ConsoleEntry[] = [];
    const secondRuntime = await host.getNamespacedRuntime(key, {
      bindings: {
        console: {
          onEntry(entry) {
            secondEntries.push(entry);
          },
        },
        tools: {
          getValue: async () => 2,
        },
      },
    });

    try {
      const diagnostics = await secondRuntime.diagnostics();
      assert.equal(diagnostics.runtime.reused, true);

      await secondRuntime.eval(`
        console.log(JSON.stringify({
          counter: globalThis.__sessionCounter,
          value: await getValue(),
        }));
      `);

      const results = await secondRuntime.runTests(`
        test("keeps globals and refreshes bindings", async () => {
          expect(globalThis.__sessionCounter).toBe(41);
          expect(await getValue()).toBe(2);
        });
      `, { timeoutMs: 10_000 });

      assert.equal(results.success, true);
      assert.equal(results.passed, 1);
    } finally {
      await secondRuntime.dispose({ hard: true });
    }

    assert.deepEqual(collectOutput(firstEntries), [
      '{"counter":41,"value":1}',
    ]);
    assert.deepEqual(collectOutput(secondEntries), [
      '{"counter":41,"value":2}',
    ]);
  });

  test("exposes test lifecycle events on public namespaced runtimes", async () => {
    const key = createTestId("namespaced-session-events");
    const runtime = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    const startedSuites: string[] = [];
    const startedTests: string[] = [];
    let sawRunEnd = false;
    const unsubscribe = runtime.test.onEvent((event) => {
      if (event.type === "suiteStart") {
        startedSuites.push(event.suite.fullName);
      }
      if (event.type === "testStart") {
        startedTests.push(event.test.fullName);
      }
      if (event.type === "runEnd") {
        sawRunEnd = true;
      }
    });

    try {
      const results = await runtime.runTests(`
        describe("session", () => {
          test("tracks the active test", () => {
            expect(2 * 3).toBe(6);
          });
        });
      `, { timeoutMs: 5_000 });

      assert.equal(results.success, true);
      assert.deepEqual(startedSuites, ["session"]);
      assert.deepEqual(startedTests, ["session > tracks the active test"]);
      assert.equal(sawRunEnd, true);
    } finally {
      unsubscribe();
      await runtime.dispose({ hard: true });
    }
  });

  test("rejects concurrent namespaced runtime acquisition", async () => {
    const key = createTestId("namespaced-session-live");
    const runtime = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    try {
      await assert.rejects(
        () => host.getNamespacedRuntime(key, { bindings: {} }),
        (error) =>
          error instanceof Error &&
          error.name === "NamespaceInUseError" &&
          error.message.includes(key),
      );
    } finally {
      await runtime.dispose({ hard: true });
    }
  });

  test("disposes active namespaces by key and invalidates stale handles", async () => {
    const key = createTestId("namespaced-session-dispose");
    const runtime = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    await runtime.eval("globalThis.__disposedByKey = 1;");
    await host.disposeNamespace(key, {
      reason: "test cleanup",
    });

    await assert.rejects(
      () => runtime.eval("globalThis.__disposedByKey += 1;"),
      (error) =>
        error instanceof Error &&
        error.name === "NamespacedRuntimeInvalidatedError",
    );
    assert.throws(
      () => runtime.test.onEvent(() => {}),
      (error) =>
        error instanceof Error &&
        error.name === "NamespacedRuntimeInvalidatedError",
    );

    await runtime.dispose();

    const replacement = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    try {
      const diagnostics = await replacement.diagnostics();
      assert.equal(diagnostics.runtime.reused, false);
      await replacement.eval(`
        if (globalThis.__disposedByKey !== undefined) {
          throw new Error("expected namespace disposal to clear runtime state");
        }
      `);
    } finally {
      await replacement.dispose({ hard: true });
    }
  });

  test("deletes pooled namespaced runtimes by key", async () => {
    const key = createTestId("namespaced-session-pooled-dispose");
    const runtime = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    await runtime.eval("globalThis.__pooledValue = 99;");
    await runtime.dispose();

    await host.disposeNamespace(key, {
      reason: "drop pooled runtime",
    });

    const replacement = await host.getNamespacedRuntime(key, {
      bindings: {},
    });

    try {
      const diagnostics = await replacement.diagnostics();
      assert.equal(diagnostics.runtime.reused, false);
      await replacement.eval(`
        if (globalThis.__pooledValue !== undefined) {
          throw new Error("expected pooled namespace disposal to remove runtime state");
        }
      `);
    } finally {
      await replacement.dispose({ hard: true });
    }
  });

  test("rejects mixed browser handler and factory bindings", async () => {
    const browserBinding = {
      handler: async () => ({
        ok: false,
        error: {
          name: "Error",
          message: "unused",
        },
      }),
      createContext: async () => ({}),
    } as any;

    await assert.rejects(
      () => host.createRuntime({
        bindings: {
          browser: browserBinding,
        },
      }),
      (error) =>
        error instanceof Error &&
        error.message.includes("either handler-first or factory-first mode"),
    );
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
      await withTimeout(runtime.eval(`
        import { createIsolateHost } from "@ricsam/isolate";

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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

        const nestedHost = createIsolateHost();
        const before = await withStepTimeout(
          nestedHost.diagnostics(),
          "nested diagnostics before runtime creation",
        );
        const child = await withStepTimeout(
          nestedHost.createRuntime(),
          "nested runtime creation",
        );
        await withStepTimeout(
          child.eval("globalThis.__nestedValue = 42;"),
          "nested runtime eval",
        );
        const during = await withStepTimeout(
          nestedHost.diagnostics(),
          "nested diagnostics during runtime lifetime",
        );
        await withStepTimeout(
          child.dispose(),
          "nested runtime dispose",
        );
        const afterDispose = await withStepTimeout(
          nestedHost.diagnostics(),
          "nested diagnostics after dispose",
        );
        await withStepTimeout(
          nestedHost.close(),
          "nested host close",
        );

        console.log(JSON.stringify({ before, during, afterDispose }));
      `, { executionTimeout: 30_000 }), 35_000, "synthetic @ricsam/isolate import eval");
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after synthetic @ricsam/isolate import",
      ).catch(() => {});
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

  test("supports namespaced runtimes through the synthetic @ricsam/isolate module", async () => {
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

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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

        const nestedHost = createIsolateHost();
        const first = await withStepTimeout(
          nestedHost.getNamespacedRuntime("nested-session", {
            bindings: {
              tools: {
                getValue: async () => 1,
              },
            },
          }),
          "first nested namespaced runtime acquisition",
        );

        await withStepTimeout(
          first.eval("globalThis.__nestedCounter = 41;"),
          "first nested namespaced eval",
        );
        await withStepTimeout(
          first.dispose(),
          "first nested namespaced dispose",
        );

        const second = await withStepTimeout(
          nestedHost.getNamespacedRuntime("nested-session", {
            bindings: {
              tools: {
                getValue: async () => 2,
              },
            },
          }),
          "second nested namespaced runtime acquisition",
        );

        const diagnostics = await withStepTimeout(
          second.diagnostics(),
          "nested namespaced diagnostics",
        );
        const results = await withStepTimeout(
          second.runTests(\`
            test("keeps globals and refreshed bindings", async () => {
              expect(globalThis.__nestedCounter).toBe(41);
              expect(await getValue()).toBe(2);
            });
          \`, { timeoutMs: 10_000 }),
          "nested namespaced runTests",
          15_000,
        );

        await withStepTimeout(
          nestedHost.disposeNamespace("nested-session", {
            reason: "nested cleanup",
          }),
          "nested namespace disposal",
        );

        let invalidatedName = null;
        try {
          await withStepTimeout(
            second.eval("globalThis.__nestedCounter += 1;"),
            "nested invalidated eval",
          );
        } catch (error) {
          invalidatedName = error.name;
        }

        await withStepTimeout(
          second.dispose(),
          "second nested namespaced dispose",
        );
        console.log(JSON.stringify({
          reused: diagnostics.runtime.reused,
          success: results.success,
          invalidatedName,
        }));
      `, { executionTimeout: 60_000 });
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after nested namespaced runtime test",
      ).catch(() => {});
    }

    assert.deepEqual(collectOutput(entries), [
      '{"reused":true,"success":true,"invalidatedName":"NamespacedRuntimeInvalidatedError"}',
    ]);
  });

  test("forwards nested test lifecycle events through the synthetic @ricsam/isolate module", async () => {
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
      await withTimeout(runtime.eval(`
        import { createIsolateHost } from "@ricsam/isolate";

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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

        const nestedHost = createIsolateHost();
        const nestedRuntime = await withStepTimeout(
          nestedHost.createTestRuntime({
            bindings: {},
          }),
          "nested test runtime creation",
        );

        const startedSuites = [];
        const startedTests = [];
        const unsubscribe = nestedRuntime.test.onEvent((event) => {
          if (event.type === "suiteStart") {
            startedSuites.push(event.suite.fullName);
          }
          if (event.type === "testStart") {
            startedTests.push(event.test.fullName);
          }
        });

        const results = await withStepTimeout(nestedRuntime.run(\`
          describe("nested", () => {
            test("emits lifecycle events", () => {
              expect(true).toBe(true);
            });
          });
        \`, { timeoutMs: 5_000 }), "nested test runtime run");

        unsubscribe();
        await withStepTimeout(
          nestedRuntime.dispose(),
          "nested test runtime dispose",
        );

        console.log(JSON.stringify({
          startedSuites,
          startedTests,
          success: results.success,
        }));
      `, { executionTimeout: 20_000 }), 25_000, "nested test lifecycle eval");
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after nested test lifecycle test",
      ).catch(() => {});
    }

    assert.deepEqual(collectOutput(entries), [
      '{"startedSuites":["nested"],"startedTests":["nested > emits lifecycle events"],"success":true}',
    ]);
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
      await withTimeout(runtime.eval(`
        import { createIsolateHost } from "@ricsam/isolate";

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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

        const nestedHost = createIsolateHost();
        const seen = [];

        const child = await withStepTimeout(
          nestedHost.createRuntime({
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
          }),
          "nested runtime creation for console forwarding",
        );

        await withStepTimeout(
          child.eval('console.log("hello from child")'),
          "nested console eval",
        );
        await withStepTimeout(
          child.dispose({ hard: true }),
          "nested console runtime dispose",
        );
        console.log(JSON.stringify(seen));
      `, { executionTimeout: 20_000 }), 25_000, "nested console forwarding eval");
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after nested console forwarding test",
      ).catch(() => {});
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

  test("supports isolate-authored bindings in nested runtimes", async () => {
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

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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
                  "  await reportRuntime({",
                  "    names,",
                  "    response: await response.text(),",
                  "    version,",
                  "  });",
                  "}",
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
          },
        };

        const child = await withStepTimeout(
          nestedHost.createRuntime({
            bindings,
          }),
          "nested runtime creation",
        );

        await withStepTimeout(
          child.eval('import { run } from "/child.ts"; await run();'),
          "child runtime eval",
        );
        await withStepTimeout(child.dispose(), "child dispose");

        console.log(JSON.stringify({
          runtimeResult,
        }));
      `, { executionTimeout: 60_000 });
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after nested runtime bindings test",
      ).catch(() => {});
    }

    assert.equal(entries.length, 1);
    const result = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      runtimeResult: {
        names: string[];
        response: string;
        version: string;
      };
    };

    assert.deepEqual(result.runtimeResult, {
      names: ["note.txt"],
      response: "/runtime:POST",
      version: "v1",
    });
  });

  test("supports isolate-authored bindings across nested app server reloads", async () => {
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

        async function withStepTimeout(promise, label, timeoutMs = 10_000) {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error("Timed out after " + timeoutMs + "ms: " + label));
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

        const nestedHost = createIsolateHost();
        let version = "v1";
        let fileNames = ["note.txt"];

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
        };

        const server = await withStepTimeout(
          nestedHost.createAppServer({
            key: "nested-server",
            entry: "/server.ts",
            bindings,
          }),
          "nested app server creation",
        );

        const firstResult = await withStepTimeout(
          server.handle("http://localhost/version"),
          "first server handle",
        );
        if (firstResult.type !== "response") {
          throw new Error("expected response result");
        }
        const firstPayload = await withStepTimeout(
          firstResult.response.json(),
          "first payload json",
        );

        version = "v2";
        fileNames = ["updated.txt"];
        await withStepTimeout(
          server.reload("update-version"),
          "server reload",
        );

        const secondResult = await withStepTimeout(
          server.handle("http://localhost/version"),
          "second server handle",
        );
        if (secondResult.type !== "response") {
          throw new Error("expected response result");
        }
        const secondPayload = await withStepTimeout(
          secondResult.response.json(),
          "second payload json",
        );

        await withStepTimeout(server.dispose(), "server dispose");
        console.log(JSON.stringify({
          firstPayload,
          secondPayload,
        }));
      `, { executionTimeout: 60_000 });
    } finally {
      await withTimeout(
        runtime.dispose().catch(() => {}),
        5_000,
        "dispose runtime after nested app server bindings test",
      ).catch(() => {});
    }

    assert.equal(entries.length, 1);
    const result = JSON.parse(collectOutput(entries)[0] ?? "{}") as {
      firstPayload: {
        names: string[];
        path: string;
        response: string;
        version: string;
      };
      secondPayload: {
        names: string[];
        path: string;
        response: string;
        version: string;
      };
    };

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
  });
});
