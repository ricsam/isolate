/**
 * Connection handling for the isolate daemon.
 */

import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import ivm from "isolated-vm";
import {
  createFrameParser,
  buildFrame,
  MessageType,
  ErrorCode,
  type Message,
  type ResponseOk,
  type ResponseError,
  type CreateRuntimeRequest,
  type DisposeRuntimeRequest,
  type EvalRequest,
  type DispatchRequestRequest,
  type CallbackResponseMsg,
  type CallbackInvoke,
  type RunTestsRequest,
  type RunPlaywrightTestsRequest,
  type ResetPlaywrightTestsRequest,
  type GetCollectedDataRequest,
  type ResetTestEnvRequest,
  type ClearCollectedDataRequest,
  type FsCallbackRegistrations,
  type CustomFunctionRegistrations,
  type CallbackRegistration,
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
import { createCallbackFileSystemHandler } from "./callback-fs-handler.ts";
import {
  setupTestEnvironment,
  runTests as runTestsInContext,
} from "@ricsam/isolate-test-environment";
import {
  setupPlaywright,
  type PlaywrightCallback,
  type BrowserConsoleLogEntry,
  type NetworkRequestInfo,
  type NetworkResponseInfo,
} from "@ricsam/isolate-playwright";
import {
  createInternalRuntime,
  type InternalRuntimeHandle,
} from "@ricsam/isolate-runtime/internal";
import type {
  DaemonState,
  ConnectionState,
  IsolateInstance,
  PendingRequest,
} from "./types.ts";

/**
 * Handle a new client connection.
 */
export function handleConnection(socket: Socket, state: DaemonState): void {
  const connection: ConnectionState = {
    socket,
    isolates: new Set(),
    pendingRequests: new Map(),
    pendingCallbacks: new Map(),
    nextRequestId: 1,
    nextCallbackId: 1,
    nextStreamId: 1,
  };

  state.connections.set(socket, connection);

  const parser = createFrameParser();

  socket.on("data", (data) => {
    try {
      for (const frame of parser.feed(new Uint8Array(data))) {
        handleMessage(frame.message, connection, state).catch((err) => {
          console.error("Error handling message:", err);
        });
      }
    } catch (err) {
      console.error("Error parsing frame:", err);
      socket.destroy();
    }
  });

  socket.on("close", () => {
    // Dispose all isolates owned by this connection
    for (const isolateId of connection.isolates) {
      const instance = state.isolates.get(isolateId);
      if (instance) {
        try {
          // Clean up Playwright resources if present
          if (instance.playwrightHandle) {
            instance.playwrightHandle.dispose();
          }
          instance.runtime.dispose();
        } catch {
          // Ignore disposal errors
        }
        state.isolates.delete(isolateId);
      }
    }

    // Reject pending callbacks
    for (const [, pending] of connection.pendingCallbacks) {
      pending.reject(new Error("Connection closed"));
    }

    state.connections.delete(socket);
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
}

/**
 * Send a message to a client.
 */
function sendMessage(socket: Socket, message: Message): void {
  const frame = buildFrame(message);
  socket.write(frame);
}

/**
 * Send an error response.
 */
function sendError(
  socket: Socket,
  requestId: number,
  code: ErrorCode,
  message: string,
  details?: { name: string; stack?: string }
): void {
  const response: ResponseError = {
    type: MessageType.RESPONSE_ERROR,
    requestId,
    code,
    message,
    details,
  };
  sendMessage(socket, response);
}

/**
 * Send a success response.
 */
function sendOk(socket: Socket, requestId: number, data?: unknown): void {
  const response: ResponseOk = {
    type: MessageType.RESPONSE_OK,
    requestId,
    data,
  };
  sendMessage(socket, response);
}

/**
 * Handle an incoming message.
 */
async function handleMessage(
  message: Message,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  state.stats.totalRequestsProcessed++;

  switch (message.type) {
    case MessageType.CREATE_RUNTIME:
      await handleCreateRuntime(
        message as CreateRuntimeRequest,
        connection,
        state
      );
      break;

    case MessageType.DISPOSE_RUNTIME:
      await handleDisposeRuntime(
        message as DisposeRuntimeRequest,
        connection,
        state
      );
      break;

    case MessageType.EVAL:
      await handleEval(message as EvalRequest, connection, state);
      break;

    case MessageType.DISPATCH_REQUEST:
      await handleDispatchRequest(
        message as DispatchRequestRequest,
        connection,
        state
      );
      break;

    case MessageType.CALLBACK_RESPONSE:
      handleCallbackResponse(message as CallbackResponseMsg, connection);
      break;

    // WebSocket operations
    case MessageType.WS_OPEN:
      await handleWsOpen(message as WsOpenRequest, connection, state);
      break;

    case MessageType.WS_MESSAGE:
      await handleWsMessage(message as WsMessageRequest, connection, state);
      break;

    case MessageType.WS_CLOSE:
      await handleWsClose(message as WsCloseRequest, connection, state);
      break;

    // Handle operations
    case MessageType.FETCH_GET_UPGRADE_REQUEST:
      await handleFetchGetUpgradeRequest(
        message as FetchGetUpgradeRequestRequest,
        connection,
        state
      );
      break;

    case MessageType.FETCH_HAS_SERVE_HANDLER:
      await handleFetchHasServeHandler(
        message as FetchHasServeHandlerRequest,
        connection,
        state
      );
      break;

    case MessageType.FETCH_HAS_ACTIVE_CONNECTIONS:
      await handleFetchHasActiveConnections(
        message as FetchHasActiveConnectionsRequest,
        connection,
        state
      );
      break;

    case MessageType.FETCH_WS_ERROR:
      await handleFetchWsError(message as FetchWsErrorRequest, connection, state);
      break;

    case MessageType.TIMERS_CLEAR_ALL:
      await handleTimersClearAll(
        message as TimersClearAllRequest,
        connection,
        state
      );
      break;

    case MessageType.CONSOLE_RESET:
      await handleConsoleReset(message as ConsoleResetRequest, connection, state);
      break;

    case MessageType.CONSOLE_GET_TIMERS:
      await handleConsoleGetTimers(
        message as ConsoleGetTimersRequest,
        connection,
        state
      );
      break;

    case MessageType.CONSOLE_GET_COUNTERS:
      await handleConsoleGetCounters(
        message as ConsoleGetCountersRequest,
        connection,
        state
      );
      break;

    case MessageType.CONSOLE_GET_GROUP_DEPTH:
      await handleConsoleGetGroupDepth(
        message as ConsoleGetGroupDepthRequest,
        connection,
        state
      );
      break;

    case MessageType.RUN_TESTS:
      await handleRunTests(message as RunTestsRequest, connection, state);
      break;

    case MessageType.RESET_TEST_ENV:
      await handleResetTestEnv(
        message as ResetTestEnvRequest,
        connection,
        state
      );
      break;

    case MessageType.RUN_PLAYWRIGHT_TESTS:
      await handleRunPlaywrightTests(
        message as RunPlaywrightTestsRequest,
        connection,
        state
      );
      break;

    case MessageType.RESET_PLAYWRIGHT_TESTS:
      await handleResetPlaywrightTests(
        message as ResetPlaywrightTestsRequest,
        connection,
        state
      );
      break;

    case MessageType.GET_COLLECTED_DATA:
      await handleGetCollectedData(
        message as GetCollectedDataRequest,
        connection,
        state
      );
      break;

    case MessageType.CLEAR_COLLECTED_DATA:
      await handleClearCollectedData(
        message as ClearCollectedDataRequest,
        connection,
        state
      );
      break;

    case MessageType.PING:
      sendMessage(connection.socket, { type: MessageType.PONG });
      break;

    default:
      sendError(
        connection.socket,
        (message as { requestId?: number }).requestId ?? 0,
        ErrorCode.UNKNOWN_MESSAGE_TYPE,
        `Unknown message type: ${message.type}`
      );
  }
}

/**
 * Handle CREATE_RUNTIME message.
 */
async function handleCreateRuntime(
  message: CreateRuntimeRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  // Check limits
  if (state.isolates.size >= state.options.maxIsolates) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_MEMORY_LIMIT,
      `Maximum isolates (${state.options.maxIsolates}) reached`
    );
    return;
  }

  try {
    const isolateId = randomUUID();

    // Create bridged callbacks that invoke the client
    const consoleCallbacks = message.options.callbacks?.console;
    const fetchCallback = message.options.callbacks?.fetch;
    const fsCallbacks = message.options.callbacks?.fs;
    const moduleLoaderCallback = message.options.callbacks?.moduleLoader;
    const customCallbacks = message.options.callbacks?.custom;

    // Track pending callbacks so eval can wait for them
    const pendingCallbacks: Promise<unknown>[] = [];

    const runtime = await createInternalRuntime({
      memoryLimit: message.options.memoryLimit ?? state.options.defaultMemoryLimit,
      cwd: message.options.cwd,
      console: consoleCallbacks?.onEntry
        ? {
            onEntry: (entry) => {
              // Track this callback so eval waits for it to complete
              const promise = invokeClientCallback(
                connection,
                consoleCallbacks.onEntry!.callbackId,
                [entry]
              ).catch(() => {}); // Ignore errors, just track completion
              pendingCallbacks.push(promise);
            },
          }
        : undefined,
      fetch: fetchCallback
        ? {
            onFetch: async (request) => {
              const serialized = await serializeRequest(request);
              const result = await invokeClientCallback(
                connection,
                fetchCallback.callbackId,
                [serialized]
              );
              return deserializeResponse(result as SerializedResponseData);
            },
          }
        : undefined,
      fs: fsCallbacks
        ? {
            getDirectory: async (path: string) => {
              return createCallbackFileSystemHandler({
                connection,
                callbacks: fsCallbacks,
                invokeClientCallback,
                basePath: path,
              });
            },
          }
        : undefined,
    });

    const instance: IsolateInstance = {
      isolateId,
      runtime,
      ownerConnection: connection.socket,
      callbacks: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      pendingCallbacks,
    };

    // Setup module loader
    if (moduleLoaderCallback) {
      instance.moduleLoaderCallbackId = moduleLoaderCallback.callbackId;
      instance.moduleCache = new Map();
    }

    // Setup custom functions as globals in the isolate
    if (customCallbacks) {
      await setupCustomFunctions(runtime.context, customCallbacks, connection);
    }

    // Store callback registrations
    if (consoleCallbacks?.onEntry) {
      instance.callbacks.set(consoleCallbacks.onEntry.callbackId, {
        ...consoleCallbacks.onEntry,
        name: "onEntry",
      });
    }
    if (fetchCallback) {
      instance.callbacks.set(fetchCallback.callbackId, fetchCallback);
    }
    if (fsCallbacks) {
      for (const [name, reg] of Object.entries(fsCallbacks)) {
        if (reg) {
          instance.callbacks.set(reg.callbackId, { ...reg, name });
        }
      }
    }
    if (moduleLoaderCallback) {
      instance.callbacks.set(moduleLoaderCallback.callbackId, moduleLoaderCallback);
    }
    if (customCallbacks) {
      for (const [name, reg] of Object.entries(customCallbacks)) {
        if (reg) {
          instance.callbacks.set(reg.callbackId, { ...reg, name });
        }
      }
    }

    // Setup test environment if requested
    if (message.options.testEnvironment) {
      await setupTestEnvironment(runtime.context);
      instance.testEnvironmentEnabled = true;
    }

    // Setup playwright if callbacks are provided (client owns the browser)
    const playwrightCallbacks = message.options.callbacks?.playwright;
    if (playwrightCallbacks) {
      // Create handler that invokes client callback
      const handler: PlaywrightCallback = async (op: PlaywrightOperation): Promise<PlaywrightResult> => {
        try {
          const resultJson = await invokeClientCallback(
            connection,
            playwrightCallbacks.handlerCallbackId,
            [JSON.stringify(op)]
          );
          return JSON.parse(resultJson as string) as PlaywrightResult;
        } catch (err) {
          const error = err as Error;
          return { ok: false, error: { name: error.name, message: error.message } };
        }
      };

      instance.playwrightHandle = await setupPlaywright(runtime.context, {
        handler,
        // If console is true, browser logs are printed to stdout
        console: playwrightCallbacks.console,
        // Event callbacks invoke client directly - track them for eval completion
        onBrowserConsoleLog: playwrightCallbacks.onBrowserConsoleLogCallbackId
          ? (entry: BrowserConsoleLogEntry) => {
              const promise = invokeClientCallback(
                connection,
                playwrightCallbacks.onBrowserConsoleLogCallbackId!,
                [entry]
              ).catch(() => {});
              pendingCallbacks.push(promise);
            }
          : undefined,
        onNetworkRequest: playwrightCallbacks.onNetworkRequestCallbackId
          ? (info: NetworkRequestInfo) => {
              const promise = invokeClientCallback(
                connection,
                playwrightCallbacks.onNetworkRequestCallbackId!,
                [info]
              ).catch(() => {});
              pendingCallbacks.push(promise);
            }
          : undefined,
        onNetworkResponse: playwrightCallbacks.onNetworkResponseCallbackId
          ? (info: NetworkResponseInfo) => {
              const promise = invokeClientCallback(
                connection,
                playwrightCallbacks.onNetworkResponseCallbackId!,
                [info]
              ).catch(() => {});
              pendingCallbacks.push(promise);
            }
          : undefined,
      });
    }

    state.isolates.set(isolateId, instance);
    connection.isolates.add(isolateId);
    state.stats.totalIsolatesCreated++;

    sendOk(connection.socket, message.requestId, { isolateId });
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle DISPOSE_RUNTIME message.
 */
async function handleDisposeRuntime(
  message: DisposeRuntimeRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (instance.ownerConnection !== connection.socket) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not owned by this connection`
    );
    return;
  }

  try {
    // Clean up Playwright resources if present
    if (instance.playwrightHandle) {
      instance.playwrightHandle.dispose();
    }

    instance.runtime.dispose();
    state.isolates.delete(message.isolateId);
    connection.isolates.delete(message.isolateId);

    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle EVAL message.
 */
async function handleEval(
  message: EvalRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Always use module mode - supports top-level await and ES module syntax
    const mod = await instance.runtime.isolate.compileModule(message.code, {
      filename: message.filename ?? "<eval>",
    });

    // Instantiate with module resolver if available
    if (instance.moduleLoaderCallbackId) {
      const resolver = createModuleResolver(instance, connection);
      await mod.instantiate(instance.runtime.context, resolver);
    } else {
      // No module loader - instantiate with a resolver that always throws
      await mod.instantiate(instance.runtime.context, (specifier) => {
        throw new Error(
          `No module loader registered. Cannot import: ${specifier}`
        );
      });
    }

    // Evaluate the module
    await mod.evaluate();

    // Wait for all pending callbacks (e.g., console.log) to complete
    // This ensures the client receives all callbacks before eval resolves
    await Promise.all(instance.pendingCallbacks);
    instance.pendingCallbacks.length = 0; // Clear for next eval

    // Return undefined for module evaluation
    sendOk(connection.socket, message.requestId, { value: undefined });
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle DISPATCH_REQUEST message.
 */
async function handleDispatchRequest(
  message: DispatchRequestRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Deserialize the request
    const request = new Request(message.request.url, {
      method: message.request.method,
      headers: message.request.headers,
      body: message.request.body as any,
    });

    // Dispatch to isolate
    const response = await instance.runtime.fetch.dispatchRequest(request);

    // Serialize the response
    const serialized = await serializeResponse(response);
    sendOk(connection.socket, message.requestId, { response: serialized });
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

// ============================================================================
// WebSocket Operation Handlers
// ============================================================================

/**
 * Handle WS_OPEN message.
 */
async function handleWsOpen(
  message: WsOpenRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.runtime.fetch.dispatchWebSocketOpen(message.connectionId);
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle WS_MESSAGE message.
 */
async function handleWsMessage(
  message: WsMessageRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Convert Uint8Array to ArrayBuffer if needed
    const data = message.data instanceof Uint8Array
      ? message.data.buffer.slice(message.data.byteOffset, message.data.byteOffset + message.data.byteLength) as ArrayBuffer
      : message.data;
    instance.runtime.fetch.dispatchWebSocketMessage(message.connectionId, data);
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle WS_CLOSE message.
 */
async function handleWsClose(
  message: WsCloseRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.runtime.fetch.dispatchWebSocketClose(message.connectionId, message.code, message.reason);
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

// ============================================================================
// Handle Operation Handlers
// ============================================================================

/**
 * Handle FETCH_GET_UPGRADE_REQUEST message.
 */
async function handleFetchGetUpgradeRequest(
  message: FetchGetUpgradeRequestRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const upgradeRequest = instance.runtime.fetch.getUpgradeRequest();
    sendOk(connection.socket, message.requestId, upgradeRequest);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle FETCH_HAS_SERVE_HANDLER message.
 */
async function handleFetchHasServeHandler(
  message: FetchHasServeHandlerRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const hasHandler = instance.runtime.fetch.hasServeHandler();
    sendOk(connection.socket, message.requestId, hasHandler);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle FETCH_HAS_ACTIVE_CONNECTIONS message.
 */
async function handleFetchHasActiveConnections(
  message: FetchHasActiveConnectionsRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const hasConnections = instance.runtime.fetch.hasActiveConnections();
    sendOk(connection.socket, message.requestId, hasConnections);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle FETCH_WS_ERROR message.
 */
async function handleFetchWsError(
  message: FetchWsErrorRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.runtime.fetch.dispatchWebSocketError(message.connectionId, new Error(message.error));
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle TIMERS_CLEAR_ALL message.
 */
async function handleTimersClearAll(
  message: TimersClearAllRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.runtime.timers.clearAll();
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CONSOLE_RESET message.
 */
async function handleConsoleReset(
  message: ConsoleResetRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.runtime.console.reset();
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CONSOLE_GET_TIMERS message.
 */
async function handleConsoleGetTimers(
  message: ConsoleGetTimersRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const timers = instance.runtime.console.getTimers();
    // Convert Map to object for serialization
    sendOk(connection.socket, message.requestId, Object.fromEntries(timers));
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CONSOLE_GET_COUNTERS message.
 */
async function handleConsoleGetCounters(
  message: ConsoleGetCountersRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const counters = instance.runtime.console.getCounters();
    // Convert Map to object for serialization
    sendOk(connection.socket, message.requestId, Object.fromEntries(counters));
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CONSOLE_GET_GROUP_DEPTH message.
 */
async function handleConsoleGetGroupDepth(
  message: ConsoleGetGroupDepthRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const depth = instance.runtime.console.getGroupDepth();
    sendOk(connection.socket, message.requestId, depth);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CALLBACK_RESPONSE message (client responding to a callback invocation).
 */
function handleCallbackResponse(
  message: CallbackResponseMsg,
  connection: ConnectionState
): void {
  const pending = connection.pendingCallbacks.get(message.requestId);

  if (!pending) {
    console.warn(`No pending callback for requestId: ${message.requestId}`);
    return;
  }

  connection.pendingCallbacks.delete(message.requestId);

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }

  if (message.error) {
    const error = new Error(message.error.message);
    error.name = message.error.name;
    if (message.error.stack) {
      error.stack = message.error.stack;
    }
    pending.reject(error);
  } else {
    pending.resolve(message.result);
  }
}

/**
 * Invoke a callback on the client side and wait for response.
 */
async function invokeClientCallback(
  connection: ConnectionState,
  callbackId: number,
  args: unknown[],
  timeout = 10000
): Promise<unknown> {
  const requestId = connection.nextCallbackId++;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      connection.pendingCallbacks.delete(requestId);
      reject(new Error("Callback timeout"));
    }, timeout);

    const pending: PendingRequest = {
      resolve,
      reject,
      timeoutId,
    };

    connection.pendingCallbacks.set(requestId, pending);

    const invoke: CallbackInvoke = {
      type: MessageType.CALLBACK_INVOKE,
      requestId,
      callbackId,
      args,
    };

    sendMessage(connection.socket, invoke);
  });
}

/**
 * Setup custom functions as globals in the isolate context.
 * Each function invokes the client callback when called.
 * Results are JSON serialized/deserialized to ensure proper transfer across isolate boundary.
 *
 * Custom functions return Promises that resolve when the host callback completes.
 * Users should use `await` when calling these functions.
 */
async function setupCustomFunctions(
  context: ivm.Context,
  customCallbacks: CustomFunctionRegistrations,
  connection: ConnectionState
): Promise<void> {
  const global = context.global;

  // Reference that invokes the callback and returns the result
  // Uses applySyncPromise which works in async contexts (serve handlers, etc.)
  const invokeCallbackRef = new ivm.Reference(
    async (callbackId: number, argsJson: string) => {
      const args = JSON.parse(argsJson);
      try {
        const result = await invokeClientCallback(connection, callbackId, args);
        return JSON.stringify({ ok: true, value: result });
      } catch (error: unknown) {
        const err = error as Error;
        return JSON.stringify({
          ok: false,
          error: { message: err.message, name: err.name },
        });
      }
    }
  );

  global.setSync("__customFn_invoke", invokeCallbackRef);

  // Create wrapper functions for each custom function
  for (const [name, registration] of Object.entries(customCallbacks)) {
    if (registration.async === false) {
      // Sync function: use applySyncPromise (to await the host response) but wrap in regular function
      // The function blocks until the host responds, but returns the value directly (not a Promise)
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            [${registration.callbackId}, JSON.stringify(args)]
          );
          const result = JSON.parse(resultJson);
          if (result.ok) {
            return result.value;
          } else {
            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          }
        };
      `);
    } else {
      // Async function: use applySyncPromise and async function wrapper
      context.evalSync(`
        globalThis.${name} = async function(...args) {
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            [${registration.callbackId}, JSON.stringify(args)]
          );
          const result = JSON.parse(resultJson);
          if (result.ok) {
            return result.value;
          } else {
            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          }
        };
      `);
    }
  }
}

