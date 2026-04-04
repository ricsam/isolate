/**
 * Connection handling for the isolate client.
 */

import { connect as netConnect, type Socket } from "node:net";
import path from "node:path";
import { getRequestContext, withRequestContext } from "../../bridge/request-context.ts";
import {
  createFrameParser,
  buildFrame,
  MessageType,
  STREAM_THRESHOLD,
  STREAM_CHUNK_SIZE,
  STREAM_DEFAULT_CREDIT,
  type Message,
  type ResponseOk,
  type ResponseError,
  type CreateRuntimeRequest,
  type DisposeRuntimeRequest,
  type DisposeNamespaceRequest,
  type EvalRequest,
  type DispatchRequestRequest,
  type DispatchRequestAbort,
  type CallbackInvoke,
  type CallbackResponseMsg,
  type CallbackRegistration,
  type RuntimeCallbackRegistrations,
  type CreateRuntimeResult,
  type SerializedRequest,
  type SerializedResponse,
  type RunTestsRequest,
  type RunTestsResult,
  type HasTestsRequest,
  type GetTestCountRequest,
  type TestEnvironmentCallbackRegistrations,
  type TestEnvironmentOptionsProtocol,
  type CollectedData,
  type ResetTestEnvRequest,
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
  type IsolateEventMessage,
  type ClientEventMessage,
  IsolateEvents,
  ClientEvents,
  type WsCommandPayload,
  type WsClientConnectPayload,
  type WsClientSendPayload,
  type WsClientClosePayload,
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
  type CallbackAbort,
  marshalValue,
  unmarshalValue,
  isPromiseRef,
  isAsyncIteratorRef,
  serializeResponse,
  deserializeRequest,
  deserializeResponse,
  type MarshalContext,
  type UnmarshalContext,
} from "../protocol/index.ts";
import {
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
  getPlaywrightHandlerMetadata,
  type PlaywrightCallback,
} from "../playwright/client.ts";
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
  EvalOptions,
  UpgradeRequest,
  WebSocketCommand,
  TestEnvironmentOptions,
  Namespace,
  DisposeRuntimeOptions,
} from "./types.ts";

// Track WebSocket command callbacks per isolate for handling WS_COMMAND messages
const isolateWsCallbacks = new Map<string, Set<(cmd: WebSocketCommand) => void>>();

// Track client WebSockets per isolate (outbound connections from isolate)
// Map: isolateId -> Map<socketId -> WebSocket>
const isolateClientWebSockets = new Map<string, Map<string, WebSocket>>();

// Track WebSocket callbacks per isolate for handling outbound WebSocket connections
// Map: isolateId -> WebSocketCallback
import type { WebSocketCallback } from "../protocol/index.ts";
const isolateWebSocketCallbacks = new Map<string, WebSocketCallback>();

// Track event listeners per isolate for handling user-defined ISOLATE_EVENT messages
// Map: isolateId -> Map<event, Set<callback>>
const isolateEventListeners = new Map<string, Map<string, Set<(payload: unknown) => void>>>();

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

/** Stream receiver for streaming response chunks directly to consumer */
interface StreamResponseReceiver {
  streamId: number;
  requestId: number;
  metadata?: {
    status?: number;
    statusText?: string;
    headers?: [string, string][];
  };
  controller: ReadableStreamDefaultController<Uint8Array>;
  state: "active" | "closed" | "errored";
  pendingChunks: Uint8Array[];  // Buffer for chunks arriving before consumer pulls
  error?: Error;  // Stored error to propagate after pending chunks are consumed
  pullResolvers: Array<() => void>;  // Queue of resolvers for pending pull() calls
  controllerFinalized: boolean;  // True if controller.close() or controller.error() was called
}

/** Stream session for tracking upload streams (client sending to daemon) */
interface StreamUploadSession {
  streamId: number;
  requestId: number;
  state: "active" | "closing" | "closed";
  bytesTransferred: number;
  credit: number;
  creditResolver?: () => void;
}

/** Tracked descriptor for a namespaced runtime, for auto-reconnection */
interface NamespacedRuntimeDescriptor {
  isolateId: string;
  runtimeOptions: RuntimeOptions;
}

interface ConnectionState {
  socket: Socket;
  pendingRequests: Map<number, PendingRequest>;
  pendingCallbackCalls: Map<number, PendingRequest>;
  callbacks: Map<number, (...args: unknown[]) => unknown>;
  /** Callback IDs that need requestId passed as last argument (e.g., fetch callbacks for streaming) */
  callbacksNeedingRequestId: Set<number>;
  nextRequestId: number;
  nextCallbackId: number;
  nextStreamId: number;
  connected: boolean;
  /** Track streaming responses being received */
  streamResponses: Map<number, StreamResponseReceiver>;
  /** Track upload streams (for request body streaming) */
  uploadStreams: Map<number, StreamUploadSession>;
  /** Cache for module source code (shared across all runtimes in this connection) */
  moduleSourceCache: Map<string, string>;
  /** Track active callback stream readers (for cancellation from daemon) */
  callbackStreamReaders: Map<number, ReadableStreamDefaultReader<Uint8Array>>;
  /** Track active callback invocations (for abort + stale-response suppression) */
  activeCallbackInvocations: Map<number, { aborted: boolean }>;
  /** Abort controllers for callback invocations that support cancellation */
  callbackAbortControllers: Map<number, AbortController>;
  /** Track async iterator sessions created for host-defined async iterator tools */
  clientIteratorSessions: Map<number, ClientIteratorSession>;
  /** Promises returned by isolate-authored callbacks, scoped to this connection */
  returnedPromiseRegistry: Map<number, Promise<unknown>>;
  /** Async iterators returned by isolate-authored callbacks, scoped to this connection */
  returnedIteratorRegistry: Map<number, AsyncIterator<unknown>>;
  /** True when close() was called explicitly (prevents auto-reconnect) */
  closing: boolean;
  /** Tracked namespaced runtimes for auto-reconnection */
  namespacedRuntimes: Map<string, NamespacedRuntimeDescriptor>;
  /** Promise that resolves when reconnection completes (set during auto-reconnect) */
  reconnecting?: Promise<void>;
  /** Monotonic ids for connection-scoped returned refs and iterator sessions */
  nextClientIteratorId: number;
  nextReturnedRefId: number;
}

/**
 * Connect to the isolate daemon.
 */
