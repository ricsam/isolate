/**
 * Connection handling for the isolate client.
 */

import { connect as netConnect, type Socket } from "node:net";
import {
  createFrameParser,
  buildFrame,
  MessageType,
  type Message,
  type ResponseOk,
  type ResponseError,
  type CreateRuntimeRequest,
  type DisposeRuntimeRequest,
  type EvalRequest,
  type DispatchRequestRequest,
  type CallbackInvoke,
  type CallbackResponseMsg,
  type CallbackRegistration,
  type RuntimeCallbackRegistrations,
  type CreateRuntimeResult,
  type SerializedResponse,
  type RunTestsRequest,
  type RunTestsResult,
  type GetCollectedDataRequest,
  type CollectedData,
  type ResetTestEnvRequest,
  type ClearCollectedDataRequest,
  type PlaywrightOperation,
  type PlaywrightResult,
  type WsOpenRequest,
  type WsMessageRequest,
  type WsCloseRequest,
  type FetchGetUpgradeRequestRequest,
  type FetchHasServeHandlerRequest,
  type FetchHasActiveConnectionsRequest,
  type FetchWsErrorRequest,
  type TimersClearAllRequest,
  type ConsoleResetRequest,
  type ConsoleGetTimersRequest,
  type ConsoleGetCountersRequest,
  type ConsoleGetGroupDepthRequest,
} from "@ricsam/isolate-protocol";
import { createPlaywrightHandler, type PlaywrightCallback } from "@ricsam/isolate-playwright";
import type {
  ConnectOptions,
  DaemonConnection,
  RuntimeOptions,
  RemoteRuntime,
  RemoteFetchHandle,
  RemoteTimersHandle,
  RemoteConsoleHandle,
  RemoteTestEnvironmentHandle,
  RemotePlaywrightHandle,
  DispatchOptions,
  ConsoleCallbacks,
  FetchCallback,
  FileSystemCallbacks,
  ModuleLoaderCallback,
  CustomFunctions,
  CustomFunctionDefinition,
  EvalOptions,
  UpgradeRequest,
  WebSocketCommand,
} from "./types.ts";

const DEFAULT_TIMEOUT = 30000;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface ConnectionState {
  socket: Socket;
  pendingRequests: Map<number, PendingRequest>;
  callbacks: Map<number, (...args: unknown[]) => unknown>;
  nextRequestId: number;
  nextCallbackId: number;
  connected: boolean;
}

/**
 * Connect to the isolate daemon.
 */
export async function connect(options: ConnectOptions = {}): Promise<DaemonConnection> {
  const socket = await createSocket(options);

  const state: ConnectionState = {
    socket,
    pendingRequests: new Map(),
    callbacks: new Map(),
    nextRequestId: 1,
    nextCallbackId: 1,
    connected: true,
  };

  const parser = createFrameParser();

  socket.on("data", (data) => {
    try {
      for (const frame of parser.feed(new Uint8Array(data))) {
        handleMessage(frame.message, state);
      }
    } catch (err) {
      console.error("Error parsing frame:", err);
    }
  });

  socket.on("close", () => {
    state.connected = false;
    // Reject all pending requests
    for (const [, pending] of state.pendingRequests) {
      pending.reject(new Error("Connection closed"));
    }
    state.pendingRequests.clear();
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });

  return {
    createRuntime: (runtimeOptions) =>
      createRuntime(state, runtimeOptions),
    close: async () => {
      state.connected = false;
      socket.destroy();
    },
    isConnected: () => state.connected,
  };
}

/**
 * Create a socket connection.
 */
