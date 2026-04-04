import ivm from "@ricsam/isolated-vm";
import path from "node:path";
import { setupCore } from "../core/index.ts";
import { setupAsyncContext } from "../async-context/index.ts";
import { normalizeEntryFilename } from "../protocol/index.ts";
import {
  transformEntryCode,
  transformModuleCode,
  contentHash,
  mapErrorStack,
  type SourceMap,
  type TransformResult,
} from "../transform/index.ts";

// Re-export for convenience
export { normalizeEntryFilename } from "../protocol/index.ts";
import { setupConsole } from "../console/index.ts";
import { setupEncoding } from "../encoding/index.ts";
import { setupTimers } from "../timers/index.ts";
import { setupPath } from "../path/index.ts";
import { setupCrypto } from "../crypto/index.ts";
import { setupFetch } from "../fetch/index.ts";
import { setupFs } from "../fs/index.ts";
import {
  setupTestEnvironment,
  runTests as runTestsInContext,
  hasTests as hasTestsInContext,
  getTestCount as getTestCountInContext,
} from "../test-environment/index.ts";
import {
  setupPlaywright,
  type PlaywrightCallback,
  type PlaywrightSetupOptions,
} from "../playwright/index.ts";

import type { ConsoleOptions, ConsoleHandle } from "../console/index.ts";
import type {
  FetchOptions,
  FetchHandle,
  DispatchRequestOptions,
  UpgradeRequest,
  WebSocketCommand,
  ClientWebSocketCommand,
} from "../fetch/index.ts";
import type { FsOptions, FsHandle } from "../fs/index.ts";
import type { CoreHandle } from "../core/index.ts";
import type { EncodingHandle } from "../encoding/index.ts";
import type { TimersHandle } from "../timers/index.ts";
import type { PathHandle } from "../path/index.ts";
import type { CryptoHandle } from "../crypto/index.ts";
import type {
  TestEnvironmentHandle,
  RunResults,
  TestEnvironmentOptions,
  TestEvent,
  SuiteInfo,
  SuiteResult,
  TestInfo,
  TestResult,
  TestError,
} from "../test-environment/index.ts";
import type {
  PlaywrightHandle,
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PageErrorInfo,
  RequestFailureInfo,
  PlaywrightEvent,
} from "../playwright/index.ts";
import type {
  ConsoleCallbacks,
  ConsoleEntry,
  FetchCallback,
  FetchRequestInit,
  ModuleLoaderCallback,
  CustomFunctionDefinition,
  CustomFunctions,
  CustomAsyncGeneratorFunction,
  DispatchOptions,
  EvalOptions as ProtocolEvalOptions,
  PlaywrightOptions as ProtocolPlaywrightOptions,
  BaseRuntimeOptions,
} from "../protocol/index.ts";
import {
  marshalValue,
  unmarshalValue,
  type MarshalContext,
  type UnmarshalContext,
} from "../protocol/index.ts";

// Re-export shared types from protocol
export type {
  ConsoleCallbacks,
  ConsoleEntry,
  FetchCallback,
  FetchRequestInit,
  ModuleLoaderCallback,
  CustomFunction,
  CustomFunctionDefinition,
  CustomFunctions,
  DispatchOptions,
} from "../protocol/index.ts";

// Re-export shared protocol option types
export type EvalOptions = ProtocolEvalOptions;
export type PlaywrightOptions = ProtocolPlaywrightOptions;

/**
 * Options for customizing how custom function return values are marshalled.
 * Used by the daemon to support returned callbacks/promises/iterators via IPC.
 */
export interface CustomFunctionsMarshalOptions {
  /** Factory to create a MarshalContext for registering returned callbacks/promises/iterators */
  createMarshalContext: () => MarshalContext;
  /** Post-processor to add callback IDs to PromiseRef/AsyncIteratorRef values */
  addCallbackIdsToRefs: (value: unknown) => unknown;
  /** Handler for numeric callback IDs from marshalled refs (CallbackRef, PromiseRef, AsyncIteratorRef) */
  invokeCallback: (callbackId: number, args: unknown[]) => Promise<unknown>;
}

/**
 * Options for creating a runtime.
 * Extends BaseRuntimeOptions and adds runtime-specific fs type.
 */
export interface RuntimeOptions<T extends Record<string, any[]> = Record<string, unknown[]>>
  extends BaseRuntimeOptions<T> {
  /**
   * File system options.
   * Note: For local runtime, this uses FsOptions with getDirectory returning a FileSystemHandler.
   * For remote runtime (isolate-client), use FileSystemCallbacks instead.
   */
  fs?: FsOptions;
  /**
   * Optional marshal options for custom functions.
   * When provided, enables MarshalContext-based marshalling for returned values.
   * Used by the daemon for IPC proxying of callbacks/promises/iterators.
   */
  customFunctionsMarshalOptions?: CustomFunctionsMarshalOptions;
}

/**
 * Runtime fetch handle - provides access to fetch/serve operations.
 */
export interface RuntimeFetchHandle {
  /** Dispatch HTTP request to serve() handler */
  dispatchRequest(
    request: Request,
    options?: DispatchRequestOptions
  ): Promise<Response>;
  /** Check if isolate requested WebSocket upgrade */
  getUpgradeRequest(): UpgradeRequest | null;
  /** Dispatch WebSocket open event to isolate */
  dispatchWebSocketOpen(connectionId: string): void;
  /** Dispatch WebSocket message event to isolate */
  dispatchWebSocketMessage(
    connectionId: string,
    message: string | ArrayBuffer
  ): void;
  /** Dispatch WebSocket close event to isolate */
  dispatchWebSocketClose(
    connectionId: string,
    code: number,
    reason: string
  ): void;
  /** Dispatch WebSocket error event to isolate */
  dispatchWebSocketError(connectionId: string, error: Error): void;
  /** Register callback for WebSocket commands from isolate */
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
  /** Check if serve() has been called */
  hasServeHandler(): boolean;
  /** Check if there are active WebSocket connections */
  hasActiveConnections(): boolean;
  /** Dispatch open event to a client WebSocket in the isolate */
  dispatchClientWebSocketOpen(socketId: string, protocol: string, extensions: string): void;
  /** Dispatch message event to a client WebSocket in the isolate */
  dispatchClientWebSocketMessage(socketId: string, data: string | ArrayBuffer): void;
  /** Dispatch close event to a client WebSocket in the isolate */
  dispatchClientWebSocketClose(socketId: string, code: number, reason: string, wasClean: boolean): void;
  /** Dispatch error event to a client WebSocket in the isolate */
  dispatchClientWebSocketError(socketId: string): void;
  /** Register callback for client WebSocket commands from isolate */
  onClientWebSocketCommand(callback: (cmd: ClientWebSocketCommand) => void): () => void;
  /** Register callback for events emitted from isolate code */
  onEvent(callback: (event: string, payload: unknown) => void): () => void;
  /** Dispatch an event into the isolate (calls __on listeners) */
  dispatchEvent(event: string, payload: unknown): void;
}

/**
 * Runtime timers handle - provides access to timer operations.
 * Timers fire automatically based on real time.
 */
export interface RuntimeTimersHandle {
  /** Clear all pending timers */
  clearAll(): void;
}

/**
 * Runtime console handle - provides access to console state.
 */
export interface RuntimeConsoleHandle {
  /** Reset all console state (timers, counters, group depth) */
  reset(): void;
  /** Get console.time() timers */
  getTimers(): Map<string, number>;
  /** Get console.count() counters */
  getCounters(): Map<string, number>;
  /** Get current console.group() nesting depth */
  getGroupDepth(): number;
}

/**
 * Runtime test environment handle - provides access to test execution.
 */
export interface RuntimeTestEnvironmentHandle {
  /** Run all registered tests */
  runTests(timeout?: number): Promise<RunResults>;
  /** Check if any tests are registered */
  hasTests(): boolean;
  /** Get count of registered tests */
  getTestCount(): number;
  /** Reset test state */
  reset(): void;
}