export async function connect(options: ConnectOptions = {}): Promise<DaemonConnection> {
  const socket = await createSocket(options);

  const state: ConnectionState = {
    socket,
    pendingRequests: new Map(),
    pendingCallbackCalls: new Map(),
    callbacks: new Map(),
    callbacksNeedingRequestId: new Set(),
    nextRequestId: 1,
    nextCallbackId: 1,
    nextStreamId: 1,
    connected: true,
    streamResponses: new Map(),
    uploadStreams: new Map(),
    moduleSourceCache: new Map(),
    callbackStreamReaders: new Map(),
    activeCallbackInvocations: new Map(),
    callbackAbortControllers: new Map(),
    clientIteratorSessions: new Map(),
    returnedPromiseRegistry: new Map(),
    returnedIteratorRegistry: new Map(),
    closing: false,
    namespacedRuntimes: new Map(),
    nextClientIteratorId: 1,
    nextReturnedRefId: 1,
  };

  function setupSocket(sock: Socket): void {
    const parser = createFrameParser();

    sock.on("data", (data) => {
      try {
        for (const frame of parser.feed(new Uint8Array(data))) {
          handleMessage(frame.message, state);
        }
      } catch (err) {
        console.error("Error parsing frame:", err);
      }
    });

    sock.on("close", () => {
      state.connected = false;
      // Reject all pending requests
      for (const [, pending] of state.pendingRequests) {
        pending.reject(new Error("Connection closed"));
      }
      state.pendingRequests.clear();
      for (const [, pending] of state.pendingCallbackCalls) {
        pending.reject(new Error("Connection closed"));
      }
      state.pendingCallbackCalls.clear();

      // Clean up streaming responses - error any pending streams
      for (const [, receiver] of state.streamResponses) {
        receiver.state = "errored";
        receiver.error = new Error("Connection closed");
        // Resolve all pending pull promises so the stream can error properly
        const resolvers = receiver.pullResolvers.splice(0);
        for (const resolver of resolvers) {
          resolver();
        }
      }
      state.streamResponses.clear();

      // Clean up upload streams
      for (const [, session] of state.uploadStreams) {
        session.state = "closed";
        if (session.creditResolver) {
          session.creditResolver();
        }
      }
      state.uploadStreams.clear();

      for (const [, controller] of state.callbackAbortControllers) {
        controller.abort();
      }
      state.callbackAbortControllers.clear();
      state.activeCallbackInvocations.clear();
      state.clientIteratorSessions.clear();
      state.returnedPromiseRegistry.clear();
      state.returnedIteratorRegistry.clear();

      // Auto-reconnect if not intentional close and we have namespaced runtimes
      if (!state.closing && state.namespacedRuntimes.size > 0) {
        state.reconnecting = reconnect(state, options).catch(() => {
          // Reconnection failed — mark all runtimes as dead
          state.namespacedRuntimes.clear();
          state.reconnecting = undefined;
        });
      }
    });

    sock.on("error", (err) => {
      // Suppress error logging during reconnection attempts
      if (!state.closing && state.namespacedRuntimes.size > 0) return;
      console.error("Socket error:", err);
    });
  }

  setupSocket(socket);

  /**
   * Auto-reconnect: create a new socket, re-register namespaced runtimes.
   */
  async function reconnect(st: ConnectionState, opts: ConnectOptions): Promise<void> {
    try {
      const newSocket = await createSocket(opts);

      // Replace socket in state
      st.socket = newSocket;
      st.connected = true;

      // Set up listeners on new socket
      setupSocket(newSocket);

      // Re-register all namespaced runtimes
      for (const [namespaceId, descriptor] of st.namespacedRuntimes) {
        // Clear old callbacks for this runtime before re-registering
        // (the old callback IDs are stale on the new connection)
        const runtimeOptions = descriptor.runtimeOptions;

        // Re-register callbacks with new IDs
        const callbacks: RuntimeCallbackRegistrations = {};
        if (runtimeOptions.console) {
          callbacks.console = registerConsoleCallbacks(st, runtimeOptions.console);
        }
        if (runtimeOptions.fetch) {
          callbacks.fetch = registerFetchCallback(st, runtimeOptions.fetch);
        }
        if (runtimeOptions.fs) {
          callbacks.fs = registerFsCallbacks(st, runtimeOptions.fs);
        }
        if (runtimeOptions.moduleLoader) {
          callbacks.moduleLoader = registerModuleLoaderCallback(st, runtimeOptions.moduleLoader);
        }
        if (runtimeOptions.customFunctions) {
          callbacks.custom = registerCustomFunctions(st, runtimeOptions.customFunctions as CustomFunctions<Record<string, unknown[]>>);
        }

        // Playwright callback re-registration
        if (runtimeOptions.playwright) {
          const playwrightHandler = runtimeOptions.playwright.handler;
          if (playwrightHandler) {
            const handlerCallbackId = st.nextCallbackId++;
            st.callbacks.set(handlerCallbackId, async (opJson: unknown) => {
              const op = JSON.parse(opJson as string) as PlaywrightOperation;
              const result = await playwrightHandler(op);
              return JSON.stringify(result);
            });
            callbacks.playwright = {
              handlerCallbackId,
              console: runtimeOptions.playwright.console && !runtimeOptions.console?.onEntry,
            };
          }
        }

        // Test environment callback re-registration
        let testEnvironmentOption: boolean | TestEnvironmentOptionsProtocol | undefined;
        if (runtimeOptions.testEnvironment) {
          if (typeof runtimeOptions.testEnvironment === "object") {
            const testEnvOptions = runtimeOptions.testEnvironment;
            const testEnvCallbacks: TestEnvironmentCallbackRegistrations = {};
            if (testEnvOptions.onEvent) {
              const userOnEvent = testEnvOptions.onEvent;
              const onEventCallbackId = registerEventCallback(st, (eventJson: unknown) => {
                const event = JSON.parse(eventJson as string);
                userOnEvent(event);
              });
              testEnvCallbacks.onEvent = {
                callbackId: onEventCallbackId,
                name: "testEnvironment.onEvent",
                type: 'async',
              };
            }
            testEnvironmentOption = {
              callbacks: testEnvCallbacks,
              testTimeout: testEnvOptions.testTimeout,
            };
          } else {
            testEnvironmentOption = true;
          }
        }

        const playwrightOption =
          runtimeOptions.playwright?.timeout !== undefined
            ? { timeout: runtimeOptions.playwright.timeout }
            : undefined;

        const requestId = st.nextRequestId++;
        const request: CreateRuntimeRequest = {
          type: MessageType.CREATE_RUNTIME,
          requestId,
          options: {
            memoryLimitMB: runtimeOptions.memoryLimitMB,
            executionTimeout: runtimeOptions.executionTimeout,
            cwd: runtimeOptions.cwd,
            callbacks,
            testEnvironment: testEnvironmentOption,
            playwright: playwrightOption,
            namespaceId,
          },
        };

        const result = await sendRequest<CreateRuntimeResult>(st, request);
        descriptor.isolateId = result.isolateId;
      }

      st.reconnecting = undefined;
    } catch {
      st.reconnecting = undefined;
      throw new Error("Failed to reconnect to daemon");
    }
  }

  return {
    createRuntime: (runtimeOptions) =>
      createRuntime(state, runtimeOptions),
    createNamespace: (id: string): Namespace => ({
      id,
      createRuntime: (runtimeOptions) =>
        createRuntime(state, runtimeOptions, id),
    }),
    disposeNamespace: async (id, options) => {
      state.namespacedRuntimes.delete(id);
      const requestId = state.nextRequestId++;
      const request: DisposeNamespaceRequest = {
        type: MessageType.DISPOSE_NAMESPACE,
        requestId,
        namespaceId: id,
        reason:
          typeof options?.reason === "string" && options.reason.length > 0
            ? options.reason
            : undefined,
      };
      await sendRequest(state, request);
    },
    close: async () => {
      state.closing = true;
      state.connected = false;
      state.socket.destroy();
    },
    isConnected: () => state.connected,
  };
}

/**
 * Create a socket connection.
 */
