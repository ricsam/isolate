import { isBenignDisposeError, type RemoteRuntime } from "../internal/client/index.ts";
import type { ScriptRuntime } from "../types.ts";
import type { MutableRuntimeDiagnostics } from "../bridge/diagnostics.ts";

export function createScriptRuntimeAdapter(
  runtime: RemoteRuntime,
  diagnostics: MutableRuntimeDiagnostics,
): ScriptRuntime {
  return {
    async eval(code, options) {
      const normalizedOptions = typeof options === "string"
        ? { filename: options }
        : options;
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
    async dispose(options) {
      diagnostics.lifecycleState = "disposing";
      try {
        await runtime.dispose(options);
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
      run: async (options) => await runtime.testEnvironment.runTests(options?.timeoutMs),
      hasTests: async () => await runtime.testEnvironment.hasTests(),
      reset: async () => {
        await runtime.testEnvironment.reset();
      },
    },
  };
}
