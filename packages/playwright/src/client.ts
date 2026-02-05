/**
 * Client-safe exports for @ricsam/isolate-playwright
 * This module can be imported without loading isolated-vm
 */

// Re-export types from types.ts
export type {
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  DefaultPlaywrightHandler,
  DefaultPlaywrightHandlerMetadata,
  DefaultPlaywrightHandlerOptions,
  PlaywrightSetupOptions,
  PlaywrightHandle,
  PlaywrightCallback,
} from "./types.ts";

export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent, PlaywrightFileData } from "@ricsam/isolate-protocol";

// Re-export handler functions
export {
  createPlaywrightHandler,
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
} from "./handler.ts";