function createSocket(options: ConnectOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout;

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

    // Connection timeout (opt-in)
    if (timeout && timeout > 0) {
      const timeoutId = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      }, timeout);

      socket.once("connect", () => {
        clearTimeout(timeoutId);
      });
    }
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
        pending.resolve(response.data);
      }
      break;
    }

    case MessageType.RESPONSE_ERROR: {
      const response = message as ResponseError;
      const pending = state.pendingRequests.get(response.requestId);
      if (pending) {
        state.pendingRequests.delete(response.requestId);
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

    case MessageType.CALLBACK_RESPONSE: {
      const response = message as CallbackResponseMsg;
      const pending = state.pendingCallbackCalls.get(response.requestId);
      if (pending) {
        state.pendingCallbackCalls.delete(response.requestId);
        if (response.error) {
          const error = new Error(response.error.message);
          error.name = response.error.name;
          if (response.error.stack) {
            error.stack = response.error.stack;
          }
          pending.reject(error);
        } else {
          pending.resolve(response.result);
        }
      }
      break;
    }

    case MessageType.PONG:
      // Heartbeat response, ignore
      break;

    case MessageType.CALLBACK_STREAM_CANCEL: {
      const streamId = (message as { streamId: number }).streamId;
      const reader = state.callbackStreamReaders.get(streamId);
      if (reader) {
        reader.cancel().catch(() => {});
      }
      break;
    }

    case MessageType.CALLBACK_ABORT: {
      const msg = message as CallbackAbort;
      const invocation = state.activeCallbackInvocations.get(msg.targetRequestId);
      if (invocation) {
        invocation.aborted = true;
      }
      const controller = state.callbackAbortControllers.get(msg.targetRequestId);
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
      break;
    }

    // Generic isolate events (WebSocket commands and user-defined events)
    case MessageType.ISOLATE_EVENT: {
      const msg = message as IsolateEventMessage;
      handleIsolateEvent(msg, state);
      break;
    }

    // Streaming response messages
    case MessageType.RESPONSE_STREAM_START: {
      const msg = message as ResponseStreamStart;

      // Create a partial receiver that will be completed when the stream is created
      const receiver: StreamResponseReceiver = {
        streamId: msg.streamId,
        requestId: msg.requestId,
        metadata: msg.metadata,
        controller: null as unknown as ReadableStreamDefaultController<Uint8Array>,
        state: "active",
        pendingChunks: [],
        pullResolvers: [],
        controllerFinalized: false,
      };

      // Create a ReadableStream that yields chunks as they arrive
      const readableStream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Store the controller in the receiver
          receiver.controller = controller;
        },
        pull(_controller) {
          // Consumer is ready for more data
          // If controller is already finalized, just return
          if (receiver.controllerFinalized) {
            return;
          }

          // Flush any pending chunks first
          while (receiver.pendingChunks.length > 0) {
            const chunk = receiver.pendingChunks.shift()!;
            receiver.controller.enqueue(chunk);
          }

          // If stream is already closed or errored, handle it
          if (receiver.state === "closed") {
            if (!receiver.controllerFinalized) {
              receiver.controllerFinalized = true;
              receiver.controller.close();
            }
            // Return a resolved Promise to signal completion cleanly
            return Promise.resolve();
          }
          if (receiver.state === "errored") {
            // Error the stream if not already done
            if (!receiver.controllerFinalized && receiver.error) {
              receiver.controllerFinalized = true;
              receiver.controller.error(receiver.error);
            }
            // Return a resolved Promise to signal completion cleanly
            return Promise.resolve();
          }

          // Send credit to daemon to request more data
          sendMessage(state.socket, {
            type: MessageType.STREAM_PULL,
            streamId: msg.streamId,
            maxBytes: STREAM_DEFAULT_CREDIT,
          } as StreamPull);

          // Return a promise that resolves when the next chunk arrives
          return new Promise<void>((resolve) => {
            receiver.pullResolvers.push(resolve);
          });
        },
        cancel(_reason) {
          // Consumer cancelled the stream - mark as closed (not errored)
          // since cancel is a clean termination
          receiver.state = "closed";
          receiver.controllerFinalized = true; // Mark as finalized on cancel

          // Resolve ALL pending pull promises to allow cleanup
          const resolvers = receiver.pullResolvers.splice(0);
          for (const resolver of resolvers) {
            resolver();
          }

          // Notify daemon that stream was cancelled
          sendMessage(state.socket, {
            type: MessageType.STREAM_ERROR,
            streamId: msg.streamId,
            error: "Stream cancelled by consumer",
          } as StreamError);
          state.streamResponses.delete(msg.streamId);

          // Return a Promise that resolves after a macrotask to ensure
          // all internal cleanup and promise resolution is processed
          return new Promise<void>((resolve) => setTimeout(resolve, 0));
        },
      });

      state.streamResponses.set(msg.streamId, receiver);

      // Create Response and resolve the pending request immediately
      const pending = state.pendingRequests.get(msg.requestId);
      if (pending) {
        state.pendingRequests.delete(msg.requestId);

        const response = new Response(readableStream, {
          status: msg.metadata?.status ?? 200,
          statusText: msg.metadata?.statusText ?? "OK",
          headers: msg.metadata?.headers,
        });

        // Resolve with a marker that this is a streaming Response
        pending.resolve({ response, __streaming: true });
      }

      // Send initial credit to start receiving data
      sendMessage(state.socket, {
        type: MessageType.STREAM_PULL,
        streamId: msg.streamId,
        maxBytes: STREAM_DEFAULT_CREDIT,
      } as StreamPull);
      break;
    }

    case MessageType.RESPONSE_STREAM_CHUNK: {
      const msg = message as ResponseStreamChunk;
      const receiver = state.streamResponses.get(msg.streamId);
      if (receiver && receiver.state === "active") {
        if (receiver.pullResolvers.length > 0) {
          // Consumer is waiting for data - enqueue directly and resolve one pending pull
          receiver.controller.enqueue(msg.chunk);
          const resolver = receiver.pullResolvers.shift()!;
          resolver();
        } else {
          // Consumer not ready - buffer the chunk
          receiver.pendingChunks.push(msg.chunk);
        }
      }
      break;
    }

    case MessageType.RESPONSE_STREAM_END: {
      const msg = message as ResponseStreamEnd;
      const receiver = state.streamResponses.get(msg.streamId);
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
        state.streamResponses.delete(msg.streamId);
      }
      break;
    }

    case MessageType.STREAM_PULL: {
      const msg = message as StreamPull;
      const session = state.uploadStreams.get(msg.streamId);
      if (session) {
        session.credit += msg.maxBytes;
        // Wake up waiting sender if there's a credit resolver
        if (session.creditResolver) {
          session.creditResolver();
          session.creditResolver = undefined;
        }
      }
      break;
    }

    case MessageType.STREAM_ERROR: {
      const msg = message as StreamError;
      // Handle error for upload streams
      const uploadSession = state.uploadStreams.get(msg.streamId);
      if (uploadSession) {
        uploadSession.state = "closed";
        state.uploadStreams.delete(msg.streamId);
      }
      // Handle error for response streams (streaming mode)
      const receiver = state.streamResponses.get(msg.streamId);
      if (receiver) {
        // Mark stream as errored and store the error
        receiver.state = "errored";
        receiver.error = new Error(msg.error);

        // Flush any remaining pending chunks to controller
        // These will be readable before the error is signaled
        while (receiver.pendingChunks.length > 0) {
          const chunk = receiver.pendingChunks.shift()!;
          receiver.controller.enqueue(chunk);
        }

        // Resolve all pending pull promises so consumer can proceed to read queued chunks
        // The error will be signaled on the next pull() after queue is empty
        const resolvers = receiver.pullResolvers.splice(0);
        for (const resolver of resolvers) {
          resolver();
        }

        // Clean up from map - pull() still has access to receiver via closure
        // Note: Don't call controller.error() here - it discards queued chunks
        state.streamResponses.delete(msg.streamId);
      }
      break;
    }

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
  const invocationState = { aborted: false };
  state.activeCallbackInvocations.set(invoke.requestId, invocationState);
  const abortController = new AbortController();
  state.callbackAbortControllers.set(invoke.requestId, abortController);

  const response: CallbackResponseMsg = {
    type: MessageType.CALLBACK_RESPONSE,
    requestId: invoke.requestId,
  };

  if (!callback) {
    response.error = {
      name: "Error",
      message: `Unknown callback: ${invoke.callbackId}`,
    };
    if (!invocationState.aborted) {
      sendMessage(state.socket, response);
    }
    state.activeCallbackInvocations.delete(invoke.requestId);
    state.callbackAbortControllers.delete(invoke.requestId);
  } else {
    try {
      const invokeRegisteredCallback = async () => {
        // Only pass requestId to callbacks that need it (e.g., fetch callbacks for streaming)
        const needsRequestId = state.callbacksNeedingRequestId.has(invoke.callbackId);
        return needsRequestId
          ? await callback(...invoke.args, invoke.requestId)
          : await callback(...invoke.args);
      };

      const result = invoke.context
        ? await withRequestContext(
            {
              requestId: invoke.context.requestId,
              metadata: invoke.context.metadata,
              signal: abortController.signal,
            },
            invokeRegisteredCallback,
          )
        : await withRequestContext(
            {
              signal: abortController.signal,
            },
            invokeRegisteredCallback,
          );

      // Check if this is a streaming response (don't send CALLBACK_RESPONSE, streaming handles it)
      if (result && typeof result === 'object' && (result as { __callbackStreaming?: boolean }).__callbackStreaming) {
        // Streaming response - CALLBACK_STREAM_START already sent, body streaming in progress
        // Don't send a CALLBACK_RESPONSE here
        return;
      }

      if (invocationState.aborted) {
        return;
      }

      response.result = result;
      sendMessage(state.socket, response);
    } catch (err) {
      if (invocationState.aborted) {
        return;
      }
      const error = err as Error;
      response.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      sendMessage(state.socket, response);
    } finally {
      state.activeCallbackInvocations.delete(invoke.requestId);
      state.callbackAbortControllers.delete(invoke.requestId);
    }
  }
}

function invokeDaemonCallback(
  state: ConnectionState,
  callbackId: number,
  args: unknown[],
): Promise<unknown> {
  if (!state.connected) {
    return Promise.reject(new Error("Not connected"));
  }

  const requestId = state.nextRequestId++;
  const requestContext = getRequestContext();
  const invoke: CallbackInvoke = {
    type: MessageType.CALLBACK_INVOKE,
    requestId,
    callbackId,
    args,
    context: requestContext
      ? {
          requestId: requestContext.requestId,
          metadata: requestContext.metadata,
        }
      : undefined,
  };

  return new Promise((resolve, reject) => {
    state.pendingCallbackCalls.set(requestId, { resolve, reject });
    sendMessage(state.socket, invoke);
  });
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
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!state.connected) {
      reject(new Error("Not connected"));
      return;
    }

    const requestId = (message as { requestId: number }).requestId;

    state.pendingRequests.set(requestId, {
      resolve: resolve as (data: unknown) => void,
      reject,
    });

    sendMessage(state.socket, message);
  });
}

export function isBenignDisposeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /isolate not owned by this connection|isolate not found|not connected|connection closed/i.test(
    message
  );
}

function normalizePlaywrightOptions(
  playwrightOptions: RuntimeOptions["playwright"] | undefined
): RuntimeOptions["playwright"] | undefined {
  if (!playwrightOptions || playwrightOptions.timeout === undefined) {
    return playwrightOptions;
  }

  const metadata = getDefaultPlaywrightHandlerMetadata(playwrightOptions.handler);
  if (!metadata?.page) {
    return playwrightOptions;
  }

  const currentTimeout = metadata.options?.timeout ?? 30000;
  if (currentTimeout === playwrightOptions.timeout) {
    return playwrightOptions;
  }

  return {
    ...playwrightOptions,
    handler: defaultPlaywrightHandler(metadata.page, {
      ...metadata.options,
      timeout: playwrightOptions.timeout,
    }),
  };
}

/**
 * Create a runtime in the daemon.
 */
