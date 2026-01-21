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
  STREAM_THRESHOLD,
  STREAM_CHUNK_SIZE,
  STREAM_DEFAULT_CREDIT,
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
  type WsCommandMessage,
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
  encodeValue,
  decodeValue,
  marshalValue,
  unmarshalValue,
  type MarshalContext,
  type UnmarshalContext,
} from "@ricsam/isolate-protocol";
import { createCallbackFileSystemHandler } from "./callback-fs-handler.ts";
import {
  setupTestEnvironment,
  runTests as runTestsInContext,
  hasTests as hasTestsInContext,
  getTestCount as getTestCountInContext,
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
    }

    // Reject pending callbacks and clear their timeouts
    for (const [, pending] of connection.pendingCallbacks) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
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
 * Clears owner connection and callbacks but preserves isolate/context/module cache.
 */
function softDeleteRuntime(instance: IsolateInstance, state: DaemonState): void {
  instance.isDisposed = true;
  instance.disposedAt = Date.now();
  instance.ownerConnection = null;
  instance.callbacks.clear();

  // Clear timers
  instance.runtime.timers.clearAll();

  // Reset console state
  instance.runtime.console.reset();

  // Clear pending callbacks
  instance.pendingCallbacks.length = 0;

  // Clear returned callback/promise/iterator registries
  instance.returnedCallbacks?.clear();
  instance.returnedPromises?.clear();
  instance.returnedIterators?.clear();

  // Note: We preserve the module cache (moduleCache) for performance benefit
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

  // Update the mutable callback context (closures reference this object)
  if (instance.callbackContext) {
    // Update connection reference
    instance.callbackContext.connection = connection;

    // Update callback IDs
    instance.callbackContext.consoleOnEntry = callbacks?.console?.onEntry?.callbackId;
    instance.callbackContext.fetch = callbacks?.fetch?.callbackId;
    instance.callbackContext.moduleLoader = callbacks?.moduleLoader?.callbackId;

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
    instance.moduleLoaderCallbackId = callbacks.moduleLoader.callbackId;
    instance.callbacks.set(callbacks.moduleLoader.callbackId, callbacks.moduleLoader);
  }

  if (callbacks?.custom) {
    for (const [name, reg] of Object.entries(callbacks.custom)) {
      if (reg) {
        instance.callbacks.set(reg.callbackId, { ...reg, name });
      }
    }
  }

  // Re-initialize registries for new callbacks
  instance.returnedCallbacks = new Map();
  instance.returnedPromises = new Map();
  instance.returnedIterators = new Map();
  instance.nextLocalCallbackId = 1_000_000;

  // Update the __customFnCallbackIds global in the V8 context with new callback IDs
  // This allows custom functions to use the new client's callback IDs
  if (callbacks?.custom) {
    const newCallbackIdMap: Record<string, number> = {};
    for (const [name, reg] of Object.entries(callbacks.custom)) {
      if (reg) {
        newCallbackIdMap[name] = reg.callbackId;
      }
    }
    try {
      instance.runtime.context.global.setSync(
        "__customFnCallbackIds",
        new ivm.ExternalCopy(newCallbackIdMap).copyInto()
      );
    } catch {
      // Ignore errors if context is not available
    }
  }
}

/**
 * Evict the oldest disposed runtime to make room for a new one.
 * Returns true if a runtime was evicted, false if no disposed runtimes available.
 */
