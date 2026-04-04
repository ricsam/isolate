/**
 * Client-safe exports for ./index.ts
 * This module can be imported without loading isolated-vm
 */

// Re-export types from types.ts
export type {
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PageErrorInfo,
  RequestFailureInfo,
  DefaultPlaywrightHandler,
  DefaultPlaywrightHandlerMetadata,
  DefaultPlaywrightHandlerOptions,
  PlaywrightCollector,
  PlaywrightHandlerMetadata,
  PlaywrightSetupOptions,
  PlaywrightHandle,
  PlaywrightCallback,
} from "./types.ts";

export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent, PlaywrightFileData } from "../protocol/index.ts";

// Re-export handler functions
export {
  createPlaywrightHandler,
  createPlaywrightFactoryHandler,
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
  getPlaywrightHandlerMetadata,
} from "./handler.ts";