async function createRuntime<T extends Record<string, any[]> = Record<string, unknown[]>>(
  state: ConnectionState,
  options: RuntimeOptions<T> = {},
  namespaceId?: string
): Promise<RemoteRuntime> {
  const normalizedPlaywrightOptions = normalizePlaywrightOptions(
    options.playwright
  );
  const runtimeOptionsForReconnect =
    normalizedPlaywrightOptions === options.playwright
      ? options
      : {
          ...options,
          playwright: normalizedPlaywrightOptions,
        };

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
    callbacks.custom = registerCustomFunctions(state, options.customFunctions as CustomFunctions<Record<string, unknown[]>>);
  }

  // Playwright callback registration - client owns the browser
  let playwrightHandler: PlaywrightCallback | undefined;
  let getCollectedData = (): CollectedData => ({
    browserConsoleLogs: [],
    pageErrors: [],
    networkRequests: [],
    networkResponses: [],
    requestFailures: [],
  });
  let getTrackedResources = (): { contexts: string[]; pages: string[] } => ({
    contexts: [],
    pages: [],
  });
  let clearCollectedData = (): void => {};
  const playwrightListenerCleanups: (() => void)[] = [];

  if (normalizedPlaywrightOptions) {
    playwrightHandler = normalizedPlaywrightOptions.handler;
    if (!playwrightHandler) {
      throw new Error("playwright.handler is required when using playwright options");
    }
    const handlerMetadata = getPlaywrightHandlerMetadata(playwrightHandler);
    if (handlerMetadata) {
      getCollectedData = () => handlerMetadata.collector.getCollectedData();
      getTrackedResources = () => handlerMetadata.collector.getTrackedResources();
      clearCollectedData = () => {
        handlerMetadata.collector.clearCollectedData();
      };
      playwrightListenerCleanups.push(
        handlerMetadata.collector.onEvent((event) => {
          if (normalizedPlaywrightOptions.onEvent) {
            normalizedPlaywrightOptions.onEvent(event);
          }

          if (event.type === "browserConsoleLog") {
            if (normalizedPlaywrightOptions.console && options.console?.onEntry) {
              options.console.onEntry({
                type: "browserOutput",
                level: event.level,
                stdout: event.stdout,
                location: event.location,
                timestamp: event.timestamp,
              });
            } else if (normalizedPlaywrightOptions.console) {
              const prefix = event.level === "error" ? "[browser:error]" : "[browser]";
              console.log(prefix, event.stdout);
            }
          }
        }),
      );
    }

    const handlerCallbackId = state.nextCallbackId++;
    state.callbacks.set(handlerCallbackId, async (opJson: unknown) => {
      const op = JSON.parse(opJson as string) as PlaywrightOperation;
      const result = await playwrightHandler!(op);
      return JSON.stringify(result);
    });

    callbacks.playwright = {
      handlerCallbackId,
      console: normalizedPlaywrightOptions.console && !options.console?.onEntry,
    };
  }

  // Test environment callback registration
  let testEnvironmentOption: boolean | TestEnvironmentOptionsProtocol | undefined;
  if (options.testEnvironment) {
    if (typeof options.testEnvironment === "object") {
      const testEnvOptions = options.testEnvironment;
      const testEnvCallbacks: TestEnvironmentCallbackRegistrations = {};

      if (testEnvOptions.onEvent) {
        const userOnEvent = testEnvOptions.onEvent;
        const onEventCallbackId = registerEventCallback(state, (eventJson: unknown) => {
          const event = JSON.parse(eventJson as string);
          userOnEvent(event);
        });
        testEnvCallbacks.onEvent = {
          callbackId: onEventCallbackId,
          name: "testEnvironment.onEvent",
          type: 'async',
        };
      }

      testEnvironmentOption = {
        callbacks: testEnvCallbacks,
        testTimeout: testEnvOptions.testTimeout,
      };
    } else {
      testEnvironmentOption = true;
    }
  }

  const playwrightOption =
    normalizedPlaywrightOptions
      ? {
          timeout: normalizedPlaywrightOptions.timeout,
          hasDefaultPage: normalizedPlaywrightOptions.hasDefaultPage,
        }
      : undefined;

  const requestId = state.nextRequestId++;
  const request: CreateRuntimeRequest = {
    type: MessageType.CREATE_RUNTIME,
    requestId,
    options: {
      memoryLimitMB: options.memoryLimitMB,
      executionTimeout: options.executionTimeout,
      cwd: options.cwd,
      callbacks,
      testEnvironment: testEnvironmentOption,
      playwright: playwrightOption,
      namespaceId,
    },
  };

  const result = await sendRequest<CreateRuntimeResult>(state, request);
  const isolateId = result.isolateId;
  const reused = result.reused ?? false;

  // Track namespaced runtimes for auto-reconnection
  if (namespaceId != null) {
    state.namespacedRuntimes.set(namespaceId, {
      isolateId,
      runtimeOptions: runtimeOptionsForReconnect as RuntimeOptions,
    });
  }

  // WebSocket command callbacks - store in module-level Map for WS_COMMAND message handling
  const wsCommandCallbacks: Set<(cmd: WebSocketCommand) => void> = new Set();
  isolateWsCallbacks.set(isolateId, wsCommandCallbacks);
  if (options.onWebSocketCommand) {
    wsCommandCallbacks.add(options.onWebSocketCommand);
  }

  // Store WebSocket callback if provided (for outbound connections from isolate)
  if (options.webSocket) {
    isolateWebSocketCallbacks.set(isolateId, options.webSocket);
  }

  // Create fetch handle
  const fetchHandle: RemoteFetchHandle = {
    async dispatchRequest(req: Request, opts?: DispatchOptions) {
      const signal = opts?.signal;
      const requestSignal = req.signal;
      const requestSignalInitiallyAborted = requestSignal?.aborted ?? false;

      const reqId = state.nextRequestId++;
      const serialized = await serializeRequestWithStreaming(state, req);

      // Extract bodyStream before creating the protocol message (can't be serialized)
      const { bodyStream, ...serializableRequest } = serialized;

      const request: DispatchRequestRequest = {
        type: MessageType.DISPATCH_REQUEST,
        requestId: reqId,
        isolateId,
        request: serializableRequest,
        context: opts?.requestId || opts?.metadata
          ? {
              requestId: opts.requestId,
              metadata: opts.metadata,
            }
          : undefined,
      };

      // Helper to handle response which may be streaming or buffered
      const handleResponse = (res: { response: SerializedResponse | Response; __streaming?: boolean }): Response => {
        // Streaming case: already a Response
        if (res.__streaming && res.response instanceof Response) {
          return res.response;
        }
        // Buffered case: deserialize SerializedResponse
        return deserializeResponse(res.response as SerializedResponse);
      };

      // Set up abort signal handling
      let abortSent = false;
      const sendAbort = () => {
        if (abortSent) {
          return;
        }
        abortSent = true;
        const abortMessage: DispatchRequestAbort = {
          type: MessageType.DISPATCH_REQUEST_ABORT,
          isolateId,
          targetRequestId: reqId,
        };
        if (state.connected) {
          sendMessage(state.socket, abortMessage);
        }
      };

      let onAbort: (() => void) | undefined;
      if (signal) {
        onAbort = sendAbort;
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          sendAbort();
        }
      }

      let onRequestAbort: (() => void) | undefined;
      if (requestSignal && !requestSignalInitiallyAborted) {
        onRequestAbort = sendAbort;
        requestSignal.addEventListener("abort", onRequestAbort, { once: true });
        if (requestSignal.aborted) {
          sendAbort();
        }
      }

      request.request.signalAborted = (request.request.signalAborted ?? false) || signal?.aborted === true;

      try {
        // If streaming body, start sending chunks after request is sent
        if (serialized.bodyStreamId !== undefined && bodyStream) {
          const streamId = serialized.bodyStreamId;

          // Send the request first
          const responsePromise = sendRequest<{ response: SerializedResponse | Response; __streaming?: boolean }>(
            state,
            request,
          );

          // Then stream the body
          await sendBodyStream(state, streamId, bodyStream);

          // Wait for response
          const res = await responsePromise;
          return handleResponse(res);
        } else {
          const res = await sendRequest<{ response: SerializedResponse | Response; __streaming?: boolean }>(
            state,
            request,
          );
          return handleResponse(res);
        }
      } finally {
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
        if (requestSignal && onRequestAbort) {
          requestSignal.removeEventListener("abort", onRequestAbort);
        }
      }
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
  const playwrightEnabled = !!normalizedPlaywrightOptions;

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
      try {
        return await sendRequest<RunTestsResult>(state, req);
      } catch (err) {
        // If connection dropped, wait for auto-reconnect and retry
        if (
          err instanceof Error &&
          /connection closed|not connected/i.test(err.message) &&
          state.reconnecting
        ) {
          await state.reconnecting;
          const retryReqId = state.nextRequestId++;
          const retryReq: RunTestsRequest = {
            type: MessageType.RUN_TESTS,
            requestId: retryReqId,
            isolateId,
            timeout,
          };
          return sendRequest<RunTestsResult>(state, retryReq);
        }
        throw err;
      }
    },

    async hasTests(): Promise<boolean> {
      if (!testEnvironmentEnabled) {
        throw new Error("Test environment not enabled. Set testEnvironment: true in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: HasTestsRequest = {
        type: MessageType.HAS_TESTS,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<boolean>(state, req);
    },

    async getTestCount(): Promise<number> {
      if (!testEnvironmentEnabled) {
        throw new Error("Test environment not enabled. Set testEnvironment: true in createRuntime options.");
      }
      const reqId = state.nextRequestId++;
      const req: GetTestCountRequest = {
        type: MessageType.GET_TEST_COUNT,
        requestId: reqId,
        isolateId,
      };
      return sendRequest<number>(state, req);
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
    getCollectedData(): CollectedData {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.handler in createRuntime options.");
      }
      return getCollectedData();
    },
    getTrackedResources(): { contexts: string[]; pages: string[] } {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.handler in createRuntime options.");
      }
      return getTrackedResources();
    },

    clearCollectedData(): void {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.handler in createRuntime options.");
      }
      clearCollectedData();
    },
  };

  return {
    id: isolateId,
    reused,

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
      const options =
        typeof filenameOrOptions === "string"
          ? { filename: filenameOrOptions }
          : filenameOrOptions;
      const req: EvalRequest = {
        type: MessageType.EVAL,
        requestId: reqId,
        isolateId,
        code,
        filename: options?.filename,
        executionTimeout: options?.executionTimeout,
      };
      await sendRequest<{ value: unknown }>(state, req);
      // Module evaluation returns void - don't return the value
    },

    on(event: string, callback: (payload: unknown) => void): () => void {
      let listeners = isolateEventListeners.get(isolateId);
      if (!listeners) {
        listeners = new Map();
        isolateEventListeners.set(isolateId, listeners);
      }
      let eventListeners = listeners.get(event);
      if (!eventListeners) {
        eventListeners = new Set();
        listeners.set(event, eventListeners);
      }
      eventListeners.add(callback);
      return () => {
        eventListeners!.delete(callback);
        if (eventListeners!.size === 0) {
          listeners!.delete(event);
          if (listeners!.size === 0) {
            isolateEventListeners.delete(isolateId);
          }
        }
      };
    },

    emit(event: string, payload: unknown): void {
      sendMessage(state.socket, {
        type: MessageType.CLIENT_EVENT,
        isolateId,
        event,
        payload,
      } as ClientEventMessage);
    },

    dispose: async (options?: DisposeRuntimeOptions) => {
      // Clean up page listeners
      for (const cleanup of playwrightListenerCleanups) {
        cleanup();
      }
      // Clean up WebSocket callbacks
      isolateWsCallbacks.delete(isolateId);
      isolateWebSocketCallbacks.delete(isolateId);
      isolateEventListeners.delete(isolateId);

      // Clean up client WebSockets (close all open connections)
      const clientSockets = isolateClientWebSockets.get(isolateId);
      if (clientSockets) {
        for (const ws of clientSockets.values()) {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close(1000, "Isolate disposed");
          }
        }
        isolateClientWebSockets.delete(isolateId);
      }

      // Remove from namespaced tracking (no auto-reconnect after explicit dispose)
      if (namespaceId != null) {
        state.namespacedRuntimes.delete(namespaceId);
      }

      const reqId = state.nextRequestId++;
      const req: DisposeRuntimeRequest = {
        type: MessageType.DISPOSE_RUNTIME,
        requestId: reqId,
        isolateId,
        hard: options?.hard === true ? true : undefined,
        reason: typeof options?.reason === "string" && options.reason.length > 0 ? options.reason : undefined,
      };
      try {
        await sendRequest(state, req);
      } catch (error) {
        // Stale runtime handles after reconnect/ownership handoff are idempotent disposals.
        if (!isBenignDisposeError(error)) {
          throw error;
        }
      }
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
  state.callbacks.set(callbackId, async (data: unknown) => {
    await handler(data);
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
    state.callbacks.set(callbackId, async (entry: unknown) => {
      await callbacks.onEntry!(entry as Parameters<typeof callbacks.onEntry>[0]);
    });
    registrations.onEntry = { callbackId, name: "onEntry", type: 'async' };
  }

  return registrations;
}

