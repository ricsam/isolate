/**
 * Types for the isolate client.
 */

import type {
  RunTestsResult,
  TestResult as ProtocolTestResult,
  PlaywrightTestResult as ProtocolPlaywrightTestResult,
  CollectedData as ProtocolCollectedData,
  ConsoleEntry as ProtocolConsoleEntry,
} from "@ricsam/isolate-protocol";

// Re-export test result types
export type TestResults = RunTestsResult;
export type TestResult = ProtocolTestResult;
export type PlaywrightTestResults = ProtocolPlaywrightTestResult;
export type CollectedData = ProtocolCollectedData;
export type ConsoleEntry = ProtocolConsoleEntry;

/**
 * Options for connecting to the daemon.
 */
export interface ConnectOptions {
  /** Unix socket path */
  socket?: string;
  /** TCP host */
  host?: string;
  /** TCP port */
  port?: number;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Connection to the daemon.
 */
export interface DaemonConnection {
  /** Create a new runtime in the daemon */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
  /** Close the connection */
  close(): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Options for creating a runtime.
 */
export interface RuntimeOptions {
  /** Memory limit in MB */
  memoryLimit?: number;
  /** Console callback handlers */
  console?: ConsoleCallbacks;
  /** Fetch callback handler */
  fetch?: FetchCallback;
  /** File system callback handlers */
  fs?: FileSystemCallbacks;
  /** Module loader callback for resolving dynamic imports */
  moduleLoader?: ModuleLoaderCallback;
  /** Custom functions callable from within the isolate */
  customFunctions?: CustomFunctions;
  /** Current working directory for path.resolve(). Defaults to "/" */
  cwd?: string;
}

/**
 * Console callback handlers with single structured callback.
 */
export interface ConsoleCallbacks {
  /**
   * Callback invoked for each console operation.
   * Receives a structured entry with all data needed to render the output.
   */
  onEntry?: (entry: ConsoleEntry) => void;
}

/**
 * Fetch callback type.
 */
export type FetchCallback = (request: Request) => Response | Promise<Response>;

/**
 * File system callback handlers.
 */
export interface FileSystemCallbacks {
  readFile?: (path: string) => Promise<ArrayBuffer>;
  writeFile?: (path: string, data: ArrayBuffer) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  readdir?: (path: string) => Promise<string[]>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rmdir?: (path: string) => Promise<void>;
  stat?: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Module loader callback type.
 * Called when the isolate imports a module dynamically.
 * Returns the JavaScript source code for the module.
 */
export type ModuleLoaderCallback = (moduleName: string) => string | Promise<string>;

/**
 * A custom function that can be called from within the isolate.
 */
export type CustomFunction = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Custom function definition with metadata.
 */
export interface CustomFunctionDefinition {
  /** The function implementation */
  fn: CustomFunction;
  /** Whether the function is async (defaults to true for safety) */
  async?: boolean;
}

/**
 * Custom functions to register in the runtime.
 * Can be either a function directly (treated as async) or a definition with metadata.
 */
export type CustomFunctions = Record<string, CustomFunction | CustomFunctionDefinition>;

/**
 * @deprecated Use the simplified eval signature instead: eval(code: string, filename?: string)
 */
export interface EvalOptions {
  /** Filename for stack traces */
  filename?: string;
  /**
   * @deprecated Always uses module mode now. This option is ignored.
   */
  module?: boolean;
}

/**
 * WebSocket upgrade request info.
 */
export interface UpgradeRequest {
  requested: true;
  connectionId: string;
}

/**
 * WebSocket command from isolate.
 */
export interface WebSocketCommand {
  type: "message" | "close";
  connectionId: string;
  data?: string | ArrayBuffer;
  code?: number;
  reason?: string;
}

/**
 * Remote fetch handle - provides access to fetch/serve operations.
 * All methods are async since they communicate over IPC.
 */
export interface RemoteFetchHandle {
  /** Dispatch HTTP request to serve() handler */
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  /** Check if isolate requested WebSocket upgrade */
  getUpgradeRequest(): Promise<UpgradeRequest | null>;
  /** Dispatch WebSocket open event to isolate */
  dispatchWebSocketOpen(connectionId: string): Promise<void>;
  /** Dispatch WebSocket message event to isolate */
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): Promise<void>;
  /** Dispatch WebSocket close event to isolate */
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): Promise<void>;
  /** Dispatch WebSocket error event to isolate */
  dispatchWebSocketError(connectionId: string, error: Error): Promise<void>;
  /** Register callback for WebSocket commands from isolate */
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
  /** Check if serve() has been called */
  hasServeHandler(): Promise<boolean>;
  /** Check if there are active WebSocket connections */
  hasActiveConnections(): Promise<boolean>;
}

/**
 * Remote timers handle - provides access to timer operations.
 * Timers fire automatically based on real time.
 * All methods are async since they communicate over IPC.
 */
export interface RemoteTimersHandle {
  /** Clear all pending timers */
  clearAll(): Promise<void>;
}

/**
 * Remote console handle - provides access to console state.
 * All methods are async since they communicate over IPC.
 */
export interface RemoteConsoleHandle {
  /** Reset all console state (timers, counters, group depth) */
  reset(): Promise<void>;
  /** Get console.time() timers */
  getTimers(): Promise<Map<string, number>>;
  /** Get console.count() counters */
  getCounters(): Promise<Map<string, number>>;
  /** Get current console.group() nesting depth */
  getGroupDepth(): Promise<number>;
}

/**
 * Remote runtime handle.
 */
export interface RemoteRuntime {
  /** Unique runtime identifier */
  readonly id: string;

