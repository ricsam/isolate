import {
  createBrowserDiagnostics,
  type MutableRuntimeDiagnostics,
} from "../bridge/diagnostics.ts";
import { isBenignDisposeError, type RemoteRuntime } from "../internal/client/index.ts";
import type { TestEventSubscriptions } from "./test-event-subscriptions.ts";
import type {
  NamespacedRuntime,
  RunResults,
  TestRuntimeDiagnostics,
} from "../types.ts";
import {
  disposeWithUnresponsiveFallback,
  getErrorMessage,
  isAbortError,
  isTerminalExecutionError,
  runAbortableOperation,
  type UnresponsiveDisposeHandler,
} from "./abort.ts";

type RuntimeState = "active" | "disposed" | "invalidated";

export interface NamespacedRuntimeAdapter extends NamespacedRuntime {
  invalidate(reason?: string): Promise<void>;
}

function createStateError(state: RuntimeState, reason?: string): Error {
  if (state === "invalidated") {
    const error = new Error(
      reason && reason.length > 0
        ? `Namespaced runtime is no longer available: ${reason}`
        : "Namespaced runtime is no longer available.",
    );
    error.name = "NamespacedRuntimeInvalidatedError";
    return error;
  }

  const error = new Error("Namespaced runtime has already been disposed.");
  error.name = "NamespacedRuntimeDisposedError";
  return error;
}

export function createNamespacedRuntimeAdapter(
  runtime: RemoteRuntime,
  diagnostics: MutableRuntimeDiagnostics,
  options: {
    hasBrowser?: boolean;
    abortBindings?: (reason?: string) => void | Promise<void>;
    onUnresponsiveDispose?: UnresponsiveDisposeHandler;
    onRelease?: () => void;
    testEvents: TestEventSubscriptions;
  },
): NamespacedRuntimeAdapter {
  let state: RuntimeState = "active";
  let lastRun: RunResults | undefined;
  let invalidationReason: string | undefined;
  let released = false;
  const subscriptions = new Set<() => void>();

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
    subscriptions.clear();
    options?.testEvents.clear();
    options?.onRelease?.();
  };

  const ensureActive = (): void => {
    if (state !== "active") {
      throw createStateError(state, invalidationReason);
    }
  };
  options.testEvents.setEnsureUsable(ensureActive);

  const hardDispose = async (reason: string): Promise<void> => {
    if (state === "disposed" || state === "invalidated") {
      release();
      return;
    }
    state = "disposed";
    await options?.abortBindings?.(reason);
    try {
      await disposeWithUnresponsiveFallback(
        () => runtime.dispose({ hard: true, reason }),
        reason,
        options.onUnresponsiveDispose,
      );
    } catch (error) {
      if (!isBenignDisposeError(error)) {
        throw error;
      }
    } finally {
      release();
    }
  };

  return {
    async eval(code, evalOptions) {
      ensureActive();
      diagnostics.lifecycleState = "active";
      try {
        await runAbortableOperation(async () => {
          await runtime.eval(code, {
            filename: evalOptions?.filename,
            executionTimeout: evalOptions?.executionTimeout,
          });
        }, {
          signal: evalOptions?.signal,
          disposeOnAbort: hardDispose,
        });
      } catch (error) {
        diagnostics.lastError = getErrorMessage(error);
        if (!isAbortError(error) && isTerminalExecutionError(error)) {
          await hardDispose(diagnostics.lastError).catch(() => {});
        }
        throw error;
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    async runTests(code, runOptions) {
      ensureActive();
      diagnostics.lifecycleState = "active";
      try {
        return await runAbortableOperation(async () => {
          await runtime.testEnvironment.reset();
          await runtime.eval(code, {
            filename: runOptions?.filename,
            executionTimeout: runOptions?.timeoutMs,
          });
          lastRun = await runtime.testEnvironment.runTests(runOptions?.timeoutMs);
          return lastRun;
        }, {
          signal: runOptions?.signal,
          disposeOnAbort: hardDispose,
        });
      } catch (error) {
        diagnostics.lastError = getErrorMessage(error);
        if (!isAbortError(error) && isTerminalExecutionError(error)) {
          await hardDispose(diagnostics.lastError).catch(() => {});
        }
        throw error;
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    async diagnostics(): Promise<TestRuntimeDiagnostics> {
      ensureActive();
      const runtimeDiagnostics = {
        ...diagnostics,
        reused: runtime.reused,
      };
      const collectedData = options?.hasBrowser
        ? runtime.playwright.getCollectedData()
        : undefined;
      const trackedResources = options?.hasBrowser
        ? runtime.playwright.getTrackedResources()
        : undefined;

      return {
        runtime: runtimeDiagnostics,
        browser: collectedData
          ? createBrowserDiagnostics(collectedData, trackedResources)
          : undefined,
        test: {
          enabled: true as const,
          registeredTests: await runtime.testEnvironment.getTestCount(),
          lastRun,
        },
      };
    },
    async dispose(disposeOptions) {
      if (state === "invalidated" || state === "disposed") {
        release();
        return;
      }

      state = "disposed";
      diagnostics.lifecycleState = "disposing";
      try {
        await options?.abortBindings?.(disposeOptions?.reason);
        await runtime.dispose(disposeOptions);
      } catch (error) {
        if (!isBenignDisposeError(error)) {
          diagnostics.lastError = getErrorMessage(error);
          throw error;
        }
      } finally {
        diagnostics.lifecycleState = "idle";
        release();
      }
    },
    async invalidate(reason) {
      if (state === "disposed" || state === "invalidated") {
        release();
        return;
      }
      state = "invalidated";
      invalidationReason = reason;
      diagnostics.lifecycleState = "idle";
      await options?.abortBindings?.(reason);
      release();
    },
    test: options.testEvents.api,
    events: {
      on: (event, handler) => {
        ensureActive();
        const unsubscribe = runtime.on(event, handler);
        subscriptions.add(unsubscribe);
        return () => {
          if (subscriptions.delete(unsubscribe)) {
            unsubscribe();
          }
        };
      },
      emit: async (event, payload) => {
        ensureActive();
        runtime.emit(event, payload);
      },
    },
  };
}
