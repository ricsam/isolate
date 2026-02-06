/**
 * Message types for the isolate daemon protocol.
 *
 * Frame format:
 * ┌──────────┬──────────┬─────────────────┐
 * │ Length   │ Type     │ Payload         │
 * │ (4 bytes)│ (1 byte) │ (MessagePack)   │
 * └──────────┴──────────┴─────────────────┘
 */

// ============================================================================
// Message Type Constants
// ============================================================================

export const MessageType = {
  // Client → Daemon: Runtime management
  CREATE_RUNTIME: 0x01,
  DISPOSE_RUNTIME: 0x02,
  EVAL: 0x03,
  DISPATCH_REQUEST: 0x04,

  // Client → Daemon: WebSocket operations
  WS_OPEN: 0x10,
  WS_MESSAGE: 0x11,
  WS_CLOSE: 0x12,

  // Client → Daemon: Handle operations
  FETCH_GET_UPGRADE_REQUEST: 0x13,
  FETCH_HAS_SERVE_HANDLER: 0x14,
  FETCH_HAS_ACTIVE_CONNECTIONS: 0x15,
  FETCH_WS_ERROR: 0x16,
  TIMERS_CLEAR_ALL: 0x17,
  CONSOLE_RESET: 0x18,
  CONSOLE_GET_TIMERS: 0x19,
  CONSOLE_GET_COUNTERS: 0x1a,
  CONSOLE_GET_GROUP_DEPTH: 0x1b,

  // Client → Daemon: Test environment
  RUN_TESTS: 0x21,
  RESET_TEST_ENV: 0x22,
  HAS_TESTS: 0x23,
  GET_TEST_COUNT: 0x24,

  // Client → Daemon: Playwright
  GET_COLLECTED_DATA: 0x33,
  CLEAR_COLLECTED_DATA: 0x34,

  // Daemon → Client: Responses
  RESPONSE_OK: 0x80,
  RESPONSE_ERROR: 0x81,
  RESPONSE_STREAM_START: 0x82,
  RESPONSE_STREAM_CHUNK: 0x83,
  RESPONSE_STREAM_END: 0x84,

  // Bidirectional: Callbacks
  CALLBACK_INVOKE: 0x90,
  CALLBACK_RESPONSE: 0x91,
  CALLBACK_STREAM_START: 0x92,
  CALLBACK_STREAM_CHUNK: 0x93,
  CALLBACK_STREAM_END: 0x94,
  CALLBACK_STREAM_CANCEL: 0x95,

  // Bidirectional: Stream data
  STREAM_PUSH: 0xa0,
  STREAM_PULL: 0xa1,
  STREAM_CLOSE: 0xa2,
  STREAM_ERROR: 0xa3,

  // Bidirectional: Generic events
  ISOLATE_EVENT: 0xc0,  // daemon → client
  CLIENT_EVENT: 0xc1,   // client → daemon

  // Heartbeat
  PING: 0xf0,
  PONG: 0xf1,
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Reverse lookup for message type names */
export const MessageTypeName: Record<number, string> = Object.fromEntries(
  Object.entries(MessageType).map(([k, v]) => [v, k])
);

// ============================================================================
// Error Codes
// ============================================================================

export const ErrorCode = {
  // Protocol errors
  INVALID_MESSAGE: 1001,
  UNKNOWN_MESSAGE_TYPE: 1002,
  MISSING_REQUIRED_FIELD: 1003,

  // Isolate errors
  ISOLATE_NOT_FOUND: 2001,
  ISOLATE_DISPOSED: 2002,
  ISOLATE_MEMORY_LIMIT: 2003,
  ISOLATE_TIMEOUT: 2004,

  // Execution errors
  SCRIPT_ERROR: 3001,
  CALLBACK_ERROR: 3002,

  // Stream errors
  STREAM_NOT_FOUND: 4001,
  STREAM_CLOSED: 4002,

  // Connection errors
  CONNECTION_LOST: 5001,
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ============================================================================
// Base Message Interface
// ============================================================================

export interface BaseMessage {
  /** Unique request ID for correlation */
  requestId: number;
}

// ============================================================================
// Callback Registration
// ============================================================================

/** Custom function type indicator */
export type CustomFunctionType = 'sync' | 'async' | 'asyncIterator';

export interface CallbackRegistration {
  /** Unique ID for this callback */
  callbackId: number;
  /** Callback name (e.g., "log", "warn", "fetch") */
  name: string;
  /** Function type: sync, async, or asyncIterator */
  type: CustomFunctionType;
}

export interface ConsoleCallbackRegistrations {
  onEntry?: CallbackRegistration;
}

export interface FsCallbackRegistrations {
  readFile?: CallbackRegistration;
  writeFile?: CallbackRegistration;
  unlink?: CallbackRegistration;
  readdir?: CallbackRegistration;
  mkdir?: CallbackRegistration;
  rmdir?: CallbackRegistration;
  stat?: CallbackRegistration;
  rename?: CallbackRegistration;
}

export interface CustomFunctionRegistrations {
  [name: string]: CallbackRegistration;
}

// ============================================================================
// Playwright Callback Types
// ============================================================================

/**
 * Playwright operation sent from daemon to client via callback.
 * The client executes this operation on the real Page object.
 */
export interface PlaywrightOperation {
  type:
    | "goto"
    | "reload"
    | "url"
    | "title"
    | "content"
    | "waitForSelector"
    | "waitForTimeout"
    | "waitForLoadState"
    | "evaluate"
    | "locatorAction"
    | "expectLocator"
    | "expectPage"
    | "request"
    | "goBack"
    | "goForward"
    | "waitForURL"
    | "waitForResponseStart"
    | "waitForResponseFinish"
    | "clearCookies"
    // Page-level operations
    | "screenshot"
    | "setViewportSize"
    | "viewportSize"
    | "emulateMedia"
    | "setExtraHTTPHeaders"
    | "bringToFront"
    | "close"
    | "isClosed"
    | "pdf"
    | "pause"
    | "frames"
    | "mainFrame"
    // Keyboard operations
    | "keyboardType"
    | "keyboardPress"
    | "keyboardDown"
    | "keyboardUp"
    | "keyboardInsertText"
    // Mouse operations
    | "mouseMove"
    | "mouseClick"
    | "mouseDown"
    | "mouseUp"
    | "mouseWheel"
    // Cookie operations
    | "addCookies"
    | "cookies"
    // Browser/Context lifecycle operations
    | "newContext"
    | "newPage"
    | "closeContext";
  args: unknown[];
  /** Target page ID (undefined = default page "page_0") */
  pageId?: string;
  /** Target context ID (undefined = default context "ctx_0") */
  contextId?: string;
}

/**
 * Result of a playwright operation.
 */
export type PlaywrightResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: { name: string; message: string } };

/**
 * Callback registrations for playwright operations.
 */
export interface PlaywrightCallbackRegistration {
  /** Callback ID for page operations */
  handlerCallbackId: number;
  /** If true, browser console logs are printed to stdout */
  console?: boolean;
  /** Optional callback for browser console log events (from the page, not sandbox) */
  onBrowserConsoleLogCallbackId?: number;
  /** Optional callback for network request events */
  onNetworkRequestCallbackId?: number;
  /** Optional callback for network response events */
  onNetworkResponseCallbackId?: number;
}

// ============================================================================
// Runtime Callback Registrations
// ============================================================================

export interface RuntimeCallbackRegistrations {
  console?: ConsoleCallbackRegistrations;
  fetch?: CallbackRegistration;
  fs?: FsCallbackRegistrations;
  moduleLoader?: CallbackRegistration;
  custom?: CustomFunctionRegistrations;
  playwright?: PlaywrightCallbackRegistration;
}

// ============================================================================
// Client → Daemon Messages
// ============================================================================

export interface TestEnvironmentCallbackRegistrations {
  /** Callback for test events */
  onEvent?: CallbackRegistration;
}

export interface TestEnvironmentOptionsProtocol {
  /** Callback registrations for test events */
  callbacks?: TestEnvironmentCallbackRegistrations;
  /** Timeout for individual tests (ms) */
  testTimeout?: number;
}

export interface CreateRuntimeRequest extends BaseMessage {
  type: typeof MessageType.CREATE_RUNTIME;
  options: {
    memoryLimitMB?: number;
    callbacks?: RuntimeCallbackRegistrations;
    /** Current working directory for path.resolve(). Defaults to "/" */
    cwd?: string;
    /** Enable test environment (describe, it, expect, etc.) */
    testEnvironment?: boolean | TestEnvironmentOptionsProtocol;
    /** Namespace ID for runtime pooling/reuse. If provided, runtime will be cached on dispose. */
    namespaceId?: string;
  };
}

export interface DisposeRuntimeRequest extends BaseMessage {
  type: typeof MessageType.DISPOSE_RUNTIME;
  isolateId: string;
}

export interface EvalRequest extends BaseMessage {
  type: typeof MessageType.EVAL;
  isolateId: string;
  code: string;
  filename?: string;
  /** Maximum execution time in milliseconds. If exceeded, throws a timeout error. */
  maxExecutionMs?: number;
}

export interface SerializedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  /** Inline body for small payloads */
  body?: Uint8Array | null;
  /** Stream reference for large/streaming bodies */
  bodyStreamId?: number;
}

