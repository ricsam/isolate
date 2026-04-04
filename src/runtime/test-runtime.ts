import {
  createBrowserDiagnostics,
  createRuntimeDiagnostics,
} from "../bridge/diagnostics.ts";
import {
  createRuntimeBindingsAdapter,
  type RuntimeBindingsAdapterOptions,
} from "../bridge/runtime-bindings.ts";
import type { RemoteRuntime, RuntimeOptions } from "../internal/client/index.ts";
import { isBenignDisposeError } from "../internal/client/index.ts";
import type {
  CreateTestRuntimeOptions,
  RunResults,
  TestRuntime,
} from "../types.ts";

export async function createTestRuntimeAdapter(
  createRuntime: (options: RuntimeOptions) => Promise<RemoteRuntime>,
  options: CreateTestRuntimeOptions,
  adapterOptions?: RuntimeBindingsAdapterOptions,
): Promise<TestRuntime> {
  const diagnostics = createRuntimeDiagnostics();
  let runtimeId = options.key ?? "test-runtime";
  const bindingsAdapter = createRuntimeBindingsAdapter(
    options.bindings,
    () => runtimeId,
    diagnostics,
    adapterOptions,
  );
  const runtime = await createRuntime({
    ...bindingsAdapter.runtimeOptions,
    cwd: options.cwd,
    memoryLimitMB: options.memoryLimitMB,
    executionTimeout: options.executionTimeout,
    testEnvironment: true,
  });
  runtimeId = runtime.id;

  let lastRun: RunResults | undefined;

  return {
    async run(code, runOptions) {
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
    async diagnostics() {
      const runtimeDiagnostics = {
        ...diagnostics,
        reused: runtime.reused,
      };
      const collectedData = options.bindings.browser
        ? runtime.playwright.getCollectedData()
        : undefined;
      const trackedResources = options.bindings.browser
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
      diagnostics.lifecycleState = "disposing";
      try {
        bindingsAdapter.abort(disposeOptions?.reason);
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
  };
}