function createSocket(options: ConnectOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    let socket: Socket;

    const onError = (err: Error) => {
      reject(err);
    };

    const onConnect = () => {
      socket.removeListener("error", onError);
      resolve(socket);
    };

    if (options.socket) {
      socket = netConnect(options.socket, onConnect);
    } else {
      socket = netConnect(
        options.port ?? 47891,
        options.host ?? "127.0.0.1",
        onConnect
      );
    }

    socket.on("error", onError);

    // Connection timeout
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection timeout"));
    }, timeout);

    socket.once("connect", () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Handle an incoming message from the daemon.
 */
function handleMessage(message: Message, state: ConnectionState): void {
  switch (message.type) {
    case MessageType.RESPONSE_OK: {
      const response = message as ResponseOk;
      const pending = state.pendingRequests.get(response.requestId);
      if (pending) {
        state.pendingRequests.delete(response.requestId);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.resolve(response.data);
      }
      break;
    }

    case MessageType.RESPONSE_ERROR: {
      const response = message as ResponseError;
      const pending = state.pendingRequests.get(response.requestId);
      if (pending) {
        state.pendingRequests.delete(response.requestId);
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        const error = new Error(response.message);
        if (response.details) {
          error.name = response.details.name;
          if (response.details.stack) {
            error.stack = response.details.stack;
          }
        }
        pending.reject(error);
      }
      break;
    }

    case MessageType.CALLBACK_INVOKE: {
      const invoke = message as CallbackInvoke;
      handleCallbackInvoke(invoke, state);
      break;
    }

    case MessageType.PONG:
      // Heartbeat response, ignore
      break;

    default:
      console.warn(`Unexpected message type: ${message.type}`);
  }
}

/**
 * Handle a callback invocation from the daemon.
 */
async function handleCallbackInvoke(
  invoke: CallbackInvoke,
  state: ConnectionState
): Promise<void> {
  const callback = state.callbacks.get(invoke.callbackId);

  const response: CallbackResponseMsg = {
    type: MessageType.CALLBACK_RESPONSE,
    requestId: invoke.requestId,
  };

  if (!callback) {
    response.error = {
      name: "Error",
      message: `Unknown callback: ${invoke.callbackId}`,
    };
  } else {
    try {
      const result = await callback(...invoke.args);
      response.result = result;
    } catch (err) {
      const error = err as Error;
      response.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
  }

  sendMessage(state.socket, response);
}

/**
 * Send a message to the daemon.
 */
function sendMessage(socket: Socket, message: Message): void {
  const frame = buildFrame(message);
  socket.write(frame);
}

/**
 * Send a request and wait for response.
 */
function sendRequest<T>(
  state: ConnectionState,
  message: Message,
  timeout = DEFAULT_TIMEOUT
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!state.connected) {
      reject(new Error("Not connected"));
      return;
    }

    const requestId = (message as { requestId: number }).requestId;

    const timeoutId = setTimeout(() => {
      state.pendingRequests.delete(requestId);
      reject(new Error("Request timeout"));
    }, timeout);

    state.pendingRequests.set(requestId, {
      resolve: resolve as (data: unknown) => void,
      reject,
      timeoutId,
    });

    sendMessage(state.socket, message);
  });
}

/**
 * Create a runtime in the daemon.
 */
