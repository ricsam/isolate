import path from "node:path";
import { defaultPlaywrightHandler } from "../internal/playwright/client.ts";
import type { RemoteRuntime, RuntimeOptions } from "../internal/client/index.ts";
import { createRuntimeDiagnostics } from "../bridge/diagnostics.ts";
import {
  createRuntimeBindingsAdapter,
  type RuntimeBindingsAdapterOptions,
} from "../bridge/runtime-bindings.ts";
import { createScriptRuntimeAdapter } from "../runtime/script-runtime.ts";
import type { BrowserRuntime, BrowserRuntimeDiagnostics, CreateBrowserRuntimeOptions } from "../types.ts";

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

export async function createBrowserRuntimeAdapter(
  createRuntime: (options: RuntimeOptions) => Promise<RemoteRuntime>,
  options: CreateBrowserRuntimeOptions,
  adapterOptions?: RuntimeBindingsAdapterOptions,
): Promise<BrowserRuntime> {
  const diagnostics = createRuntimeDiagnostics();
  let runtimeId = options.key ?? "browser-runtime";
  const bindingsAdapter = createRuntimeBindingsAdapter(
    options.bindings,
    () => runtimeId,
    diagnostics,
    adapterOptions,
  );
  const readFile = options.browser.readFile
    ? async (filePath: string) => {
        const buffer = await options.browser.readFile!(filePath);
        return {
          name: path.basename(filePath),
          mimeType: getMimeType(filePath),
          buffer,
        };
      }
    : undefined;
  const playwrightHandler = defaultPlaywrightHandler(options.browser.page as never, {
    readFile,
    writeFile: options.browser.writeFile as never,
    createPage: options.browser.createPage as never,
    createContext: options.browser.createContext as never,
  });
  const runtime = await createRuntime({
    ...bindingsAdapter.runtimeOptions,
    cwd: options.cwd,
    memoryLimitMB: options.memoryLimitMB,
    executionTimeout: options.executionTimeout,
    testEnvironment: options.features?.tests ?? false,
    playwright: {
      handler: playwrightHandler,
      hasDefaultPage: true,
      console: options.browser.captureConsole ?? false,
      onEvent: options.browser.onEvent,
    },
  });
  runtimeId = runtime.id;
  const scriptRuntime = createScriptRuntimeAdapter(runtime, diagnostics, {
    onBeforeDispose: (reason) => bindingsAdapter.abort(reason),
  });

  return {
    async run(code, runOptions) {
      await scriptRuntime.eval(code, {
        filename: runOptions?.filename,
        executionTimeout: runOptions?.timeoutMs,
      });

      if (runOptions?.asTestSuite && (await runtime.testEnvironment.hasTests())) {
        return {
          tests: await runtime.testEnvironment.runTests(runOptions.timeoutMs),
        };
      }

      return {};
    },
    async diagnostics(): Promise<BrowserRuntimeDiagnostics> {
      const collectedData = runtime.playwright.getCollectedData();
      return {
        ...(await scriptRuntime.diagnostics()),
        browserConsoleLogs: collectedData.browserConsoleLogs.length,
        networkRequests: collectedData.networkRequests.length,
        networkResponses: collectedData.networkResponses.length,
        pageErrors: collectedData.pageErrors.length,
        requestFailures: collectedData.requestFailures.length,
        collectedData,
      };
    },
    dispose: async (disposeOptions) => {
      await scriptRuntime.dispose(disposeOptions);
    },
  };
}