/**
 * Runtime playwright handle - provides access to browser data collection.
 */
export interface RuntimePlaywrightHandle {
  /** Get collected browser data (console logs, network requests/responses) */
  getCollectedData(): CollectedData;
  /** Get tracked browser context/page ids */
  getTrackedResources(): { contexts: string[]; pages: string[] };
  /** Clear collected browser data */
  clearCollectedData(): void;
}

/**
 * Collected browser data from playwright.
 */
export interface CollectedData {
  /** Browser console logs (from the page, not sandbox) */
  browserConsoleLogs: BrowserConsoleLogEntry[];
  pageErrors: PageErrorInfo[];
  networkRequests: NetworkRequestInfo[];
  networkResponses: NetworkResponseInfo[];
  requestFailures: RequestFailureInfo[];
}

/**
 * Runtime handle - the main interface for interacting with the isolate.
 */
export interface RuntimeHandle {
  /** Unique runtime identifier */
  readonly id: string;
  /** Execute code as ES module (supports top-level await) */
  eval(code: string, filenameOrOptions?: string | EvalOptions): Promise<void>;
  /** Dispose all resources */
  dispose(): Promise<void>;
  /** Clear module cache and source maps (used for namespace pooling/reuse) */
  clearModuleCache(): void;

  /**
   * Array of pending callback promises. Push promises here to have them
   * awaited after each eval() call completes. Used by daemon for IPC flush.
   * For standalone use this array stays empty (callbacks are synchronous).
   */
  readonly pendingCallbacks: Promise<unknown>[];

  /** Fetch handle - access to fetch/serve operations */
  readonly fetch: RuntimeFetchHandle;
  /** Timers handle - access to timer operations */
  readonly timers: RuntimeTimersHandle;
  /** Console handle - access to console state */
  readonly console: RuntimeConsoleHandle;
  /** Test environment handle - access to test execution (throws if not enabled) */
  readonly testEnvironment: RuntimeTestEnvironmentHandle;
  /** Playwright handle - access to playwright operations (throws if not configured) */
  readonly playwright: RuntimePlaywrightHandle;
}

// Internal state for runtime
interface RuntimeState {
  id: string;
  isolate: ivm.Isolate;
  context: ivm.Context;
  handles: {
    core?: CoreHandle;
    console?: ConsoleHandle;
    encoding?: EncodingHandle;
    timers?: TimersHandle;
    path?: PathHandle;
    crypto?: CryptoHandle;
    fetch?: FetchHandle;
    fs?: FsHandle;
    testEnvironment?: TestEnvironmentHandle;
    playwright?: PlaywrightHandle;
  };
  moduleCache: Map<string, ivm.Module>;
  staticModuleCache: Map<string, ivm.Module>;
  moduleLoadsInFlight: Map<string, Promise<ivm.Module>>;
  transformCache: Map<string, TransformResult>;
  moduleToFilename: Map<ivm.Module, string>;
  moduleLoader?: ModuleLoaderCallback;
  customFunctions?: CustomFunctions;
  customFnInvokeRef?: ivm.Reference<
    (name: string, argsJson: string) => Promise<string>
  >;
  sourceMaps: Map<string, SourceMap>;
  /** Tracks the import chain for each module (resolved path → list of ancestor paths) */
  moduleImportChain: Map<string, string[]>;
  /** Tracks which file imported a given specifier (resolvedSpecifier → importerPath) */
  specifierToImporter: Map<string, string>;
  /** Pending callbacks to await after eval (for daemon IPC fire-and-forget pattern) */
  pendingCallbacks: Promise<unknown>[];
  /** Per-runtime eval queue to prevent overlapping module linking/evaluation */
  evalChain: Promise<void>;
  /** Optional timeout for full eval/test executions */
  executionTimeout?: number;
  /** True after dispose() starts */
  isDisposed: boolean;
  /** Cached dispose promise to make disposal idempotent */
  disposePromise?: Promise<void>;
  /** Human-readable reason recorded when disposal first started */
  disposeReason?: string;
  /** Timeout budget that permanently poisoned this runtime */
  timedOutExecutionMs?: number;
}

function getConfiguredExecutionTimeout(timeoutMs?: number): number | undefined {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return timeoutMs;
}