function evictOldestDisposedRuntime(state: DaemonState): boolean {
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
      if (oldest.playwrightHandle) {
        oldest.playwrightHandle.dispose();
      }
      oldest.runtime.dispose();
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
    if (!evictOldestDisposedRuntime(state)) {
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

    // Track pending callbacks so eval can wait for them
    const pendingCallbacks: Promise<unknown>[] = [];

    // Create mutable callback context that closures can reference
    // This allows updating callback IDs on runtime reuse
    const callbackContext: CallbackContext = {
      connection,
      consoleOnEntry: consoleCallbacks?.onEntry?.callbackId,
      fetch: fetchCallback?.callbackId,
      moduleLoader: moduleLoaderCallback?.callbackId,
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

    const runtime = await createInternalRuntime({
      memoryLimitMB: message.options.memoryLimitMB ?? state.options.defaultMemoryLimitMB,
      cwd: message.options.cwd,
      // Always create console handler to support adding callbacks on reuse
      console: {
        onEntry: (entry) => {
          // Use callback context for dynamic lookup (supports runtime reuse)
          const conn = callbackContext.connection;
          const callbackId = callbackContext.consoleOnEntry;
          // Only invoke if callback is registered
          if (!conn || callbackId === undefined) return;

          // Track this callback so eval waits for it to complete
          const promise = invokeClientCallback(
            conn,
            callbackId,
            [entry]
          ).catch(() => {}); // Ignore errors, just track completion
          pendingCallbacks.push(promise);
        },
      },
      // Always create fetch handler to support adding callbacks on reuse
      fetch: {
        onFetch: async (request) => {
          // Use callback context for dynamic lookup (supports runtime reuse)
          const conn = callbackContext.connection;
          const callbackId = callbackContext.fetch;
          if (!conn || callbackId === undefined) {
            throw new Error("Fetch callback not available");
          }

          const serialized = await serializeRequest(request);
          const result = await invokeClientCallback(
            conn,
            callbackId,
            [serialized],
            // Use longer timeout for fetch callbacks since they may involve streaming
            // The timeout is for the initial response, streaming continues after
            60000
          );

          // Check if this is a streaming response
          if (result && typeof result === 'object' && (result as { __streamingResponse?: boolean }).__streamingResponse) {
            // Streaming response - return the Response directly
            // Mark it so fetch setup knows to stream it to the isolate
            const response = (result as { response: Response }).response;
            (response as Response & { __isCallbackStream?: boolean }).__isCallbackStream = true;
            return response;
          }

          // Buffered response - deserialize
          return deserializeResponse(result as SerializedResponseData);
        },
      },
      // Always create fs handler to support adding callbacks on reuse
      fs: {
        getDirectory: async (path: string) => {
          // Use callback context for dynamic lookup (supports runtime reuse)
          const conn = callbackContext.connection;
          if (!conn) {
            throw new Error("FS callbacks not available");
          }

          return createCallbackFileSystemHandler({
            connection: conn,
            callbackContext,
            invokeClientCallback,
            basePath: path,
          });
        },
      },
    });

    const instance: IsolateInstance = {
      isolateId,
      runtime,
      ownerConnection: connection.socket,
      callbacks: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      pendingCallbacks,
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

    // Setup module loader
    if (moduleLoaderCallback) {
      instance.moduleLoaderCallbackId = moduleLoaderCallback.callbackId;
      instance.moduleCache = new Map();
    }

    // Setup custom functions as globals in the isolate
    if (customCallbacks) {
      await setupCustomFunctions(runtime.context, customCallbacks, connection, instance);
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
      const testEnvOption = message.options.testEnvironment;
      const testEnvOptions = typeof testEnvOption === "object" ? testEnvOption : undefined;

      // Create event callback if provided
      const onEventCallback = testEnvOptions?.callbacks?.onEvent;

      await setupTestEnvironment(runtime.context, {
        onEvent: onEventCallback
          ? (event) => {
              // Forward event to client callback
              const promise = invokeClientCallback(
                connection,
                onEventCallback.callbackId,
                [JSON.stringify(event)]
              ).catch(() => {});
              pendingCallbacks.push(promise);
            }
          : undefined,
        testTimeout: testEnvOptions?.testTimeout,
      });

      instance.testEnvironmentEnabled = true;

      // Store callback registration
      if (onEventCallback) {
        instance.callbacks.set(onEventCallback.callbackId, {
          ...onEventCallback,
          name: "testEnvironment.onEvent",
        });
      }
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
        // Unified event callback
        onEvent: (event) => {
          // Route events to appropriate client callbacks
          if (event.type === "browserConsoleLog" && playwrightCallbacks.onBrowserConsoleLogCallbackId) {
            const promise = invokeClientCallback(
              connection,
              playwrightCallbacks.onBrowserConsoleLogCallbackId,
              [{ level: event.level, stdout: event.stdout, timestamp: event.timestamp }]
            ).catch(() => {});
            pendingCallbacks.push(promise);
          } else if (event.type === "networkRequest" && playwrightCallbacks.onNetworkRequestCallbackId) {
            const promise = invokeClientCallback(
              connection,
              playwrightCallbacks.onNetworkRequestCallbackId,
              [event]
            ).catch(() => {});
            pendingCallbacks.push(promise);
          } else if (event.type === "networkResponse" && playwrightCallbacks.onNetworkResponseCallbackId) {
            const promise = invokeClientCallback(
              connection,
              playwrightCallbacks.onNetworkResponseCallbackId,
              [event]
            ).catch(() => {});
            pendingCallbacks.push(promise);
          }
        },
      });
    }

    state.isolates.set(isolateId, instance);
    connection.isolates.add(isolateId);
    state.stats.totalIsolatesCreated++;

    // Add to namespace index if this is a namespaced runtime
    if (namespaceId != null) {
      state.namespacedRuntimes.set(namespaceId, instance);
    }

    // Forward WebSocket commands from isolate to client
    instance.runtime.fetch.onWebSocketCommand((cmd) => {
      // Convert ArrayBuffer to Uint8Array if needed for protocol
      let data: string | Uint8Array | undefined;
      if (cmd.data instanceof ArrayBuffer) {
        data = new Uint8Array(cmd.data);
      } else {
        data = cmd.data as string | undefined;
      }
      const wsCommandMsg: WsCommandMessage = {
        type: MessageType.WS_COMMAND,
        isolateId,
        command: {
          type: cmd.type,
          connectionId: cmd.connectionId,
          data,
          code: cmd.code,
          reason: cmd.reason,
        },
      };
      sendMessage(connection.socket, wsCommandMsg);
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
      // Clean up Playwright resources if present
      if (instance.playwrightHandle) {
        instance.playwrightHandle.dispose();
      }

      instance.runtime.dispose();
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

    // Evaluate the module with optional timeout
    const timeout = message.maxExecutionMs;
    await mod.evaluate(timeout ? { timeout } : undefined);

    // Wait for all pending callbacks (e.g., console.log) to complete
    // This ensures the client receives all callbacks before eval resolves
    await Promise.all(instance.pendingCallbacks);
    instance.pendingCallbacks.length = 0; // Clear for next eval

    // Return undefined for module evaluation
    sendOk(connection.socket, message.requestId, { value: undefined });
  } catch (err) {
    const error = err as Error;
    // Check if this is a timeout error from isolated-vm
    const isTimeoutError = error.message?.includes('Script execution timed out');
    sendError(
      connection.socket,
      message.requestId,
      isTimeoutError ? ErrorCode.ISOLATE_TIMEOUT : ErrorCode.SCRIPT_ERROR,
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
 * Lightweight marshalling code to inject into the isolate.
 * Converts JavaScript types to Ref objects for type-preserving serialization.
 */
const ISOLATE_MARSHAL_CODE = `
(function() {
  // Marshal a value (JavaScript → Ref)
  function marshalForHost(value, depth = 0) {
    if (depth > 100) throw new Error('Maximum marshalling depth exceeded');

    if (value === null) return null;
    if (value === undefined) return { __type: 'UndefinedRef' };

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return { __type: 'BigIntRef', value: value.toString() };
    if (type === 'function') throw new Error('Cannot marshal functions from isolate');
    if (type === 'symbol') throw new Error('Cannot marshal Symbol values');

    if (type === 'object') {
      if (value instanceof Date) {
        return { __type: 'DateRef', timestamp: value.getTime() };
      }
      if (value instanceof RegExp) {
        return { __type: 'RegExpRef', source: value.source, flags: value.flags };
      }
      if (value instanceof URL) {
        return { __type: 'URLRef', href: value.href };
      }
      if (typeof Headers !== 'undefined' && value instanceof Headers) {
        const pairs = [];
        value.forEach((v, k) => pairs.push([k, v]));
        return { __type: 'HeadersRef', pairs };
      }
      if (value instanceof Uint8Array) {
        return { __type: 'Uint8ArrayRef', data: Array.from(value) };
      }
      if (value instanceof ArrayBuffer) {
        return { __type: 'Uint8ArrayRef', data: Array.from(new Uint8Array(value)) };
      }
      if (typeof Request !== 'undefined' && value instanceof Request) {
        throw new Error('Cannot marshal Request from isolate. Use fetch callback instead.');
      }
      if (typeof Response !== 'undefined' && value instanceof Response) {
        throw new Error('Cannot marshal Response from isolate. Return plain objects instead.');
      }
      if (typeof File !== 'undefined' && value instanceof File) {
        throw new Error('Cannot marshal File from isolate.');
      }
      if (typeof Blob !== 'undefined' && value instanceof Blob) {
        throw new Error('Cannot marshal Blob from isolate.');
      }
      if (typeof FormData !== 'undefined' && value instanceof FormData) {
        throw new Error('Cannot marshal FormData from isolate.');
      }
      if (Array.isArray(value)) {
        return value.map(v => marshalForHost(v, depth + 1));
      }
      // Plain object
      const result = {};
      for (const key of Object.keys(value)) {
        result[key] = marshalForHost(value[key], depth + 1);
      }
      return result;
    }
    return value;
  }

  // Unmarshal a value (Ref → JavaScript)
  function unmarshalFromHost(value, depth = 0) {
    if (depth > 100) throw new Error('Maximum unmarshalling depth exceeded');

    if (value === null) return null;
    if (typeof value !== 'object') return value;

    if (value.__type) {
      switch (value.__type) {
        case 'UndefinedRef': return undefined;
        case 'DateRef': return new Date(value.timestamp);
        case 'RegExpRef': return new RegExp(value.source, value.flags);
        case 'BigIntRef': return BigInt(value.value);
        case 'URLRef': return new URL(value.href);
        case 'HeadersRef': return new Headers(value.pairs);
        case 'Uint8ArrayRef': return new Uint8Array(value.data);
        case 'RequestRef': {
          const init = {
            method: value.method,
            headers: value.headers,
            body: value.body ? new Uint8Array(value.body) : null,
          };
          if (value.mode) init.mode = value.mode;
          if (value.credentials) init.credentials = value.credentials;
          if (value.cache) init.cache = value.cache;
          if (value.redirect) init.redirect = value.redirect;
          if (value.referrer) init.referrer = value.referrer;
          if (value.referrerPolicy) init.referrerPolicy = value.referrerPolicy;
          if (value.integrity) init.integrity = value.integrity;
          return new Request(value.url, init);
        }
        case 'ResponseRef': {
          return new Response(value.body ? new Uint8Array(value.body) : null, {
            status: value.status,
            statusText: value.statusText,
            headers: value.headers,
          });
        }
        case 'FileRef': {
          if (!value.name) {
            return new Blob([new Uint8Array(value.data)], { type: value.type });
          }
          return new File([new Uint8Array(value.data)], value.name, {
            type: value.type,
            lastModified: value.lastModified,
          });
        }
        case 'FormDataRef': {
          const fd = new FormData();
          for (const [key, entry] of value.entries) {
            if (typeof entry === 'string') {
              fd.append(key, entry);
            } else {
              const file = unmarshalFromHost(entry, depth + 1);
              fd.append(key, file);
            }
          }
          return fd;
        }
        case 'CallbackRef': {
          // Create a proxy function that invokes the callback
          const callbackId = value.callbackId;
          return function(...args) {
            const argsJson = JSON.stringify(marshalForHost(args));
            const resultJson = __customFn_invoke.applySyncPromise(undefined, [callbackId, argsJson]);
            const result = JSON.parse(resultJson);
            if (result.ok) {
              return unmarshalFromHost(result.value);
            } else {
              const error = new Error(result.error.message);
              error.name = result.error.name;
              throw error;
            }
          };
        }
        case 'PromiseRef': {
          // Create a proxy Promise that resolves via callback
          const promiseId = value.promiseId;
          return new Promise((resolve, reject) => {
            try {
              const argsJson = JSON.stringify([promiseId]);
              const resultJson = __customFn_invoke.applySyncPromise(undefined, [value.__resolveCallbackId, argsJson]);
              const result = JSON.parse(resultJson);
              if (result.ok) {
                resolve(unmarshalFromHost(result.value));
              } else {
                reject(new Error(result.error.message));
              }
            } catch (e) {
              reject(e);
            }
          });
        }
        case 'AsyncIteratorRef': {
          const iteratorId = value.iteratorId;
          const nextCallbackId = value.__nextCallbackId;
          const returnCallbackId = value.__returnCallbackId;
          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              const argsJson = JSON.stringify([iteratorId]);
              const resultJson = __customFn_invoke.applySyncPromise(undefined, [nextCallbackId, argsJson]);
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              return {
                done: result.value.done,
                value: unmarshalFromHost(result.value.value)
              };
            },
            async return(v) {
              const argsJson = JSON.stringify([iteratorId, marshalForHost(v)]);
              const resultJson = __customFn_invoke.applySyncPromise(undefined, [returnCallbackId, argsJson]);
              const result = JSON.parse(resultJson);
              return { done: true, value: result.ok ? unmarshalFromHost(result.value) : undefined };
            }
          };
        }
        default:
          // Unknown ref type, return as-is
          break;
      }
    }

    if (Array.isArray(value)) {
      return value.map(v => unmarshalFromHost(v, depth + 1));
    }

    // Plain object - recursively unmarshal
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = unmarshalFromHost(value[key], depth + 1);
    }
    return result;
  }

  globalThis.__marshalForHost = marshalForHost;
  globalThis.__unmarshalFromHost = unmarshalFromHost;
})();
`;

// Threshold for daemon-local callback IDs (returned callbacks/promises/iterators)
const LOCAL_CALLBACK_THRESHOLD = 1_000_000;

/**
 * Type guard for PromiseRef
 */
function isPromiseRef(value: unknown): value is { __type: "PromiseRef"; promiseId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: string }).__type === 'PromiseRef'
  );
}

/**
 * Type guard for AsyncIteratorRef
 */
function isAsyncIteratorRef(value: unknown): value is { __type: "AsyncIteratorRef"; iteratorId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: string }).__type === 'AsyncIteratorRef'
  );
}

