/**
 * Types for the isolate client.
 */

import type {
  RunTestsResult,
  TestResult as ProtocolTestResult,
  TestInfo as ProtocolTestInfo,
  TestError as ProtocolTestError,
  TestEvent as ProtocolTestEvent,
  SuiteInfo as ProtocolSuiteInfo,
  SuiteResult as ProtocolSuiteResult,
  CollectedData as ProtocolCollectedData,
  ConsoleEntry as ProtocolConsoleEntry,
  PlaywrightEvent as ProtocolPlaywrightEvent,
  CustomFunctionType,
} from "@ricsam/isolate-protocol";

// Re-export test result types
export type RunResults = RunTestsResult;
export type TestResult = ProtocolTestResult;
export type TestInfo = ProtocolTestInfo;
export type TestError = ProtocolTestError;
export type TestEvent = ProtocolTestEvent;
export type SuiteInfo = ProtocolSuiteInfo;
export type SuiteResult = ProtocolSuiteResult;
export type CollectedData = ProtocolCollectedData;
export type ConsoleEntry = ProtocolConsoleEntry;
export type PlaywrightEvent = ProtocolPlaywrightEvent;

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
 * Test environment options for createRuntime.
 */
export interface TestEnvironmentOptions {
  /** Receive test lifecycle events */
  onEvent?: (event: TestEvent) => void;
  /** Timeout for individual tests (ms) */
  testTimeout?: number;
}

/**
 * Options for creating a runtime.
 */
export interface RuntimeOptions {
  /** Memory limit in megabytes (optional) */
  memoryLimitMB?: number;
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
  /** Enable test environment (describe, it, expect, etc.) */
  testEnvironment?: boolean | TestEnvironmentOptions;
  /** Playwright options - user provides page */
  playwright?: PlaywrightOptions;
}

/**
 * Options for Playwright integration.
 * User provides the page object - client owns the browser.
 */
export interface PlaywrightOptions {
  /** Playwright page object */
  page: import("playwright").Page;
  /** Default timeout for operations in ms */
  timeout?: number;
  /** Base URL for navigation */
  baseUrl?: string;
  /** If true, browser console logs are routed through console handler (or printed to stdout if no handler) */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
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

export type { CustomFunctionType };

/**
 * A custom function that can be called from within the isolate.
 */
export type CustomFunction = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * An async generator function that can be consumed in the isolate via for await...of.
 */
export type CustomAsyncGeneratorFunction = (...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>;

/**
 * Custom function definition with metadata.
 */
export interface CustomFunctionDefinition {
  /** The function implementation */
  fn: CustomFunction | CustomAsyncGeneratorFunction;
  /** Function type: 'sync', 'async', or 'asyncIterator' */
  type: CustomFunctionType;
}

/**
 * Custom functions to register in the runtime.
 */
export type CustomFunctions = Record<string, CustomFunctionDefinition>;

/**
 * Options for eval() method.
 */
export interface EvalOptions {
  /** Filename for stack traces */
  filename?: string;
  /** Maximum execution time in milliseconds. If exceeded, throws a timeout error. */
  maxExecutionMs?: number;
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
  /** Test environment handle (methods throw if not enabled) */
  readonly testEnvironment: RemoteTestEnvironmentHandle;
  /** Playwright handle (methods throw if not configured) */
  readonly playwright: RemotePlaywrightHandle;

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

  /** Dispose the runtime */
  dispose(): Promise<void>;
}

/**
 * Remote test environment handle.
 * All methods are async since they communicate over IPC.
 */
export interface RemoteTestEnvironmentHandle {
  /** Run all registered tests and return results */
  runTests(timeout?: number): Promise<RunResults>;
  /** Check if any tests are registered */
  hasTests(): Promise<boolean>;
  /** Get count of registered tests */
  getTestCount(): Promise<number>;
  /** Reset test environment state */
  reset(): Promise<void>;
}

/**
 * Remote playwright handle - provides access to browser data collection.
 * All methods are async since they communicate over IPC.
 */
export interface RemotePlaywrightHandle {
  /** Get collected browser console logs and network data */
  getCollectedData(): Promise<CollectedData>;
  /** Clear collected data */
  clearCollectedData(): Promise<void>;
}

/**
 * Options for dispatching a request.
 */
export interface DispatchOptions {
  /** Request timeout in ms */
  timeout?: number;
}