/**
 * Create a module resolver function that invokes the client's module loader.
 */
function createModuleResolver(
  instance: IsolateInstance,
  connection: ConnectionState
): (specifier: string, referrer: ivm.Module) => Promise<ivm.Module> {
  return async (specifier: string, _referrer: ivm.Module): Promise<ivm.Module> => {
    // Check cache first
    const cached = instance.moduleCache?.get(specifier);
    if (cached) return cached;

    if (!instance.moduleLoaderCallbackId) {
      throw new Error(`Module not found: ${specifier}`);
    }

    // Invoke client callback to get source code
    const code = (await invokeClientCallback(
      connection,
      instance.moduleLoaderCallbackId,
      [specifier]
    )) as string;

    // Compile the module
    const mod = await instance.runtime.isolate.compileModule(code, {
      filename: specifier,
    });

    // Instantiate with recursive resolver
    const resolver = createModuleResolver(instance, connection);
    await mod.instantiate(instance.runtime.context, resolver);

    // Cache and return
    instance.moduleCache?.set(specifier, mod);
    return mod;
  };
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

function deserializeResponse(data: SerializedResponseData): Response {
  return new Response(data.body as any, {
    status: data.status,
    statusText: data.statusText,
    headers: data.headers,
  });
}

// ============================================================================
// Test Environment Handlers
// ============================================================================

/**
 * Handle RUN_TESTS message.
 */
async function handleRunTests(
  message: RunTestsRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.testEnvironmentEnabled) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Test environment not enabled. Set testEnvironment: true in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Run tests with optional timeout
    const timeout = message.timeout ?? 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Test timeout")), timeout);
    });

    const results = await Promise.race([
      runTestsInContext(instance.runtime.context),
      timeoutPromise,
    ]);

    sendOk(connection.socket, message.requestId, results);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle RESET_TEST_ENV message.
 */