/** Threshold for streaming callback responses (64KB) */
const CALLBACK_STREAM_THRESHOLD = 64 * 1024;
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Register fetch callback.
 * Supports streaming responses for large/unknown-size bodies.
 */
function registerFetchCallback(
  state: ConnectionState,
  callback: FetchCallback
): CallbackRegistration {
  const callbackId = state.nextCallbackId++;

  // Mark this callback as needing requestId for streaming support
  state.callbacksNeedingRequestId.add(callbackId);

  // Register a callback that returns a special marker for streaming responses
  state.callbacks.set(callbackId, async (serialized: unknown, requestId: unknown) => {
    const data = serialized as SerializedRequest;
    const requestContext = getRequestContext();

    // Create a FetchRequestInit from the serialized data
    const signalController = new AbortController();
    const onContextAbort = () => {
      if (!signalController.signal.aborted) {
        signalController.abort(
          requestContext.signal?.reason ??
            Object.assign(new Error("The operation was aborted."), {
              name: "AbortError",
            }),
        );
      }
    };

    if (requestContext.signal) {
      requestContext.signal.addEventListener("abort", onContextAbort, {
        once: true,
      });
      if (requestContext.signal.aborted) {
        onContextAbort();
      }
    }

    if (data.signalAborted) {
      signalController.abort();
    }
    try {
      const init = {
        method: data.method,
        headers: data.headers,
        rawBody: data.body ?? null,
        body: (data.body ?? null) as BodyInit | null,
        signal: signalController.signal,
      };
      const response = await callback(data.url, init);

      // Determine if we should stream the response
      const contentLength = response.headers.get("content-length");
      const knownSize = contentLength ? parseInt(contentLength, 10) : null;

      // Only stream network responses (responses with http/https URLs)
      // Locally constructed Responses (no URL or non-http URL) are buffered
      const isNetworkResponse = response.url && (response.url.startsWith('http://') || response.url.startsWith('https://'));

      // Stream if: network response AND status allows body AND has body AND
      // (no content-length OR size > threshold)
      const shouldStream =
        isNetworkResponse &&
        !NULL_BODY_STATUSES.has(response.status) &&
        !!response.body &&
        (knownSize === null || knownSize > CALLBACK_STREAM_THRESHOLD);

      if (shouldStream && response.body) {
        // Streaming path: send metadata immediately, then stream body
        const streamId = state.nextStreamId++;

        // Collect headers
        const headers: [string, string][] = [];
        response.headers.forEach((value, key) => {
          headers.push([key, value]);
        });

        // Send CALLBACK_STREAM_START with metadata
        sendMessage(state.socket, {
          type: MessageType.CALLBACK_STREAM_START,
          requestId: requestId as number,
          streamId,
          metadata: {
            status: response.status,
            statusText: response.statusText,
            headers,
            url: response.url || undefined,
          },
        } as CallbackStreamStart);

        // Stream the body in the background
        streamCallbackResponseBody(state, streamId, requestId as number, response.body);

        // Return special marker indicating streaming is in progress
        return { __callbackStreaming: true, streamId };
      }

      // Buffered path for small responses
      return serializeResponse(response);
    } finally {
      if (requestContext.signal) {
        requestContext.signal.removeEventListener("abort", onContextAbort);
      }
    }
  });

  return { callbackId, name: "fetch", type: 'async' };
}

/**
 * Stream a callback response body to the daemon.
 */
