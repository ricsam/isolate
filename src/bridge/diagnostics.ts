import type { CollectedData } from "../internal/client/index.ts";
import type { BrowserDiagnostics, RuntimeDiagnostics } from "../types.ts";

export interface MutableRuntimeDiagnostics extends RuntimeDiagnostics {
  activeRequests: number;
  activeResources: number;
  pendingFiles: number;
  pendingFetches: number;
  pendingModules: number;
  pendingTools: number;
  streamCount: number;
  lifecycleState: "idle" | "active" | "reloading" | "disposing";
}

export function createRuntimeDiagnostics(): MutableRuntimeDiagnostics {
  return {
    activeRequests: 0,
    activeResources: 0,
    pendingFiles: 0,
    pendingFetches: 0,
    pendingModules: 0,
    pendingTools: 0,
    streamCount: 0,
    lifecycleState: "idle",
  };
}

export function createBrowserDiagnostics(
  collectedData: CollectedData,
  trackedResources?: { contexts: string[]; pages: string[] },
): BrowserDiagnostics {
  const contextIds = new Set<string>();
  const pageIds = new Set<string>();
  for (const entry of collectedData.browserConsoleLogs) {
    contextIds.add(entry.contextId);
    pageIds.add(entry.pageId);
  }
  for (const entry of collectedData.pageErrors) {
    contextIds.add(entry.contextId);
    pageIds.add(entry.pageId);
  }
  for (const entry of collectedData.networkRequests) {
    contextIds.add(entry.contextId);
    pageIds.add(entry.pageId);
  }
  for (const entry of collectedData.networkResponses) {
    contextIds.add(entry.contextId);
    pageIds.add(entry.pageId);
  }
  for (const entry of collectedData.requestFailures) {
    contextIds.add(entry.contextId);
    pageIds.add(entry.pageId);
  }

  return {
    contexts: trackedResources?.contexts.length ?? contextIds.size,
    pages: trackedResources?.pages.length ?? pageIds.size,
    browserConsoleLogs: collectedData.browserConsoleLogs.length,
    networkRequests: collectedData.networkRequests.length,
    networkResponses: collectedData.networkResponses.length,
    pageErrors: collectedData.pageErrors.length,
    requestFailures: collectedData.requestFailures.length,
    collectedData,
  };
}
