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
  EvalOptions as ProtocolEvalOptions,
  TestEnvironmentOptions as ProtocolTestEnvironmentOptions,
  PlaywrightOptions as ProtocolPlaywrightOptions,
  BaseRuntimeOptions,
  ConsoleCallbacks,
  FetchCallback,
  WebSocketCallback,
  FileSystemCallbacks,
  ModuleLoaderCallback,
  ModuleLoaderResult,
  CustomFunction,
  CustomAsyncGeneratorFunction,
  CustomFunctionDefinition,
  CustomFunctions,
  DispatchOptions,
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

// Re-export shared types from protocol
export type EvalOptions = ProtocolEvalOptions;
export type TestEnvironmentOptions = ProtocolTestEnvironmentOptions;
export type PlaywrightOptions = ProtocolPlaywrightOptions;
export type {
  ConsoleCallbacks,
  FetchCallback,
  WebSocketCallback,
  FileSystemCallbacks,
  ModuleLoaderCallback,
  ModuleLoaderResult,
  CustomFunction,
  CustomAsyncGeneratorFunction,
  CustomFunctionDefinition,
  CustomFunctions,
  CustomFunctionType,
  DispatchOptions,
};

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
 * Namespace for runtime pooling/reuse.
 * Runtimes created in a namespace are cached on dispose and can be reused.
 */
export interface Namespace {
  /** The namespace ID */
  readonly id: string;
  /** Create a runtime in this namespace (cacheable on dispose) */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
}

/**
 * Connection to the daemon.
 */
export interface DaemonConnection {
  /** Create a new runtime in the daemon */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
  /** Create a namespace for runtime pooling/reuse */
  createNamespace(id: string): Namespace;
  /** Close the connection */
  close(): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Options for creating a runtime.
 * Extends BaseRuntimeOptions and adds client-specific fs type.
 */
export interface RuntimeOptions<T extends Record<string, any[]> = Record<string, unknown[]>>
  extends BaseRuntimeOptions<T> {
  /** File system callback handlers */
  fs?: FileSystemCallbacks;
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

  /** True if runtime was reused from namespace pool */
  readonly reused?: boolean;

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
   * @param filenameOrOptions - Optional filename or eval options
   */
  eval(code: string, filenameOrOptions?: string | EvalOptions): Promise<void>;

  /**
   * Listen for events emitted from isolate code (via __emit).
   * @param event - The event name to listen for
   * @param callback - Called when the event is received
   * @returns Unsubscribe function
   */
  on(event: string, callback: (payload: unknown) => void): () => void;

  /**
   * Emit an event to the isolate (received via __on in isolate code).
   * @param event - The event name
   * @param payload - The event payload (must be JSON-serializable)
   */
  emit(event: string, payload: unknown): void;

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
 */
export interface RemotePlaywrightHandle {
  /** Get collected browser console logs and network data */
  getCollectedData(): CollectedData;
  /** Clear collected data */
  clearCollectedData(): void;
}