function createTimeoutError(label: string, timeoutMs: number): Error {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function createDisposedRuntimeError(): Error {
  return new Error("Runtime has been disposed");
}

function createTimedOutRuntimeError(timeoutMs: number): Error {
  const error = new Error(
    `Runtime execution timed out after ${timeoutMs}ms; create a new runtime.`
  );
  error.name = "TimeoutError";
  return error;
}

function assertRuntimeUsable(state: RuntimeState): void {
  if (state.timedOutExecutionMs !== undefined) {
    throw createTimedOutRuntimeError(state.timedOutExecutionMs);
  }
  if (state.isDisposed) {
    throw createDisposedRuntimeError();
  }
}

interface DisposeRuntimeStateOptions {
  reason: string;
  log?: boolean;
  error?: unknown;
}

function logRuntimeDisposal(state: RuntimeState, options: DisposeRuntimeStateOptions): void {
  const message = `[isolate-runtime] Disposing runtime ${state.id}: ${options.reason}`;
  if (options.error) {
    console.error(message, options.error);
    return;
  }
  console.warn(message);
}

async function disposeRuntimeState(
  state: RuntimeState,
  options: DisposeRuntimeStateOptions = { reason: "RuntimeHandle.dispose() called", log: false },
): Promise<void> {
  if (state.disposePromise) {
    return state.disposePromise;
  }

  state.disposeReason = options.reason;
  state.isDisposed = true;
  if (options.log !== false) {
    logRuntimeDisposal(state, options);
  }
  state.disposePromise = (async () => {
    if (state.customFnInvokeRef) {
      try {
        state.customFnInvokeRef.release();
      } catch {
        // Ignore cleanup errors during disposal.
      } finally {
        state.customFnInvokeRef = undefined;
      }
    }

    const disposeHandle = (dispose: (() => void) | undefined): void => {
      if (!dispose) return;
      try {
        dispose();
      } catch {
        // Ignore cleanup errors during disposal.
      }
    };

    disposeHandle(state.handles.playwright?.dispose.bind(state.handles.playwright));
    disposeHandle(state.handles.testEnvironment?.dispose.bind(state.handles.testEnvironment));
    disposeHandle(state.handles.fs?.dispose.bind(state.handles.fs));
    disposeHandle(state.handles.fetch?.dispose.bind(state.handles.fetch));
    disposeHandle(state.handles.crypto?.dispose.bind(state.handles.crypto));
    disposeHandle(state.handles.path?.dispose.bind(state.handles.path));
    disposeHandle(state.handles.timers?.dispose.bind(state.handles.timers));
    disposeHandle(state.handles.encoding?.dispose.bind(state.handles.encoding));
    disposeHandle(state.handles.console?.dispose.bind(state.handles.console));
    disposeHandle(state.handles.core?.dispose.bind(state.handles.core));

    state.pendingCallbacks.length = 0;
    state.moduleCache.clear();
    state.moduleLoadsInFlight.clear();
    state.moduleToFilename.clear();
    state.moduleImportChain.clear();
    state.specifierToImporter.clear();
    state.sourceMaps.clear();

    try {
      state.context.release();
    } catch {
      // Ignore cleanup errors during disposal.
    }

    try {
      state.isolate.dispose();
    } catch {
      // Ignore cleanup errors during disposal.
    }
  })();

  return state.disposePromise;
}

async function runWithExecutionTimeout<T>(
  state: RuntimeState,
  timeoutMs: number | undefined,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const effectiveTimeoutMs = getConfiguredExecutionTimeout(timeoutMs);
  if (effectiveTimeoutMs === undefined) {
    return operation();
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = createTimeoutError(label, effectiveTimeoutMs);
      state.timedOutExecutionMs ??= effectiveTimeoutMs;
      void disposeRuntimeState(state, {
        reason: timeoutError.message,
        error: timeoutError,
      });
      reject(timeoutError);
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Iterator session tracking for async iterator custom functions
interface IteratorSession {
  iterator: AsyncGenerator<unknown, unknown, unknown>;
}

const iteratorSessions = new Map<number, IteratorSession>();
let nextIteratorId = 1;

/**
 * Lightweight marshalling code to inject into the isolate.
 * Converts JavaScript types to Ref objects for type-preserving serialization.
 */
const ISOLATE_MARSHAL_CODE = `
(function() {
  const __wrapAsyncContextCallback = (callback) => (
    typeof callback === 'function' && globalThis.__isolateAsyncContextInternals?.wrapCallback
      ? globalThis.__isolateAsyncContextInternals.wrapCallback(callback, { type: 'isolate.callback' })
      : callback
  );
  let __customFn_nextCallbackId = 1;
  const __customFn_callbacks = new Map();
  let __customFn_nextAsyncRefId = 1;
  const __customFn_promises = new Map();
  const __customFn_iterators = new Map();

  function __customFn_attachAsyncIterator(resultPromise, label) {
    resultPromise[Symbol.asyncIterator] = async function* () {
      const iterable = await resultPromise;
      if (iterable && typeof iterable[Symbol.asyncIterator] === 'function') {
        yield* iterable;
        return;
      }
      if (iterable && typeof iterable[Symbol.iterator] === 'function') {
        yield* iterable;
        return;
      }
      throw new TypeError(label + '(...) is not async iterable');
    };
    return resultPromise;
  }

  async function __customFn_waitForTurn() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function __customFn_registerCallback(callback) {
    const callbackId = __customFn_nextCallbackId++;
    __customFn_callbacks.set(callbackId, __wrapAsyncContextCallback(callback));
    return callbackId;
  }

  // Marshal a value (JavaScript → Ref)
  function marshalForHost(value, depth = 0) {
    if (depth > 100) throw new Error('Maximum marshalling depth exceeded');

    if (value === null) return null;
    if (value === undefined) return { __type: 'UndefinedRef' };

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return { __type: 'BigIntRef', value: value.toString() };
    if (type === 'function') {
      return {
        __type: 'CallbackRef',
        callbackId: __customFn_registerCallback(value),
        callbackKind:
          value.__isolateCallbackKind === 'asyncGenerator' ||
          (value.constructor && value.constructor.name === 'AsyncGeneratorFunction')
            ? 'asyncGenerator'
            : undefined,
      };
    }
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
      if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) {
        return { __type: 'AbortSignalRef', aborted: value.aborted };
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

  async function marshalForHostAsync(value, depth = 0) {
    if (depth > 100) throw new Error('Maximum marshalling depth exceeded');

    if (value === null || value === undefined) {
      return marshalForHost(value, depth);
    }

    const type = typeof value;
    if (
      type === 'string' ||
      type === 'number' ||
      type === 'boolean' ||
      type === 'bigint' ||
      type === 'function'
    ) {
      return marshalForHost(value, depth);
    }
    if (type === 'symbol') {
      throw new Error('Cannot marshal Symbol values');
    }

    if (value && typeof value.then === 'function') {
      return await marshalForHostAsync(await value, depth);
    }

    if (value && typeof value[Symbol.asyncIterator] === 'function') {
      const iteratorId = __customFn_nextAsyncRefId++;
      const iterator = value[Symbol.asyncIterator]();
      __customFn_iterators.set(iteratorId, iterator);

      const nextCallbackId = __customFn_registerCallback(async (id) => {
        const target = __customFn_iterators.get(id);
        if (!target) {
          throw new Error('Iterator ' + id + ' not found');
        }
        const result = await target.next();
        if (result.done) {
          __customFn_iterators.delete(id);
        }
        return {
          done: result.done,
          value: await marshalForHostAsync(result.value, depth + 1),
        };
      });

      const returnCallbackId = __customFn_registerCallback(async (id, returnValue) => {
        const target = __customFn_iterators.get(id);
        __customFn_iterators.delete(id);
        if (!target || typeof target.return !== 'function') {
          return {
            done: true,
            value: marshalForHost(undefined, depth + 1),
          };
        }
        const result = await target.return(returnValue);
        return {
          done: result.done ?? true,
          value: await marshalForHostAsync(result.value, depth + 1),
        };
      });

      const throwCallbackId = __customFn_registerCallback(async (id, errorValue) => {
        const target = __customFn_iterators.get(id);
        if (!target) {
          throw new Error('Iterator ' + id + ' not found');
        }
        if (typeof target.throw !== 'function') {
          throw Object.assign(
            new Error(errorValue?.message ?? 'Iterator does not support throw()'),
            { name: errorValue?.name ?? 'Error', stack: errorValue?.stack }
          );
        }

        try {
          const thrown = Object.assign(
            new Error(errorValue?.message ?? 'Iterator throw()'),
            { name: errorValue?.name ?? 'Error', stack: errorValue?.stack }
          );
          const result = await target.throw(thrown);
          if (result.done) {
            __customFn_iterators.delete(id);
          }
          return {
            done: result.done,
            value: await marshalForHostAsync(result.value, depth + 1),
          };
        } catch (error) {
          __customFn_iterators.delete(id);
          throw error;
        }
      });

      return {
        __type: 'AsyncIteratorRef',
        iteratorId,
        __nextCallbackId: nextCallbackId,
        __returnCallbackId: returnCallbackId,
        __throwCallbackId: throwCallbackId,
      };
    }

    if (value instanceof Date || value instanceof RegExp || value instanceof URL) {
      return marshalForHost(value, depth);
    }
    if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) {
      return marshalForHost(value, depth);
    }
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
      return marshalForHost(value, depth);
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return marshalForHost(value, depth);
    }
    if (typeof Request !== 'undefined' && value instanceof Request) {
      const headers = [];
      value.headers.forEach((headerValue, key) => headers.push([key, headerValue]));
      const body = value.body
        ? Array.from(new Uint8Array(await value.clone().arrayBuffer()))
        : null;
      return {
        __type: 'RequestRef',
        url: value.url,
        method: value.method,
        headers,
        body,
        mode: value.mode,
        credentials: value.credentials,
        cache: value.cache,
        redirect: value.redirect,
        referrer: value.referrer,
        referrerPolicy: value.referrerPolicy,
        integrity: value.integrity,
      };
    }
    if (typeof Response !== 'undefined' && value instanceof Response) {
      const headers = [];
      value.headers.forEach((headerValue, key) => headers.push([key, headerValue]));
      const body = value.body
        ? Array.from(new Uint8Array(await value.clone().arrayBuffer()))
        : null;
      return {
        __type: 'ResponseRef',
        status: value.status,
        statusText: value.statusText,
        headers,
        body,
      };
    }
    if (typeof File !== 'undefined' && value instanceof File) {
      return {
        __type: 'FileRef',
        name: value.name,
        type: value.type,
        lastModified: value.lastModified,
        data: Array.from(new Uint8Array(await value.arrayBuffer())),
      };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return {
        __type: 'FileRef',
        type: value.type,
        data: Array.from(new Uint8Array(await value.arrayBuffer())),
      };
    }
    if (typeof FormData !== 'undefined' && value instanceof FormData) {
      const entries = [];
      for (const [key, entry] of value.entries()) {
        if (typeof entry === 'string') {
          entries.push([key, entry]);
        } else {
          entries.push([key, await marshalForHostAsync(entry, depth + 1)]);
        }
      }
      return { __type: 'FormDataRef', entries };
    }
    if (Array.isArray(value)) {
      return await Promise.all(value.map((item) => marshalForHostAsync(item, depth + 1)));
    }

    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = await marshalForHostAsync(value[key], depth + 1);
    }
    return result;
  }

  async function invokeLocalCallback(callbackId, argsJson) {
    const callback = __customFn_callbacks.get(callbackId);
    if (!callback) {
      return JSON.stringify({
        ok: false,
        error: {
          message: 'Callback ' + callbackId + ' not found',
          name: 'Error',
        },
      });
    }

    try {
      const rawArgs = JSON.parse(argsJson);
      const args = unmarshalFromHost(rawArgs);
      const result = callback(...args);
      return JSON.stringify({ ok: true, value: await marshalForHostAsync(result) });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return JSON.stringify({
        ok: false,
        error: {
          message: err.message,
          name: err.name,
        },
      });
    }
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
        case 'AbortSignalRef': {
          if (value.aborted) {
            return AbortSignal.abort();
          }
          return new AbortController().signal;
        }
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
          const callbackId = value.callbackId;
          return async function(...args) {
            const argsJson = JSON.stringify(marshalForHost(args));
            const resultJson = await __customFn_invoke.apply(
              undefined,
              [callbackId, argsJson],
              { result: { promise: true, copy: true } }
            );
            const result = JSON.parse(resultJson);
            if (result.ok) {
              return unmarshalFromHost(result.value);
            }

            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          };
        }
        case 'PromiseRef': {
          const promiseId = value.promiseId;
          return (async () => {
            const argsJson = JSON.stringify([promiseId]);
            const resultJson = await __customFn_invoke.apply(
              undefined,
              [value.__resolveCallbackId, argsJson],
              { result: { promise: true, copy: true } }
            );
            const result = JSON.parse(resultJson);
            if (result.ok) {
              return unmarshalFromHost(result.value);
            }

            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          })();
        }
        case 'AsyncIteratorRef': {
          const iteratorId = value.iteratorId;
          const nextCallbackId = value.__nextCallbackId;
          const returnCallbackId = value.__returnCallbackId;
          const throwCallbackId = value.__throwCallbackId;
          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              const argsJson = JSON.stringify([iteratorId]);
              const resultJson = await __customFn_invoke.apply(
                undefined,
                [nextCallbackId, argsJson],
                { result: { promise: true, copy: true } }
              );
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              await __customFn_waitForTurn();
              return {
                done: result.value.done,
                value: unmarshalFromHost(result.value.value)
              };
            },
            async return(v) {
              const argsJson = JSON.stringify([iteratorId, marshalForHost(v)]);
              const resultJson = await __customFn_invoke.apply(
                undefined,
                [returnCallbackId, argsJson],
                { result: { promise: true, copy: true } }
              );
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              await __customFn_waitForTurn();
              return {
                done: result.value.done ?? true,
                value: unmarshalFromHost(result.value.value ?? result.value),
              };
            },
            async throw(e) {
              if (throwCallbackId == null) {
                throw e;
              }
              const errorValue = e && typeof e === 'object'
                ? { message: e.message, name: e.name, stack: e.stack }
                : { message: String(e), name: 'Error' };
              const argsJson = JSON.stringify([iteratorId, errorValue]);
              const resultJson = await __customFn_invoke.apply(
                undefined,
                [throwCallbackId, argsJson],
                { result: { promise: true, copy: true } }
              );
              const result = JSON.parse(resultJson);
              if (!result.ok) {
                const error = new Error(result.error.message);
                error.name = result.error.name;
                throw error;
              }
              await __customFn_waitForTurn();
              return {
                done: result.value.done,
                value: unmarshalFromHost(result.value.value),
              };
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

  // Expose as globals
  globalThis.__marshalForHost = marshalForHost;
  globalThis.__unmarshalFromHost = unmarshalFromHost;
  globalThis.__customFn_invokeLocalCallback = invokeLocalCallback;
  globalThis.__customFn_attachAsyncIterator = __customFn_attachAsyncIterator;
  globalThis.__customFn_waitForTurn = __customFn_waitForTurn;
})();
`;

// CustomFunctionsMarshalOptions is exported at the top of the file

/**
 * Setup custom functions as globals in the isolate context.
 * Each function directly calls the host callback when invoked.
 *
 * When marshalOptions is provided, returned values are marshalled with a MarshalContext,
 * enabling proper proxying of callbacks/promises/iterators across boundaries.
 */
async function setupCustomFunctions(
  context: ivm.Context,
  customFunctions: CustomFunctions,
  marshalOptions?: CustomFunctionsMarshalOptions,
): Promise<ivm.Reference<(name: string, argsJson: string) => Promise<string>>> {
  const global = context.global;
  const isolateUnmarshalContext: UnmarshalContext = {};

  // Reference that invokes the callback and returns the result.
  // The first argument can be a string function name (for custom functions) or a
  // numeric callback ID (for returned callbacks/promises/iterators from marshal).
  const invokeCallbackRef = new ivm.Reference(
    async (nameOrId: string | number, argsJson: string): Promise<string> => {
      // Check if this is a local callback ID (numeric, used by returned callbacks/promises/iterators)
      if (typeof nameOrId === "number" && marshalOptions) {
        const rawArgs = JSON.parse(argsJson) as unknown[];
        const args = unmarshalValue(rawArgs, isolateUnmarshalContext) as unknown[];
        try {
          const result = await marshalOptions.invokeCallback(nameOrId, args);
          const ctx = marshalOptions.createMarshalContext();
          const marshalledResult = await marshalValue(result, ctx);
          const processedResult = marshalOptions.addCallbackIdsToRefs(marshalledResult);
          return JSON.stringify({ ok: true, value: processedResult });
        } catch (error: unknown) {
          const err = error as Error;
          return JSON.stringify({
            ok: false,
            error: { message: err.message, name: err.name },
          });
        }
      }

      const name = String(nameOrId);
      const def = customFunctions[name];
      if (!def) {
        return JSON.stringify({
          ok: false,
          error: {
            message: `Custom function '${name}' not found`,
            name: "Error",
          },
        });
      }
      // Unmarshal args from isolate (converts Refs back to JavaScript types)
      const rawArgs = JSON.parse(argsJson) as unknown[];
      const args = unmarshalValue(rawArgs, isolateUnmarshalContext) as unknown[];
      try {
        // Always await the result: for daemon-bridged functions, even "sync" custom functions
        // are async due to IPC, so we need to resolve the promise.
        const result = await def.fn(...args);
        // Marshal result for isolate (converts JavaScript types to Refs)
        if (marshalOptions) {
          const ctx = marshalOptions.createMarshalContext();
          const marshalledResult = await marshalValue(result, ctx);
          const processedResult = marshalOptions.addCallbackIdsToRefs(marshalledResult);
          return JSON.stringify({ ok: true, value: processedResult });
        }
        const marshalledResult = await marshalValue(result);
        return JSON.stringify({ ok: true, value: marshalledResult });
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
  const invokeIsolateCallbackRef = context.global.getSync(
    "__customFn_invokeLocalCallback",
    { reference: true },
  ) as ivm.Reference<(callbackId: number, argsJson: string) => Promise<string>>;

  const normalizeIsolateCallbackResult = async (
    value: unknown,
  ): Promise<unknown> => {
    if (typeof Response !== "undefined" && value instanceof Response) {
      const headers: Array<[string, string]> = [];
      value.headers.forEach((headerValue, key) => {
        headers.push([key, headerValue]);
      });
      const body = value.body
        ? Array.from(new Uint8Array(await value.clone().arrayBuffer()))
        : null;
      return {
        __type: "ResponseRef",
        status: value.status,
        statusText: value.statusText,
        headers,
        body,
      };
    }

    return value;
  };

  isolateUnmarshalContext.getCallback = (callbackId: number) => {
    return async (...args: unknown[]) => {
      let marshalledArgs: unknown;
      if (marshalOptions) {
        const ctx = marshalOptions.createMarshalContext();
        marshalledArgs = await marshalValue(args, ctx);
        marshalledArgs = marshalOptions.addCallbackIdsToRefs(marshalledArgs);
      } else {
        marshalledArgs = await marshalValue(args);
      }

      const resultJson = await invokeIsolateCallbackRef.apply(
        undefined,
        [callbackId, JSON.stringify(marshalledArgs)],
        { result: { promise: true, copy: true } },
      ) as string;
      const result = JSON.parse(resultJson) as {
        ok: boolean;
        value?: unknown;
        error?: { message?: string; name?: string };
      };

      if (result.ok) {
        const unmarshalled = unmarshalValue(result.value, isolateUnmarshalContext);
        return await normalizeIsolateCallbackResult(unmarshalled);
      }

      const error = new Error(result.error?.message ?? `Callback ${callbackId} failed`);
      error.name = result.error?.name ?? "Error";
      throw error;
    };
  };

  isolateUnmarshalContext.createPromiseProxy = (
    promiseId: number,
    ref?: { __resolveCallbackId?: number },
  ) => {
    const resolveCallbackId = ref?.__resolveCallbackId;
    if (typeof resolveCallbackId !== "number") {
      throw new Error(`Promise ${promiseId} is missing a resolve callback`);
    }

    return (async () => {
      const resultJson = await invokeIsolateCallbackRef.apply(
        undefined,
        [resolveCallbackId, JSON.stringify([promiseId])],
        { result: { promise: true, copy: true } },
      ) as string;
      const result = JSON.parse(resultJson) as {
        ok: boolean;
        value?: unknown;
        error?: { message?: string; name?: string };
      };

      if (result.ok) {
        return unmarshalValue(result.value, isolateUnmarshalContext);
      }

      const error = new Error(
        result.error?.message ?? `Promise ${promiseId} failed`,
      );
      error.name = result.error?.name ?? "Error";
      throw error;
    })();
  };

  isolateUnmarshalContext.createIteratorProxy = (
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
      const resultJson = await invokeIsolateCallbackRef.apply(
        undefined,
        [callbackId, JSON.stringify(args)],
        { result: { promise: true, copy: true } },
      ) as string;
      const result = JSON.parse(resultJson) as {
        ok: boolean;
        value?: unknown;
        error?: { message?: string; name?: string };
      };

      if (result.ok) {
        return result.value as { done?: boolean; value?: unknown };
      }

      const error = new Error(
        result.error?.message ?? `${label} failed for iterator ${iteratorId}`,
      );
      error.name = result.error?.name ?? "Error";
      throw error;
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
          value: unmarshalValue(result.value, isolateUnmarshalContext),
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
          value: unmarshalValue(result.value, isolateUnmarshalContext),
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
          value: unmarshalValue(result.value, isolateUnmarshalContext),
        };
      },
    };
  };

  // Create wrapper functions for each custom function
  for (const name of Object.keys(customFunctions)) {
    const def = customFunctions[name]!;

    if (def.type === "async") {
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const resultPromise = (async () => {
            const marshalledArgs = __marshalForHost(args);
            const resultJson = await __customFn_invoke.apply(
              undefined,
              ["${name}", JSON.stringify(marshalledArgs)],
              { result: { promise: true, copy: true } }
            );
            const result = JSON.parse(resultJson);
            if (result.ok) {
              await __customFn_waitForTurn();
              return __unmarshalFromHost(result.value);
            }
            const error = new Error(result.error.message);
            error.name = result.error.name;
            throw error;
          })();
          return __customFn_attachAsyncIterator(resultPromise, "${name}");
        };
      `);
    } else if (def.type === "sync") {
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const marshalledArgs = __marshalForHost(args);
          const resultJson = __customFn_invoke.applySync(
            undefined,
            ["${name}", JSON.stringify(marshalledArgs)],
            { result: { copy: true } }
          );
          const result = JSON.parse(resultJson);
          if (result.ok) {
            return __unmarshalFromHost(result.value);
          }
          const error = new Error(result.error.message);
          error.name = result.error.name;
          throw error;
        };
      `);
    } else if (def.type === "asyncIterator") {
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const marshalledArgs = __marshalForHost(args);
          const iteratorPromise = (async () => {
            const resultJson = await __customFn_invoke.apply(
              undefined,
              ["${name}", JSON.stringify(marshalledArgs)],
              { result: { promise: true, copy: true } }
            );
            const result = JSON.parse(resultJson);
            if (result.ok) {
              return __unmarshalFromHost(result.value);
            }
            throw Object.assign(new Error(result.error.message), {
              name: result.error.name,
            });
          })();
          let iteratorRef;
          const getIterator = async () => {
            if (!iteratorRef) {
              let iterator = await iteratorPromise;
              for (let depth = 0; depth < 4; depth += 1) {
                if (iterator && typeof iterator.next === 'function') {
                  break;
                }
                if (!iterator || typeof iterator[Symbol.asyncIterator] !== 'function') {
                  break;
                }
                iterator = iterator[Symbol.asyncIterator]();
              }
              iteratorRef = iterator;
            }
            return iteratorRef;
          };
          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              const iterator = await getIterator();
              if (!iterator || typeof iterator.next !== 'function') {
                throw new TypeError('Custom async iterator resolved to a non-iterator');
              }
              return iterator.next();
            },
            async return(v) {
              const iterator = await getIterator();
              return iterator.return ? iterator.return(v) : { done: true, value: v };
            },
            async throw(e) {
              const iterator = await getIterator();
              if (!iterator.throw) {
                throw e;
              }
              return iterator.throw(e);
            }
          };
        };
      `);
    }
  }

  return invokeCallbackRef;
}

/**
 * Create local marshal options for standalone runtime custom functions.
 * Enables returned callbacks/promises/iterators without daemon IPC.
 */
function createLocalCustomFunctionsMarshalOptions(): CustomFunctionsMarshalOptions {
  const returnedCallbacks = new Map<number, Function>();
  const returnedPromises = new Map<number, Promise<unknown>>();
  const returnedIterators = new Map<number, AsyncIterator<unknown>>();
  let nextLocalCallbackId = 1_000_000;

  const createMarshalContext = (): MarshalContext => ({
    registerCallback: (fn: Function): number => {
      const callbackId = nextLocalCallbackId++;
      returnedCallbacks.set(callbackId, fn);
      return callbackId;
    },
    registerPromise: (promise: Promise<unknown>): number => {
      const promiseId = nextLocalCallbackId++;
      returnedPromises.set(promiseId, promise);
      return promiseId;
    },
    registerIterator: (iterator: AsyncIterator<unknown>): number => {
      const iteratorId = nextLocalCallbackId++;
      returnedIterators.set(iteratorId, iterator);
      return iteratorId;
    },
  });

  const isPromiseRef = (
    value: unknown
  ): value is { __type: "PromiseRef"; promiseId: number } =>
    typeof value === "object" &&
    value !== null &&
    (value as { __type?: string }).__type === "PromiseRef";

  const isAsyncIteratorRef = (
    value: unknown
  ): value is { __type: "AsyncIteratorRef"; iteratorId: number } =>
    typeof value === "object" &&
    value !== null &&
    (value as { __type?: string }).__type === "AsyncIteratorRef";

  const addCallbackIdsToRefs = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;

    if (isPromiseRef(value)) {
      if ("__resolveCallbackId" in value) return value;

      const resolveCallbackId = nextLocalCallbackId++;
      returnedCallbacks.set(resolveCallbackId, async (promiseId: number) => {
        const promise = returnedPromises.get(promiseId);
        if (!promise) {
          throw new Error(`Promise ${promiseId} not found`);
        }
        const result = await promise;
        returnedPromises.delete(promiseId);
        const ctx = createMarshalContext();
        const marshalled = await marshalValue(result, ctx);
        return addCallbackIdsToRefs(marshalled);
      });

      return { ...value, __resolveCallbackId: resolveCallbackId };
    }

    if (isAsyncIteratorRef(value)) {
      if ("__nextCallbackId" in value) return value;

      const nextCallbackId = nextLocalCallbackId++;
      returnedCallbacks.set(nextCallbackId, async (iteratorId: number) => {
        const iterator = returnedIterators.get(iteratorId);
        if (!iterator) {
          throw new Error(`Iterator ${iteratorId} not found`);
        }
        const result = await iterator.next();
        if (result.done) {
          returnedIterators.delete(iteratorId);
        }
        const ctx = createMarshalContext();
        const marshalledValue = await marshalValue(result.value, ctx);
        return {
          done: result.done,
          value: addCallbackIdsToRefs(marshalledValue),
        };
      });

      const returnCallbackId = nextLocalCallbackId++;
      returnedCallbacks.set(
        returnCallbackId,
        async (iteratorId: number, returnValue?: unknown) => {
          const iterator = returnedIterators.get(iteratorId);
          returnedIterators.delete(iteratorId);
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
        }
      );

      const throwCallbackId = nextLocalCallbackId++;
      returnedCallbacks.set(
        throwCallbackId,
        async (
          iteratorId: number,
          errorValue?: { message?: string; name?: string; stack?: string },
        ) => {
          const iterator = returnedIterators.get(iteratorId);
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
            const result = await iterator.throw(thrownError);
            if (result.done) {
              returnedIterators.delete(iteratorId);
            }
            const ctx = createMarshalContext();
            const marshalledValue = await marshalValue(result.value, ctx);
            return {
              done: result.done,
              value: addCallbackIdsToRefs(marshalledValue),
            };
          } catch (error) {
            returnedIterators.delete(iteratorId);
            throw error;
          }
        },
      );

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

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = addCallbackIdsToRefs(
        (value as Record<string, unknown>)[key]
      );
    }
    return result;
  };

  const invokeCallback = async (
    callbackId: number,
    args: unknown[]
  ): Promise<unknown> => {
    const callback = returnedCallbacks.get(callbackId);
    if (!callback) {
      throw new Error(`Local callback ${callbackId} not found`);
    }
    return await callback(...args);
  };

  return { createMarshalContext, addCallbackIdsToRefs, invokeCallback };
}

/**
 * Create a module resolver function for local execution.
 */
function createModuleResolver(
  state: RuntimeState
): (specifier: string, referrer: ivm.Module) => Promise<ivm.Module> {
  return async (
    specifier: string,
    referrer: ivm.Module
  ): Promise<ivm.Module> => {
    // Get importer info
    const importerPath = state.moduleToFilename.get(referrer) ?? "<unknown>";
    const importerResolveDir = path.posix.dirname(importerPath);
    const importerStack = state.moduleImportChain.get(importerPath) ?? [];

    // Resolve relative specifiers to absolute-like paths for cache key uniqueness.
    // This prevents cross-package collisions (e.g. two different packages both importing "./utils.js").
    const resolvedSpecifier = specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(importerResolveDir, specifier))
      : specifier;

    // Track who imports this specifier (for error diagnostics)
    state.specifierToImporter.set(resolvedSpecifier, importerPath);

    // Static cache first
    const staticCached = state.staticModuleCache.get(resolvedSpecifier);
    if (staticCached) return staticCached;

    const cached = state.moduleCache.get(resolvedSpecifier);
    if (cached) return cached;

    if (!state.moduleLoader) {
      throw new Error(
        `No module loader registered. Cannot import: ${specifier}`
      );
    }

    // Invoke module loader - capture full result including static flag
    const result = await state.moduleLoader(specifier, {
      path: importerPath,
      resolveDir: importerResolveDir,
    });
    const { code, resolveDir } = result;

    // Validate filename: must be a basename (no slashes)
    if (result.filename.includes('/')) {
      throw new Error(
        `moduleLoader returned a filename with slashes: "${result.filename}". ` +
        `filename must be a basename (e.g. "utils.js"), not a path.`
      );
    }

    // Construct resolved filename using result.filename
    const resolvedFilename = path.posix.join(resolveDir, result.filename);

    // Cache by specifier + content hash (allows invalidation when content changes)
    const hash = contentHash(code);
    const cacheKey = `${resolvedSpecifier}:${hash}`;
    const inFlightKey = `${result.static ? "static" : "dynamic"}:${cacheKey}`;

    // Cache checks again after await in case another resolver call won the race
    const staticCachedAfterLoad = state.staticModuleCache.get(resolvedSpecifier);
    if (staticCachedAfterLoad) return staticCachedAfterLoad;

    const cachedAfterLoad = state.moduleCache.get(resolvedSpecifier);
    if (cachedAfterLoad) return cachedAfterLoad;

    const hashCached = state.moduleCache.get(cacheKey);
    if (hashCached) return hashCached;

    const inFlight = state.moduleLoadsInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const loadPromise = (async (): Promise<ivm.Module> => {
      let mod: ivm.Module | undefined;
      try {
        // Transform cache — check transform cache first (survives reuse in daemon)
        let transformed: TransformResult | undefined = state.transformCache.get(hash);
        if (!transformed) {
          transformed = await transformModuleCode(code, resolvedSpecifier);
          state.transformCache.set(hash, transformed);
        }

        if (transformed.sourceMap) {
          state.sourceMaps.set(resolvedSpecifier, transformed.sourceMap);
        }

        // Compile the module using resolvedSpecifier as filename
        mod = await state.isolate.compileModule(transformed.code, {
          filename: resolvedSpecifier,
        });

        // Track resolved filename for nested imports
        state.moduleToFilename.set(mod, resolvedFilename);

        // Track import chain for error diagnostics
        state.moduleImportChain.set(resolvedFilename, [...importerStack, importerPath]);

        // Cache the compiled module before linker uses it (supports circular deps)
        if (result.static) {
          state.staticModuleCache.set(resolvedSpecifier, mod);
        } else {
          state.moduleCache.set(resolvedSpecifier, mod);
          state.moduleCache.set(cacheKey, mod);
        }

        return mod;
      } catch (err) {
        // Annotate error with module resolution context
        const error = err instanceof Error ? err : new Error(String(err));
        error.message = `Failed to compile module "${resolvedSpecifier}" (imported by "${importerPath}"):\n${error.message}`;
        if (importerStack.length > 0) {
          error.message += `\n\nImport chain:\n  ${[...importerStack, importerPath].join('\n    -> ')}`;
        }

        // Remove partial cache state to avoid returning poisoned module entries later.
        if (mod) {
          state.moduleToFilename.delete(mod);
          if (result.static) {
            if (state.staticModuleCache.get(resolvedSpecifier) === mod) {
              state.staticModuleCache.delete(resolvedSpecifier);
            }
          } else {
            if (state.moduleCache.get(resolvedSpecifier) === mod) {
              state.moduleCache.delete(resolvedSpecifier);
            }
            if (state.moduleCache.get(cacheKey) === mod) {
              state.moduleCache.delete(cacheKey);
            }
          }
        }
        throw error;
      }
    })();

    state.moduleLoadsInFlight.set(inFlightKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      state.moduleLoadsInFlight.delete(inFlightKey);
    }
  };
}

/**
 * Convert FetchCallback to FetchOptions
 */
function convertFetchCallback(callback?: FetchCallback): FetchOptions {
  if (!callback) {
    return {};
  }
  return {
    onFetch: async (url: string, init: FetchRequestInit): Promise<Response> => {
      // Wrap the result in a Promise to handle both sync and async callbacks
      return Promise.resolve(callback(url, init));
    },
  };
}

/**
 * Create a fully configured isolated-vm runtime
 *
 * Sets up all WHATWG APIs: fetch, fs, console, crypto, encoding, timers
 *
 * @example
 * const runtime = await createRuntime({
 *   console: { log: (...args) => console.log("[isolate]", ...args) },
 *   fetch: async (request) => fetch(request),
 * });
 *
 * await runtime.eval(`
 *   console.log("Hello from sandbox!");
 *   const response = await fetch("https://example.com");
 * `);
 *
 * await runtime.dispose();
 */
export async function createRuntime<T extends Record<string, any[]> = Record<string, unknown[]>>(
  options?: RuntimeOptions<T>
): Promise<RuntimeHandle> {
  const opts = options ?? {};

  // Generate unique ID
  const id = crypto.randomUUID();

  // Create isolate with optional memory limit
  const isolate = new ivm.Isolate({
    memoryLimit: opts.memoryLimitMB,
  });
  const context = await isolate.createContext({
    asyncContext: true,
  } as any);

  // Initialize state
  const state: RuntimeState = {
    id,
    isolate,
    context,
    handles: {},
    moduleCache: new Map(),
    staticModuleCache: new Map(),
    moduleLoadsInFlight: new Map(),
    transformCache: new Map(),
    moduleToFilename: new Map(),
    sourceMaps: new Map(),
    moduleImportChain: new Map(),
    specifierToImporter: new Map(),
    pendingCallbacks: [],
    evalChain: Promise.resolve(),
    executionTimeout: getConfiguredExecutionTimeout(opts.executionTimeout),
    isDisposed: false,
    moduleLoader: opts.moduleLoader,
    customFunctions: opts.customFunctions as CustomFunctions<Record<string, unknown[]>>,
  };

  // Setup all APIs in order
  await setupAsyncContext(context);

  // Core must be first as it provides Blob, File, streams, URL, etc.
  state.handles.core = await setupCore(context);

  // Console
  state.handles.console = await setupConsole(context, opts.console);

  // Encoding (btoa/atob) and Buffer
  state.handles.encoding = await setupEncoding(context);

  // Timers (setTimeout, setInterval)
  state.handles.timers = await setupTimers(context);

  // Path module
  state.handles.path = await setupPath(context, { cwd: opts.cwd });

  // Crypto (randomUUID, getRandomValues)
  state.handles.crypto = await setupCrypto(context);

  // Fetch API - convert callback to options
  state.handles.fetch = await setupFetch(
    context,
    convertFetchCallback(opts.fetch)
  );

  // File system (only if handler provided)
  if (opts.fs) {
    state.handles.fs = await setupFs(context, opts.fs);
  }

  // Setup custom functions
  if (opts.customFunctions) {
    const customMarshalOptions =
      opts.customFunctionsMarshalOptions ??
      createLocalCustomFunctionsMarshalOptions();

    state.customFnInvokeRef = await setupCustomFunctions(
      context,
      opts.customFunctions as CustomFunctions<Record<string, unknown[]>>,
      customMarshalOptions,
    );
  }

  // Setup test environment (if enabled)
  if (opts.testEnvironment) {
    const testEnvOptions: TestEnvironmentOptions | undefined =
      typeof opts.testEnvironment === "object"
        ? opts.testEnvironment
        : undefined;
    state.handles.testEnvironment = await setupTestEnvironment(
      context,
      testEnvOptions
    );
  }

  // Setup playwright - AFTER test environment so expect can be extended
  if (opts.playwright) {
    if (!opts.playwright.handler) {
      throw new Error(
        "Playwright configured without handler. Provide playwright.handler in createRuntime options."
      );
    }

    // Determine event handler
    // If console: true and we have a console handler, wrap onEvent to route browser logs
    let eventCallback = opts.playwright.onEvent;

    if (opts.playwright.console && opts.console?.onEntry) {
      const originalCallback = eventCallback;
      const consoleHandler = opts.console.onEntry;
      eventCallback = (event) => {
        // Call original callback if provided
        if (originalCallback) {
          originalCallback(event);
        }
        // Route browser console logs through console handler as browserOutput entry
        if (event.type === "browserConsoleLog") {
          consoleHandler({
            type: "browserOutput",
            level: event.level,
            stdout: event.stdout,
            location: event.location,
            timestamp: event.timestamp,
          });
        }
      };
    }

    const playwrightSetupOptions: PlaywrightSetupOptions = {
      handler: opts.playwright.handler,
      hasDefaultPage: opts.playwright.hasDefaultPage,
      timeout: opts.playwright.timeout,
      // Don't print directly if routing through console handler
      console: opts.playwright.console && !opts.console?.onEntry,
      onEvent: eventCallback,
    };

    state.handles.playwright = await setupPlaywright(context, playwrightSetupOptions);
  }

  const ensureRuntimeUsable = (): void => {
    assertRuntimeUsable(state);
  };

  // Create fetch handle wrapper
  const fetchHandle: RuntimeFetchHandle = {
    async dispatchRequest(
      request: Request,
      options?: DispatchRequestOptions
    ): Promise<Response> {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.dispatchRequest(request, options);
    },
    getUpgradeRequest() {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.getUpgradeRequest();
    },
    dispatchWebSocketOpen(connectionId: string) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketOpen(connectionId);
    },
    dispatchWebSocketMessage(
      connectionId: string,
      message: string | ArrayBuffer
    ) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketMessage(connectionId, message);
    },
    dispatchWebSocketClose(connectionId: string, code: number, reason: string) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketClose(connectionId, code, reason);
    },
    dispatchWebSocketError(connectionId: string, error: Error) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketError(connectionId, error);
    },
    onWebSocketCommand(callback: (cmd: WebSocketCommand) => void) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.onWebSocketCommand(callback);
    },
    hasServeHandler() {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.hasServeHandler();
    },
    hasActiveConnections() {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.hasActiveConnections();
    },
    dispatchClientWebSocketOpen(socketId: string, protocol: string, extensions: string) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchClientWebSocketOpen(socketId, protocol, extensions);
    },
    dispatchClientWebSocketMessage(socketId: string, data: string | ArrayBuffer) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchClientWebSocketMessage(socketId, data);
    },
    dispatchClientWebSocketClose(socketId: string, code: number, reason: string, wasClean: boolean) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchClientWebSocketClose(socketId, code, reason, wasClean);
    },
    dispatchClientWebSocketError(socketId: string) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchClientWebSocketError(socketId);
    },
    onClientWebSocketCommand(callback: (cmd: ClientWebSocketCommand) => void) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.onClientWebSocketCommand(callback);
    },
    onEvent(callback: (event: string, payload: unknown) => void) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.onEvent(callback);
    },
    dispatchEvent(event: string, payload: unknown) {
      ensureRuntimeUsable();
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchEvent(event, payload);
    },
  };

  // Create timers handle wrapper
  const timersHandle: RuntimeTimersHandle = {
    clearAll() {
      ensureRuntimeUsable();
      state.handles.timers?.clearAll();
    },
  };

  // Create console handle wrapper
  const consoleHandle: RuntimeConsoleHandle = {
    reset() {
      ensureRuntimeUsable();
      state.handles.console?.reset();
    },
    getTimers() {
      ensureRuntimeUsable();
      return state.handles.console?.getTimers() ?? new Map();
    },
    getCounters() {
      ensureRuntimeUsable();
      return state.handles.console?.getCounters() ?? new Map();
    },
    getGroupDepth() {
      ensureRuntimeUsable();
      return state.handles.console?.getGroupDepth() ?? 0;
    },
  };

  // Create test environment handle wrapper
  const testEnvironmentHandle: RuntimeTestEnvironmentHandle = {
    async runTests(timeout?: number): Promise<RunResults> {
      ensureRuntimeUsable();
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }

      const executionTimeout = timeout ?? state.executionTimeout;
      return runWithExecutionTimeout(
        state,
        executionTimeout,
        "Test",
        async () => {
          return runTestsInContext(state.context);
        },
      );
    },
    hasTests(): boolean {
      ensureRuntimeUsable();
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }
      return hasTestsInContext(state.context);
    },
    getTestCount(): number {
      ensureRuntimeUsable();
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }
      return getTestCountInContext(state.context);
    },
    reset() {
      ensureRuntimeUsable();
      state.handles.testEnvironment?.dispose();
    },
  };

  // Create playwright handle wrapper
  const playwrightHandle: RuntimePlaywrightHandle = {
    getCollectedData(): CollectedData {
      ensureRuntimeUsable();
      if (!state.handles.playwright) {
        throw new Error(
          "Playwright not configured. Provide playwright.handler in createRuntime options."
        );
      }
      return {
        browserConsoleLogs: state.handles.playwright.getBrowserConsoleLogs(),
        pageErrors: state.handles.playwright.getPageErrors(),
        networkRequests: state.handles.playwright.getNetworkRequests(),
        networkResponses: state.handles.playwright.getNetworkResponses(),
        requestFailures: state.handles.playwright.getRequestFailures(),
      };
    },
    getTrackedResources() {
      ensureRuntimeUsable();
      if (!state.handles.playwright) {
        throw new Error(
          "Playwright not configured. Provide playwright.handler in createRuntime options."
        );
      }
      return state.handles.playwright.getTrackedResources();
    },
    clearCollectedData() {
      ensureRuntimeUsable();
      state.handles.playwright?.clearCollected();
    },
  };

  return {
    id,
    pendingCallbacks: state.pendingCallbacks,

    // Module handles
    fetch: fetchHandle,
    timers: timersHandle,
    console: consoleHandle,
    testEnvironment: testEnvironmentHandle,
    playwright: playwrightHandle,

    async eval(
      code: string,
      filenameOrOptions?: string | EvalOptions
    ): Promise<void> {
      const options =
        typeof filenameOrOptions === "string"
          ? { filename: filenameOrOptions }
          : filenameOrOptions;
      const executionTimeout = options?.executionTimeout ?? state.executionTimeout;

      const runEval = async (): Promise<void> => {
        assertRuntimeUsable(state);

        // Normalize filename to absolute path for module resolution
        const filename = normalizeEntryFilename(options?.filename);

        try {
          await runWithExecutionTimeout(
            state,
            executionTimeout,
            "Execution",
            async () => {
              // Transform entry code: strip types, validate, wrap in async function
              const transformed = await transformEntryCode(code, filename);
              if (transformed.sourceMap) {
                state.sourceMaps.set(filename, transformed.sourceMap);
              }

              // Compile as ES module
              const mod = await state.isolate.compileModule(transformed.code, {
                filename,
              });

              // Track entry module filename and import chain
              state.moduleToFilename.set(mod, filename);
              state.moduleImportChain.set(filename, []);

              // Instantiate with module resolver
              const resolver = createModuleResolver(state);
              try {
                await mod.instantiate(state.context, resolver);
              } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));

                // Extract failing module specifier and export name from V8 error
                // e.g. "The requested module './foo' does not provide an export named 'Bar'"
                const specifierMatch = error.message.match(/The requested module '([^']+)'/);
                const exportMatch = error.message.match(/export named '([^']+)'/);
                const failingSpecifier = specifierMatch?.[1];
                const failingExport = exportMatch?.[1];

                // Find which file imports the failing specifier
                const importerFile = failingSpecifier
                  ? state.specifierToImporter.get(failingSpecifier)
                  : undefined;

                // Build the full import chain from entry → importer → failing module
                const details: string[] = [];

                if (importerFile) {
                  const chain = state.moduleImportChain.get(importerFile) ?? [];
                  const fullChain = [...chain, importerFile];
                  if (failingSpecifier) fullChain.push(failingSpecifier);
                  const trimmed = fullChain.length > 12 ? fullChain.slice(-12) : fullChain;
                  const prefix = fullChain.length > 12 ? "  ...\n" : "";
                  details.push(`Import chain:\n${prefix}${trimmed.map((p) => `  ${p}`).join("\n    -> ")}`);
                } else if (failingSpecifier) {
                  // Fallback: search moduleImportChain for any path containing the specifier
                  for (const [modPath, chain] of state.moduleImportChain) {
                    if (modPath.includes(failingSpecifier) || modPath.endsWith(failingSpecifier)) {
                      const fullChain = [...chain, modPath];
                      const trimmed = fullChain.length > 12 ? fullChain.slice(-12) : fullChain;
                      details.push(`Import chain:\n${trimmed.map((p) => `  ${p}`).join("\n    -> ")}`);
                      break;
                    }
                  }
                }

                if (failingExport && failingSpecifier) {
                  details.push(
                    `Hint: If '${failingExport}' is a TypeScript type/interface, use \`import type\` to prevent it from being resolved at runtime:\n` +
                    `  import type { ${failingExport} } from '${failingSpecifier}';`
                  );
                }

                const suffix = details.length > 0 ? "\n\n" + details.join("\n\n") : "";
                error.message = `Module instantiation failed: ${error.message}${suffix}`;
                throw error;
              }

              await mod.evaluate();

              const ns = mod.namespace;
              const runRef = await ns.get("default", { reference: true });
              try {
                await runRef.apply(undefined, [], {
                  result: { promise: true },
                });
              } finally {
                runRef.release();
              }

              if (state.pendingCallbacks.length > 0) {
                await Promise.all(state.pendingCallbacks);
                state.pendingCallbacks.length = 0;
              }
            },
          );
        } catch (err) {
          const error = err as Error;
          if (error.stack && state.sourceMaps.size > 0) {
            error.stack = mapErrorStack(error.stack, state.sourceMaps);
          }
          throw error;
        }
      };

      const queuedEval = state.evalChain.then(runEval, runEval);
      state.evalChain = queuedEval.then(
        () => undefined,
        () => undefined
      );
      return queuedEval;
    },

    clearModuleCache() {
      ensureRuntimeUsable();
      state.moduleCache.clear();
      state.moduleLoadsInFlight.clear();
      state.moduleToFilename.clear();
      state.moduleImportChain.clear();
      state.specifierToImporter.clear();
      state.sourceMaps.clear();
      // staticModuleCache and transformCache intentionally preserved
    },

    async dispose(): Promise<void> {
      await disposeRuntimeState(state);
    },
  };
}

