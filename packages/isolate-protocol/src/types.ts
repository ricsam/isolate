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

  // Client → Daemon: Playwright
  RUN_PLAYWRIGHT_TESTS: 0x31,
  RESET_PLAYWRIGHT_TESTS: 0x32,
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

  // Bidirectional: Stream data
  STREAM_PUSH: 0xa0,
  STREAM_PULL: 0xa1,
  STREAM_CLOSE: 0xa2,
  STREAM_ERROR: 0xa3,

  // Daemon → Client: Events
  PLAYWRIGHT_EVENT: 0xb0,

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

export interface CallbackRegistration {
  /** Unique ID for this callback */
  callbackId: number;
  /** Callback name (e.g., "log", "warn", "fetch") */
  name: string;
  /** Whether callback returns a Promise */
  async: boolean;
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
    | "request";
  args: unknown[];
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
  /** Optional callback for console log events */
  onConsoleLogCallbackId?: number;
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

export interface CreateRuntimeRequest extends BaseMessage {
  type: typeof MessageType.CREATE_RUNTIME;
  options: {
    memoryLimit?: number;
    callbacks?: RuntimeCallbackRegistrations;
    /** Current working directory for path.resolve(). Defaults to "/" */
    cwd?: string;
    /** Enable test environment (describe, it, expect, etc.) */
    testEnvironment?: boolean;
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
  /**
   * @deprecated Always uses module mode now. This field is ignored.
   * All code is evaluated as ES modules with support for top-level await.
   */
  module?: boolean;
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

// Playwright messages
export interface RunPlaywrightTestsRequest extends BaseMessage {
  type: typeof MessageType.RUN_PLAYWRIGHT_TESTS;
  isolateId: string;
  timeout?: number;
}

export interface ResetPlaywrightTestsRequest extends BaseMessage {
  type: typeof MessageType.RESET_PLAYWRIGHT_TESTS;
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
// Events
// ============================================================================

export type PlaywrightEventType =
  | "consoleLog"
  | "networkRequest"
  | "networkResponse";

export interface PlaywrightEvent {
  type: typeof MessageType.PLAYWRIGHT_EVENT;
  isolateId: string;
  eventType: PlaywrightEventType;
  payload: unknown;
}

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
  | RunPlaywrightTestsRequest
  | ResetPlaywrightTestsRequest
  | GetCollectedDataRequest
  | ClearCollectedDataRequest
  | CallbackResponseMsg
  | StreamPush
  | StreamPull
  | StreamClose
  | StreamError
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
  | PlaywrightEvent
  | PongMessage;

export type Message = ClientMessage | DaemonMessage;

// ============================================================================
// Shared Types (used by both isolate-runtime and isolate-client)
// ============================================================================

/**
 * Module loader callback type.
 * Called when the isolate imports a module dynamically.
 * Returns the JavaScript source code for the module.
 */
export type ModuleLoaderCallback = (
  moduleName: string
) => string | Promise<string>;

/**
 * A custom function that can be called from within the isolate.
 */
export type CustomFunction = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Custom function definition with metadata.
 * Requires explicit `async` property to be clear about function behavior.
 */
export interface CustomFunctionDefinition {
  /** The function implementation */
  fn: CustomFunction;
  /** Whether the function is async (returns a Promise) */
  async: boolean;
}

/**
 * Custom functions to register in the runtime.
 * Each function must be defined with explicit async property.
 *
 * @example
 * ```typescript
 * customFunctions: {
 *   // Async function
 *   hashPassword: {
 *     fn: async (password) => bcrypt.hash(password, 10),
 *     async: true,
 *   },
 *   // Sync function
 *   getConfig: {
 *     fn: () => ({ environment: "production" }),
 *     async: false,
 *   },
 * }
 * ```
 */
export type CustomFunctions = Record<string, CustomFunctionDefinition>;

/**
 * Console entry types for structured console output.
 * Each entry type captures the specific data needed to render like DevTools.
 */
export type ConsoleEntry =
  | {
      type: "output";
      level: "log" | "warn" | "error" | "info" | "debug";
      args: unknown[];
      groupDepth: number;
    }
  | { type: "dir"; value: unknown; groupDepth: number }
  | { type: "table"; data: unknown; columns?: string[]; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | {
      type: "timeLog";
      label: string;
      duration: number;
      args: unknown[];
      groupDepth: number;
    }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; args: unknown[]; groupDepth: number }
  | {
      type: "group";
      label: string;
      collapsed: boolean;
      groupDepth: number;
    }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; args: unknown[]; stack: string; groupDepth: number };

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

// ============================================================================
// Result Types (for responses)
// ============================================================================

export interface CreateRuntimeResult {
  isolateId: string;
}

export interface EvalResult {
  value: unknown;
}

export interface DispatchRequestResult {
  response: SerializedResponse;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  skipped?: boolean;
}

export interface RunTestsResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  results: TestResult[];
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
  consoleLogs: {
    level: string;
    args: unknown[];
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