async function createRuntime(
  state: ConnectionState,
  options: RuntimeOptions = {}
): Promise<RemoteRuntime> {
  // Register callbacks
  const callbacks: RuntimeCallbackRegistrations = {};

  if (options.console) {
    callbacks.console = registerConsoleCallbacks(state, options.console);
  }

  if (options.fetch) {
    callbacks.fetch = registerFetchCallback(state, options.fetch);
  }

  if (options.fs) {
    callbacks.fs = registerFsCallbacks(state, options.fs);
  }

  if (options.moduleLoader) {
    callbacks.moduleLoader = registerModuleLoaderCallback(
      state,
      options.moduleLoader
    );
  }

  if (options.customFunctions) {
    callbacks.custom = registerCustomFunctions(state, options.customFunctions);
  }

  // Playwright callback registration - client owns the browser
  let playwrightHandler: PlaywrightCallback | undefined;
  if (options.playwright) {
    playwrightHandler = createPlaywrightHandler(options.playwright.page, {
      timeout: options.playwright.timeout,
      baseUrl: options.playwright.baseUrl,
    });

    const handlerCallbackId = state.nextCallbackId++;
    state.callbacks.set(handlerCallbackId, async (opJson: unknown) => {
      const op = JSON.parse(opJson as string) as PlaywrightOperation;
      const result = await playwrightHandler!(op);
      return JSON.stringify(result);
    });

    // Determine if we need event callbacks
    const hasOnEvent = !!options.playwright.onEvent;
    const hasConsoleHandler = options.playwright.console && options.console?.onEntry;

    // Browser console log callback
    let browserConsoleLogCallbackId: number | undefined;
    if (hasOnEvent || hasConsoleHandler) {
      browserConsoleLogCallbackId = registerEventCallback(state, (entry: unknown) => {
        const browserEntry = entry as { level: string; args: unknown[]; timestamp: number };

        if (options.playwright!.onEvent) {
          options.playwright!.onEvent({
            type: "browserConsoleLog",
            level: browserEntry.level,
            args: browserEntry.args,
            timestamp: browserEntry.timestamp,
          });
        }

        // Route through console handler as browserOutput entry if console: true
        if (options.playwright!.console && options.console?.onEntry) {
          options.console.onEntry({
            type: "browserOutput",
            level: browserEntry.level,
            args: browserEntry.args,
            timestamp: browserEntry.timestamp,
          });
        }
      });
    }

    // Network request callback
    let networkRequestCallbackId: number | undefined;
    if (hasOnEvent) {
      networkRequestCallbackId = registerEventCallback(state, (info: unknown) => {
        const reqInfo = info as { url: string; method: string; headers: Record<string, string>; postData?: string; resourceType?: string; timestamp: number };

        options.playwright!.onEvent!({
          type: "networkRequest",
          url: reqInfo.url,
          method: reqInfo.method,
          headers: reqInfo.headers,
          postData: reqInfo.postData,
          resourceType: reqInfo.resourceType,
          timestamp: reqInfo.timestamp,
        });
      });
    }

    // Network response callback
    let networkResponseCallbackId: number | undefined;
    if (hasOnEvent) {
      networkResponseCallbackId = registerEventCallback(state, (info: unknown) => {
        const resInfo = info as { url: string; status: number; statusText?: string; headers: Record<string, string>; timestamp: number };

        options.playwright!.onEvent!({
          type: "networkResponse",
          url: resInfo.url,
          status: resInfo.status,
          statusText: resInfo.statusText,
          headers: resInfo.headers,
          timestamp: resInfo.timestamp,
        });
      });
    }

    callbacks.playwright = {
      handlerCallbackId,
      // Don't let daemon print directly if we're routing through console handler
      console: options.playwright.console && !options.console?.onEntry,
      onBrowserConsoleLogCallbackId: browserConsoleLogCallbackId,
      onNetworkRequestCallbackId: networkRequestCallbackId,
      onNetworkResponseCallbackId: networkResponseCallbackId,
    };
  }

  const requestId = state.nextRequestId++;
  const request: CreateRuntimeRequest = {
    type: MessageType.CREATE_RUNTIME,
    requestId,
    options: {
      memoryLimit: options.memoryLimit,
      cwd: options.cwd,
      callbacks,
      testEnvironment: options.testEnvironment,
    },
  };

  const result = await sendRequest<CreateRuntimeResult>(state, request);
  const isolateId = result.isolateId;

  // WebSocket command callbacks
  const wsCommandCallbacks: Set<(cmd: WebSocketCommand) => void> = new Set();

  // Create fetch handle
  const fetchHandle: RemoteFetchHandle = {
    async dispatchRequest(req: Request, opts?: DispatchOptions) {
      const reqId = state.nextRequestId++;
      const serialized = await serializeRequest(req);
      const request: DispatchRequestRequest = {
        type: MessageType.DISPATCH_REQUEST,
        requestId: reqId,
        isolateId,
        request: serialized,
        options: opts,
      };
      const res = await sendRequest<{ response: SerializedResponse }>(
        state,
        request,
        opts?.timeout ?? DEFAULT_TIMEOUT
      );
      return deserializeResponse(res.response);
    },

    async getUpgradeRequest(): Promise<UpgradeRequest | null> {
      const reqId = state.nextRequestId++;
      const req: FetchGetUpgradeRequestRequest = {
        type: MessageType.FETCH_GET_UPGRADE_REQUEST,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<UpgradeRequest | null>(state, req);
    },

    async dispatchWebSocketOpen(connectionId: string): Promise<void> {
      const reqId = state.nextRequestId++;
      const req: WsOpenRequest = {
        type: MessageType.WS_OPEN,
        requestId: reqId,
        isolateId,
        connectionId,
      };
      await sendRequest(state, req);
    },

    async dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): Promise<void> {
      const reqId = state.nextRequestId++;
      const data = message instanceof ArrayBuffer ? new Uint8Array(message) : message;
      const req: WsMessageRequest = {
        type: MessageType.WS_MESSAGE,
        requestId: reqId,
        isolateId,
        connectionId,
        data,
      };
      await sendRequest(state, req);
    },

    async dispatchWebSocketClose(connectionId: string, code: number, reason: string): Promise<void> {
      const reqId = state.nextRequestId++;
      const req: WsCloseRequest = {
        type: MessageType.WS_CLOSE,
        requestId: reqId,
        isolateId,
        connectionId,
        code,
        reason,
      };
      await sendRequest(state, req);
    },

    async dispatchWebSocketError(connectionId: string, error: Error): Promise<void> {
      const reqId = state.nextRequestId++;
      const req: FetchWsErrorRequest = {
        type: MessageType.FETCH_WS_ERROR,
        requestId: reqId,
        isolateId,
        connectionId,
        error: error.message,
      };
      await sendRequest(state, req);
    },

    onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void {
      wsCommandCallbacks.add(callback);
      return () => {
        wsCommandCallbacks.delete(callback);
      };
    },

    async hasServeHandler(): Promise<boolean> {
      const reqId = state.nextRequestId++;
      const req: FetchHasServeHandlerRequest = {
        type: MessageType.FETCH_HAS_SERVE_HANDLER,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<boolean>(state, req);
    },

    async hasActiveConnections(): Promise<boolean> {
      const reqId = state.nextRequestId++;
      const req: FetchHasActiveConnectionsRequest = {
        type: MessageType.FETCH_HAS_ACTIVE_CONNECTIONS,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<boolean>(state, req);
    },
  };

  // Create timers handle
  const timersHandle: RemoteTimersHandle = {
    async clearAll(): Promise<void> {
      const reqId = state.nextRequestId++;
      const req: TimersClearAllRequest = {
        type: MessageType.TIMERS_CLEAR_ALL,
        requestId: reqId,
        isolateId,
      };
      await sendRequest(state, req);
    },
  };

  // Create console handle
  const consoleHandle: RemoteConsoleHandle = {
    async reset(): Promise<void> {
      const reqId = state.nextRequestId++;
      const req: ConsoleResetRequest = {
        type: MessageType.CONSOLE_RESET,
        requestId: reqId,
        isolateId,
      };
      await sendRequest(state, req);
    },

    async getTimers(): Promise<Map<string, number>> {
      const reqId = state.nextRequestId++;
      const req: ConsoleGetTimersRequest = {
        type: MessageType.CONSOLE_GET_TIMERS,
        requestId: reqId,
        isolateId,
      };
      const result = await sendRequest<Record<string, number>>(state, req);
      return new Map(Object.entries(result));
    },

    async getCounters(): Promise<Map<string, number>> {
      const reqId = state.nextRequestId++;
      const req: ConsoleGetCountersRequest = {
        type: MessageType.CONSOLE_GET_COUNTERS,
        requestId: reqId,
        isolateId,
      };
      const result = await sendRequest<Record<string, number>>(state, req);
      return new Map(Object.entries(result));
    },

    async getGroupDepth(): Promise<number> {
      const reqId = state.nextRequestId++;
      const req: ConsoleGetGroupDepthRequest = {
        type: MessageType.CONSOLE_GET_GROUP_DEPTH,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<number>(state, req);
    },
  };

  // Track whether testEnvironment and playwright were enabled
  const testEnvironmentEnabled = !!options.testEnvironment;
  const playwrightEnabled = !!options.playwright;

  // Create test environment handle
  const testEnvironmentHandle: RemoteTestEnvironmentHandle = {
    async runTests(timeout?: number): Promise<RunTestsResult> {
      if (!testEnvironmentEnabled) {
        throw new Error("Test environment not enabled. Set testEnvironment: true in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: RunTestsRequest = {
        type: MessageType.RUN_TESTS,
        requestId: reqId,
        isolateId,
        timeout,
      };
      return sendRequest<RunTestsResult>(state, req, timeout ?? DEFAULT_TIMEOUT);
    },

    async reset(): Promise<void> {
      if (!testEnvironmentEnabled) {
        throw new Error("Test environment not enabled. Set testEnvironment: true in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: ResetTestEnvRequest = {
        type: MessageType.RESET_TEST_ENV,
        requestId: reqId,
        isolateId,
      };
      await sendRequest(state, req);
    },
  };

  // Create playwright handle
  const playwrightHandle: RemotePlaywrightHandle = {
    async getCollectedData(): Promise<CollectedData> {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.page in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: GetCollectedDataRequest = {
        type: MessageType.GET_COLLECTED_DATA,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<CollectedData>(state, req);
    },

    async clearCollectedData(): Promise<void> {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.page in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: ClearCollectedDataRequest = {
        type: MessageType.CLEAR_COLLECTED_DATA,
        requestId: reqId,
        isolateId,
      };
      await sendRequest(state, req);
    },
  };

  return {
    id: isolateId,
    isolateId,

    // Module handles
    fetch: fetchHandle,
    timers: timersHandle,
    console: consoleHandle,
    testEnvironment: testEnvironmentHandle,
    playwright: playwrightHandle,

    eval: async (
      code: string,
      filenameOrOptions?: string | EvalOptions
    ): Promise<void> => {
      const reqId = state.nextRequestId++;
      // Support both new signature (filename string) and old signature (EvalOptions)
      const filename =
        typeof filenameOrOptions === "string"
          ? filenameOrOptions
          : filenameOrOptions?.filename;
      const req: EvalRequest = {
        type: MessageType.EVAL,
        requestId: reqId,
        isolateId,
        code,
        filename,
        module: true, // Always use module mode
      };
      await sendRequest<{ value: unknown }>(state, req);
      // Module evaluation returns void - don't return the value
    },

    dispose: async () => {
      const reqId = state.nextRequestId++;
      const req: DisposeRuntimeRequest = {
        type: MessageType.DISPOSE_RUNTIME,
        requestId: reqId,
        isolateId,
      };
      await sendRequest(state, req);
    },
  };
}

/**
 * Register a simple event callback (fire-and-forget).
 */
function registerEventCallback(
  state: ConnectionState,
  handler: (data: unknown) => void
): number {
  const callbackId = state.nextCallbackId++;
  state.callbacks.set(callbackId, (data: unknown) => {
    handler(data);
    return undefined;
  });
  return callbackId;
}

/**
 * Register console callbacks.
 */
function registerConsoleCallbacks(
  state: ConnectionState,
  callbacks: ConsoleCallbacks
): Record<string, CallbackRegistration> {
  const registrations: Record<string, CallbackRegistration> = {};

  if (callbacks.onEntry) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, (entry: unknown) => {
      callbacks.onEntry!(entry as Parameters<typeof callbacks.onEntry>[0]);
    });
    registrations.onEntry = { callbackId, name: "onEntry", async: false };
  }

  return registrations;
}

/**
 * Register fetch callback.
 */
function registerFetchCallback(
  state: ConnectionState,
  callback: FetchCallback
): CallbackRegistration {
  const callbackId = state.nextCallbackId++;

  state.callbacks.set(callbackId, async (serialized: unknown) => {
    const request = deserializeRequest(serialized as SerializedRequestData);
    const response = await callback(request);
    return serializeResponse(response);
  });

  return { callbackId, name: "fetch", async: true };
}

/**
 * Register file system callbacks.
 */
function registerFsCallbacks(
  state: ConnectionState,
  callbacks: FileSystemCallbacks
): Record<string, CallbackRegistration> {
  const registrations: Record<string, CallbackRegistration> = {};

  // readFile: (path: string) => Promise<ArrayBuffer>
  if (callbacks.readFile) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      const result = await callbacks.readFile!(path as string);
      // Convert ArrayBuffer to Uint8Array for serialization
      return new Uint8Array(result);
    });
    registrations.readFile = { callbackId, name: "readFile", async: true };
  }

  // writeFile: (path: string, data: ArrayBuffer) => Promise<void>
  if (callbacks.writeFile) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown, data: unknown) => {
      // Convert Uint8Array or array back to ArrayBuffer
      let buffer: ArrayBuffer;
      if (data instanceof Uint8Array) {
        buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      } else if (Array.isArray(data)) {
        buffer = new Uint8Array(data as number[]).buffer;
      } else if (data instanceof ArrayBuffer) {
        buffer = data;
      } else {
        buffer = new ArrayBuffer(0);
      }
      await callbacks.writeFile!(path as string, buffer);
    });
    registrations.writeFile = { callbackId, name: "writeFile", async: true };
  }

  // unlink: (path: string) => Promise<void>
  if (callbacks.unlink) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      await callbacks.unlink!(path as string);
    });
    registrations.unlink = { callbackId, name: "unlink", async: true };
  }

  // readdir: (path: string) => Promise<string[]>
  if (callbacks.readdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      return callbacks.readdir!(path as string);
    });
    registrations.readdir = { callbackId, name: "readdir", async: true };
  }

  // mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  if (callbacks.mkdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown, options: unknown) => {
      await callbacks.mkdir!(path as string, options as { recursive?: boolean });
    });
    registrations.mkdir = { callbackId, name: "mkdir", async: true };
  }

  // rmdir: (path: string) => Promise<void>
  if (callbacks.rmdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      await callbacks.rmdir!(path as string);
    });
    registrations.rmdir = { callbackId, name: "rmdir", async: true };
  }

  // stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>
  if (callbacks.stat) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      return callbacks.stat!(path as string);
    });
    registrations.stat = { callbackId, name: "stat", async: true };
  }

  // rename: (from: string, to: string) => Promise<void>
  if (callbacks.rename) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (from: unknown, to: unknown) => {
      await callbacks.rename!(from as string, to as string);
    });
    registrations.rename = { callbackId, name: "rename", async: true };
  }

  return registrations;
}