// Re-export all package types and functions
export { setupCore } from "../core/index.ts";
export type { CoreHandle, SetupCoreOptions } from "../core/index.ts";

export { setupConsole } from "../console/index.ts";
export {
  simpleConsoleHandler,
  type SimpleConsoleCallbacks,
} from "../console/utils.ts";
export type {
  ConsoleHandle,
  ConsoleOptions,
  ConsoleEntry as ConsoleEntryFromConsole,
} from "../console/index.ts";

export { setupCrypto } from "../crypto/index.ts";
export type { CryptoHandle } from "../crypto/index.ts";

export { setupEncoding } from "../encoding/index.ts";
export type { EncodingHandle } from "../encoding/index.ts";

export { setupFetch } from "../fetch/index.ts";
export type {
  FetchHandle,
  FetchOptions,
  WebSocketCommand,
  UpgradeRequest,
  ClientWebSocketCommand,
} from "../fetch/index.ts";

export { setupFs, createNodeFileSystemHandler } from "../fs/index.ts";
export type {
  FsHandle,
  FsOptions,
  FileSystemHandler,
  NodeFileSystemHandlerOptions,
} from "../fs/index.ts";

export { setupPath } from "../path/index.ts";
export type { PathHandle, PathOptions } from "../path/index.ts";

export { setupTimers } from "../timers/index.ts";
export type { TimersHandle } from "../timers/index.ts";

export {
  setupTestEnvironment,
  runTests,
  hasTests,
  getTestCount,
} from "../test-environment/index.ts";
export type {
  TestEnvironmentHandle,
  TestEnvironmentOptions,
  RunResults,
  TestResult,
  TestInfo,
  TestError,
  TestEvent,
  SuiteInfo,
  SuiteResult,
} from "../test-environment/index.ts";

export {
  setupPlaywright,
  createPlaywrightHandler,
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
} from "../playwright/index.ts";
export type {
  PlaywrightHandle,
  PlaywrightSetupOptions,
  PlaywrightCallback,
  PlaywrightEvent,
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PageErrorInfo,
  RequestFailureInfo,
} from "../playwright/index.ts";
