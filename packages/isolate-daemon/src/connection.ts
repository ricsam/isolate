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
  type Message,
  type ResponseOk,
  type ResponseError,
  type CreateRuntimeRequest,
  type DisposeRuntimeRequest,
  type EvalRequest,
  type DispatchRequestRequest,
  type TickRequest,
  type CallbackResponseMsg,
  type CallbackInvoke,
  type SetupTestEnvRequest,
  type RunTestsRequest,
  type SetupPlaywrightRequest,
  type RunPlaywrightTestsRequest,
  type ResetPlaywrightTestsRequest,
  type GetCollectedDataRequest,
  type PlaywrightEvent,
  type FsCallbackRegistrations,
} from "@ricsam/isolate-protocol";
import { createCallbackFileSystemHandler } from "./callback-fs-handler.ts";
import {
  setupTestEnvironment,
  runTests as runTestsInContext,
} from "@ricsam/isolate-test-environment";
import {
  setupPlaywright,
  runPlaywrightTests,
  resetPlaywrightTests,
} from "@ricsam/isolate-playwright";
import { chromium, firefox, webkit } from "playwright";
import { createRuntime, type RuntimeHandle } from "@ricsam/isolate-runtime";
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
          if (instance.browserContext) {
            instance.browserContext.close().catch(() => {});
          }
          if (instance.browser) {
            instance.browser.close().catch(() => {});
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

    case MessageType.TICK:
      await handleTick(message as TickRequest, connection, state);
      break;

    case MessageType.CALLBACK_RESPONSE:
      handleCallbackResponse(message as CallbackResponseMsg, connection);
      break;

    case MessageType.SETUP_TEST_ENV:
      await handleSetupTestEnv(
        message as SetupTestEnvRequest,
        connection,
        state
      );
      break;

    case MessageType.RUN_TESTS:
      await handleRunTests(message as RunTestsRequest, connection, state);
      break;

    case MessageType.SETUP_PLAYWRIGHT:
      await handleSetupPlaywright(
        message as SetupPlaywrightRequest,
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

    const runtime = await createRuntime({
      memoryLimit: message.options.memoryLimit ?? state.options.defaultMemoryLimit,
      console: consoleCallbacks
        ? {
            onLog: async (level, ...args) => {
              // Route to the appropriate callback based on level
              const levelCallback = (consoleCallbacks as Record<string, { callbackId: number } | undefined>)[level];
              if (levelCallback) {
                await invokeClientCallback(
                  connection,
                  levelCallback.callbackId,
                  [level, ...args]
                );
              } else if (consoleCallbacks.log) {
                // Fallback to log callback if specific level callback not registered
                await invokeClientCallback(
                  connection,
                  consoleCallbacks.log.callbackId,
                  [level, ...args]
                );
              }
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
    };

    // Store callback registrations
    if (consoleCallbacks) {
      for (const [name, reg] of Object.entries(consoleCallbacks)) {
        if (reg) {
          instance.callbacks.set(reg.callbackId, { ...reg, name });
        }
      }
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
    if (instance.browserContext) {
      await instance.browserContext.close();
    }
    if (instance.browser) {
      await instance.browser.close();
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
    const result = instance.runtime.context.evalSync(message.code, {
      filename: message.filename,
    });
    sendOk(connection.socket, message.requestId, { value: result });
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
    // Note: Pass tick function for streaming response support
    const response = await instance.runtime.fetch.dispatchRequest(request, {
      tick: async () => {
        await instance.runtime.tick();
      },
    });

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

/**
 * Handle TICK message.
 */
async function handleTick(
  message: TickRequest,
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
    instance.runtime.tick(message.ms);
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
 * Handle SETUP_TEST_ENV message.
 */
async function handleSetupTestEnv(
  message: SetupTestEnvRequest,
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
    // Setup test environment in the isolate's context
    await setupTestEnvironment(instance.runtime.context);
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

// ============================================================================
// Playwright Handlers
// ============================================================================

/**
 * Handle SETUP_PLAYWRIGHT message.
 */
async function handleSetupPlaywright(
  message: SetupPlaywrightRequest,
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

  if (instance.browser) {
    sendError(
      connection.socket,
      message.requestId,
      ErrorCode.SCRIPT_ERROR,
      "Playwright already set up for this isolate"
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    // Launch browser based on type
    const browserType = message.options.browserType ?? "chromium";
    const headless = message.options.headless ?? true;

    let browser;
    switch (browserType) {
      case "firefox":
        browser = await firefox.launch({ headless });
        break;
      case "webkit":
        browser = await webkit.launch({ headless });
        break;
      default:
        browser = await chromium.launch({ headless });
    }

    // Create context and page
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    // Setup Playwright in the isolate context with event streaming
    const playwrightHandle = await setupPlaywright(instance.runtime.context, {
      page,
      baseUrl: message.options.baseURL,
      onConsoleLog: (level, ...args) => {
        // Stream console logs to client
        const event: PlaywrightEvent = {
          type: MessageType.PLAYWRIGHT_EVENT,
          isolateId: message.isolateId,
          eventType: "consoleLog",
          payload: { level, args },
        };
        sendMessage(connection.socket, event);
      },
      onNetworkRequest: (info) => {
        // Stream network requests to client
        const event: PlaywrightEvent = {
          type: MessageType.PLAYWRIGHT_EVENT,
          isolateId: message.isolateId,
          eventType: "networkRequest",
          payload: info,
        };
        sendMessage(connection.socket, event);
      },
      onNetworkResponse: (info) => {
        // Stream network responses to client
        const event: PlaywrightEvent = {
          type: MessageType.PLAYWRIGHT_EVENT,
          isolateId: message.isolateId,
          eventType: "networkResponse",
          payload: info,
        };
        sendMessage(connection.socket, event);
      },
    });

    // Store references
    instance.browser = browser;
    instance.browserContext = browserContext;
    instance.page = page;
    instance.playwrightHandle = playwrightHandle;

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
      "Playwright not set up for this isolate"
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
      "Playwright not set up for this isolate"
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
      "Playwright not set up for this isolate"
    );
    return;
  }

  instance.lastActivity = Date.now();

  try {
    const data = {
      consoleLogs: instance.playwrightHandle.getConsoleLogs(),
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