async function streamCallbackResponseBody(
  state: ConnectionState,
  streamId: number,
  requestId: number,
  body: ReadableStream<Uint8Array>
): Promise<void> {
  const reader = body.getReader();
  state.callbackStreamReaders.set(streamId, reader);

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Send stream end
        sendMessage(state.socket, {
          type: MessageType.CALLBACK_STREAM_END,
          requestId,
          streamId,
        } as CallbackStreamEnd);
        break;
      }

      // Send chunk(s) - split large chunks if needed
      for (let offset = 0; offset < value.length; offset += STREAM_CHUNK_SIZE) {
        const chunk = value.slice(offset, offset + STREAM_CHUNK_SIZE);
        sendMessage(state.socket, {
          type: MessageType.CALLBACK_STREAM_CHUNK,
          requestId,
          streamId,
          chunk,
        } as CallbackStreamChunk);
      }
    }
  } catch (err) {
    // Ignore cancellation errors
    if (!(err instanceof Error && err.message.includes('cancel'))) {
      // Send error
      sendMessage(state.socket, {
        type: MessageType.STREAM_ERROR,
        streamId,
        error: (err as Error).message,
      } as StreamError);
    }
  } finally {
    state.callbackStreamReaders.delete(streamId);
    reader.releaseLock();
  }
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
    registrations.readFile = { callbackId, name: "readFile", type: 'async' };
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
    registrations.writeFile = { callbackId, name: "writeFile", type: 'async' };
  }

  // unlink: (path: string) => Promise<void>
  if (callbacks.unlink) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      await callbacks.unlink!(path as string);
    });
    registrations.unlink = { callbackId, name: "unlink", type: 'async' };
  }

  // readdir: (path: string) => Promise<string[]>
  if (callbacks.readdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      return callbacks.readdir!(path as string);
    });
    registrations.readdir = { callbackId, name: "readdir", type: 'async' };
  }

  // mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  if (callbacks.mkdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown, options: unknown) => {
      await callbacks.mkdir!(path as string, options as { recursive?: boolean });
    });
    registrations.mkdir = { callbackId, name: "mkdir", type: 'async' };
  }

  // rmdir: (path: string) => Promise<void>
  if (callbacks.rmdir) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      await callbacks.rmdir!(path as string);
    });
    registrations.rmdir = { callbackId, name: "rmdir", type: 'async' };
  }

  // stat: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>
  if (callbacks.stat) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (path: unknown) => {
      return callbacks.stat!(path as string);
    });
    registrations.stat = { callbackId, name: "stat", type: 'async' };
  }

  // rename: (from: string, to: string) => Promise<void>
  if (callbacks.rename) {
    const callbackId = state.nextCallbackId++;
    state.callbacks.set(callbackId, async (from: unknown, to: unknown) => {
      await callbacks.rename!(from as string, to as string);
    });
    registrations.rename = { callbackId, name: "rename", type: 'async' };
  }

  return registrations;
}

/**
 * Register module loader callback.
 * Uses connection-level cache to avoid calling the callback multiple times for the same module.
 */
function registerModuleLoaderCallback(
  state: ConnectionState,
  callback: ModuleLoaderCallback
): CallbackRegistration {
  const callbackId = state.nextCallbackId++;

  state.callbacks.set(callbackId, async (moduleName: unknown, importer: unknown) => {
    const specifier = moduleName as string;
    const importerInfo = importer as { path: string; resolveDir: string };

    // Call user's module loader - returns { code, resolveDir }
    const result = await callback(specifier, importerInfo);

    // Cache using resolved path
    const resolvedPath = path.posix.join(result.resolveDir, result.filename);
    state.moduleSourceCache.set(resolvedPath, result.code);

    return result;
  });

  return { callbackId, name: "moduleLoader", type: 'async' };
}

// Iterator session tracking for async iterator custom functions on the client side
interface ClientIteratorSession {
  iterator: AsyncGenerator<unknown, unknown, unknown>;
}

/**
 * Register custom function callbacks.
 */
function registerCustomFunctions(
  state: ConnectionState,
  customFunctions: CustomFunctions
): Record<string, CallbackRegistration> {
  const registrations: Record<string, CallbackRegistration> = {};
  const addCallbackIdsToRefs = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (isPromiseRef(value)) {
      const resolveCallbackId = state.nextCallbackId++;
      state.callbacks.set(resolveCallbackId, async (...args: unknown[]) => {
        const promiseId = args[0] as number;
        const promise = state.returnedPromiseRegistry.get(promiseId);
        if (!promise) {
          throw new Error(`Promise ${promiseId} not found`);
        }
        const promiseResult = await promise;
        state.returnedPromiseRegistry.delete(promiseId);
        const marshalledResult = await marshalValue(promiseResult, marshalCtx);
        return addCallbackIdsToRefs(marshalledResult);
      });
      return {
        ...value,
        __resolveCallbackId: resolveCallbackId,
      };
    }

    if (isAsyncIteratorRef(value)) {
      const nextCallbackId = state.nextCallbackId++;
      state.callbacks.set(nextCallbackId, async (...args: unknown[]) => {
        const iteratorId = args[0] as number;
        const iterator = state.returnedIteratorRegistry.get(iteratorId);
        if (!iterator) {
          throw new Error(`Iterator ${iteratorId} not found`);
        }
        const iterResult = await iterator.next();
        if (iterResult.done) {
          state.returnedIteratorRegistry.delete(iteratorId);
        }
        const marshalledValue = await marshalValue(iterResult.value, marshalCtx);
        return {
          done: iterResult.done,
          value: addCallbackIdsToRefs(marshalledValue),
        };
      });

      const returnCallbackId = state.nextCallbackId++;
      state.callbacks.set(returnCallbackId, async (...args: unknown[]) => {
        const iteratorId = args[0] as number;
        const returnValue = args[1];
        const iterator = state.returnedIteratorRegistry.get(iteratorId);
        state.returnedIteratorRegistry.delete(iteratorId);
        if (!iterator || !iterator.return) {
          return { done: true, value: undefined };
        }
        const iterResult = await iterator.return(returnValue);
        const marshalledValue = await marshalValue(iterResult.value, marshalCtx);
        return {
          done: true,
          value: addCallbackIdsToRefs(marshalledValue),
        };
      });

      const throwCallbackId = state.nextCallbackId++;
      state.callbacks.set(throwCallbackId, async (...args: unknown[]) => {
        const iteratorId = args[0] as number;
        const errorValue = args[1] as { message?: string; name?: string; stack?: string } | undefined;
        const iterator = state.returnedIteratorRegistry.get(iteratorId);
        if (!iterator) {
          throw new Error(`Iterator ${iteratorId} not found`);
        }

        try {
          if (!iterator.throw) {
            throw Object.assign(
              new Error(errorValue?.message ?? "Iterator does not support throw()"),
              { name: errorValue?.name ?? "Error", stack: errorValue?.stack },
            );
          }

          const thrownError = Object.assign(
            new Error(errorValue?.message ?? "Iterator throw()"),
            { name: errorValue?.name ?? "Error", stack: errorValue?.stack },
          );
          const iterResult = await iterator.throw(thrownError);
          if (iterResult.done) {
            state.returnedIteratorRegistry.delete(iteratorId);
          }
          const marshalledValue = await marshalValue(iterResult.value, marshalCtx);
          return {
            done: iterResult.done,
            value: addCallbackIdsToRefs(marshalledValue),
          };
        } catch (error) {
          state.returnedIteratorRegistry.delete(iteratorId);
          throw error;
        }
      });

      return {
        ...value,
        __nextCallbackId: nextCallbackId,
        __returnCallbackId: returnCallbackId,
        __throwCallbackId: throwCallbackId,
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => addCallbackIdsToRefs(item));
    }

    const objResult: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      objResult[key] = addCallbackIdsToRefs((value as Record<string, unknown>)[key]);
    }
    return objResult;
  };

  const marshalCtx: MarshalContext = {
    registerCallback: (fn: Function): number => {
      const returnedCallbackId = state.nextCallbackId++;
      state.callbacks.set(returnedCallbackId, async (...args: unknown[]) => {
        const fnResult = fn(...args);
        const marshalledResult = await marshalValue(fnResult, marshalCtx);
        return addCallbackIdsToRefs(marshalledResult);
      });
      return returnedCallbackId;
    },
    registerPromise: (promise: Promise<unknown>): number => {
      const promiseId = state.nextReturnedRefId++;
      state.returnedPromiseRegistry.set(promiseId, promise);
      return promiseId;
    },
    registerIterator: (iterator: AsyncIterator<unknown>): number => {
      const iteratorId = state.nextReturnedRefId++;
      state.returnedIteratorRegistry.set(iteratorId, iterator);
      return iteratorId;
    },
  };

  const unmarshalCtx: UnmarshalContext = {};
  unmarshalCtx.getCallback = (callbackId: number) => {
    return async (...args: unknown[]) => {
      const marshalledArgs = await marshalValue(args, marshalCtx);
      const result = await invokeDaemonCallback(
        state,
        callbackId,
        addCallbackIdsToRefs(marshalledArgs) as unknown[],
      );
      return unmarshalValue(result, unmarshalCtx);
    };
  };
  unmarshalCtx.createPromiseProxy = (
    promiseId: number,
    ref?: { __resolveCallbackId?: number },
  ) => {
    const resolveCallbackId = ref?.__resolveCallbackId;
    if (typeof resolveCallbackId !== "number") {
      throw new Error(`Promise ${promiseId} is missing a resolve callback`);
    }

    return (async () => {
      const result = await invokeDaemonCallback(
        state,
        resolveCallbackId,
        [promiseId],
      );
      return unmarshalValue(result, unmarshalCtx);
    })();
  };
  unmarshalCtx.createIteratorProxy = (
    iteratorId: number,
    ref?: {
      __nextCallbackId?: number;
      __returnCallbackId?: number;
      __throwCallbackId?: number;
    },
  ) => {
    const nextCallbackId = ref?.__nextCallbackId;
    const returnCallbackId = ref?.__returnCallbackId;
    const throwCallbackId = ref?.__throwCallbackId;

    if (typeof nextCallbackId !== "number") {
      throw new Error(`Iterator ${iteratorId} is missing a next callback`);
    }

    const invokeIteratorCallback = async (
      callbackId: number,
      args: unknown[],
      label: string,
    ) => {
      const result = await invokeDaemonCallback(state, callbackId, args);
      if (
        !result ||
        typeof result !== "object" ||
        !("done" in result)
      ) {
        throw new Error(`${label} returned an invalid iterator result`);
      }
      return result as { done?: boolean; value?: unknown };
    };

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        const result = await invokeIteratorCallback(
          nextCallbackId,
          [iteratorId],
          "Iterator next()",
        );
        return {
          done: Boolean(result.done),
          value: unmarshalValue(result.value, unmarshalCtx),
        };
      },
      async return(value?: unknown) {
        if (typeof returnCallbackId !== "number") {
          return { done: true, value };
        }

        const result = await invokeIteratorCallback(
          returnCallbackId,
          [iteratorId, value],
          "Iterator return()",
        );
        return {
          done: result.done ?? true,
          value: unmarshalValue(result.value, unmarshalCtx),
        };
      },
      async throw(errorValue?: unknown) {
        if (typeof throwCallbackId !== "number") {
          throw errorValue;
        }

        const serializedError = errorValue && typeof errorValue === "object"
          ? {
              message: (errorValue as { message?: unknown }).message,
              name: (errorValue as { name?: unknown }).name,
              stack: (errorValue as { stack?: unknown }).stack,
            }
          : {
              message: String(errorValue ?? "Iterator throw()"),
              name: "Error",
            };
        const result = await invokeIteratorCallback(
          throwCallbackId,
          [iteratorId, serializedError],
          "Iterator throw()",
        );
        return {
          done: Boolean(result.done),
          value: unmarshalValue(result.value, unmarshalCtx),
        };
      },
    };
  };

  for (const [name, def] of Object.entries(customFunctions)) {
    if (def.type === 'asyncIterator') {
      // For async iterators, we need to register 4 callbacks:
      // start, next, return, throw

      // Start callback: creates iterator, returns iteratorId
      const startCallbackId = state.nextCallbackId++;
      state.callbacks.set(startCallbackId, async (...args: unknown[]) => {
        try {
          const fn = def.fn as (...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>;
          const iterator = fn(...(unmarshalValue(args, unmarshalCtx) as unknown[]));
          const iteratorId = state.nextClientIteratorId++;
          state.clientIteratorSessions.set(iteratorId, { iterator });
          return { iteratorId };
        } catch (error: unknown) {
          throw error;
        }
      });

      // Next callback: calls iterator.next() - marshal the value for type fidelity
      const nextCallbackId = state.nextCallbackId++;
      state.callbacks.set(nextCallbackId, async (iteratorId: unknown) => {
        const session = state.clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          throw new Error(`Iterator session ${iteratorId} not found`);
        }
        try {
          const result = await session.iterator.next();
          if (result.done) {
            state.clientIteratorSessions.delete(iteratorId as number);
          }
          return { done: result.done, value: await marshalValue(result.value) };
        } catch (error: unknown) {
          state.clientIteratorSessions.delete(iteratorId as number);
          throw error;
        }
      });

      // Return callback: calls iterator.return() - marshal the value for type fidelity
      const returnCallbackId = state.nextCallbackId++;
      state.callbacks.set(returnCallbackId, async (iteratorId: unknown, value: unknown) => {
        const session = state.clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          return { done: true, value: await marshalValue(undefined) };
        }
        try {
          const result = await session.iterator.return?.(value);
          state.clientIteratorSessions.delete(iteratorId as number);
          return { done: true, value: await marshalValue(result?.value) };
        } catch (error: unknown) {
          state.clientIteratorSessions.delete(iteratorId as number);
          throw error;
        }
      });

      // Throw callback: calls iterator.throw() - marshal the value for type fidelity
      const throwCallbackId = state.nextCallbackId++;
      state.callbacks.set(throwCallbackId, async (iteratorId: unknown, errorData: unknown) => {
        const session = state.clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          throw new Error(`Iterator session ${iteratorId} not found`);
        }
        try {
          const errInfo = errorData as { message: string; name: string };
          const error = Object.assign(new Error(errInfo.message), { name: errInfo.name });
          const result = await session.iterator.throw?.(error);
          state.clientIteratorSessions.delete(iteratorId as number);
          return { done: result?.done ?? true, value: await marshalValue(result?.value) };
        } catch (error: unknown) {
          state.clientIteratorSessions.delete(iteratorId as number);
          throw error;
        }
      });

      // Register with special naming convention for iterator callbacks
      registrations[`${name}:start`] = { callbackId: startCallbackId, name: `${name}:start`, type: 'async' };
      registrations[`${name}:next`] = { callbackId: nextCallbackId, name: `${name}:next`, type: 'async' };
      registrations[`${name}:return`] = { callbackId: returnCallbackId, name: `${name}:return`, type: 'async' };
      registrations[`${name}:throw`] = { callbackId: throwCallbackId, name: `${name}:throw`, type: 'async' };

      // Also register the main entry with asyncIterator type so daemon knows this is an iterator
      registrations[name] = {
        callbackId: startCallbackId,
        name,
        type: 'asyncIterator',
      };
    } else {
      const callbackId = state.nextCallbackId++;

      // Register the callback - marshal the result to preserve type fidelity
      // (Request, Response, File, undefined, etc. → Refs)
      // Also register returned functions/promises/iterators so they can be called back
      state.callbacks.set(callbackId, async (...args: unknown[]) => {
        const result = await def.fn(...(unmarshalValue(args, unmarshalCtx) as unknown[]));
        const marshalled = await marshalValue(result, marshalCtx);
        const withCallbackIds = addCallbackIdsToRefs(marshalled);
        return withCallbackIds;
      });

      registrations[name] = {
        callbackId,
        name,
        type: def.type,
      };
    }
  }

  return registrations;
}