/**
 * Register module loader callback.
 */
function registerModuleLoaderCallback(
  state: ConnectionState,
  callback: ModuleLoaderCallback
): CallbackRegistration {
  const callbackId = state.nextCallbackId++;

  state.callbacks.set(callbackId, async (moduleName: unknown) => {
    return callback(moduleName as string);
  });

  return { callbackId, name: "moduleLoader", async: true };
}

/**
 * Register custom function callbacks.
 */
function registerCustomFunctions(
  state: ConnectionState,
  customFunctions: CustomFunctions
): Record<string, CallbackRegistration> {
  const registrations: Record<string, CallbackRegistration> = {};

  for (const [name, fnOrDef] of Object.entries(customFunctions)) {
    // Normalize to definition format
    const def: CustomFunctionDefinition =
      typeof fnOrDef === "function" ? { fn: fnOrDef, async: true } : fnOrDef;

    const callbackId = state.nextCallbackId++;

    // Register the callback
    state.callbacks.set(callbackId, async (...args: unknown[]) => {
      return def.fn(...args);
    });

    registrations[name] = {
      callbackId,
      name,
      async: def.async !== false, // Default to async
    };
  }

  return registrations;
}

// ============================================================================
// Request/Response Serialization
// ============================================================================

interface SerializedRequestData {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

interface SerializedResponseData {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

async function serializeRequest(request: Request): Promise<SerializedRequestData> {
  const headers: [string, string][] = [];
  request.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  if (request.body) {
    body = new Uint8Array(await request.arrayBuffer());
  }

  return {
    method: request.method,
    url: request.url,
    headers,
    body,
  };
}

async function serializeResponse(response: Response): Promise<SerializedResponseData> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  if (response.body) {
    body = new Uint8Array(await response.arrayBuffer());
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}

function deserializeRequest(data: SerializedRequestData): Request {
  return new Request(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body as unknown as BodyInit | null | undefined,
  });
}

function deserializeResponse(data: SerializedResponse): Response {
  return new Response(data.body as unknown as BodyInit | null, {
    status: data.status,
    statusText: data.statusText,
    headers: data.headers,
  });
}
