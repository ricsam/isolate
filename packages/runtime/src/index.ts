import ivm from "isolated-vm";
import path from "node:path";
import { setupCore } from "@ricsam/isolate-core";
import { normalizeEntryFilename } from "@ricsam/isolate-protocol";
import {
  transformEntryCode,
  transformModuleCode,
  contentHash,
  mapErrorStack,
  type SourceMap,
  type TransformResult,
} from "@ricsam/isolate-transform";

// Re-export for convenience
export { normalizeEntryFilename } from "@ricsam/isolate-protocol";
import { setupConsole } from "@ricsam/isolate-console";
import { setupEncoding } from "@ricsam/isolate-encoding";
import { setupTimers } from "@ricsam/isolate-timers";
import { setupPath } from "@ricsam/isolate-path";
import { setupCrypto } from "@ricsam/isolate-crypto";
import { setupFetch } from "@ricsam/isolate-fetch";
import { setupFs } from "@ricsam/isolate-fs";
import {
  setupTestEnvironment,
  runTests as runTestsInContext,
  hasTests as hasTestsInContext,
  getTestCount as getTestCountInContext,
} from "@ricsam/isolate-test-environment";
import { setupPlaywright } from "@ricsam/isolate-playwright";

import type { ConsoleOptions, ConsoleHandle } from "@ricsam/isolate-console";
import type {
  FetchOptions,
  FetchHandle,
  DispatchRequestOptions,
  UpgradeRequest,
  WebSocketCommand,
} from "@ricsam/isolate-fetch";
import type { FsOptions, FsHandle } from "@ricsam/isolate-fs";
import type { CoreHandle } from "@ricsam/isolate-core";
import type { EncodingHandle } from "@ricsam/isolate-encoding";
import type { TimersHandle } from "@ricsam/isolate-timers";
import type { PathHandle } from "@ricsam/isolate-path";
import type { CryptoHandle } from "@ricsam/isolate-crypto";
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
} from "@ricsam/isolate-test-environment";
import type {
  PlaywrightHandle,
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PlaywrightEvent,
} from "@ricsam/isolate-playwright";
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
} from "@ricsam/isolate-protocol";
import {
  marshalValue,
  unmarshalValue,
} from "@ricsam/isolate-protocol";

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
} from "@ricsam/isolate-protocol";

// Re-export shared types with local aliases for backward compatibility
export type EvalOptions = ProtocolEvalOptions;
export type PlaywrightOptions = ProtocolPlaywrightOptions;

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
  /** Clear collected browser data */
  clearCollectedData(): void;
}

/**
 * Collected browser data from playwright.
 */