// ============================================================================
// Streaming Request Serialization
// ============================================================================

interface SerializedRequestWithStream extends SerializedRequest {
  bodyStreamId?: number;
  bodyStream?: ReadableStream<Uint8Array>;
}

/**
 * Serialize a request, using streaming for large bodies.
 */
async function serializeRequestWithStreaming(
  state: ConnectionState,
  request: Request
): Promise<SerializedRequestWithStream> {
  const headers: [string, string][] = [];
  request.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  let bodyStreamId: number | undefined;
  let bodyStream: ReadableStream<Uint8Array> | undefined;

  if (request.body) {
    // Check Content-Length header first
    const contentLength = request.headers.get("content-length");
    const knownSize = contentLength ? parseInt(contentLength, 10) : null;

    if (knownSize !== null && knownSize > STREAM_THRESHOLD) {
      // Large body with known size - use streaming
      bodyStreamId = state.nextStreamId++;
      bodyStream = request.body;
    } else {
      // Small or unknown size - read into memory
      const clonedRequest = request.clone();
      try {
        body = new Uint8Array(await request.arrayBuffer());

        // Check if it ended up being large
        if (body.length > STREAM_THRESHOLD) {
          // Use the cloned request's body for streaming
          bodyStreamId = state.nextStreamId++;
          bodyStream = clonedRequest.body!;
          body = null;
        }
      } catch {
        // Failed to read body, try streaming
        bodyStreamId = state.nextStreamId++;
        bodyStream = clonedRequest.body!;
      }
    }
  }

  const result: SerializedRequestWithStream = {
    method: request.method,
    url: request.url,
    headers,
    body,
    signalAborted: request.signal?.aborted ?? false,
  };

  // Only include streaming fields if actually streaming
  if (bodyStreamId !== undefined) {
    result.bodyStreamId = bodyStreamId;
    result.bodyStream = bodyStream;
  }

  return result;
}

/**
 * Wait for credit to become available on an upload stream session.
 */
function waitForUploadCredit(session: StreamUploadSession): Promise<void> {
  return new Promise((resolve) => {
    session.creditResolver = resolve;
  });
}

/**
 * Send a request body as a stream.
 */