  /**
   * @deprecated Use id instead
   */
  readonly isolateId: string;

  /** Fetch handle - access to fetch/serve operations */
  readonly fetch: RemoteFetchHandle;
  /** Timers handle - access to timer operations */
  readonly timers: RemoteTimersHandle;
  /** Console handle - access to console state */
  readonly console: RemoteConsoleHandle;

  /**
   * Execute code as ES module in the isolate.
   * Supports top-level await.
   * @param code - The code to execute
   * @param filename - Optional filename for stack traces
   */
  eval(code: string, filename?: string): Promise<void>;

  /**
   * @deprecated Use the new signature: eval(code: string, filename?: string)
   */
  eval(code: string, options?: EvalOptions): Promise<void>;

  /** Setup test environment (describe, it, expect, etc.) */
  setupTestEnvironment(): Promise<void>;

  /** Run all registered tests and return results */
  runTests(timeout?: number): Promise<TestResults>;

  /** Setup Playwright browser environment */
  setupPlaywright(options?: PlaywrightSetupOptions): Promise<void>;

  /** Run all registered Playwright tests */
  runPlaywrightTests(timeout?: number): Promise<PlaywrightTestResults>;

  /** Reset/clear all Playwright tests */
  resetPlaywrightTests(): Promise<void>;

  /** Get collected console logs and network data */
  getCollectedData(): Promise<CollectedData>;

  /** Dispose the runtime */
  dispose(): Promise<void>;
}

/**
 * Options for dispatching a request.
 */
export interface DispatchOptions {
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Options for setting up Playwright.
 */
export interface PlaywrightSetupOptions {
  /** Browser type to use */
  browserType?: "chromium" | "firefox" | "webkit";
  /** Run browser in headless mode */
  headless?: boolean;
  /** Base URL for navigation */
  baseURL?: string;
  /** Console log event handler */
  onConsoleLog?: (log: { level: string; args: unknown[] }) => void;
  /** Network request event handler */
  onNetworkRequest?: (request: { url: string; method: string; headers: Record<string, string>; timestamp: number }) => void;
  /** Network response event handler */
  onNetworkResponse?: (response: { url: string; status: number; headers: Record<string, string>; timestamp: number }) => void;
}

/**
 * Handler for Playwright events streamed from daemon.
 */
export interface PlaywrightEventHandler {
  onConsoleLog?: (log: { level: string; args: unknown[] }) => void;
  onNetworkRequest?: (request: { url: string; method: string; headers: Record<string, string>; timestamp: number }) => void;
  onNetworkResponse?: (response: { url: string; status: number; headers: Record<string, string>; timestamp: number }) => void;
}