export interface CollectedData {
  /** Browser console logs (from the page, not sandbox) */
  browserConsoleLogs: BrowserConsoleLogEntry[];
  networkRequests: NetworkRequestInfo[];
  networkResponses: NetworkResponseInfo[];
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
  transformCache: Map<string, TransformResult>;
  moduleToFilename: Map<ivm.Module, string>;
  moduleLoader?: ModuleLoaderCallback;
  customFunctions?: CustomFunctions;
  customFnInvokeRef?: ivm.Reference<
    (name: string, argsJson: string) => Promise<string>
  >;
  sourceMaps: Map<string, SourceMap>;
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
})();
`;

/**
 * Setup custom functions as globals in the isolate context.
 * Each function directly calls the host callback when invoked.
 */
async function setupCustomFunctions(
  context: ivm.Context,
  customFunctions: CustomFunctions
): Promise<ivm.Reference<(name: string, argsJson: string) => Promise<string>>> {
  const global = context.global;

  // Reference that invokes the callback and returns the result
  const invokeCallbackRef = new ivm.Reference(
    async (name: string, argsJson: string): Promise<string> => {
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
      const args = unmarshalValue(rawArgs) as unknown[];
      try {
        const result =
          def.type === "async" ? await def.fn(...args) : def.fn(...args);
        // Marshal result for isolate (converts JavaScript types to Refs)
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

  // Iterator start: creates iterator, stores in session, returns iteratorId
  const iterStartRef = new ivm.Reference(
    async (name: string, argsJson: string): Promise<string> => {
      const def = customFunctions[name];
      if (!def || def.type !== "asyncIterator") {
        return JSON.stringify({
          ok: false,
          error: {
            message: `Async iterator function '${name}' not found`,
            name: "Error",
          },
        });
      }
      try {
        // Unmarshal args from isolate
        const rawArgs = JSON.parse(argsJson) as unknown[];
        const args = unmarshalValue(rawArgs) as unknown[];
        const fn = def.fn as CustomAsyncGeneratorFunction;
        const iterator = fn(...args);
        const iteratorId = nextIteratorId++;
        iteratorSessions.set(iteratorId, { iterator });
        return JSON.stringify({ ok: true, iteratorId });
      } catch (error: unknown) {
        const err = error as Error;
        return JSON.stringify({
          ok: false,
          error: { message: err.message, name: err.name },
        });
      }
    }
  );

  global.setSync("__iter_start", iterStartRef);

  // Iterator next: calls iterator.next(), returns {done, value}
  const iterNextRef = new ivm.Reference(
    async (iteratorId: number): Promise<string> => {
      const session = iteratorSessions.get(iteratorId);
      if (!session) {
        return JSON.stringify({
          ok: false,
          error: {
            message: `Iterator session ${iteratorId} not found`,
            name: "Error",
          },
        });
      }
      try {
        const result = await session.iterator.next();
        if (result.done) {
          iteratorSessions.delete(iteratorId);
        }
        // Marshal value for isolate
        const marshalledValue = await marshalValue(result.value);
        return JSON.stringify({
          ok: true,
          done: result.done,
          value: marshalledValue,
        });
      } catch (error: unknown) {
        const err = error as Error;
        iteratorSessions.delete(iteratorId);
        return JSON.stringify({
          ok: false,
          error: { message: err.message, name: err.name },
        });
      }
    }
  );

  global.setSync("__iter_next", iterNextRef);

  // Iterator return: calls iterator.return(), cleans up session
  const iterReturnRef = new ivm.Reference(
    async (iteratorId: number, valueJson: string): Promise<string> => {
      const session = iteratorSessions.get(iteratorId);
      if (!session) {
        return JSON.stringify({ ok: true, done: true, value: undefined });
      }
      try {
        // Unmarshal value from isolate
        const rawValue = valueJson ? JSON.parse(valueJson) : undefined;
        const value = unmarshalValue(rawValue);
        const result = await session.iterator.return?.(value);
        iteratorSessions.delete(iteratorId);
        // Marshal value for isolate
        const marshalledValue = await marshalValue(result?.value);
        return JSON.stringify({ ok: true, done: true, value: marshalledValue });
      } catch (error: unknown) {
        const err = error as Error;
        iteratorSessions.delete(iteratorId);
        return JSON.stringify({
          ok: false,
          error: { message: err.message, name: err.name },
        });
      }
    }
  );

  global.setSync("__iter_return", iterReturnRef);

  // Iterator throw: calls iterator.throw(), cleans up session
  const iterThrowRef = new ivm.Reference(
    async (iteratorId: number, errorJson: string): Promise<string> => {
      const session = iteratorSessions.get(iteratorId);
      if (!session) {
        return JSON.stringify({
          ok: false,
          error: {
            message: `Iterator session ${iteratorId} not found`,
            name: "Error",
          },
        });
      }
      try {
        const errorData = JSON.parse(errorJson) as {
          message: string;
          name: string;
        };
        const error = Object.assign(new Error(errorData.message), {
          name: errorData.name,
        });
        const result = await session.iterator.throw?.(error);
        iteratorSessions.delete(iteratorId);
        // Marshal value for isolate
        const marshalledValue = await marshalValue(result?.value);
        return JSON.stringify({
          ok: true,
          done: result?.done ?? true,
          value: marshalledValue,
        });
      } catch (error: unknown) {
        const err = error as Error;
        iteratorSessions.delete(iteratorId);
        return JSON.stringify({
          ok: false,
          error: { message: err.message, name: err.name },
        });
      }
    }
  );

  global.setSync("__iter_throw", iterThrowRef);

  // Inject marshalling helpers into the isolate
  context.evalSync(ISOLATE_MARSHAL_CODE);

  // Create wrapper functions for each custom function
  for (const name of Object.keys(customFunctions)) {
    const def = customFunctions[name]!;

    if (def.type === "async") {
      // Async function: use applySyncPromise and async function wrapper
      context.evalSync(`
        globalThis.${name} = async function(...args) {
          const marshalledArgs = __marshalForHost(args);
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            ["${name}", JSON.stringify(marshalledArgs)]
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
    } else if (def.type === "sync") {
      // Sync function: use applySyncPromise (to await the host) but wrap in regular function
      // The function blocks until the host responds, but returns the value directly (not a Promise)
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const marshalledArgs = __marshalForHost(args);
          const resultJson = __customFn_invoke.applySyncPromise(
            undefined,
            ["${name}", JSON.stringify(marshalledArgs)]
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
    } else if (def.type === "asyncIterator") {
      // Async iterator function: returns an async iterable object
      context.evalSync(`
        globalThis.${name} = function(...args) {
          const marshalledArgs = __marshalForHost(args);
          const startResult = JSON.parse(__iter_start.applySyncPromise(undefined, ["${name}", JSON.stringify(marshalledArgs)]));
          if (!startResult.ok) {
            throw Object.assign(new Error(startResult.error.message), { name: startResult.error.name });
          }
          const iteratorId = startResult.iteratorId;
          return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
              const result = JSON.parse(__iter_next.applySyncPromise(undefined, [iteratorId]));
              if (!result.ok) {
                throw Object.assign(new Error(result.error.message), { name: result.error.name });
              }
              return { done: result.done, value: __unmarshalFromHost(result.value) };
            },
            async return(v) {
              const result = JSON.parse(__iter_return.applySyncPromise(undefined, [iteratorId, JSON.stringify(__marshalForHost(v))]));
              return { done: true, value: __unmarshalFromHost(result.value) };
            },
            async throw(e) {
              const result = JSON.parse(__iter_throw.applySyncPromise(undefined, [iteratorId, JSON.stringify({ message: e.message, name: e.name })]));
              if (!result.ok) {
                throw Object.assign(new Error(result.error.message), { name: result.error.name });
              }
              return { done: result.done, value: __unmarshalFromHost(result.value) };
            }
          };
        };
      `);
    }
  }

  return invokeCallbackRef;
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
    // Static cache first
    const staticCached = state.staticModuleCache.get(specifier);
    if (staticCached) return staticCached;

    // Specifier-only fast path is safe here: each local runtime gets a fresh cache,
    // so there's no cross-lifecycle staleness (unlike the daemon where caches persist across namespace reuse).
    const cached = state.moduleCache.get(specifier);
    if (cached) return cached;

    if (!state.moduleLoader) {
      throw new Error(
        `No module loader registered. Cannot import: ${specifier}`
      );
    }

    // Get importer info
    const importerPath = state.moduleToFilename.get(referrer) ?? "<unknown>";
    const importerResolveDir = path.posix.dirname(importerPath);

    // Invoke module loader - capture full result including static flag
    const result = await state.moduleLoader(specifier, {
      path: importerPath,
      resolveDir: importerResolveDir,
    });
    const { code, resolveDir } = result;

    // Cache by specifier + content hash (allows invalidation when content changes)
    const hash = contentHash(code);
    const cacheKey = `${specifier}:${hash}`;
    const hashCached = state.moduleCache.get(cacheKey);
    if (hashCached) return hashCached;

    // Transform cache — check transform cache first (survives reuse in daemon)
    let transformed: TransformResult | undefined = state.transformCache.get(hash);
    if (!transformed) {
      transformed = await transformModuleCode(code, specifier);
      state.transformCache.set(hash, transformed);
    }

    if (transformed.sourceMap) {
      state.sourceMaps.set(specifier, transformed.sourceMap);
    }

    // Compile the module
    const mod = await state.isolate.compileModule(transformed.code, {
      filename: specifier,
    });

    // Construct resolved path and track for nested imports
    const resolvedPath = path.posix.join(resolveDir, path.posix.basename(specifier));
    state.moduleToFilename.set(mod, resolvedPath);

    // Cache before instantiation (for circular dependencies)
    if (result.static) {
      state.staticModuleCache.set(specifier, mod);
    } else {
      state.moduleCache.set(specifier, mod);
      state.moduleCache.set(cacheKey, mod);
    }

    // Instantiate with recursive resolver
    const resolver = createModuleResolver(state);
    await mod.instantiate(state.context, resolver);

    return mod;
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
  const context = await isolate.createContext();

  // Initialize state
  const state: RuntimeState = {
    isolate,
    context,
    handles: {},
    moduleCache: new Map(),
    staticModuleCache: new Map(),
    transformCache: new Map(),
    moduleToFilename: new Map(),
    sourceMaps: new Map(),
    moduleLoader: opts.moduleLoader,
    customFunctions: opts.customFunctions as CustomFunctions<Record<string, unknown[]>>,
  };

  // Setup all APIs in order
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
    state.customFnInvokeRef = await setupCustomFunctions(
      context,
      opts.customFunctions as CustomFunctions<Record<string, unknown[]>>
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

  // Setup playwright (if page provided) - AFTER test environment so expect can be extended
  if (opts.playwright) {
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
            timestamp: event.timestamp,
          });
        }
      };
    }

    state.handles.playwright = await setupPlaywright(context, {
      page: opts.playwright.page,
      timeout: opts.playwright.timeout,
      // Don't print directly if routing through console handler
      console: opts.playwright.console && !opts.console?.onEntry,
      onEvent: eventCallback,
      createPage: opts.playwright.createPage,
      createContext: opts.playwright.createContext,
    });
  }

  // Create fetch handle wrapper
  const fetchHandle: RuntimeFetchHandle = {
    async dispatchRequest(
      request: Request,
      options?: DispatchRequestOptions
    ): Promise<Response> {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.dispatchRequest(request, options);
    },
    getUpgradeRequest() {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.getUpgradeRequest();
    },
    dispatchWebSocketOpen(connectionId: string) {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketOpen(connectionId);
    },
    dispatchWebSocketMessage(
      connectionId: string,
      message: string | ArrayBuffer
    ) {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketMessage(connectionId, message);
    },
    dispatchWebSocketClose(connectionId: string, code: number, reason: string) {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketClose(connectionId, code, reason);
    },
    dispatchWebSocketError(connectionId: string, error: Error) {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      state.handles.fetch.dispatchWebSocketError(connectionId, error);
    },
    onWebSocketCommand(callback: (cmd: WebSocketCommand) => void) {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.onWebSocketCommand(callback);
    },
    hasServeHandler() {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.hasServeHandler();
    },
    hasActiveConnections() {
      if (!state.handles.fetch) {
        throw new Error("Fetch handle not available");
      }
      return state.handles.fetch.hasActiveConnections();
    },
  };

  // Create timers handle wrapper
  const timersHandle: RuntimeTimersHandle = {
    clearAll() {
      state.handles.timers?.clearAll();
    },
  };

  // Create console handle wrapper
  const consoleHandle: RuntimeConsoleHandle = {
    reset() {
      state.handles.console?.reset();
    },
    getTimers() {
      return state.handles.console?.getTimers() ?? new Map();
    },
    getCounters() {
      return state.handles.console?.getCounters() ?? new Map();
    },
    getGroupDepth() {
      return state.handles.console?.getGroupDepth() ?? 0;
    },
  };

  // Create test environment handle wrapper
  const testEnvironmentHandle: RuntimeTestEnvironmentHandle = {
    async runTests(_timeout?: number): Promise<RunResults> {
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }
      // Note: timeout parameter reserved for future use
      return runTestsInContext(state.context);
    },
    hasTests(): boolean {
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }
      return hasTestsInContext(state.context);
    },
    getTestCount(): number {
      if (!state.handles.testEnvironment) {
        throw new Error(
          "Test environment not enabled. Set testEnvironment: true in createRuntime options."
        );
      }
      return getTestCountInContext(state.context);
    },
    reset() {
      state.handles.testEnvironment?.dispose();
    },
  };

  // Create playwright handle wrapper
  const playwrightHandle: RuntimePlaywrightHandle = {
    getCollectedData(): CollectedData {
      if (!state.handles.playwright) {
        throw new Error(
          "Playwright not configured. Provide playwright.page in createRuntime options."
        );
      }
      return {
        browserConsoleLogs: state.handles.playwright.getBrowserConsoleLogs(),
        networkRequests: state.handles.playwright.getNetworkRequests(),
        networkResponses: state.handles.playwright.getNetworkResponses(),
      };
    },
    clearCollectedData() {
      state.handles.playwright?.clearCollected();
    },
  };

  return {
    id,

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
      // Parse options
      const options =
        typeof filenameOrOptions === "string"
          ? { filename: filenameOrOptions }
          : filenameOrOptions;

      // Normalize filename to absolute path for module resolution
      const filename = normalizeEntryFilename(options?.filename);

      try {
        // Transform entry code: strip types, validate, wrap in async function
        const transformed = await transformEntryCode(code, filename);
        if (transformed.sourceMap) {
          state.sourceMaps.set(filename, transformed.sourceMap);
        }

        // Compile as ES module
        const mod = await state.isolate.compileModule(transformed.code, {
          filename,
        });

        // Track entry module filename for nested imports
        state.moduleToFilename.set(mod, filename);

        // Instantiate with module resolver
        const resolver = createModuleResolver(state);
        await mod.instantiate(state.context, resolver);

        // Evaluate - only resolves imports and defines the default function (no timeout needed)
        await mod.evaluate();

        // Get the default export and run it with timeout
        const ns = mod.namespace;
        const runRef = await ns.get("default", { reference: true });
        try {
          await runRef.apply(undefined, [], {
            result: { promise: true },
            ...(options?.maxExecutionMs
              ? { timeout: options.maxExecutionMs }
              : {}),
          });
        } finally {
          runRef.release();
        }
      } catch (err) {
        const error = err as Error;
        if (error.stack && state.sourceMaps.size > 0) {
          error.stack = mapErrorStack(error.stack, state.sourceMaps);
        }
        throw error;
      }
    },

    async dispose(): Promise<void> {
      // Dispose custom function reference
      if (state.customFnInvokeRef) {
        state.customFnInvokeRef.release();
      }

      // Dispose all handles (in reverse order of setup)
      state.handles.playwright?.dispose();
      state.handles.testEnvironment?.dispose();
      state.handles.fs?.dispose();
      state.handles.fetch?.dispose();
      state.handles.crypto?.dispose();
      state.handles.path?.dispose();
      state.handles.timers?.dispose();
      state.handles.encoding?.dispose();
      state.handles.console?.dispose();
      state.handles.core?.dispose();

      // Clear module cache
      state.moduleCache.clear();

      // Release context and dispose isolate
      state.context.release();
      state.isolate.dispose();
    },
  };
}

