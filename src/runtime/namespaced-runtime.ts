import {
  createBrowserDiagnostics,
  type MutableRuntimeDiagnostics,
} from "../bridge/diagnostics.ts";
import { isBenignDisposeError, type RemoteRuntime } from "../internal/client/index.ts";
import type {
  NamespacedRuntime,
  RunResults,
  TestRuntimeDiagnostics,
} from "../types.ts";

type RuntimeState = "active" | "disposed" | "invalidated";

export interface NamespacedRuntimeAdapter extends NamespacedRuntime {
  invalidate(reason?: string): void;
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
  options?: {
    hasBrowser?: boolean;
    abortBindings?: (reason?: string) => void;
    onRelease?: () => void;
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
    options?.onRelease?.();
  };

  const ensureActive = (): void => {
    if (state !== "active") {
      throw createStateError(state, invalidationReason);
    }
  };

  return {
    async eval(code, evalOptions) {
      ensureActive();
      diagnostics.lifecycleState = "active";
      try {
        await runtime.eval(code, {
          filename: evalOptions?.filename,
          executionTimeout: evalOptions?.executionTimeout,
        });
      } catch (error) {
        diagnostics.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    async runTests(code, runOptions) {
      ensureActive();
      diagnostics.lifecycleState = "active";
      try {
        await runtime.testEnvironment.reset();
        await runtime.eval(code, {
          filename: runOptions?.filename,
          executionTimeout: runOptions?.timeoutMs,
        });
        lastRun = await runtime.testEnvironment.runTests(runOptions?.timeoutMs);
        return lastRun;
      } catch (error) {
        diagnostics.lastError = error instanceof Error ? error.message : String(error);
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
        options?.abortBindings?.(disposeOptions?.reason);
        await runtime.dispose(disposeOptions);
      } catch (error) {
        if (!isBenignDisposeError(error)) {
          diagnostics.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      } finally {
        diagnostics.lifecycleState = "idle";
        release();
      }
    },
    invalidate(reason) {
      if (state === "disposed" || state === "invalidated") {
        release();
        return;
      }
      state = "invalidated";
      invalidationReason = reason;
      diagnostics.lifecycleState = "idle";
      options?.abortBindings?.(reason);
      release();
    },
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