async function sendBodyStream(
  state: ConnectionState,
  streamId: number,
  body: ReadableStream<Uint8Array>
): Promise<void> {
  // Create upload session for tracking
  const session: StreamUploadSession = {
    streamId,
    requestId: 0,
    state: "active",
    bytesTransferred: 0,
    credit: 0, // Wait for initial credit from daemon
  };
  state.uploadStreams.set(streamId, session);

  const reader = body.getReader();

  try {
    while (true) {
      if (session.state !== "active") {
        throw new Error("Stream cancelled");
      }

      // Wait for credit if needed
      while (session.credit < STREAM_CHUNK_SIZE && session.state === "active") {
        await waitForUploadCredit(session);
      }

      if (session.state !== "active") {
        throw new Error("Stream cancelled");
      }

      const { done, value } = await reader.read();

      if (done) {
        // Send stream close
        sendMessage(state.socket, {
          type: MessageType.STREAM_CLOSE,
          streamId,
        } as StreamClose);
        break;
      }

      // Send chunk(s)
      for (let offset = 0; offset < value.length; offset += STREAM_CHUNK_SIZE) {
        const chunk = value.slice(offset, offset + STREAM_CHUNK_SIZE);

        sendMessage(state.socket, {
          type: MessageType.STREAM_PUSH,
          streamId,
          chunk,
        } as StreamPush);

        session.credit -= chunk.length;
        session.bytesTransferred += chunk.length;
      }
    }
  } catch (err) {
    sendMessage(state.socket, {
      type: MessageType.STREAM_ERROR,
      streamId,
      error: (err as Error).message,
    } as StreamError);
    throw err;
  } finally {
    reader.releaseLock();
    state.uploadStreams.delete(streamId);
  }
}

// ============================================================================
// Generic Isolate Event Handler
// ============================================================================

/**
 * Handle ISOLATE_EVENT message from daemon.
 * Routes WS events to existing handlers, and user-defined events to listeners.
 */
function handleIsolateEvent(
  message: IsolateEventMessage,
  state: ConnectionState
): void {
  switch (message.event) {
    case IsolateEvents.WS_COMMAND: {
      const payload = message.payload as WsCommandPayload;
      const callbacks = isolateWsCallbacks.get(message.isolateId);
      if (callbacks) {
        // Convert Uint8Array to ArrayBuffer if needed
        let data: string | ArrayBuffer | undefined;
        if (payload.data instanceof Uint8Array) {
          data = payload.data.buffer.slice(
            payload.data.byteOffset,
            payload.data.byteOffset + payload.data.byteLength
          ) as ArrayBuffer;
        } else {
          data = payload.data;
        }
        const cmd: WebSocketCommand = {
          type: payload.type,
          connectionId: payload.connectionId,
          data,
          code: payload.code,
          reason: payload.reason,
        };
        for (const cb of callbacks) {
          cb(cmd);
        }
      }
      break;
    }
    case IsolateEvents.WS_CLIENT_CONNECT: {
      const payload = message.payload as WsClientConnectPayload;
      handleClientWsConnect(message.isolateId, payload, state);
      break;
    }
    case IsolateEvents.WS_CLIENT_SEND: {
      const payload = message.payload as WsClientSendPayload;
      handleClientWsSend(message.isolateId, payload, state);
      break;
    }
    case IsolateEvents.WS_CLIENT_CLOSE: {
      const payload = message.payload as WsClientClosePayload;
      handleClientWsClose(message.isolateId, payload, state);
      break;
    }
    default: {
      // User-defined events: dispatch to per-isolate event listeners
      const listeners = isolateEventListeners.get(message.isolateId);
      if (listeners) {
        const eventListeners = listeners.get(message.event);
        if (eventListeners) {
          for (const cb of eventListeners) {
            cb(message.payload);
          }
        }
      }
      break;
    }
  }
}

// ============================================================================
// Client WebSocket Handlers (outbound connections from isolate)
// ============================================================================

/**
 * Handle client WebSocket connect command from daemon.
 * Creates a real WebSocket connection and sets up event handlers.
 * If a WebSocket callback is registered, it's used to create/proxy the connection.
 */
function handleClientWsConnect(
  isolateId: string,
  payload: WsClientConnectPayload,
  state: ConnectionState
): void {
  const { socketId, url, protocols } = payload;

  // Get or create the WebSocket map for this isolate
  let sockets = isolateClientWebSockets.get(isolateId);
  if (!sockets) {
    sockets = new Map();
    isolateClientWebSockets.set(isolateId, sockets);
  }

  // Helper to set up event handlers on a WebSocket
  const setupWebSocket = (ws: WebSocket) => {
    // Track the socket
    sockets!.set(socketId, ws);

    // Set up event handlers
    ws.onopen = () => {
      sendMessage(state.socket, {
        type: MessageType.CLIENT_EVENT,
        isolateId,
        event: ClientEvents.WS_CLIENT_OPENED,
        payload: { socketId, protocol: ws.protocol || "", extensions: ws.extensions || "" },
      } as ClientEventMessage);
    };

    ws.onmessage = (event) => {
      let data: string | Uint8Array;
      if (typeof event.data === "string") {
        data = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        data = new Uint8Array(event.data);
      } else if (event.data instanceof Blob) {
        // Read blob asynchronously
        event.data.arrayBuffer().then((buffer) => {
          sendMessage(state.socket, {
            type: MessageType.CLIENT_EVENT,
            isolateId,
            event: ClientEvents.WS_CLIENT_MESSAGE,
            payload: { socketId, data: new Uint8Array(buffer) },
          } as ClientEventMessage);
        });
        return;
      } else {
        // Unknown data type, convert to string
        data = String(event.data);
      }

      sendMessage(state.socket, {
        type: MessageType.CLIENT_EVENT,
        isolateId,
        event: ClientEvents.WS_CLIENT_MESSAGE,
        payload: { socketId, data },
      } as ClientEventMessage);
    };

    ws.onerror = () => {
      sendMessage(state.socket, {
        type: MessageType.CLIENT_EVENT,
        isolateId,
        event: ClientEvents.WS_CLIENT_ERROR,
        payload: { socketId },
      } as ClientEventMessage);
    };

    ws.onclose = (event) => {
      sendMessage(state.socket, {
        type: MessageType.CLIENT_EVENT,
        isolateId,
        event: ClientEvents.WS_CLIENT_CLOSED,
        payload: { socketId, code: event.code, reason: event.reason, wasClean: event.wasClean },
      } as ClientEventMessage);

      // Clean up the socket
      sockets?.delete(socketId);
      if (sockets?.size === 0) {
        isolateClientWebSockets.delete(isolateId);
      }
    };
  };

  // Helper to send connection blocked/failed events
  const sendConnectionFailed = (reason: string) => {
    sendMessage(state.socket, {
      type: MessageType.CLIENT_EVENT,
      isolateId,
      event: ClientEvents.WS_CLIENT_ERROR,
      payload: { socketId },
    } as ClientEventMessage);

    sendMessage(state.socket, {
      type: MessageType.CLIENT_EVENT,
      isolateId,
      event: ClientEvents.WS_CLIENT_CLOSED,
      payload: { socketId, code: 1006, reason, wasClean: false },
    } as ClientEventMessage);
  };

  // Check if a WebSocket callback is registered for this isolate
  const callback = isolateWebSocketCallbacks.get(isolateId);

  if (callback) {
    // Use the callback to create/proxy the WebSocket
    try {
      const result = callback(url, protocols || []);

      if (result instanceof Promise) {
        // Handle async callback
        result
          .then((ws) => {
            if (ws === null) {
              // Connection blocked by callback
              sendConnectionFailed("Connection blocked");
            } else {
              setupWebSocket(ws);
            }
          })
          .catch(() => {
            sendConnectionFailed("Callback error");
          });
      } else if (result === null) {
        // Connection blocked by callback
        sendConnectionFailed("Connection blocked");
      } else {
        // Callback returned a WebSocket synchronously
        setupWebSocket(result);
      }
    } catch {
      sendConnectionFailed("Callback error");
    }
  } else {
    // No callback, create WebSocket directly (default behavior)
    try {
      const ws =
        protocols && protocols.length > 0
          ? new WebSocket(url, protocols)
          : new WebSocket(url);
      setupWebSocket(ws);
    } catch {
      sendConnectionFailed("Connection failed");
    }
  }
}

/**
 * Handle client WebSocket send command from daemon.
 * Sends data on an existing WebSocket connection.
 */
function handleClientWsSend(
  isolateId: string,
  payload: WsClientSendPayload,
  state: ConnectionState
): void {
  const { socketId, data } = payload;

  const sockets = isolateClientWebSockets.get(isolateId);
  const ws = sockets?.get(socketId);

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return; // Silently ignore if socket not found or not open
  }

  // Handle binary data (check for __BINARY__ marker from isolate)
  if (typeof data === "string" && data.startsWith("__BINARY__")) {
    const base64 = data.slice(10);
    const binary = Buffer.from(base64, "base64");
    ws.send(binary);
  } else if (data instanceof Uint8Array) {
    ws.send(Buffer.from(data));
  } else {
    ws.send(data as string);
  }
}

/**
 * Handle client WebSocket close command from daemon.
 * Closes an existing WebSocket connection.
 */
function handleClientWsClose(
  isolateId: string,
  payload: WsClientClosePayload,
  state: ConnectionState
): void {
  const { socketId, code, reason } = payload;

  const sockets = isolateClientWebSockets.get(isolateId);
  const ws = sockets?.get(socketId);

  if (!ws) {
    return; // Silently ignore if socket not found
  }

  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(code ?? 1000, reason ?? "");
  }
}