// Re-export all package types and functions
export { setupCore } from "@ricsam/isolate-core";
export type { CoreHandle, SetupCoreOptions } from "@ricsam/isolate-core";

export { setupConsole } from "@ricsam/isolate-console";
export {
  simpleConsoleHandler,
  type SimpleConsoleCallbacks,
} from "@ricsam/isolate-console/utils";
export type {
  ConsoleHandle,
  ConsoleOptions,
  ConsoleEntry as ConsoleEntryFromConsole,
} from "@ricsam/isolate-console";

export { setupCrypto } from "@ricsam/isolate-crypto";
export type { CryptoHandle } from "@ricsam/isolate-crypto";

export { setupEncoding } from "@ricsam/isolate-encoding";
export type { EncodingHandle } from "@ricsam/isolate-encoding";

export { setupFetch } from "@ricsam/isolate-fetch";
export type {
  FetchHandle,
  FetchOptions,
  WebSocketCommand,
  UpgradeRequest,
} from "@ricsam/isolate-fetch";

export { setupFs, createNodeFileSystemHandler } from "@ricsam/isolate-fs";
export type {
  FsHandle,
  FsOptions,
  FileSystemHandler,
  NodeFileSystemHandlerOptions,
} from "@ricsam/isolate-fs";

export { setupPath } from "@ricsam/isolate-path";
export type { PathHandle, PathOptions } from "@ricsam/isolate-path";

export { setupTimers } from "@ricsam/isolate-timers";
export type { TimersHandle } from "@ricsam/isolate-timers";

export {
  setupTestEnvironment,
  runTests,
  hasTests,
  getTestCount,
} from "@ricsam/isolate-test-environment";
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
} from "@ricsam/isolate-test-environment";

export {
  setupPlaywright,
  createPlaywrightHandler,
} from "@ricsam/isolate-playwright";
export type {
  PlaywrightHandle,
  PlaywrightSetupOptions,
  PlaywrightCallback,
  PlaywrightEvent,
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
} from "@ricsam/isolate-playwright";

export * from "./internal.ts";
