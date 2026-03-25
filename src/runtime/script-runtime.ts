import type { MutableRuntimeDiagnostics } from "../bridge/diagnostics.ts";
import { isBenignDisposeError, type RemoteRuntime } from "../internal/client/index.ts";
import type { ScriptRuntime } from "../types.ts";

export function createScriptRuntimeAdapter(
  runtime: RemoteRuntime,
  diagnostics: MutableRuntimeDiagnostics,
  options?: { onBeforeDispose?: (reason?: string) => void },
): ScriptRuntime {
  return {
    async eval(code, evalOptions) {
      const normalizedOptions = typeof evalOptions === "string"
        ? { filename: evalOptions }
        : evalOptions;
      diagnostics.lifecycleState = "active";
      try {
        await runtime.eval(code, {
          filename: normalizedOptions?.filename,
          executionTimeout: normalizedOptions?.executionTimeout,
        });
      } catch (error) {
        diagnostics.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    async dispose(disposeOptions) {
      diagnostics.lifecycleState = "disposing";
      try {
        options?.onBeforeDispose?.(disposeOptions?.reason);
        await runtime.dispose(disposeOptions);
      } catch (error) {
        if (!isBenignDisposeError(error)) {
          diagnostics.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    diagnostics: async () => ({
      ...diagnostics,
      reused: runtime.reused,
    }),
    events: {
      on: (event, handler) => runtime.on(event, handler),
      emit: async (event, payload) => {
        runtime.emit(event, payload);
      },
    },
    tests: {
      run: async (testOptions) => await runtime.testEnvironment.runTests(testOptions?.timeoutMs),
      hasTests: async () => await runtime.testEnvironment.hasTests(),
      reset: async () => {
        await runtime.testEnvironment.reset();
      },
    },
  };
}
