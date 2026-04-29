import {
  createBrowserDiagnostics,
  type MutableRuntimeDiagnostics,
} from "../bridge/diagnostics.ts";
import { isBenignDisposeError, type RemoteRuntime } from "../internal/client/index.ts";
import type { ScriptRuntime } from "../types.ts";
import {
  disposeWithUnresponsiveFallback,
  getErrorMessage,
  isAbortError,
  isTerminalExecutionError,
  runAbortableOperation,
  type UnresponsiveDisposeHandler,
} from "./abort.ts";

function createDisposedScriptRuntimeError(): Error {
  return new Error("Script runtime has already been disposed.");
}

export function createScriptRuntimeAdapter(
  runtime: RemoteRuntime,
  diagnostics: MutableRuntimeDiagnostics,
  options?: {
    hasBrowser?: boolean;
    onBeforeDispose?: (reason?: string) => void | Promise<void>;
    onUnresponsiveDispose?: UnresponsiveDisposeHandler;
  },
): ScriptRuntime {
  let isDisposed = false;

  const ensureActive = (): void => {
    if (isDisposed) {
      throw createDisposedScriptRuntimeError();
    }
  };

  const hardDispose = async (reason: string): Promise<void> => {
    if (isDisposed) {
      return;
    }
    isDisposed = true;
    await options?.onBeforeDispose?.(reason);
    try {
      await disposeWithUnresponsiveFallback(
        () => runtime.dispose({ hard: true, reason }),
        reason,
        options?.onUnresponsiveDispose,
      );
    } catch (error) {
      if (!isBenignDisposeError(error)) {
        throw error;
      }
    }
  };

  return {
    async eval(code, evalOptions) {
      ensureActive();
      const normalizedOptions = typeof evalOptions === "string"
        ? { filename: evalOptions }
        : evalOptions;
      diagnostics.lifecycleState = "active";
      try {
        await runAbortableOperation(async () => {
          await runtime.eval(code, {
            filename: normalizedOptions?.filename,
            executionTimeout: normalizedOptions?.executionTimeout,
          });
        }, {
          signal: normalizedOptions?.signal,
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
    async dispose(disposeOptions) {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      diagnostics.lifecycleState = "disposing";
      try {
        await options?.onBeforeDispose?.(disposeOptions?.reason);
        await runtime.dispose(disposeOptions);
      } catch (error) {
        if (!isBenignDisposeError(error)) {
          diagnostics.lastError = getErrorMessage(error);
          throw error;
        }
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    diagnostics: async () => {
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
      };
    },
    events: {
      on: (event, handler) => {
        ensureActive();
        return runtime.on(event, handler);
      },
      emit: async (event, payload) => {
        ensureActive();
        runtime.emit(event, payload);
      },
    },
  };
}
