/**
 * Client-safe types for @ricsam/isolate-playwright
 * This module can be imported without loading isolated-vm
 */

// Re-export protocol types
export type {
  PlaywrightOperation,
  PlaywrightResult,
  PlaywrightEvent,
} from "@ricsam/isolate-protocol";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface NetworkRequestInfo {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
}

export interface NetworkResponseInfo {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Browser console log entry - logs from the page context (not sandbox).
 */
export interface BrowserConsoleLogEntry {
  level: string;
  args: string[];
  timestamp: number;
}

/**
 * Callback type for handling playwright operations.
 * Used for remote execution where the page lives on the client.
 */
export type PlaywrightCallback = (
  op: import("@ricsam/isolate-protocol").PlaywrightOperation
) => Promise<import("@ricsam/isolate-protocol").PlaywrightResult>;

/**
 * Options for setting up playwright in an isolate.
 */
export interface PlaywrightSetupOptions {
  /** Direct page object (for local use) */
  page?: import("playwright").Page;
  /** Handler callback (for remote use - daemon invokes this) */
  handler?: PlaywrightCallback;
  /** Default timeout for operations */
  timeout?: number;
  /** Base URL for relative navigation */
  baseUrl?: string;
  /** If true, browser console logs are printed to stdout */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: import("@ricsam/isolate-protocol").PlaywrightEvent) => void;
}

/**
 * @deprecated Use PlaywrightSetupOptions instead
 */
export interface PlaywrightOptions {
  page: import("playwright").Page;
  timeout?: number;
  baseUrl?: string;
  onNetworkRequest?: (info: NetworkRequestInfo) => void;
  onNetworkResponse?: (info: NetworkResponseInfo) => void;
}

export interface PlaywrightHandle {
  dispose(): void;
  /** Get browser console logs (from the page, not sandbox) */
  getBrowserConsoleLogs(): BrowserConsoleLogEntry[];
  getNetworkRequests(): NetworkRequestInfo[];
  getNetworkResponses(): NetworkResponseInfo[];
  clearCollected(): void;
}