/**
 * Type guard for CallbackRef
 */
function isCallbackRef(value: unknown): value is { __type: "CallbackRef"; callbackId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: string }).__type === 'CallbackRef'
  );
}

/**
 * Check if a callback ID is for a daemon-local callback (returned from custom function)
 */
function isLocalCallbackId(callbackId: number): boolean {
  return callbackId >= LOCAL_CALLBACK_THRESHOLD;
}

/**
 * Setup custom functions as globals in the isolate context.
 * Each function invokes the client callback when called.
 * Results are marshalled/unmarshalled to preserve type fidelity across isolate boundary.
 *
 * Custom functions return Promises that resolve when the host callback completes.
 * Users should use `await` when calling these functions.
 */
async function setupCustomFunctions(
  context: ivm.Context,
  customCallbacks: CustomFunctionRegistrations,
  connection: ConnectionState,
  instance: IsolateInstance
): Promise<void> {
  const global = context.global;

  /**
   * Create a MarshalContext for registering returned callbacks/promises/iterators.
   * These are registered on the instance so they can be invoked when the isolate calls back.
   */
  function createMarshalContext(): MarshalContext {
    return {
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
    };
  }

  /**
   * Post-process marshalled value to add callback IDs for PromiseRef and AsyncIteratorRef.
   * This recursively walks the value and adds __resolveCallbackId, __nextCallbackId, etc.
   */
  function addCallbackIdsToRefs(value: unknown): unknown {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    // Check for PromiseRef - skip if already has callback ID (came from client)
    if (isPromiseRef(value)) {
      if ('__resolveCallbackId' in value) {
        // Already has callback ID from client, pass through
        return value;
      }
      // Create a resolve callback that waits for the promise
      const resolveCallbackId = instance.nextLocalCallbackId!++;
      instance.returnedCallbacks!.set(resolveCallbackId, async (promiseId: number) => {
        const promise = instance.returnedPromises!.get(promiseId);
        if (!promise) {
          throw new Error(`Promise ${promiseId} not found`);
        }
        const result = await promise;
        // Clean up
        instance.returnedPromises!.delete(promiseId);
        // Marshal the result recursively
        const ctx = createMarshalContext();
        const marshalled = await marshalValue(result, ctx);
        return addCallbackIdsToRefs(marshalled);
      });
      return {
        ...value,
        __resolveCallbackId: resolveCallbackId,
      };
    }

    // Check for AsyncIteratorRef - skip if already has callback IDs (came from client)
    if (isAsyncIteratorRef(value)) {
      if ('__nextCallbackId' in value) {
        // Already has callback IDs from client, pass through
        return value;
      }
      // Create next callback
      const nextCallbackId = instance.nextLocalCallbackId!++;
      instance.returnedCallbacks!.set(nextCallbackId, async (iteratorId: number) => {
        const iterator = instance.returnedIterators!.get(iteratorId);
        if (!iterator) {
          throw new Error(`Iterator ${iteratorId} not found`);
        }
        const result = await iterator.next();
        if (result.done) {
          instance.returnedIterators!.delete(iteratorId);
        }
        // Marshal the value recursively
        const ctx = createMarshalContext();
        const marshalledValue = await marshalValue(result.value, ctx);
        return {
          done: result.done,
          value: addCallbackIdsToRefs(marshalledValue),
        };
      });

      // Create return callback
      const returnCallbackId = instance.nextLocalCallbackId!++;
      instance.returnedCallbacks!.set(returnCallbackId, async (iteratorId: number, returnValue?: unknown) => {
        const iterator = instance.returnedIterators!.get(iteratorId);
        instance.returnedIterators!.delete(iteratorId);
        if (!iterator || !iterator.return) {
          return { done: true, value: undefined };
        }
        const result = await iterator.return(returnValue);
        const ctx = createMarshalContext();
        const marshalledValue = await marshalValue(result.value, ctx);
        return {
          done: true,
          value: addCallbackIdsToRefs(marshalledValue),
        };
      });

      return {
        ...value,
        __nextCallbackId: nextCallbackId,
        __returnCallbackId: returnCallbackId,
      };
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => addCallbackIdsToRefs(item));
    }

    // Handle plain objects (recursively process values)
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = addCallbackIdsToRefs((value as Record<string, unknown>)[key]);
    }
    return result;
  }

  // Reference that invokes the callback and returns the result
  // Uses applySyncPromise which works in async contexts (serve handlers, etc.)
  // Args are JSON-encoded marshalled values, result is JSON-encoded marshalled value
  // Uses instance.callbackContext for dynamic connection lookup (supports runtime reuse)
  const invokeCallbackRef = new ivm.Reference(
    async (callbackId: number, argsJson: string) => {
      // Parse the JSON and unmarshal refs back to real types
      const marshalledArgs = JSON.parse(argsJson);
      const args = unmarshalValue(marshalledArgs) as unknown[];
      try {
        let result: unknown;

        if (isLocalCallbackId(callbackId)) {
          // Local callback (returned from a previous custom function call)
          const callback = instance.returnedCallbacks!.get(callbackId);
          if (!callback) {
            throw new Error(`Local callback ${callbackId} not found`);
          }
          result = await callback(...args);
        } else {
          // Client callback - use dynamic connection lookup for runtime reuse support
          const conn = instance.callbackContext?.connection || connection;
          result = await invokeClientCallback(conn, callbackId, args);
        }

        // Marshal the result with context for registering returned callbacks/promises/iterators
        const ctx = createMarshalContext();
        const marshalledResult = await marshalValue({ ok: true, value: result }, ctx);
        // Add callback IDs to any PromiseRef/AsyncIteratorRef in the result
        const processedResult = addCallbackIdsToRefs(marshalledResult);
        return JSON.stringify(processedResult);
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

  // Inject marshalling helpers into the isolate
  context.evalSync(ISOLATE_MARSHAL_CODE);

  // Create a global registry for custom function callback IDs
  // This allows updating callback IDs on runtime reuse without recreating wrapper functions
  const callbackIdMap: Record<string, number> = {};
  for (const [name, registration] of Object.entries(customCallbacks)) {
    callbackIdMap[name] = registration.callbackId;
  }
  global.setSync("__customFnCallbackIds", new ivm.ExternalCopy(callbackIdMap).copyInto());

  // Create wrapper functions for each custom function
  // These use __customFnCallbackIds for dynamic callback ID lookup
  for (const [name, registration] of Object.entries(customCallbacks)) {
    // Skip companion callbacks (name:start, name:next, etc.) - they are used internally by asyncIterator
    if (name.includes(':')) {
      continue;
    }

    if (registration.type === 'sync') {
      // Sync function: use applySyncPromise (to await the host response) but wrap in regular function
      // The function blocks until the host responds, but returns the value directly (not a Promise)
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const callbackId = globalThis.__customFnCallbackIds["${name}"];
          const argsJson = JSON.stringify(__marshalForHost(args));
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            [callbackId, argsJson]
          );
          const result = JSON.parse(resultJson);
          if (result.ok) {
            return __unmarshalFromHost(result.value);
          } else {
            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          }
        };
      `);
    } else if (registration.type === 'asyncIterator') {
      // AsyncIterator function: look up companion callbacks and create async iterator wrapper
      const startReg = customCallbacks[`${name}:start`];
      const nextReg = customCallbacks[`${name}:next`];
      const returnReg = customCallbacks[`${name}:return`];
      const throwReg = customCallbacks[`${name}:throw`];

      if (!startReg || !nextReg || !returnReg || !throwReg) {
        throw new Error(`Missing companion callbacks for asyncIterator function "${name}"`);
      }

      context.evalSync(`
        globalThis.${name} = function(...args) {
          // Start the iterator and get the iteratorId
          const startCallbackId = globalThis.__customFnCallbackIds["${name}:start"];
          const argsJson = JSON.stringify(__marshalForHost(args));
          const startResultJson = __customFn_invoke.applySyncPromise(
            undefined,
            [startCallbackId, argsJson]
          );
          const startResult = JSON.parse(startResultJson);
          if (!startResult.ok) {
            const error = new Error(startResult.error.message);
            error.name = startResult.error.name;
            throw error;
          }
          const iteratorId = __unmarshalFromHost(startResult.value).iteratorId;

          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              const nextCallbackId = globalThis.__customFnCallbackIds["${name}:next"];
              const argsJson = JSON.stringify(__marshalForHost([iteratorId]));
              const resultJson = __customFn_invoke.applySyncPromise(
                undefined,
                [nextCallbackId, argsJson]
              );
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              const val = __unmarshalFromHost(result.value);
              return { done: val.done, value: val.value };
            },
            async return(v) {
              const returnCallbackId = globalThis.__customFnCallbackIds["${name}:return"];
              const argsJson = JSON.stringify(__marshalForHost([iteratorId, v]));
              const resultJson = __customFn_invoke.applySyncPromise(
                undefined,
                [returnCallbackId, argsJson]
              );
              const result = JSON.parse(resultJson);
              return { done: true, value: result.ok ? __unmarshalFromHost(result.value) : undefined };
            },
            async throw(e) {
              const throwCallbackId = globalThis.__customFnCallbackIds["${name}:throw"];
              const argsJson = JSON.stringify(__marshalForHost([iteratorId, { message: e?.message, name: e?.name }]));
              const resultJson = __customFn_invoke.applySyncPromise(
                undefined,
                [throwCallbackId, argsJson]
              );
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              const val = __unmarshalFromHost(result.value);
              return { done: val.done, value: val.value };
            }
          };
        };
      `);
    } else if (registration.type === 'async') {
      // Async function: use applySyncPromise and async function wrapper
      context.evalSync(`
        globalThis.${name} = async function(...args) {
          const callbackId = globalThis.__customFnCallbackIds["${name}"];
          const argsJson = JSON.stringify(__marshalForHost(args));
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            [callbackId, argsJson]
          );
          const result = JSON.parse(resultJson);
          if (result.ok) {
            return __unmarshalFromHost(result.value);
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
      return Promise.resolve();
    },
  });

  connection.callbackStreamReceivers.set(message.streamId, receiver);

  // Create Response and resolve the pending callback
  const pending = connection.pendingCallbacks.get(message.requestId);
  if (pending) {
    connection.pendingCallbacks.delete(message.requestId);
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Test timeout")), timeout);
    });

    try {
      const results = await Promise.race([
        runTestsInContext(instance.runtime.context),
        timeoutPromise,
      ]);

      sendOk(connection.socket, message.requestId, results);
    } finally {
      // Always clear the timeout to prevent process from hanging
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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
    const result = hasTestsInContext(instance.runtime.context);
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
    const result = getTestCountInContext(instance.runtime.context);
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
 * Handle RUN_PLAYWRIGHT_TESTS message.
 * @deprecated Use testEnvironment.runTests() instead
 */
async function handleRunPlaywrightTests(
  message: RunPlaywrightTestsRequest,
  connection: ConnectionState,
  _state: DaemonState
): Promise<void> {
  sendError(
    connection.socket,
    message.requestId,
    ErrorCode.SCRIPT_ERROR,
    "playwright.runTests() has been removed. Use testEnvironment.runTests() instead."
  );
}

/**
 * Handle RESET_PLAYWRIGHT_TESTS message.
 * @deprecated Use testEnvironment.reset() instead
 */
async function handleResetPlaywrightTests(
  message: ResetPlaywrightTestsRequest,
  connection: ConnectionState,
  _state: DaemonState
): Promise<void> {
  sendError(
    connection.socket,
    message.requestId,
    ErrorCode.SCRIPT_ERROR,
    "playwright.reset() has been removed. Use testEnvironment.reset() instead."
  );
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
