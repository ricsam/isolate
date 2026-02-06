/**
 * Connection handling for the isolate daemon.
 */

import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import {
  createFrameParser,
  buildFrame,
  MessageType,
  ErrorCode,
  STREAM_THRESHOLD,
  STREAM_CHUNK_SIZE,
  STREAM_DEFAULT_CREDIT,
  marshalValue,
  unmarshalValue,
  isPromiseRef,
  isAsyncIteratorRef,
  deserializeResponse,
  type SerializedRequest,
  type SerializedResponse,
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
  type HasTestsRequest,
  type GetTestCountRequest,
  type GetCollectedDataRequest,
  type ResetTestEnvRequest,
  type ClearCollectedDataRequest,
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
  type ResponseStreamStart,
  type ResponseStreamChunk,
  type ResponseStreamEnd,
  type StreamPush,
  type StreamPull,
  type StreamClose,
  type StreamError,
  type CallbackStreamStart,
  type CallbackStreamChunk,
  type CallbackStreamEnd,
  type ClientEventMessage,
  type IsolateEventMessage,
  IsolateEvents,
  ClientEvents,
  type WsCommandPayload,
  type WsClientConnectPayload,
  type WsClientSendPayload,
  type WsClientClosePayload,
  type WsClientOpenedPayload,
  type WsClientMessagePayload,
  type WsClientClosedPayload,
  type WsClientErrorPayload,
  type FetchRequestInit,
  type MarshalContext,
} from "@ricsam/isolate-protocol";
import { createCallbackFileSystemHandler } from "./callback-fs-handler.ts";
import {
  createRuntime,
  type RuntimeHandle,
  type CustomFunctionsMarshalOptions,
} from "@ricsam/isolate-runtime";
import type {
  DaemonState,
  ConnectionState,
  IsolateInstance,
  PendingRequest,
  CallbackContext,
  CallbackStreamReceiver,
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
    activeStreams: new Map(),
    streamReceivers: new Map(),
    callbackStreamReceivers: new Map(),
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
    // Dispose or soft-delete isolates owned by this connection
    for (const isolateId of connection.isolates) {
      const instance = state.isolates.get(isolateId);
      if (instance) {
        if (instance.namespaceId != null && !instance.isDisposed) {
          // Namespaced runtime: soft-delete (keep cached for reuse)
          softDeleteRuntime(instance, state);
        } else if (!instance.isDisposed) {
          // Non-namespaced runtime: hard delete
          instance.runtime.dispose().catch(() => {
            // Ignore disposal errors
          });
          state.isolates.delete(isolateId);
        }
      }
    }

    // Reject pending callbacks
    for (const [, pending] of connection.pendingCallbacks) {
      pending.reject(new Error("Connection closed"));
    }
    connection.pendingCallbacks.clear();

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

    case MessageType.HAS_TESTS:
      await handleHasTests(message as HasTestsRequest, connection, state);
      break;

    case MessageType.GET_TEST_COUNT:
      await handleGetTestCount(
        message as GetTestCountRequest,
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

    // Stream operations (for request body streaming)
    case MessageType.STREAM_PUSH:
      handleStreamPush(message as StreamPush, connection);
      break;

    case MessageType.STREAM_PULL:
      handleStreamPull(message as StreamPull, connection);
      break;

    case MessageType.STREAM_CLOSE:
      handleStreamClose(message as StreamClose, connection);
      break;

    case MessageType.STREAM_ERROR:
      handleStreamError(message as StreamError, connection);
      break;

    // Callback streaming messages (for streaming fetch callback responses)
    case MessageType.CALLBACK_STREAM_START:
      handleCallbackStreamStart(message as CallbackStreamStart, connection);
      break;

    case MessageType.CALLBACK_STREAM_CHUNK:
      handleCallbackStreamChunk(message as CallbackStreamChunk, connection);
      break;

    case MessageType.CALLBACK_STREAM_END:
      handleCallbackStreamEnd(message as CallbackStreamEnd, connection);
      break;

    // Generic client events (WebSocket events and user-defined events)
    case MessageType.CLIENT_EVENT:
      handleClientEvent(message as ClientEventMessage, connection, state);
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

// ============================================================================
// Namespace Runtime Management
// ============================================================================

/**
 * Soft-delete a namespaced runtime (keep cached for reuse).
 * Clears owner connection and callbacks but preserves isolate/context.
 */
function softDeleteRuntime(instance: IsolateInstance, state: DaemonState): void {
  instance.isDisposed = true;
  instance.disposedAt = Date.now();
  instance.ownerConnection = null;
  if (instance.callbackContext) {
    instance.callbackContext.connection = null;
  }
  instance.callbacks.clear();

  // Clear timers
  instance.runtime.timers.clearAll();

  // Reset console state
  instance.runtime.console.reset();

  // Clear pending callbacks
  instance.runtime.pendingCallbacks.length = 0;

  // Clear returned callback/promise/iterator registries
  instance.returnedCallbacks?.clear();
  instance.returnedPromises?.clear();
  instance.returnedIterators?.clear();

  // Clear module cache (staticModuleCache and transformCache preserved by clearModuleCache)
  instance.runtime.clearModuleCache();
}

/**
 * Reuse a cached namespaced runtime for a new connection.
 * Resets state that should be fresh but preserves isolate/context/module cache.
 */
function reuseNamespacedRuntime(
  instance: IsolateInstance,
  connection: ConnectionState,
  message: CreateRuntimeRequest,
  state: DaemonState
): void {
  // Update ownership
  instance.ownerConnection = connection.socket;
  instance.isDisposed = false;
  instance.disposedAt = undefined;
  instance.lastActivity = Date.now();

  // Track in connection
  connection.isolates.add(instance.isolateId);

  // Re-register callbacks from the new request
  const callbacks = message.options.callbacks;
  const testEnvOptions =
    message.options.testEnvironment != null &&
    typeof message.options.testEnvironment === "object"
      ? message.options.testEnvironment
      : undefined;

  // Update the mutable callback context (closures reference this object)
  if (instance.callbackContext) {
    // Update connection reference
    instance.callbackContext.connection = connection;

    // Update callback IDs
    instance.callbackContext.consoleOnEntry = callbacks?.console?.onEntry?.callbackId;
    instance.callbackContext.fetch = callbacks?.fetch?.callbackId;
    instance.callbackContext.moduleLoader = callbacks?.moduleLoader?.callbackId;
    instance.callbackContext.testEnvironmentOnEvent =
      testEnvOptions?.callbacks?.onEvent?.callbackId;
    instance.callbackContext.playwright = {
      handlerCallbackId: callbacks?.playwright?.handlerCallbackId,
      onBrowserConsoleLogCallbackId:
        callbacks?.playwright?.onBrowserConsoleLogCallbackId,
      onNetworkRequestCallbackId:
        callbacks?.playwright?.onNetworkRequestCallbackId,
      onNetworkResponseCallbackId:
        callbacks?.playwright?.onNetworkResponseCallbackId,
    };

    // Update FS callback IDs
    instance.callbackContext.fs = {
      readFile: callbacks?.fs?.readFile?.callbackId,
      writeFile: callbacks?.fs?.writeFile?.callbackId,
      stat: callbacks?.fs?.stat?.callbackId,
      readdir: callbacks?.fs?.readdir?.callbackId,
      unlink: callbacks?.fs?.unlink?.callbackId,
      mkdir: callbacks?.fs?.mkdir?.callbackId,
      rmdir: callbacks?.fs?.rmdir?.callbackId,
    };

    // Update custom function callback IDs
    instance.callbackContext.custom.clear();
    if (callbacks?.custom) {
      for (const [name, reg] of Object.entries(callbacks.custom)) {
        if (reg) {
          instance.callbackContext.custom.set(name, reg.callbackId);
        }
      }
    }
  }

  // Also update the callbacks map for registration tracking
  instance.callbacks.clear();

  if (callbacks?.console?.onEntry) {
    instance.callbacks.set(callbacks.console.onEntry.callbackId, {
      ...callbacks.console.onEntry,
      name: "onEntry",
    });
  }

  if (callbacks?.fetch) {
    instance.callbacks.set(callbacks.fetch.callbackId, callbacks.fetch);
  }

  if (callbacks?.fs) {
    for (const [name, reg] of Object.entries(callbacks.fs)) {
      if (reg) {
        instance.callbacks.set(reg.callbackId, { ...reg, name });
      }
    }
  }

  if (callbacks?.moduleLoader) {
    instance.callbacks.set(callbacks.moduleLoader.callbackId, callbacks.moduleLoader);
  }

  if (callbacks?.custom) {
    for (const [name, reg] of Object.entries(callbacks.custom)) {
      if (reg) {
        instance.callbacks.set(reg.callbackId, { ...reg, name });
      }
    }
  }

  if (testEnvOptions?.callbacks?.onEvent) {
    instance.callbacks.set(testEnvOptions.callbacks.onEvent.callbackId, {
      ...testEnvOptions.callbacks.onEvent,
      name: "testEnvironment.onEvent",
    });
  }

  if (callbacks?.playwright) {
    instance.callbacks.set(callbacks.playwright.handlerCallbackId, {
      callbackId: callbacks.playwright.handlerCallbackId,
      name: "playwright.handler",
      type: "async",
    });
    if (callbacks.playwright.onBrowserConsoleLogCallbackId !== undefined) {
      instance.callbacks.set(callbacks.playwright.onBrowserConsoleLogCallbackId, {
        callbackId: callbacks.playwright.onBrowserConsoleLogCallbackId,
        name: "playwright.onBrowserConsoleLog",
        type: "sync",
      });
    }
    if (callbacks.playwright.onNetworkRequestCallbackId !== undefined) {
      instance.callbacks.set(callbacks.playwright.onNetworkRequestCallbackId, {
        callbackId: callbacks.playwright.onNetworkRequestCallbackId,
        name: "playwright.onNetworkRequest",
        type: "sync",
      });
    }
    if (callbacks.playwright.onNetworkResponseCallbackId !== undefined) {
      instance.callbacks.set(callbacks.playwright.onNetworkResponseCallbackId, {
        callbackId: callbacks.playwright.onNetworkResponseCallbackId,
        name: "playwright.onNetworkResponse",
        type: "sync",
      });
    }
  }

  // Re-initialize registries for new callbacks
  instance.returnedCallbacks = new Map();
  instance.returnedPromises = new Map();
  instance.returnedIterators = new Map();
  instance.nextLocalCallbackId = 1_000_000;
}

/**
 * Evict the oldest disposed runtime to make room for a new one.
 * Returns true if a runtime was evicted, false if no disposed runtimes available.
 */
async function evictOldestDisposedRuntime(state: DaemonState): Promise<boolean> {
  let oldest: IsolateInstance | null = null;
  let oldestTime = Infinity;

  for (const [, instance] of state.isolates) {
    if (instance.isDisposed && instance.disposedAt !== undefined) {
      if (instance.disposedAt < oldestTime) {
        oldestTime = instance.disposedAt;
        oldest = instance;
      }
    }
  }

  if (oldest) {
    // Hard delete the oldest disposed runtime
    try {
      await oldest.runtime.dispose();
    } catch {
      // Ignore disposal errors
    }
    state.isolates.delete(oldest.isolateId);
    if (oldest.namespaceId != null) {
      state.namespacedRuntimes.delete(oldest.namespaceId);
    }
    return true;
  }

  return false;
}

// ============================================================================
// Message Handlers
// ============================================================================

/**
 * Handle CREATE_RUNTIME message.
 */
async function handleCreateRuntime(
  message: CreateRuntimeRequest,
  connection: ConnectionState,
  state: DaemonState
): Promise<void> {
  const namespaceId = message.options.namespaceId;

  // Check if we're trying to reuse a namespaced runtime
  // Note: use != null to allow empty string namespace IDs but exclude undefined/null
  // (MessagePack converts undefined to null during encoding)
  if (namespaceId != null) {
    const existing = state.namespacedRuntimes.get(namespaceId);

    if (existing) {
      if (!existing.isDisposed) {
        // Check if same connection already owns this runtime (idempotent case)
        if (existing.ownerConnection === connection.socket) {
          sendOk(connection.socket, message.requestId, {
            isolateId: existing.isolateId,
            reused: true,
          });
          return;
        }

        // Different connection - still error
        sendError(
          connection.socket,
          message.requestId,
          ErrorCode.SCRIPT_ERROR,
          `Namespace "${namespaceId}" already has an active runtime`
        );
        return;
      }

      // Reuse the cached runtime
      reuseNamespacedRuntime(existing, connection, message, state);

      sendOk(connection.socket, message.requestId, {
        isolateId: existing.isolateId,
        reused: true,
      });
      return;
    }
  }

  // Check limits - try LRU eviction if at limit
  if (state.isolates.size >= state.options.maxIsolates) {
    // Try to evict an old disposed runtime
    if (!(await evictOldestDisposedRuntime(state))) {
      sendError(
        connection.socket,
        message.requestId,
        ErrorCode.ISOLATE_MEMORY_LIMIT,
        `Maximum isolates (${state.options.maxIsolates}) reached`
      );
      return;
    }
  }

  try {
    const isolateId = randomUUID();

    // Create bridged callbacks that invoke the client
    const consoleCallbacks = message.options.callbacks?.console;
    const fetchCallback = message.options.callbacks?.fetch;
    const fsCallbacks = message.options.callbacks?.fs;
    const moduleLoaderCallback = message.options.callbacks?.moduleLoader;
    const customCallbacks = message.options.callbacks?.custom;

    // Create mutable callback context that closures can reference
    // This allows updating callback IDs on runtime reuse
    const callbackContext: CallbackContext = {
      connection,
      consoleOnEntry: consoleCallbacks?.onEntry?.callbackId,
      fetch: fetchCallback?.callbackId,
      moduleLoader: moduleLoaderCallback?.callbackId,
      testEnvironmentOnEvent:
        message.options.testEnvironment != null &&
        typeof message.options.testEnvironment === "object"
          ? message.options.testEnvironment.callbacks?.onEvent?.callbackId
          : undefined,
      playwright: {
        handlerCallbackId: message.options.callbacks?.playwright?.handlerCallbackId,
        onBrowserConsoleLogCallbackId:
          message.options.callbacks?.playwright?.onBrowserConsoleLogCallbackId,
        onNetworkRequestCallbackId:
          message.options.callbacks?.playwright?.onNetworkRequestCallbackId,
        onNetworkResponseCallbackId:
          message.options.callbacks?.playwright?.onNetworkResponseCallbackId,
      },
      fs: {
        readFile: fsCallbacks?.readFile?.callbackId,
        writeFile: fsCallbacks?.writeFile?.callbackId,
        stat: fsCallbacks?.stat?.callbackId,
        readdir: fsCallbacks?.readdir?.callbackId,
        unlink: fsCallbacks?.unlink?.callbackId,
        mkdir: fsCallbacks?.mkdir?.callbackId,
        rmdir: fsCallbacks?.rmdir?.callbackId,
      },
      custom: new Map(
        customCallbacks
          ? Object.entries(customCallbacks).map(([name, reg]) => [name, reg.callbackId])
          : []
      ),
    };

    // Pre-create the instance object so marshalOptions closures can reference it
    // (needed for returned callbacks/promises/iterators registration)
    const instance: IsolateInstance = {
      isolateId,
      runtime: null as unknown as RuntimeHandle, // Set after createRuntime
      ownerConnection: connection.socket,
      callbacks: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      // Initialize registries for returned callbacks/promises/iterators
      returnedCallbacks: new Map(),
      returnedPromises: new Map(),
      returnedIterators: new Map(),
      // Start at 1,000,000 to avoid conflicts with client callback IDs
      nextLocalCallbackId: 1_000_000,
      // Namespace pooling fields
      namespaceId,
      isDisposed: false,
      // Mutable callback context for runtime reuse
      callbackContext,
    };

    // Build custom functions as local IPC-bridged implementations
    type CustomFunctions = Record<string, { type: "sync" | "async" | "asyncIterator"; fn: (...args: unknown[]) => unknown }>;
    let bridgedCustomFunctions: CustomFunctions | undefined;
    let customFnMarshalOptions: CustomFunctionsMarshalOptions | undefined;

    if (customCallbacks) {
      // Create MarshalContext factory and addCallbackIdsToRefs for custom function results
      const createMarshalContext = (): MarshalContext => ({
        registerCallback: (fn: Function): number => {
          const callbackId = instance.nextLocalCallbackId!++;
          instance.returnedCallbacks!.set(callbackId, fn);
          return callbackId;
        },
        registerPromise: (promise: Promise<unknown>): number => {
          const promiseId = instance.nextLocalCallbackId!++;
          instance.returnedPromises!.set(promiseId, promise);
          return promiseId;
        },
        registerIterator: (iterator: AsyncIterator<unknown>): number => {
          const iteratorId = instance.nextLocalCallbackId!++;
          instance.returnedIterators!.set(iteratorId, iterator);
          return iteratorId;
        },
      });

      const addCallbackIdsToRefs = (value: unknown): unknown => {
        if (value === null || typeof value !== 'object') return value;

        if (isPromiseRef(value)) {
          if ('__resolveCallbackId' in value) return value;
          const resolveCallbackId = instance.nextLocalCallbackId!++;
          instance.returnedCallbacks!.set(resolveCallbackId, async (promiseId: number) => {
            const promise = instance.returnedPromises!.get(promiseId);
            if (!promise) throw new Error(`Promise ${promiseId} not found`);
            const result = await promise;
            instance.returnedPromises!.delete(promiseId);
            const ctx = createMarshalContext();
            const marshalled = await marshalValue(result, ctx);
            return addCallbackIdsToRefs(marshalled);
          });
          return { ...value, __resolveCallbackId: resolveCallbackId };
        }

        if (isAsyncIteratorRef(value)) {
          if ('__nextCallbackId' in value) return value;
          const nextCallbackId = instance.nextLocalCallbackId!++;
          instance.returnedCallbacks!.set(nextCallbackId, async (iteratorId: number) => {
            const iterator = instance.returnedIterators!.get(iteratorId);
            if (!iterator) throw new Error(`Iterator ${iteratorId} not found`);
            const result = await iterator.next();
            if (result.done) instance.returnedIterators!.delete(iteratorId);
            const ctx = createMarshalContext();
            const marshalledValue = await marshalValue(result.value, ctx);
            return { done: result.done, value: addCallbackIdsToRefs(marshalledValue) };
          });
          const returnCallbackId = instance.nextLocalCallbackId!++;
          instance.returnedCallbacks!.set(returnCallbackId, async (iteratorId: number, returnValue?: unknown) => {
            const iterator = instance.returnedIterators!.get(iteratorId);
            instance.returnedIterators!.delete(iteratorId);
            if (!iterator || !iterator.return) return { done: true, value: undefined };
            const result = await iterator.return(returnValue);
            const ctx = createMarshalContext();
            const marshalledValue = await marshalValue(result.value, ctx);
            return { done: true, value: addCallbackIdsToRefs(marshalledValue) };
          });
          return { ...value, __nextCallbackId: nextCallbackId, __returnCallbackId: returnCallbackId };
        }

        if (Array.isArray(value)) return value.map(item => addCallbackIdsToRefs(item));

        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
          result[key] = addCallbackIdsToRefs((value as Record<string, unknown>)[key]);
        }
        return result;
      };

      const LOCAL_CALLBACK_THRESHOLD = 1_000_000;

      const invokeCallback = async (callbackId: number, args: unknown[]): Promise<unknown> => {
        if (callbackId >= LOCAL_CALLBACK_THRESHOLD) {
          // Local callback (returned from a previous custom function call on the daemon)
          const callback = instance.returnedCallbacks!.get(callbackId);
          if (!callback) {
            throw new Error(`Local callback ${callbackId} not found`);
          }
          return await callback(...args);
        } else {
          // Client-side callback — forward via IPC
          const conn = callbackContext.connection;
          if (!conn) {
            throw new Error(`No connection available for callback ${callbackId}`);
          }
          return invokeClientCallback(conn, callbackId, args);
        }
      };

      customFnMarshalOptions = { createMarshalContext, addCallbackIdsToRefs, invokeCallback };

      // Build bridged custom functions
      // The invokeCallbackRef in setupCustomFunctions (in runtime) will call these bridged functions.
      // For client callbacks, these functions invoke IPC; for local callbacks (returned from previous calls),
      // they invoke from the instance registries.
      bridgedCustomFunctions = {};

      for (const [name, registration] of Object.entries(customCallbacks)) {
        // Skip companion callbacks for asyncIterator (name:start, etc.)
        if (name.includes(':')) continue;

        const callbackContext_ = callbackContext; // Capture for closure

        if (registration.type === 'asyncIterator') {
          // AsyncIterator: create start/next/return/throw as a single asyncIterator function
          bridgedCustomFunctions[name] = {
            type: 'asyncIterator' as const,
            fn: (...args: unknown[]) => {
              // Return an async generator that bridges to client callbacks
              const startCallbackId = callbackContext_.custom.get(`${name}:start`);
              const nextCallbackId = callbackContext_.custom.get(`${name}:next`);
              const returnCallbackId = callbackContext_.custom.get(`${name}:return`);

              // Create async generator
              async function* bridgedIterator() {
                // Start the iterator on the client
                const conn = callbackContext_.connection;
                if (!conn || startCallbackId === undefined) {
                  throw new Error(`AsyncIterator callback '${name}' not available`);
                }

                const startResult = await invokeClientCallback(conn, startCallbackId, args) as { iteratorId: number };
                const iteratorId = startResult.iteratorId;

                try {
                  while (true) {
                    const nextConn = callbackContext_.connection;
                    if (!nextConn || nextCallbackId === undefined) {
                      throw new Error(`AsyncIterator callback '${name}' not available`);
                    }
                    const nextResult = await invokeClientCallback(nextConn, nextCallbackId, [iteratorId]) as { done: boolean; value: unknown };
                    if (nextResult.done) return nextResult.value;
                    yield nextResult.value;
                  }
                } finally {
                  // Call return on cleanup
                  const retConn = callbackContext_.connection;
                  if (retConn && returnCallbackId !== undefined) {
                    await invokeClientCallback(retConn, returnCallbackId, [iteratorId]).catch(() => {});
                  }
                }
              }

              return bridgedIterator();
            },
          };
        } else {
          // Sync or async function — both bridge to IPC (which is always async)
          // The runtime's setupCustomFunctions handles the sync/async wrapping in the isolate
          bridgedCustomFunctions[name] = {
            type: registration.type as 'sync' | 'async',
            fn: async (...args: unknown[]) => {
              const conn = callbackContext_.connection;
              const cbId = callbackContext_.custom.get(name);
              if (!conn || cbId === undefined) {
                throw new Error(`Custom function callback '${name}' not available`);
              }
              return invokeClientCallback(conn, cbId, args);
            },
          };
        }
      }
    }

    // Build module loader if registered
    let moduleLoader: ((specifier: string, importer: { path: string; resolveDir: string }) => Promise<{ code: string; resolveDir: string; static?: boolean }>) | undefined;
    if (moduleLoaderCallback) {
      moduleLoader = async (specifier: string, importer: { path: string; resolveDir: string }) => {
        const conn = callbackContext.connection;
        const cbId = callbackContext.moduleLoader;
        if (!conn || cbId === undefined) {
          throw new Error("Module loader callback not available");
        }
        return invokeClientCallback(conn, cbId, [specifier, importer]) as Promise<{ code: string; resolveDir: string; static?: boolean }>;
      };
    }

    // Build test environment options
    let testEnvironment: boolean | { onEvent?: (event: unknown) => void; testTimeout?: number } | undefined;
    if (message.options.testEnvironment) {
      const testEnvOption = message.options.testEnvironment;
      const testEnvOptions = typeof testEnvOption === "object" ? testEnvOption : undefined;
      testEnvironment = {
        onEvent: testEnvOptions?.callbacks?.onEvent
          ? (event: unknown) => {
              const conn = callbackContext.connection;
              const callbackId = callbackContext.testEnvironmentOnEvent;
              if (!conn || callbackId === undefined) {
                return;
              }
              const promise = invokeClientCallback(
                conn,
                callbackId,
                [JSON.stringify(event)]
              ).catch(() => {});
              // Push to runtime's pendingCallbacks (will be set after createRuntime)
              instance.runtime?.pendingCallbacks?.push(promise);
            }
          : undefined,
        testTimeout: testEnvOptions?.testTimeout,
      };

      // Store callback registration
      if (testEnvOptions?.callbacks?.onEvent) {
        instance.callbacks.set(testEnvOptions.callbacks.onEvent.callbackId, {
          ...testEnvOptions.callbacks.onEvent,
          name: "testEnvironment.onEvent",
        });
      }
    }

    // Build playwright options
    let playwrightOptions: { handler: (op: PlaywrightOperation) => Promise<PlaywrightResult>; console?: boolean; onEvent?: (event: { type: string; level?: string; stdout?: string; timestamp?: number; [key: string]: unknown }) => void } | undefined;
    const playwrightCallbacks = message.options.callbacks?.playwright;
    if (playwrightCallbacks) {
      playwrightOptions = {
        handler: async (op: PlaywrightOperation): Promise<PlaywrightResult> => {
          const conn = callbackContext.connection;
          const callbackId = callbackContext.playwright.handlerCallbackId;
          if (!conn || callbackId === undefined) {
            return {
              ok: false,
              error: {
                name: "Error",
                message: "Playwright handler callback not available",
              },
            };
          }
          try {
            const resultJson = await invokeClientCallback(
              conn,
              callbackId,
              [JSON.stringify(op)],
            );
            return JSON.parse(resultJson as string) as PlaywrightResult;
          } catch (err) {
            const error = err as Error;
            return { ok: false, error: { name: error.name, message: error.message } };
          }
        },
        console: playwrightCallbacks.console,
        onEvent: (event: { type: string; level?: string; stdout?: string; timestamp?: number; [key: string]: unknown }) => {
          const conn = callbackContext.connection;
          if (!conn) {
            return;
          }

          if (
            event.type === "browserConsoleLog" &&
            callbackContext.playwright.onBrowserConsoleLogCallbackId !== undefined
          ) {
            const promise = invokeClientCallback(
              conn,
              callbackContext.playwright.onBrowserConsoleLogCallbackId,
              [{ level: event.level, stdout: event.stdout, timestamp: event.timestamp }]
            ).catch(() => {});
            instance.runtime?.pendingCallbacks?.push(promise);
          } else if (
            event.type === "networkRequest" &&
            callbackContext.playwright.onNetworkRequestCallbackId !== undefined
          ) {
            const promise = invokeClientCallback(
              conn,
              callbackContext.playwright.onNetworkRequestCallbackId,
              [event]
            ).catch(() => {});
            instance.runtime?.pendingCallbacks?.push(promise);
          } else if (
            event.type === "networkResponse" &&
            callbackContext.playwright.onNetworkResponseCallbackId !== undefined
          ) {
            const promise = invokeClientCallback(
              conn,
              callbackContext.playwright.onNetworkResponseCallbackId,
              [event]
            ).catch(() => {});
            instance.runtime?.pendingCallbacks?.push(promise);
          }
        },
      };
    }

    // Create the runtime using the unified createRuntime()
    const runtime = await createRuntime({
      memoryLimitMB: message.options.memoryLimitMB ?? state.options.defaultMemoryLimitMB,
      cwd: message.options.cwd,
      // Console handler that bridges to client via IPC
      console: {
        onEntry: (entry) => {
          const conn = callbackContext.connection;
          const callbackId = callbackContext.consoleOnEntry;
          if (!conn || callbackId === undefined) return;
          const promise = invokeClientCallback(conn, callbackId, [entry]).catch(() => {});
          runtime.pendingCallbacks.push(promise);
        },
      },
      // Fetch handler that bridges to client via IPC
      fetch: async (url: string, init: FetchRequestInit) => {
        const conn = callbackContext.connection;
        const callbackId = callbackContext.fetch;
        if (!conn || callbackId === undefined) {
          throw new Error("Fetch callback not available");
        }
        const serialized: SerializedRequest = {
          url,
          method: init.method,
          headers: init.headers,
          body: init.rawBody,
        };
        const result = await invokeClientCallback(conn, callbackId, [serialized]);
        if (result && typeof result === 'object' && (result as { __streamingResponse?: boolean }).__streamingResponse) {
          const response = (result as { response: Response }).response;
          (response as Response & { __isCallbackStream?: boolean }).__isCallbackStream = true;
          return response;
        }
        return deserializeResponse(result as SerializedResponse);
      },
      // FS handler that bridges to client via IPC
      fs: {
        getDirectory: async (dirPath: string) => {
          const conn = callbackContext.connection;
          if (!conn) {
            throw new Error("FS callbacks not available");
          }
          return createCallbackFileSystemHandler({
            connection: conn,
            callbackContext,
            invokeClientCallback,
            basePath: dirPath,
          });
        },
      },
      // Module loader that bridges to client via IPC
      moduleLoader,
      // Custom functions bridged to client via IPC
      customFunctions: bridgedCustomFunctions as any,
      customFunctionsMarshalOptions: customFnMarshalOptions,
      // Test environment
      testEnvironment,
      // Playwright
      playwright: playwrightOptions as any,
    });

    // Set the runtime on the pre-created instance
    instance.runtime = runtime;

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
    if (playwrightCallbacks) {
      instance.callbacks.set(playwrightCallbacks.handlerCallbackId, {
        callbackId: playwrightCallbacks.handlerCallbackId,
        name: "playwright.handler",
        type: "async",
      });
      if (playwrightCallbacks.onBrowserConsoleLogCallbackId !== undefined) {
        instance.callbacks.set(playwrightCallbacks.onBrowserConsoleLogCallbackId, {
          callbackId: playwrightCallbacks.onBrowserConsoleLogCallbackId,
          name: "playwright.onBrowserConsoleLog",
          type: "sync",
        });
      }
      if (playwrightCallbacks.onNetworkRequestCallbackId !== undefined) {
        instance.callbacks.set(playwrightCallbacks.onNetworkRequestCallbackId, {
          callbackId: playwrightCallbacks.onNetworkRequestCallbackId,
          name: "playwright.onNetworkRequest",
          type: "sync",
        });
      }
      if (playwrightCallbacks.onNetworkResponseCallbackId !== undefined) {
        instance.callbacks.set(playwrightCallbacks.onNetworkResponseCallbackId, {
          callbackId: playwrightCallbacks.onNetworkResponseCallbackId,
          name: "playwright.onNetworkResponse",
          type: "sync",
        });
      }
    }

    state.isolates.set(isolateId, instance);
    connection.isolates.add(isolateId);
    state.stats.totalIsolatesCreated++;

    // Add to namespace index if this is a namespaced runtime
    if (namespaceId != null) {
      state.namespacedRuntimes.set(namespaceId, instance);
    }

    // Forward WebSocket commands from isolate to client via ISOLATE_EVENT
    runtime.fetch.onWebSocketCommand((cmd) => {
      const targetConnection = callbackContext.connection;
      if (!targetConnection) {
        return;
      }

      let data: string | Uint8Array | undefined;
      if (cmd.data instanceof ArrayBuffer) {
        data = new Uint8Array(cmd.data);
      } else {
        data = cmd.data as string | undefined;
      }
      const payload: WsCommandPayload = {
        type: cmd.type,
        connectionId: cmd.connectionId,
        data,
        code: cmd.code,
        reason: cmd.reason,
      };
      sendMessage(targetConnection.socket, {
        type: MessageType.ISOLATE_EVENT,
        isolateId,
        event: IsolateEvents.WS_COMMAND,
        payload,
      } as IsolateEventMessage);
    });

    // Forward client WebSocket commands from isolate to client via ISOLATE_EVENT
    runtime.fetch.onClientWebSocketCommand((cmd) => {
      const targetConnection = callbackContext.connection;
      if (!targetConnection) {
        return;
      }

      let data: string | Uint8Array | undefined;
      if (cmd.data instanceof ArrayBuffer) {
        data = new Uint8Array(cmd.data);
      } else {
        data = cmd.data as string | undefined;
      }
      if (cmd.type === "connect") {
        const payload: WsClientConnectPayload = {
          socketId: cmd.socketId,
          url: cmd.url!,
          protocols: cmd.protocols,
        };
        sendMessage(targetConnection.socket, {
          type: MessageType.ISOLATE_EVENT,
          isolateId,
          event: IsolateEvents.WS_CLIENT_CONNECT,
          payload,
        } as IsolateEventMessage);
      } else if (cmd.type === "send") {
        const payload: WsClientSendPayload = {
          socketId: cmd.socketId,
          data: data!,
        };
        sendMessage(targetConnection.socket, {
          type: MessageType.ISOLATE_EVENT,
          isolateId,
          event: IsolateEvents.WS_CLIENT_SEND,
          payload,
        } as IsolateEventMessage);
      } else if (cmd.type === "close") {
        const payload: WsClientClosePayload = {
          socketId: cmd.socketId,
          code: cmd.code,
          reason: cmd.reason,
        };
        sendMessage(targetConnection.socket, {
          type: MessageType.ISOLATE_EVENT,
          isolateId,
          event: IsolateEvents.WS_CLIENT_CLOSE,
          payload,
        } as IsolateEventMessage);
      }
    });

    // Forward user-defined events from isolate to client via ISOLATE_EVENT
    runtime.fetch.onEvent((eventName, payload) => {
      const targetConnection = callbackContext.connection;
      if (!targetConnection) {
        return;
      }
      sendMessage(targetConnection.socket, {
        type: MessageType.ISOLATE_EVENT,
        isolateId,
        event: eventName,
        payload,
      } as IsolateEventMessage);
    });

    sendOk(connection.socket, message.requestId, { isolateId, reused: false });
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
    // Remove from connection's tracking
    connection.isolates.delete(message.isolateId);

    if (instance.namespaceId != null) {
      // Namespaced runtime: soft-delete (keep cached for reuse)
      softDeleteRuntime(instance, state);
    } else {
      // Non-namespaced runtime: hard delete
      await instance.runtime.dispose();
      state.isolates.delete(message.isolateId);
    }

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
    // Delegate to RuntimeHandle.eval() which handles:
    // - Transform, compile, instantiate, evaluate, source maps
    // - Module resolution via moduleLoader callback
    // - Pending callback flushing
    await instance.runtime.eval(message.code, {
      filename: message.filename,
    });

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
    // Handle request body (inline or streamed)
    let requestBody: BodyInit | null = null;

    if (message.request.bodyStreamId !== undefined) {
      // Streaming body - wait for all chunks to arrive
      requestBody = await receiveStreamedBody(connection, message.request.bodyStreamId) as BodyInit;
    } else if (message.request.body) {
      requestBody = message.request.body as unknown as BodyInit;
    }

    // Deserialize the request
    const request = new Request(message.request.url, {
      method: message.request.method,
      headers: message.request.headers,
      body: requestBody,
    });

    // Dispatch to isolate
    const response = await instance.runtime.fetch.dispatchRequest(request);

    // Always stream responses with a body to preserve chunk boundaries
    // Only inline responses without a body (e.g., 204 No Content)
    if (response.body) {
      await sendStreamedResponse(connection, message.requestId, response);
    } else {
      // No body - send inline response with just headers
      const headers: [string, string][] = [];
      response.headers.forEach((value, key) => {
        headers.push([key, value]);
      });

      sendOk(connection.socket, message.requestId, {
        response: {
          status: response.status,
          statusText: response.statusText,
          headers,
          body: null,
        },
      });
    }
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
 * Receive a streamed body from the client.
 * Sets up a receiver and waits for all chunks to arrive.
 */
function receiveStreamedBody(
  connection: ConnectionState,
  streamId: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const receiver: import("./types.ts").StreamReceiver = {
      streamId,
      requestId: 0,
      chunks: [],
      totalBytes: 0,
      resolve,
      reject,
    };
    connection.streamReceivers.set(streamId, receiver);

    // Send initial credit to allow client to start sending
    sendMessage(connection.socket, {
      type: MessageType.STREAM_PULL,
      streamId,
      maxBytes: STREAM_DEFAULT_CREDIT,
    } as StreamPull);
  });
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
// Generic Client Event Handler
// ============================================================================

/**
 * Handle CLIENT_EVENT message from client.
 * Routes WebSocket events to the isolate, and user-defined events to dispatchEvent.
 */
function handleClientEvent(
  message: ClientEventMessage,
  connection: ConnectionState,
  state: DaemonState
): void {
  const instance = state.isolates.get(message.isolateId);
  if (!instance) return;

  instance.lastActivity = Date.now();

  switch (message.event) {
    case ClientEvents.WS_CLIENT_OPENED: {
      const payload = message.payload as WsClientOpenedPayload;
      instance.runtime.fetch.dispatchClientWebSocketOpen(
        payload.socketId,
        payload.protocol,
        payload.extensions
      );
      break;
    }
    case ClientEvents.WS_CLIENT_MESSAGE: {
      const payload = message.payload as WsClientMessagePayload;
      // Convert Uint8Array to ArrayBuffer if needed
      const data = payload.data instanceof Uint8Array
        ? payload.data.buffer.slice(
            payload.data.byteOffset,
            payload.data.byteOffset + payload.data.byteLength
          ) as ArrayBuffer
        : payload.data;
      instance.runtime.fetch.dispatchClientWebSocketMessage(payload.socketId, data);
      break;
    }
    case ClientEvents.WS_CLIENT_CLOSED: {
      const payload = message.payload as WsClientClosedPayload;
      instance.runtime.fetch.dispatchClientWebSocketClose(
        payload.socketId,
        payload.code,
        payload.reason,
        payload.wasClean
      );
      break;
    }
    case ClientEvents.WS_CLIENT_ERROR: {
      const payload = message.payload as WsClientErrorPayload;
      instance.runtime.fetch.dispatchClientWebSocketError(payload.socketId);
      break;
    }
    default: {
      // User-defined events: dispatch to isolate
      instance.runtime.fetch.dispatchEvent(message.event, message.payload);
      break;
    }
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
): Promise<unknown> {
  const requestId = connection.nextCallbackId++;

  return new Promise((resolve, reject) => {
    const pending: PendingRequest = {
      resolve,
      reject,
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

// ============================================================================
// Stream Handlers
// ============================================================================

/**
 * Handle STREAM_PUSH message (client uploading body chunks).
 */
function handleStreamPush(message: StreamPush, connection: ConnectionState): void {
  const receiver = connection.streamReceivers.get(message.streamId);
  if (!receiver) {
    sendMessage(connection.socket, {
      type: MessageType.STREAM_ERROR,
      streamId: message.streamId,
      error: "Stream not found",
    });
    return;
  }

  receiver.chunks.push(message.chunk);
  receiver.totalBytes += message.chunk.length;

  // Send credit back to allow more chunks
  sendMessage(connection.socket, {
    type: MessageType.STREAM_PULL,
    streamId: message.streamId,
    maxBytes: STREAM_DEFAULT_CREDIT,
  } as StreamPull);
}

/**
 * Handle STREAM_PULL message (client granting credit for response streaming).
 */
function handleStreamPull(message: StreamPull, connection: ConnectionState): void {
  const session = connection.activeStreams.get(message.streamId);
  if (!session) {
    return; // Stream may have completed
  }

  session.credit += message.maxBytes;

  // Wake up waiting sender if there's a credit resolver
  if (session.creditResolver) {
    session.creditResolver();
    session.creditResolver = undefined;
  }
}

/**
 * Handle STREAM_CLOSE message (client signaling end of upload).
 */
function handleStreamClose(message: StreamClose, connection: ConnectionState): void {
  const receiver = connection.streamReceivers.get(message.streamId);
  if (!receiver) {
    return;
  }

  // Concatenate all chunks and resolve
  const totalLength = receiver.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of receiver.chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  receiver.resolve(body);
  connection.streamReceivers.delete(message.streamId);
}

/**
 * Handle STREAM_ERROR message (client signaling upload error).
 */
function handleStreamError(message: StreamError, connection: ConnectionState): void {
  const receiver = connection.streamReceivers.get(message.streamId);
  if (receiver) {
    receiver.reject(new Error(message.error));
    connection.streamReceivers.delete(message.streamId);
  }

  const session = connection.activeStreams.get(message.streamId);
  if (session) {
    session.state = "closed";
    connection.activeStreams.delete(message.streamId);
  }

  // Also handle callback stream receivers
  const callbackReceiver = connection.callbackStreamReceivers.get(message.streamId);
  if (callbackReceiver && callbackReceiver.state === "active") {
    callbackReceiver.state = "errored";
    callbackReceiver.error = new Error(message.error);

    // Resolve all pending pull promises so the stream can error properly
    const resolvers = callbackReceiver.pullResolvers.splice(0);
    for (const resolver of resolvers) {
      resolver();
    }

    connection.callbackStreamReceivers.delete(message.streamId);
  }
}

// ============================================================================
// Callback Stream Handlers (for streaming fetch callback responses)
// ============================================================================

/**
 * Handle CALLBACK_STREAM_START message.
 * Creates a ReadableStream and resolves the pending callback with a Response.
 */
function handleCallbackStreamStart(
  message: CallbackStreamStart,
  connection: ConnectionState
): void {
  // Create a partial receiver that will be completed when the stream is created
  const receiver: CallbackStreamReceiver = {
    streamId: message.streamId,
    requestId: message.requestId,
    metadata: message.metadata,
    controller: null as unknown as ReadableStreamDefaultController<Uint8Array>,
    state: "active",
    pendingChunks: [],
    pullResolvers: [],
    controllerFinalized: false,
  };

  // Create a ReadableStream that yields chunks as they arrive
  const readableStream = new ReadableStream<Uint8Array>({
    start(controller) {
      receiver.controller = controller;
    },
    pull(_controller) {
      // If controller is already finalized, just return
      if (receiver.controllerFinalized) {
        return;
      }

      // If there's a pending chunk, enqueue ONE chunk and return
      // This preserves streaming behavior - one chunk per pull
      if (receiver.pendingChunks.length > 0) {
        const chunk = receiver.pendingChunks.shift()!;
        receiver.controller.enqueue(chunk);
        return Promise.resolve();
      }

      // If stream is already closed or errored, handle it
      if (receiver.state === "closed") {
        if (!receiver.controllerFinalized) {
          receiver.controllerFinalized = true;
          receiver.controller.close();
        }
        return Promise.resolve();
      }
      if (receiver.state === "errored") {
        if (!receiver.controllerFinalized && receiver.error) {
          receiver.controllerFinalized = true;
          receiver.controller.error(receiver.error);
        }
        return Promise.resolve();
      }

      // Return a promise that resolves when the next chunk arrives
      return new Promise<void>((resolve) => {
        receiver.pullResolvers.push(resolve);
      });
    },
    cancel(_reason) {
      receiver.state = "closed";
      receiver.controllerFinalized = true;

      // Resolve all pending pull promises
      const resolvers = receiver.pullResolvers.splice(0);
      for (const resolver of resolvers) {
        resolver();
      }

      connection.callbackStreamReceivers.delete(message.streamId);

      // Tell the client to stop streaming this response body
      sendMessage(connection.socket, {
        type: MessageType.CALLBACK_STREAM_CANCEL,
        streamId: message.streamId,
      });

      return Promise.resolve();
    },
  });

  connection.callbackStreamReceivers.set(message.streamId, receiver);

  // Create Response and resolve the pending callback
  const pending = connection.pendingCallbacks.get(message.requestId);
  if (pending) {
    connection.pendingCallbacks.delete(message.requestId);

    const response = new Response(readableStream, {
      status: message.metadata.status,
      statusText: message.metadata.statusText,
      headers: message.metadata.headers,
    });

    // Resolve with the streaming Response
    pending.resolve({ __streamingResponse: true, response });
  }
}

/**
 * Handle CALLBACK_STREAM_CHUNK message.
 * Enqueues a chunk to the stream controller.
 */
function handleCallbackStreamChunk(
  message: CallbackStreamChunk,
  connection: ConnectionState
): void {
  const receiver = connection.callbackStreamReceivers.get(message.streamId);
  if (receiver && receiver.state === "active") {
    if (receiver.pullResolvers.length > 0) {
      // Consumer is waiting for data - enqueue directly and resolve one pending pull
      receiver.controller.enqueue(message.chunk);
      const resolver = receiver.pullResolvers.shift()!;
      resolver();
    } else {
      // Consumer not ready - buffer the chunk
      receiver.pendingChunks.push(message.chunk);
    }
  }
}

/**
 * Handle CALLBACK_STREAM_END message.
 * Closes the stream controller.
 */
function handleCallbackStreamEnd(
  message: CallbackStreamEnd,
  connection: ConnectionState
): void {
  const receiver = connection.callbackStreamReceivers.get(message.streamId);
  if (receiver) {
    // Mark stream as closed
    receiver.state = "closed";

    // Flush any remaining pending chunks
    while (receiver.pendingChunks.length > 0) {
      const chunk = receiver.pendingChunks.shift()!;
      receiver.controller.enqueue(chunk);
    }

    // Close the stream (only if not already finalized)
    if (!receiver.controllerFinalized) {
      receiver.controllerFinalized = true;
      receiver.controller.close();
    }

    // Resolve all pending pull promises
    const resolvers = receiver.pullResolvers.splice(0);
    for (const resolver of resolvers) {
      resolver();
    }

    // Clean up
    connection.callbackStreamReceivers.delete(message.streamId);
  }
}

/**
 * Helper to concatenate Uint8Arrays.
 */
function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Wait for credit to become available on a stream session.
 */
function waitForCredit(session: import("./types.ts").StreamSession): Promise<void> {
  return new Promise((resolve) => {
    session.creditResolver = resolve;
  });
}

/**
 * Send a response body as a stream.
 */
async function sendStreamedResponse(
  connection: ConnectionState,
  requestId: number,
  response: Response
): Promise<void> {
  const streamId = connection.nextStreamId++;

  // Collect headers
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  // Send stream start with metadata
  const startMsg: ResponseStreamStart = {
    type: MessageType.RESPONSE_STREAM_START,
    requestId,
    streamId,
    metadata: {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  };
  sendMessage(connection.socket, startMsg);

  if (!response.body) {
    // No body, just end
    const endMsg: ResponseStreamEnd = {
      type: MessageType.RESPONSE_STREAM_END,
      requestId,
      streamId,
    };
    sendMessage(connection.socket, endMsg);
    return;
  }

  // Create stream session for tracking
  const session: import("./types.ts").StreamSession = {
    streamId,
    direction: "download",
    requestId,
    state: "active",
    bytesTransferred: 0,
    credit: STREAM_DEFAULT_CREDIT,
  };
  connection.activeStreams.set(streamId, session);

  const reader = response.body.getReader();

  try {
    while (true) {
      // Check credit (backpressure)
      while (session.credit < STREAM_CHUNK_SIZE && session.state === "active") {
        await waitForCredit(session);
      }

      if (session.state !== "active") {
        throw new Error("Stream cancelled");
      }

      const { done, value } = await reader.read();

      if (done) {
        const endMsg: ResponseStreamEnd = {
          type: MessageType.RESPONSE_STREAM_END,
          requestId,
          streamId,
        };
        sendMessage(connection.socket, endMsg);
        break;
      }

      // Send chunk(s)
      for (let offset = 0; offset < value.length; offset += STREAM_CHUNK_SIZE) {
        const chunk = value.slice(offset, offset + STREAM_CHUNK_SIZE);

        const chunkMsg: ResponseStreamChunk = {
          type: MessageType.RESPONSE_STREAM_CHUNK,
          requestId,
          streamId,
          chunk,
        };
        sendMessage(connection.socket, chunkMsg);

        session.credit -= chunk.length;
        session.bytesTransferred += chunk.length;
      }
    }
  } catch (err) {
    const errorMsg: StreamError = {
      type: MessageType.STREAM_ERROR,
      streamId,
      error: (err as Error).message,
    };
    sendMessage(connection.socket, errorMsg);
  } finally {
    reader.releaseLock();
    connection.activeStreams.delete(streamId);
  }
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

  instance.lastActivity = Date.now();

  try {
    const timeout = message.timeout ?? 30000;
    const results = await instance.runtime.testEnvironment.runTests(timeout);
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

  instance.lastActivity = Date.now();

  try {
    instance.runtime.testEnvironment.reset();
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
 * Handle HAS_TESTS message.
 */
async function handleHasTests(
  message: HasTestsRequest,
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
    const result = instance.runtime.testEnvironment.hasTests();
    sendOk(connection.socket, message.requestId, result);
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
 * Handle GET_TEST_COUNT message.
 */
async function handleGetTestCount(
  message: GetTestCountRequest,
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
    const result = instance.runtime.testEnvironment.getTestCount();
    sendOk(connection.socket, message.requestId, result);
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

  instance.lastActivity = Date.now();

  try {
    const data = instance.runtime.playwright.getCollectedData();
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

  instance.lastActivity = Date.now();

  try {
    instance.runtime.playwright.clearCollectedData();
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