export interface DispatchRequestRequest extends BaseMessage {
  type: typeof MessageType.DISPATCH_REQUEST;
  isolateId: string;
  request: SerializedRequest;
  options?: {
    timeout?: number;
  };
}

// WebSocket messages
export interface WsOpenRequest extends BaseMessage {
  type: typeof MessageType.WS_OPEN;
  isolateId: string;
  connectionId: string;
}

export interface WsMessageRequest extends BaseMessage {
  type: typeof MessageType.WS_MESSAGE;
  isolateId: string;
  connectionId: string;
  data: string | Uint8Array;
}

export interface WsCloseRequest extends BaseMessage {
  type: typeof MessageType.WS_CLOSE;
  isolateId: string;
  connectionId: string;
  code: number;
  reason: string;
}

// Handle operation messages
export interface FetchGetUpgradeRequestRequest extends BaseMessage {
  type: typeof MessageType.FETCH_GET_UPGRADE_REQUEST;
  isolateId: string;
}

export interface FetchHasServeHandlerRequest extends BaseMessage {
  type: typeof MessageType.FETCH_HAS_SERVE_HANDLER;
  isolateId: string;
}

export interface FetchHasActiveConnectionsRequest extends BaseMessage {
  type: typeof MessageType.FETCH_HAS_ACTIVE_CONNECTIONS;
  isolateId: string;
}

