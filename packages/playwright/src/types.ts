/**
 * Client-safe types for @ricsam/isolate-playwright
 * This module can be imported without loading isolated-vm
 */

// Re-export protocol types
export type {
  PlaywrightOperation,
  PlaywrightResult,
  PlaywrightEvent,
  PlaywrightFileData,
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
  stdout: string;
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
 * Symbol key used to attach metadata to handlers created by
 * defaultPlaywrightHandler(). Enables adapter layers to keep local ergonomics
 * (event capture, collected data) without exposing page-mode in runtime options.
 */
export const DEFAULT_PLAYWRIGHT_HANDLER_META = Symbol.for(
  "@ricsam/isolate-playwright/default-handler-meta"
);

/**
 * Options for defaultPlaywrightHandler(page, options).
 */
export interface DefaultPlaywrightHandlerOptions {
  /** Default timeout for operations */
  timeout?: number;
  /** Callback to read files for setInputFiles() with file paths */
  readFile?: (filePath: string) => Promise<import("@ricsam/isolate-protocol").PlaywrightFileData> | import("@ricsam/isolate-protocol").PlaywrightFileData;
  /** Callback to write files for screenshot()/pdf() with path option */
  writeFile?: (filePath: string, data: Buffer) => Promise<void> | void;
  /** Callback to create new pages when context.newPage() is called */
  createPage?: (context: import("playwright").BrowserContext) => Promise<import("playwright").Page> | import("playwright").Page;
  /** Callback to create new contexts when browser.newContext() is called */
  createContext?: (options?: import("playwright").BrowserContextOptions) => Promise<import("playwright").BrowserContext> | import("playwright").BrowserContext;
}

/**
 * Metadata attached to handlers created by defaultPlaywrightHandler().
 */
export interface DefaultPlaywrightHandlerMetadata {
  page: import("playwright").Page;
  options?: DefaultPlaywrightHandlerOptions;
}

/**
 * Handler created by defaultPlaywrightHandler().
 */
export type DefaultPlaywrightHandler = PlaywrightCallback & {
  [DEFAULT_PLAYWRIGHT_HANDLER_META]?: DefaultPlaywrightHandlerMetadata;
};

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
  /** If true, browser console logs are printed to stdout */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: import("@ricsam/isolate-protocol").PlaywrightEvent) => void;
  /**
   * Callback to read files for setInputFiles() operations.
   * This allows the host to control which files the isolate can access.
   * If not provided, setInputFiles() with file paths will throw an error.
   */
  readFile?: (filePath: string) => Promise<import("@ricsam/isolate-protocol").PlaywrightFileData> | import("@ricsam/isolate-protocol").PlaywrightFileData;
  /**
   * Callback to write files for screenshot() and pdf() operations with path option.
   * This allows the host to control where files are written.
   * If not provided, screenshot()/pdf() with path option will throw an error.
   */
  writeFile?: (filePath: string, data: Buffer) => Promise<void> | void;
  /**
   * Callback invoked when context.newPage() is called from within the isolate.
   * Host creates/configures the new page. If not provided, newPage() will throw an error.
   * Receives the BrowserContext so you can call context.newPage().
   * @param context - The BrowserContext that requested the new page
   * @returns The new Page object
   */
  createPage?: (context: import("playwright").BrowserContext) => Promise<import("playwright").Page> | import("playwright").Page;
  /**
   * Callback invoked when browser.newContext() is called from within the isolate.
   * Host creates/configures the new context. If not provided, newContext() will throw an error.
   * @param options - Browser context options passed from the isolate
   * @returns The new BrowserContext object
   */
  createContext?: (options?: import("playwright").BrowserContextOptions) => Promise<import("playwright").BrowserContext> | import("playwright").BrowserContext;
}

export interface PlaywrightHandle {
  dispose(): void;
  /** Get browser console logs (from the page, not sandbox) */
  getBrowserConsoleLogs(): BrowserConsoleLogEntry[];
  getNetworkRequests(): NetworkRequestInfo[];
  getNetworkResponses(): NetworkResponseInfo[];
  clearCollected(): void;
}
