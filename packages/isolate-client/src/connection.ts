/**
 * Connection handling for the isolate client.
 */

import { connect as netConnect, type Socket } from "node:net";
import path from "node:path";
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
  type HasTestsRequest,
  type GetTestCountRequest,
  type TestEnvironmentCallbackRegistrations,
  type TestEnvironmentOptionsProtocol,
  type TestEventMessage,
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
  marshalValue,
  type MarshalContext,
} from "@ricsam/isolate-protocol";
import { createPlaywrightHandler, type PlaywrightCallback } from "@ricsam/isolate-playwright/client";
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
} from "./types.ts";

const DEFAULT_TIMEOUT = 30000;

// Track WebSocket command callbacks per isolate for handling WS_COMMAND messages
const isolateWsCallbacks = new Map<string, Set<(cmd: WebSocketCommand) => void>>();

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
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

interface ConnectionState {
  socket: Socket;
  pendingRequests: Map<number, PendingRequest>;
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
    callbacksNeedingRequestId: new Set(),
    nextRequestId: 1,
    nextCallbackId: 1,
    nextStreamId: 1,
    connected: true,
    streamResponses: new Map(),
    uploadStreams: new Map(),
    moduleSourceCache: new Map(),
    callbackStreamReaders: new Map(),
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
    // Reject all pending requests and clear their timeouts
    for (const [, pending] of state.pendingRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error("Connection closed"));
    }
    state.pendingRequests.clear();

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
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });

  return {
    createRuntime: (runtimeOptions) =>
      createRuntime(state, runtimeOptions),
    createNamespace: (id: string): Namespace => ({
      id,
      createRuntime: (runtimeOptions) =>
        createRuntime(state, runtimeOptions, id),
    }),
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

    case MessageType.CALLBACK_STREAM_CANCEL: {
      const streamId = (message as { streamId: number }).streamId;
      const reader = state.callbackStreamReaders.get(streamId);
      if (reader) {
        reader.cancel().catch(() => {});
      }
      break;
    }

    case MessageType.WS_COMMAND: {
      const msg = message as WsCommandMessage;
      const callbacks = isolateWsCallbacks.get(msg.isolateId);
      if (callbacks) {
        // Convert Uint8Array to ArrayBuffer if needed
        let data: string | ArrayBuffer | undefined;
        if (msg.command.data instanceof Uint8Array) {
          data = msg.command.data.buffer.slice(
            msg.command.data.byteOffset,
            msg.command.data.byteOffset + msg.command.data.byteLength
          ) as ArrayBuffer;
        } else {
          data = msg.command.data;
        }
        const cmd: WebSocketCommand = {
          type: msg.command.type,
          connectionId: msg.command.connectionId,
          data,
          code: msg.command.code,
          reason: msg.command.reason,
        };
        for (const cb of callbacks) {
          cb(cmd);
        }
      }
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
        if (pending.timeoutId) clearTimeout(pending.timeoutId);

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

  const response: CallbackResponseMsg = {
    type: MessageType.CALLBACK_RESPONSE,
    requestId: invoke.requestId,
  };

  if (!callback) {
    response.error = {
      name: "Error",
      message: `Unknown callback: ${invoke.callbackId}`,
    };
    sendMessage(state.socket, response);
  } else {
    try {
      // Only pass requestId to callbacks that need it (e.g., fetch callbacks for streaming)
      const needsRequestId = state.callbacksNeedingRequestId.has(invoke.callbackId);
      const result = needsRequestId
        ? await callback(...invoke.args, invoke.requestId)
        : await callback(...invoke.args);

      // Check if this is a streaming response (don't send CALLBACK_RESPONSE, streaming handles it)
      if (result && typeof result === 'object' && (result as { __callbackStreaming?: boolean }).__callbackStreaming) {
        // Streaming response - CALLBACK_STREAM_START already sent, body streaming in progress
        // Don't send a CALLBACK_RESPONSE here
        return;
      }

      response.result = result;
      sendMessage(state.socket, response);
    } catch (err) {
      const error = err as Error;
      response.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      sendMessage(state.socket, response);
    }
  }
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
async function createRuntime<T extends Record<string, any[]> = Record<string, unknown[]>>(
  state: ConnectionState,
  options: RuntimeOptions<T> = {},
  namespaceId?: string
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
    callbacks.custom = registerCustomFunctions(state, options.customFunctions as CustomFunctions<Record<string, unknown[]>>);
  }

  // Playwright callback registration - client owns the browser
  let playwrightHandler: PlaywrightCallback | undefined;
  // Client-side browser event buffers
  const browserConsoleLogs: { level: string; stdout: string; timestamp: number }[] = [];
  const networkRequests: { url: string; method: string; headers: Record<string, string>; timestamp: number }[] = [];
  const networkResponses: { url: string; status: number; headers: Record<string, string>; timestamp: number }[] = [];
  const pageListenerCleanups: (() => void)[] = [];

  if (options.playwright) {
    playwrightHandler = createPlaywrightHandler(options.playwright.page, {
      timeout: options.playwright.timeout,
    });

    const handlerCallbackId = state.nextCallbackId++;
    state.callbacks.set(handlerCallbackId, async (opJson: unknown) => {
      const op = JSON.parse(opJson as string) as PlaywrightOperation;
      const result = await playwrightHandler!(op);
      return JSON.stringify(result);
    });

    // Set up client-side page.on listeners for browser events
    const page = options.playwright.page;

    const onConsole = (msg: { type: () => string; text: () => string }) => {
      const entry = {
        level: msg.type(),
        stdout: msg.text(),
        timestamp: Date.now(),
      };
      browserConsoleLogs.push(entry);

      if (options.playwright!.onEvent) {
        options.playwright!.onEvent({
          type: "browserConsoleLog",
          ...entry,
        });
      }

      if (options.playwright!.console && options.console?.onEntry) {
        options.console.onEntry({
          type: "browserOutput",
          ...entry,
        });
      } else if (options.playwright!.console) {
        const prefix = entry.level === "error" ? "[browser:error]" : "[browser]";
        console.log(prefix, entry.stdout);
      }
    };

    const onRequest = (request: { url: () => string; method: () => string; headers: () => Record<string, string> }) => {
      const info = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
      };
      networkRequests.push(info);

      if (options.playwright!.onEvent) {
        options.playwright!.onEvent({
          type: "networkRequest",
          ...info,
        });
      }
    };

    const onResponse = (response: { url: () => string; status: () => number; headers: () => Record<string, string> }) => {
      const info = {
        url: response.url(),
        status: response.status(),
        headers: response.headers(),
        timestamp: Date.now(),
      };
      networkResponses.push(info);

      if (options.playwright!.onEvent) {
        options.playwright!.onEvent({
          type: "networkResponse",
          ...info,
        });
      }
    };

    page.on("console", onConsole);
    page.on("request", onRequest);
    page.on("response", onResponse);

    pageListenerCleanups.push(
      () => page.removeListener("console", onConsole),
      () => page.removeListener("request", onRequest),
      () => page.removeListener("response", onResponse),
    );

    callbacks.playwright = {
      handlerCallbackId,
      console: options.playwright.console && !options.console?.onEntry,
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
          type: 'sync',
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

  const requestId = state.nextRequestId++;
  const request: CreateRuntimeRequest = {
    type: MessageType.CREATE_RUNTIME,
    requestId,
    options: {
      memoryLimitMB: options.memoryLimitMB,
      cwd: options.cwd,
      callbacks,
      testEnvironment: testEnvironmentOption,
      namespaceId,
    },
  };

  const result = await sendRequest<CreateRuntimeResult>(state, request);
  const isolateId = result.isolateId;
  const reused = result.reused ?? false;

  // WebSocket command callbacks - store in module-level Map for WS_COMMAND message handling
  const wsCommandCallbacks: Set<(cmd: WebSocketCommand) => void> = new Set();
  isolateWsCallbacks.set(isolateId, wsCommandCallbacks);

  // Create fetch handle
  const fetchHandle: RemoteFetchHandle = {
    async dispatchRequest(req: Request, opts?: DispatchOptions) {
      const reqId = state.nextRequestId++;
      const serialized = await serializeRequestWithStreaming(state, req);

      // Extract bodyStream before creating the protocol message (can't be serialized)
      const { bodyStream, ...serializableRequest } = serialized;

      const request: DispatchRequestRequest = {
        type: MessageType.DISPATCH_REQUEST,
        requestId: reqId,
        isolateId,
        request: serializableRequest,
        options: opts,
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

      // If streaming body, start sending chunks after request is sent
      if (serialized.bodyStreamId !== undefined && bodyStream) {
        const streamId = serialized.bodyStreamId;

        // Send the request first
        const responsePromise = sendRequest<{ response: SerializedResponse | Response; __streaming?: boolean }>(
          state,
          request,
          opts?.timeout ?? DEFAULT_TIMEOUT
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
          opts?.timeout ?? DEFAULT_TIMEOUT
        );
        return handleResponse(res);
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
        throw new Error("Playwright not configured. Provide playwright.page in createRuntime options.");
      }
      return {
        browserConsoleLogs: [...browserConsoleLogs],
        networkRequests: [...networkRequests],
        networkResponses: [...networkResponses],
      };
    },

    clearCollectedData(): void {
      if (!playwrightEnabled) {
        throw new Error("Playwright not configured. Provide playwright.page in createRuntime options.");
      }
      browserConsoleLogs.length = 0;
      networkRequests.length = 0;
      networkResponses.length = 0;
    },
  };

  return {
    id: isolateId,
    isolateId,
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
      // Support both new signature (filename string) and old signature (EvalOptions)
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
        maxExecutionMs: options?.maxExecutionMs,
        module: true, // Always use module mode
      };
      await sendRequest<{ value: unknown }>(state, req);
      // Module evaluation returns void - don't return the value
    },

    dispose: async () => {
      // Clean up page listeners
      for (const cleanup of pageListenerCleanups) {
        cleanup();
      }
      // Clean up WebSocket callbacks
      isolateWsCallbacks.delete(isolateId);

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
    registrations.onEntry = { callbackId, name: "onEntry", type: 'sync' };
  }

  return registrations;
}

/** Threshold for streaming callback responses (64KB) */
const CALLBACK_STREAM_THRESHOLD = 64 * 1024;

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
    const request = deserializeRequest(serialized as SerializedRequestData);
    const response = await callback(request);

    // Determine if we should stream the response
    const contentLength = response.headers.get("content-length");
    const knownSize = contentLength ? parseInt(contentLength, 10) : null;

    // Only stream network responses (responses with http/https URLs)
    // Locally constructed Responses (no URL or non-http URL) are buffered
    const isNetworkResponse = response.url && (response.url.startsWith('http://') || response.url.startsWith('https://'));

    // Stream if: network response AND has body AND (no content-length OR size > threshold)
    const shouldStream = isNetworkResponse && response.body && (knownSize === null || knownSize > CALLBACK_STREAM_THRESHOLD);

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
    const resolvedPath = path.posix.join(result.resolveDir, path.posix.basename(specifier));
    state.moduleSourceCache.set(resolvedPath, result.code);

    return result;
  });

  return { callbackId, name: "moduleLoader", type: 'async' };
}