async function handleResetTestEnv(
  message: ResetTestEnvRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.testEnvironmentEnabled) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Test environment not enabled. Set testEnvironment: true in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Reset test environment state
    await instance.runtime.context.eval("__resetTestEnvironment()", { promise: true });
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

// ============================================================================
// Playwright Handlers
// ============================================================================

/**
 * Handle RUN_PLAYWRIGHT_TESTS message.
 */
async function handleRunPlaywrightTests(
  message: RunPlaywrightTestsRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.playwrightHandle) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Playwright not configured. Provide playwright.page in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const timeout = message.timeout ?? 30000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Playwright test timeout")), timeout);
    });

    const results = await Promise.race([
      runPlaywrightTests(instance.runtime.context),
      timeoutPromise,
    ]);

    // Wait for all pending callbacks (e.g., onConsoleLog) to complete
    await Promise.all(instance.pendingCallbacks);
    instance.pendingCallbacks.length = 0;

    sendOk(connection.socket, message.requestId, results);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle RESET_PLAYWRIGHT_TESTS message.
 */
async function handleResetPlaywrightTests(
  message: ResetPlaywrightTestsRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.playwrightHandle) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Playwright not configured. Provide playwright.page in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    await resetPlaywrightTests(instance.runtime.context);
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle GET_COLLECTED_DATA message.
 */
async function handleGetCollectedData(
  message: GetCollectedDataRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.playwrightHandle) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Playwright not configured. Provide playwright.page in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const data = {
      browserConsoleLogs: instance.playwrightHandle.getBrowserConsoleLogs(),
      networkRequests: instance.playwrightHandle.getNetworkRequests(),
      networkResponses: instance.playwrightHandle.getNetworkResponses(),
    };

    sendOk(connection.socket, message.requestId, data);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}

/**
 * Handle CLEAR_COLLECTED_DATA message.
 */
async function handleClearCollectedData(
  message: ClearCollectedDataRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const instance = state.isolates.get(message.isolateId);

  if (!instance) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.ISOLATE_NOT_FOUND,
      `Isolate not found: ${message.isolateId}`
    );
    return;
  }

  if (!instance.playwrightHandle) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Playwright not configured. Provide playwright.page in createRuntime options."
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    instance.playwrightHandle.clearCollected();
    sendOk(connection.socket, message.requestId);
  } catch (err) {
    const error = err as Error;
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      error.message,
      { name: error.name, stack: error.stack }
    );
  }
}