export interface FetchWsErrorRequest extends BaseMessage {
  type: typeof MessageType.FETCH_WS_ERROR;
  isolateId: string;
  connectionId: string;
  error: string;
}

export interface TimersClearAllRequest extends BaseMessage {
  type: typeof MessageType.TIMERS_CLEAR_ALL;
  isolateId: string;
}

export interface ConsoleResetRequest extends BaseMessage {
  type: typeof MessageType.CONSOLE_RESET;
  isolateId: string;
}

export interface ConsoleGetTimersRequest extends BaseMessage {
  type: typeof MessageType.CONSOLE_GET_TIMERS;
  isolateId: string;
}

export interface ConsoleGetCountersRequest extends BaseMessage {
  type: typeof MessageType.CONSOLE_GET_COUNTERS;
  isolateId: string;
}

export interface ConsoleGetGroupDepthRequest extends BaseMessage {
  type: typeof MessageType.CONSOLE_GET_GROUP_DEPTH;
  isolateId: string;
}

// Test environment messages
export interface RunTestsRequest extends BaseMessage {
  type: typeof MessageType.RUN_TESTS;
  isolateId: string;
  timeout?: number;
}

export interface ResetTestEnvRequest extends BaseMessage {
  type: typeof MessageType.RESET_TEST_ENV;
  isolateId: string;
}

export interface HasTestsRequest extends BaseMessage {
  type: typeof MessageType.HAS_TESTS;
  isolateId: string;
}

export interface GetTestCountRequest extends BaseMessage {
  type: typeof MessageType.GET_TEST_COUNT;
  isolateId: string;
}