// Iterator session tracking for async iterator custom functions on the client side
interface ClientIteratorSession {
  iterator: AsyncGenerator<unknown, unknown, unknown>;
}

const clientIteratorSessions = new Map<number, ClientIteratorSession>();
let nextClientIteratorId = 1;

// Registries for returned promises/iterators from custom function callbacks
// These are populated when a custom function returns a Promise or AsyncIterator
const returnedPromiseRegistry = new Map<number, Promise<unknown>>();
const returnedIteratorRegistry = new Map<number, AsyncIterator<unknown>>();

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
 * Register custom function callbacks.
 */
function registerCustomFunctions(
  state: ConnectionState,
  customFunctions: CustomFunctions
): Record<string, CallbackRegistration> {
  const registrations: Record<string, CallbackRegistration> = {};

  for (const [name, def] of Object.entries(customFunctions)) {
    if (def.type === 'asyncIterator') {
      // For async iterators, we need to register 4 callbacks:
      // start, next, return, throw

      // Start callback: creates iterator, returns iteratorId
      const startCallbackId = state.nextCallbackId++;
      state.callbacks.set(startCallbackId, async (...args: unknown[]) => {
        try {
          const fn = def.fn as (...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>;
          const iterator = fn(...args);
          const iteratorId = nextClientIteratorId++;
          clientIteratorSessions.set(iteratorId, { iterator });
          return { iteratorId };
        } catch (error: unknown) {
          throw error;
        }
      });

      // Next callback: calls iterator.next() - marshal the value for type fidelity
      const nextCallbackId = state.nextCallbackId++;
      state.callbacks.set(nextCallbackId, async (iteratorId: unknown) => {
        const session = clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          throw new Error(`Iterator session ${iteratorId} not found`);
        }
        try {
          const result = await session.iterator.next();
          if (result.done) {
            clientIteratorSessions.delete(iteratorId as number);
          }
          return { done: result.done, value: await marshalValue(result.value) };
        } catch (error: unknown) {
          clientIteratorSessions.delete(iteratorId as number);
          throw error;
        }
      });

      // Return callback: calls iterator.return() - marshal the value for type fidelity
      const returnCallbackId = state.nextCallbackId++;
      state.callbacks.set(returnCallbackId, async (iteratorId: unknown, value: unknown) => {
        const session = clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          return { done: true, value: await marshalValue(undefined) };
        }
        try {
          const result = await session.iterator.return?.(value);
          clientIteratorSessions.delete(iteratorId as number);
          return { done: true, value: await marshalValue(result?.value) };
        } catch (error: unknown) {
          clientIteratorSessions.delete(iteratorId as number);
          throw error;
        }
      });

      // Throw callback: calls iterator.throw() - marshal the value for type fidelity
      const throwCallbackId = state.nextCallbackId++;
      state.callbacks.set(throwCallbackId, async (iteratorId: unknown, errorData: unknown) => {
        const session = clientIteratorSessions.get(iteratorId as number);
        if (!session) {
          throw new Error(`Iterator session ${iteratorId} not found`);
        }
        try {
          const errInfo = errorData as { message: string; name: string };
          const error = Object.assign(new Error(errInfo.message), { name: errInfo.name });
          const result = await session.iterator.throw?.(error);
          clientIteratorSessions.delete(iteratorId as number);
          return { done: result?.done ?? true, value: await marshalValue(result?.value) };
        } catch (error: unknown) {
          clientIteratorSessions.delete(iteratorId as number);
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
        const result = await def.fn(...args);

        // Helper to add callback IDs to PromiseRef and AsyncIteratorRef
        const addCallbackIdsToRefs = (value: unknown): unknown => {
          if (value === null || typeof value !== 'object') {
            return value;
          }

          // Check for PromiseRef
          if (isPromiseRef(value)) {
            // Create a resolve callback
            const resolveCallbackId = state.nextCallbackId++;
            state.callbacks.set(resolveCallbackId, async (...args: unknown[]) => {
              const promiseId = args[0] as number;
              const promise = returnedPromiseRegistry.get(promiseId);
              if (!promise) {
                throw new Error(`Promise ${promiseId} not found`);
              }
              const promiseResult = await promise;
              // Clean up
              returnedPromiseRegistry.delete(promiseId);
              // Marshal and process the result recursively
              const marshalledResult = await marshalValue(promiseResult, marshalCtx);
              return addCallbackIdsToRefs(marshalledResult);
            });
            return {
              ...value,
              __resolveCallbackId: resolveCallbackId,
            };
          }

          // Check for AsyncIteratorRef
          if (isAsyncIteratorRef(value)) {
            // Create next callback
            const nextCallbackId = state.nextCallbackId++;
            state.callbacks.set(nextCallbackId, async (...args: unknown[]) => {
              const iteratorId = args[0] as number;
              const iterator = returnedIteratorRegistry.get(iteratorId);
              if (!iterator) {
                throw new Error(`Iterator ${iteratorId} not found`);
              }
              const iterResult = await iterator.next();
              if (iterResult.done) {
                returnedIteratorRegistry.delete(iteratorId);
              }
              // Marshal and process the value recursively
              const marshalledValue = await marshalValue(iterResult.value, marshalCtx);
              return {
                done: iterResult.done,
                value: addCallbackIdsToRefs(marshalledValue),
              };
            });

            // Create return callback
            const returnCallbackId = state.nextCallbackId++;
            state.callbacks.set(returnCallbackId, async (...args: unknown[]) => {
              const iteratorId = args[0] as number;
              const returnValue = args[1];
              const iterator = returnedIteratorRegistry.get(iteratorId);
              returnedIteratorRegistry.delete(iteratorId);
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
          const objResult: Record<string, unknown> = {};
          for (const key of Object.keys(value)) {
            objResult[key] = addCallbackIdsToRefs((value as Record<string, unknown>)[key]);
          }
          return objResult;
        };

        // Create context for registering returned callbacks/promises/iterators
        // These will be registered in state.callbacks so the daemon can call them back
        const marshalCtx: MarshalContext = {
          registerCallback: (fn: Function): number => {
            const returnedCallbackId = state.nextCallbackId++;
            // Register a callback that marshals its result recursively
            state.callbacks.set(returnedCallbackId, async (...args: unknown[]) => {
              const fnResult = await fn(...args);
              const marshalledResult = await marshalValue(fnResult, marshalCtx);
              return addCallbackIdsToRefs(marshalledResult);
            });
            return returnedCallbackId;
          },
          registerPromise: (promise: Promise<unknown>): number => {
            const promiseId = state.nextCallbackId++;
            // Store the promise - callback to resolve it will be created in addCallbackIdsToRefs
            returnedPromiseRegistry.set(promiseId, promise);
            return promiseId;
          },
          registerIterator: (iterator: AsyncIterator<unknown>): number => {
            const iteratorId = state.nextCallbackId++;
            // Store the iterator - callbacks for next/return will be created in addCallbackIdsToRefs
            returnedIteratorRegistry.set(iteratorId, iterator);
            return iteratorId;
          },
        };

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

// ============================================================================
// Streaming Request Serialization
// ============================================================================

interface SerializedRequestWithStream extends SerializedRequestData {
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