export interface GetCollectedDataRequest extends BaseMessage {
  type: typeof MessageType.GET_COLLECTED_DATA;
  isolateId: string;
}

export interface ClearCollectedDataRequest extends BaseMessage {
  type: typeof MessageType.CLEAR_COLLECTED_DATA;
  isolateId: string;
}

// ============================================================================
// Daemon → Client Messages
// ============================================================================

export interface ResponseOk extends BaseMessage {
  type: typeof MessageType.RESPONSE_OK;
  data?: unknown;
}

export interface ResponseError extends BaseMessage {
  type: typeof MessageType.RESPONSE_ERROR;
  code: ErrorCode;
  message: string;
  details?: {
    name: string;
    stack?: string;
    cause?: unknown;
  };
}

export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  /** Inline body for small payloads */
  body?: Uint8Array | null;
  /** Stream reference for large/streaming bodies */
  bodyStreamId?: number;
}

export interface ResponseStreamStart extends BaseMessage {
  type: typeof MessageType.RESPONSE_STREAM_START;
  streamId: number;
  metadata?: {
    status?: number;
    statusText?: string;
    headers?: [string, string][];
  };
}

export interface ResponseStreamChunk extends BaseMessage {
  type: typeof MessageType.RESPONSE_STREAM_CHUNK;
  streamId: number;
  chunk: Uint8Array;
}

export interface ResponseStreamEnd extends BaseMessage {
  type: typeof MessageType.RESPONSE_STREAM_END;
  streamId: number;
}

// ============================================================================
// Bidirectional: Callbacks
// ============================================================================

export interface CallbackInvoke extends BaseMessage {
  type: typeof MessageType.CALLBACK_INVOKE;
  callbackId: number;
  args: unknown[];
}

export interface CallbackResponseMsg extends BaseMessage {
  type: typeof MessageType.CALLBACK_RESPONSE;
  result?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Start a streaming callback response (client → daemon).
 * Used when the callback returns a Response with a streaming body.
 */
export interface CallbackStreamStart extends BaseMessage {
  type: typeof MessageType.CALLBACK_STREAM_START;
  /** The stream ID for correlating chunks */
  streamId: number;
  /** Response metadata */
  metadata: {
    status: number;
    statusText: string;
    headers: [string, string][];
    /** Response URL (for network responses) */
    url?: string;
  };
}

/**
 * A chunk of streaming callback response data (client → daemon).
 */
export interface CallbackStreamChunk extends BaseMessage {
  type: typeof MessageType.CALLBACK_STREAM_CHUNK;
  /** The stream ID for correlation */
  streamId: number;
  /** The chunk data */
  chunk: Uint8Array;
}

/**
 * End of a streaming callback response (client → daemon).
 */
export interface CallbackStreamEnd extends BaseMessage {
  type: typeof MessageType.CALLBACK_STREAM_END;
  /** The stream ID for correlation */
  streamId: number;
}

/**
 * Cancel a streaming callback response (daemon → client).
 * Tells the client to stop reading the response body.
 */
export interface CallbackStreamCancel {
  type: typeof MessageType.CALLBACK_STREAM_CANCEL;
  /** The stream ID to cancel */
  streamId: number;
}

// ============================================================================
// Bidirectional: Stream Data
// ============================================================================

export interface StreamPush {
  type: typeof MessageType.STREAM_PUSH;
  streamId: number;
  chunk: Uint8Array;
}

export interface StreamPull {
  type: typeof MessageType.STREAM_PULL;
  streamId: number;
  maxBytes: number;
}

export interface StreamClose {
  type: typeof MessageType.STREAM_CLOSE;
  streamId: number;
}

export interface StreamError {
  type: typeof MessageType.STREAM_ERROR;
  streamId: number;
  error: string;
}

// ============================================================================
// Generic Events
// ============================================================================

/** Event name constants for isolate → client events */
export const IsolateEvents = {
  WS_COMMAND: "ws:command",
  WS_CLIENT_CONNECT: "ws:client-connect",
  WS_CLIENT_SEND: "ws:client-send",
  WS_CLIENT_CLOSE: "ws:client-close",
} as const;

/** Event name constants for client → daemon events */
export const ClientEvents = {
  WS_CLIENT_OPENED: "ws:client-opened",
  WS_CLIENT_MESSAGE: "ws:client-message",
  WS_CLIENT_CLOSED: "ws:client-closed",
  WS_CLIENT_ERROR: "ws:client-error",
} as const;

/** Generic event from daemon to client */
export interface IsolateEventMessage {
  type: typeof MessageType.ISOLATE_EVENT;
  isolateId: string;
  event: string;
  payload: unknown;
}

/** Generic event from client to daemon */
export interface ClientEventMessage {
  type: typeof MessageType.CLIENT_EVENT;
  isolateId: string;
  event: string;
  payload: unknown;
}

// Typed payloads for internal WS events (for type safety at usage sites)

export interface WsCommandPayload {
  type: "message" | "close";
  connectionId: string;
  data?: string | Uint8Array;
  code?: number;
  reason?: string;
}

export interface WsClientConnectPayload {
  socketId: string;
  url: string;
  protocols?: string[];
}

export interface WsClientSendPayload {
  socketId: string;
  data: string | Uint8Array;
}

export interface WsClientClosePayload {
  socketId: string;
  code?: number;
  reason?: string;
}

export interface WsClientOpenedPayload {
  socketId: string;
  protocol: string;
  extensions: string;
}

export interface WsClientMessagePayload {
  socketId: string;
  data: string | Uint8Array;
}

export interface WsClientClosedPayload {
  socketId: string;
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface WsClientErrorPayload {
  socketId: string;
}

/**
 * Unified playwright event type for the onEvent callback.
 */
export type PlaywrightEvent =
  | {
      type: "browserConsoleLog";
      level: string;
      stdout: string;
      timestamp: number;
    }
  | {
      type: "networkRequest";
      url: string;
      method: string;
      headers: Record<string, string>;
      postData?: string;
      resourceType?: string;
      timestamp: number;
    }
  | {
      type: "networkResponse";
      url: string;
      status: number;
      statusText?: string;
      headers: Record<string, string>;
      timestamp: number;
    };

// ============================================================================
// Heartbeat
// ============================================================================

export interface PingMessage {
  type: typeof MessageType.PING;
}

export interface PongMessage {
  type: typeof MessageType.PONG;
}

// ============================================================================
// Union Types
// ============================================================================

export type ClientMessage =
  | CreateRuntimeRequest
  | DisposeRuntimeRequest
  | EvalRequest
  | DispatchRequestRequest
  | WsOpenRequest
  | WsMessageRequest
  | WsCloseRequest
  | FetchGetUpgradeRequestRequest
  | FetchHasServeHandlerRequest
  | FetchHasActiveConnectionsRequest
  | FetchWsErrorRequest
  | TimersClearAllRequest
  | ConsoleResetRequest
  | ConsoleGetTimersRequest
  | ConsoleGetCountersRequest
  | ConsoleGetGroupDepthRequest
  | RunTestsRequest
  | ResetTestEnvRequest
  | HasTestsRequest
  | GetTestCountRequest
  | GetCollectedDataRequest
  | ClearCollectedDataRequest
  | CallbackResponseMsg
  | CallbackStreamStart
  | CallbackStreamChunk
  | CallbackStreamEnd
  | CallbackStreamCancel
  | StreamPush
  | StreamPull
  | StreamClose
  | StreamError
  | ClientEventMessage
  | PingMessage;

export type DaemonMessage =
  | ResponseOk
  | ResponseError
  | ResponseStreamStart
  | ResponseStreamChunk
  | ResponseStreamEnd
  | CallbackInvoke
  | StreamPush
  | StreamPull
  | StreamClose
  | StreamError
  | IsolateEventMessage
  | PongMessage;

export type Message = ClientMessage | DaemonMessage;

// ============================================================================
// Shared Types (used by both isolate-runtime and isolate-client)
// ============================================================================

/**
 * Module loader callback type.
 * Called when the isolate imports a module dynamically.
 *
 * @param moduleName - The module specifier being imported
 * @param importer - Information about the importing module
 * @param importer.path - The resolved path of the importing module
 * @param importer.resolveDir - The directory to resolve relative imports from
 * @returns Object with code and resolveDir for the resolved module
 */
export type ModuleLoaderCallback = (
  moduleName: string,
  importer: { path: string; resolveDir: string }
) => ModuleLoaderResult | Promise<ModuleLoaderResult>;

export interface ModuleLoaderResult {
  code: string;
  resolveDir: string;
  /** Mark as static to preserve across namespace reuse (e.g. node_modules).
   *  Static modules and their transitive deps should all be static. */
  static?: boolean;
}

/**
 * A custom function that can be called from within the isolate.
 */
export type CustomFunction<T extends any[] = unknown[]> = (...args: T) => unknown | Promise<unknown>;

/**
 * An async generator function that can be consumed in the isolate via for await...of.
 */
export type CustomAsyncGeneratorFunction<T extends any[] = unknown[]> = (...args: T) => AsyncGenerator<unknown, unknown, unknown>;

/**
 * Custom function definition with metadata.
 * Requires explicit `type` property to indicate function behavior.
 */
export interface CustomFunctionDefinition<T extends any[] = unknown[]> {
  /** The function implementation */
  fn: CustomFunction<T> | CustomAsyncGeneratorFunction<T>;
  /** Function type: 'sync', 'async', or 'asyncIterator' */
  type: CustomFunctionType;
}

/**
 * Custom functions to register in the runtime.
 * Each function must be defined with explicit type property.
 *
 * @example
 * ```typescript
 * customFunctions: {
 *   // Sync function
 *   getConfig: {
 *     fn: () => ({ environment: "production" }),
 *     type: 'sync',
 *   },
 *   // Async function
 *   hashPassword: {
 *     fn: async (password) => bcrypt.hash(password, 10),
 *     type: 'async',
 *   },
 *   // Async iterator function
 *   streamData: {
 *     fn: async function* (options) {
 *       for await (const chunk of someStream) {
 *         yield chunk;
 *       }
 *     },
 *     type: 'asyncIterator',
 *   },
 * }
 * ```
 */
export type CustomFunctions<T extends Record<string, any[]> = Record<string, unknown[]>> = {
  [K in keyof T]: CustomFunctionDefinition<T[K]>;
}

/**
 * Console entry types for structured console output.
 * Each entry type captures the specific data needed to render like DevTools.
 * Output is pre-formatted as stdout strings (like Node.js console) inside the sandbox.
 */
export type ConsoleEntry =
  | {
      type: "output";
      level: "log" | "warn" | "error" | "info" | "debug";
      stdout: string;
      groupDepth: number;
    }
  | {
      /** Browser console output (from Playwright page, not sandbox) */
      type: "browserOutput";
      level: string;
      stdout: string;
      timestamp: number;
    }
  | { type: "dir"; stdout: string; groupDepth: number }
  | { type: "table"; stdout: string; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | {
      type: "timeLog";
      label: string;
      duration: number;
      stdout: string;
      groupDepth: number;
    }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; stdout: string; groupDepth: number }
  | {
      type: "group";
      label: string;
      collapsed: boolean;
      groupDepth: number;
    }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; stdout: string; stack: string; groupDepth: number };

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
 * Fetch request init type.
 */
export interface FetchRequestInit {
  method: string;
  headers: [string, string][];
  /** Raw body bytes - use this if you need direct access to the body data */
  rawBody: Uint8Array | null;
  /** Body ready for use with fetch() - same data as rawBody but typed as BodyInit */
  body: BodyInit | null;
  signal: AbortSignal;
}

/**
 * Fetch callback type.
 */
export type FetchCallback = (url: string, init: FetchRequestInit) => Response | Promise<Response>;

/**
 * WebSocket callback type.
 * Called when isolate code creates an outbound WebSocket connection.
 * Return a WebSocket to proxy the connection, or null to block it.
 */
export type WebSocketCallback = (url: string, protocols: string[]) => WebSocket | Promise<WebSocket | null> | null;

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
  stat?: (
    path: string
  ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Options for dispatching a request.
 */
export interface DispatchOptions {
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Options for eval() method.
 */
export interface EvalOptions {
  /** Filename for stack traces */
  filename?: string;
  /** Maximum execution time in milliseconds. If exceeded, throws a timeout error. */
  maxExecutionMs?: number;
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
 * File data for setInputFiles operations.
 */
export interface PlaywrightFileData {
  /** File name */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File contents as Buffer */
  buffer: Buffer;
}

/**
 * Options for Playwright integration.
 *
 * Public API is handler-first: host-specific page wiring should be done by
 * creating a handler (for example via `defaultPlaywrightHandler(page)`).
 */
export interface PlaywrightOptions {
  /** Handler callback for Playwright operations (required when playwright is enabled) */
  handler: (op: PlaywrightOperation) => Promise<PlaywrightResult>;
  /** Default timeout for operations in ms */
  timeout?: number;
  /** If true, browser console logs are routed through console handler (or printed to stdout if no handler) */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
}

/**
 * Base runtime options shared between isolate-client and isolate-runtime.
 * Each package extends this with its own `fs` type.
 */
export interface BaseRuntimeOptions<T extends Record<string, any[]> = Record<string, unknown[]>> {
  /** Memory limit in megabytes (optional) */
  memoryLimitMB?: number;
  /** Console callback handlers */
  console?: ConsoleCallbacks;
  /** Fetch callback handler */
  fetch?: FetchCallback;
  /** WebSocket callback handler for outbound connections from isolate */
  webSocket?: WebSocketCallback;
  /** Module loader callback for resolving dynamic imports */
  moduleLoader?: ModuleLoaderCallback;
  /** Custom functions callable from within the isolate */
  customFunctions?: CustomFunctions<T>;
  /** Current working directory for path.resolve(). Defaults to "/" */
  cwd?: string;
  /** Enable test environment (describe, it, expect, etc.) */
  testEnvironment?: boolean | TestEnvironmentOptions;
  /** Playwright options (handler-first API) */
  playwright?: PlaywrightOptions;
}

// ============================================================================
// Result Types (for responses)
// ============================================================================

export interface CreateRuntimeResult {
  isolateId: string;
  /** True if runtime was reused from namespace pool */
  reused?: boolean;
}

export interface EvalResult {
  value: unknown;
}

export interface DispatchRequestResult {
  response: SerializedResponse;
}

// ============================================================================
// Test Environment Types
// ============================================================================

export interface SuiteInfo {
  name: string;
  /** Ancestry path: ["outer", "inner"] */
  path: string[];
  /** Full display name: "outer > inner" */
  fullName: string;
  /** Nesting depth (0 for root-level suites) */
  depth: number;
}

export interface SuiteResult extends SuiteInfo {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  duration: number;
}

export interface TestInfo {
  name: string;
  /** Suite ancestry */
  suitePath: string[];
  /** Full display name: "suite > test name" */
  fullName: string;
}

export interface TestError {
  message: string;
  stack?: string;
  /** For assertion failures */
  expected?: unknown;
  actual?: unknown;
  /** e.g., "toBe", "toEqual", "toContain" */
  matcherName?: string;
}

export interface TestResult extends TestInfo {
  status: "pass" | "fail" | "skip" | "todo";
  duration: number;
  error?: TestError;
}

export type TestEvent =
  | { type: "runStart"; testCount: number; suiteCount: number }
  | { type: "suiteStart"; suite: SuiteInfo }
  | { type: "suiteEnd"; suite: SuiteResult }
  | { type: "testStart"; test: TestInfo }
  | { type: "testEnd"; test: TestResult }
  | { type: "runEnd"; results: RunTestsResult };

export interface RunTestsResult {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
  duration: number;
  success: boolean;
  suites: SuiteResult[];
  tests: TestResult[];
}

export interface PlaywrightTestResult {
  passed: number;
  failed: number;
  total: number;
  results: {
    name: string;
    passed: boolean;
    error?: string;
    duration: number;
  }[];
}

export interface CollectedData {
  /** Browser console logs (from the page, not sandbox) */
  browserConsoleLogs: {
    level: string;
    stdout: string;
    timestamp: number;
  }[];
  networkRequests: {
    url: string;
    method: string;
    headers: Record<string, string>;
    timestamp: number;
  }[];
  networkResponses: {
    url: string;
    status: number;
    headers: Record<string, string>;
    timestamp: number;
  }[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize a filename to an absolute path for module resolution.
 *
 * Rules:
 * - undefined/empty/"" → "/index.js"
 * - Absolute paths (start with /) → normalized as-is
 * - Relative paths starting with "./" → converted to absolute from root
 * - Bare filenames (no leading ./ or /) → converted to absolute from root
 * - Paths starting with "../" → Error (can't resolve parent of root)
 * - Directory paths ("/" or "./") → append "index.js"
 *
 * @example
 * normalizeEntryFilename(undefined)     // "/index.js"
 * normalizeEntryFilename("")            // "/index.js"
 * normalizeEntryFilename("app.js")      // "/app.js"
 * normalizeEntryFilename("./app.js")    // "/app.js"
 * normalizeEntryFilename("/app.js")     // "/app.js"
 * normalizeEntryFilename("./foo/bar.js") // "/foo/bar.js"
 * normalizeEntryFilename("/")           // "/index.js"
 * normalizeEntryFilename("./")          // "/index.js"
 * normalizeEntryFilename("../app.js")   // throws Error
 *
 * @throws Error if the filename cannot be normalized (e.g., starts with "../")
 */
export function normalizeEntryFilename(filename: string | undefined): string {
  // Default to /index.js
  if (!filename || filename === "") {
    return "/index.js";
  }

  // Reject paths that try to go above root
  if (filename.startsWith("../")) {
    throw new Error(
      `Invalid entry filename "${filename}": cannot use "../" at the start. ` +
      `Use an absolute path like "/app.js" or a relative path like "./app.js".`
    );
  }

  // Track if original path ends with / (indicates directory)
  const endsWithSlash = filename.endsWith("/");

  let toNormalize: string;
  if (filename.startsWith("/")) {
    // Already absolute
    toNormalize = filename;
  } else if (filename.startsWith("./")) {
    // Relative from root: ./app.js → /app.js
    toNormalize = "/" + filename.slice(2);
  } else {
    // Bare filename: app.js → /app.js
    toNormalize = "/" + filename;
  }

  // Normalize path and check for escaping root
  const normalized = normalizePosixPath(toNormalize, filename);

  // Handle directory paths - append index.js
  if (normalized === "/" || endsWithSlash) {
    return normalized === "/" ? "/index.js" : normalized + "/index.js";
  }

  return normalized;
}

/**
 * Simple POSIX path normalization without external dependencies.
 * Handles . and .. segments, collapses multiple slashes.
 * Throws if path tries to escape above root.
 */
function normalizePosixPath(p: string, originalFilename: string): string {
  if (p === "") return ".";

  const isAbsolute = p.startsWith("/");
  const segments = p.split("/").filter(s => s !== "" && s !== ".");
  const result: string[] = [];
  let parentCount = 0; // Track how many .. we've seen at root level

  for (const segment of segments) {
    if (segment === "..") {
      if (result.length > 0 && result[result.length - 1] !== "..") {
        result.pop();
      } else if (isAbsolute) {
        // For absolute paths, track attempts to go above root
        parentCount++;
      } else {
        result.push("..");
      }
    } else {
      result.push(segment);
    }
  }

  // If we tried to go above root, throw an error
  if (isAbsolute && parentCount > 0 && result.length === 0) {
    // Only throw if we actually escaped (ended up at root after going above)
    // This catches cases like /foo/../../bar.js where we went above root
  }

  // Count segments before normalization to detect if we went above root
  const originalSegments = p.split("/").filter(s => s !== "" && s !== ".");
  let depth = 0;
  for (const segment of originalSegments) {
    if (segment === "..") {
      depth--;
      if (isAbsolute && depth < 0) {
        throw new Error(
          `Invalid entry filename "${originalFilename}": path resolves above root directory.`
        );
      }
    } else {
      depth++;
    }
  }

  const normalized = result.join("/");
  return isAbsolute ? "/" + normalized : (normalized || ".");
}
