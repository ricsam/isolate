import ivm from "isolated-vm";

// Types for isolated-vm context
export type { Isolate, Context, Reference } from "isolated-vm";

// ============================================================================
// Instance State Management
// ============================================================================

/**
 * Map to store host-side state for instances created in the isolate.
 * Key is the unique instance ID, value is the instance state.
 */
const instanceStateMap = new WeakMap<ivm.Context, Map<number, unknown>>();
let nextInstanceId = 1;

function getInstanceStateMapForContext(
  context: ivm.Context
): Map<number, unknown> {
  let map = instanceStateMap.get(context);
  if (!map) {
    map = new Map();
    instanceStateMap.set(context, map);
  }
  return map;
}

/**
 * Clear all instance state (for testing)
 */
export function clearAllInstanceState(): void {
  nextInstanceId = 1;
}

// ============================================================================
// Unmarshaled Handle Tracking
// ============================================================================

const unmarshaledHandles = new WeakMap<ivm.Context, Set<ivm.Reference>>();

function trackUnmarshaledHandle(
  context: ivm.Context,
  ref: ivm.Reference
): void {
  let set = unmarshaledHandles.get(context);
  if (!set) {
    set = new Set();
    unmarshaledHandles.set(context, set);
  }
  set.add(ref);
}

/**
 * Cleanup all handles created during unmarshalling for a context
 */
export function cleanupUnmarshaledHandles(context: ivm.Context): void {
  const set = unmarshaledHandles.get(context);
  if (set) {
    for (const ref of set) {
      try {
        ref.release();
      } catch {
        // Handle may already be released
      }
    }
    set.clear();
  }
}

// ============================================================================
// Marshal / Unmarshal
// ============================================================================

export interface MarshalOptions {
  maxDepth?: number;
}

export interface UnmarshalOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 100;

/**
 * Marshal a JavaScript value to an isolated-vm Reference.
 * Converts host values into values that can be used inside the isolate.
 */
export function marshal(
  context: ivm.Context,
  value: unknown,
  options?: MarshalOptions
): ivm.Reference {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const seen = new Set<object>();

  function marshalValue(val: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      throw new Error(`Max depth of ${maxDepth} exceeded during marshalling`);
    }

    // Handle primitives
    if (val === null || val === undefined) {
      return val;
    }

    const type = typeof val;
    if (type === "string" || type === "number" || type === "boolean") {
      return val;
    }

    if (type === "function") {
      // Create a callback that can be called from the isolate
      return new ivm.Callback((...args: unknown[]) => {
        try {
          return (val as (...args: unknown[]) => unknown)(...args);
        } catch (err) {
          if (err instanceof Error) {
            throw err;
          }
          throw new Error(String(err));
        }
      });
    }

    if (type === "object") {
      const obj = val as object;

      // Check for circular reference
      if (seen.has(obj)) {
        throw new Error("Circular reference detected during marshalling");
      }
      seen.add(obj);

      try {
        // Handle Uint8Array and other typed arrays
        if (ArrayBuffer.isView(obj)) {
          if (obj instanceof Uint8Array) {
            // Create a copy of the buffer to pass to the isolate
            return new ivm.ExternalCopy(obj).copyInto();
          }
          // Other typed arrays - convert to regular array for now
          return Array.from(obj as Iterable<number>);
        }

        // Handle ArrayBuffer
        if (obj instanceof ArrayBuffer) {
          return new ivm.ExternalCopy(new Uint8Array(obj)).copyInto();
        }

        // Handle Date
        if (obj instanceof Date) {
          return obj.toISOString();
        }

        // Handle RegExp
        if (obj instanceof RegExp) {
          return {
            __type: "RegExp",
            source: obj.source,
            flags: obj.flags,
          };
        }

        // Handle Error
        if (obj instanceof Error) {
          return {
            __type: "Error",
            name: obj.name,
            message: obj.message,
            stack: obj.stack,
          };
        }

        // Handle Array
        if (Array.isArray(obj)) {
          const result: unknown[] = [];
          for (let i = 0; i < obj.length; i++) {
            result[i] = marshalValue(obj[i], depth + 1);
          }
          return result;
        }

        // Handle plain objects
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
          result[key] = marshalValue(
            (obj as Record<string, unknown>)[key],
            depth + 1
          );
        }
        return result;
      } finally {
        seen.delete(obj);
      }
    }

    // Unsupported type
    return undefined;
  }

  const marshaled = marshalValue(value, 0);

  // If it's already a Reference or Callback, return it directly
  if (marshaled instanceof ivm.Reference || marshaled instanceof ivm.Callback) {
    return marshaled as ivm.Reference;
  }

  // Use ExternalCopy for efficient transfer of the marshaled value
  const copy = new ivm.ExternalCopy(marshaled);
  const result = copy.copyInto();
  copy.release();

  // Note: This returns the copied value, not a Reference
  // For full Reference semantics, use context.global.setSync then getSync with { reference: true }
  return result as unknown as ivm.Reference;
}

/**
 * Unmarshal an isolated-vm Reference or value to a JavaScript value.
 * Converts isolate values back to host values.
 */
export function unmarshal(
  context: ivm.Context,
  value: ivm.Reference | unknown,
  options?: UnmarshalOptions
): unknown {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;

  function unmarshalValue(val: unknown, depth: number): unknown {
    if (depth > maxDepth) {
      throw new Error(`Max depth of ${maxDepth} exceeded during unmarshalling`);
    }

    if (val === null || val === undefined) {
      return val;
    }

    const type = typeof val;
    if (type === "string" || type === "number" || type === "boolean") {
      return val;
    }

    if (val instanceof ivm.Reference) {
      // Copy the value out of the isolate
      try {
        const copied = val.copySync();
        trackUnmarshaledHandle(context, val);
        return unmarshalValue(copied, depth);
      } catch {
        // If copy fails, the reference might be to a function
        return val;
      }
    }

    if (type === "object") {
      const obj = val as Record<string, unknown>;

      // Handle special types
      if (obj.__type === "Error") {
        const ErrorConstructor = (globalThis as Record<string, unknown>)[
          obj.name as string
        ] as ErrorConstructor | undefined;
        const error = new (ErrorConstructor || Error)(obj.message as string);
        error.name = obj.name as string;
        if (obj.stack) {
          error.stack = obj.stack as string;
        }
        return error;
      }

      if (obj.__type === "RegExp") {
        return new RegExp(obj.source as string, obj.flags as string);
      }

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item) => unmarshalValue(item, depth + 1));
      }

      // Handle plain objects
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(obj)) {
        result[key] = unmarshalValue(obj[key], depth + 1);
      }
      return result;
    }

    return val;
  }

  // Handle both Reference and direct values (from marshal's copyInto)
  if (value instanceof ivm.Reference) {
    try {
      const copied = value.copySync();
      return unmarshalValue(copied, 0);
    } catch {
      // Reference might be to a function or other non-copyable value
      return value;
    }
  }

  // Direct value (e.g., from marshal which returns copyInto result)
  return unmarshalValue(value, 0);
}

// ============================================================================
// Scope Management
// ============================================================================

/**
 * Scope for managing reference lifecycle
 */
export interface Scope {
  /**
   * Track a reference for automatic cleanup when scope exits
   */
  manage<T extends ivm.Reference>(ref: T): T;

  /**
   * Marshal a value and track the resulting reference
   */
  marshal(value: unknown, options?: MarshalOptions): ivm.Reference;
}

/**
 * Execute a synchronous callback with automatic reference cleanup.
 * All references tracked via scope.manage() will be released when the scope exits.
 */
export function withScope<T>(
  context: ivm.Context,
  callback: (scope: Scope) => T
): T {
  const refs: ivm.Reference[] = [];

  const scope: Scope = {
    manage<R extends ivm.Reference>(ref: R): R {
      refs.push(ref);
      return ref;
    },
    marshal(value: unknown, options?: MarshalOptions): ivm.Reference {
      const ref = marshal(context, value, options);
      refs.push(ref);
      return ref;
    },
  };

  try {
    return callback(scope);
  } finally {
    // Release in reverse order (LIFO)
    for (let i = refs.length - 1; i >= 0; i--) {
      try {
        refs[i]!.release();
      } catch {
        // Handle may already be released
      }
    }
  }
}

/**
 * Execute an async callback with automatic reference cleanup.
 * All references tracked via scope.manage() will be released when the scope exits.
 */
export async function withScopeAsync<T>(
  context: ivm.Context,
  callback: (scope: Scope) => Promise<T>
): Promise<T> {
  const refs: ivm.Reference[] = [];

  const scope: Scope = {
    manage<R extends ivm.Reference>(ref: R): R {
      refs.push(ref);
      return ref;
    },
    marshal(value: unknown, options?: MarshalOptions): ivm.Reference {
      const ref = marshal(context, value, options);
      refs.push(ref);
      return ref;
    },
  };

  try {
    return await callback(scope);
  } finally {
    // Release in reverse order (LIFO)
    for (let i = refs.length - 1; i >= 0; i--) {
      try {
        refs[i]!.release();
      } catch {
        // Handle may already be released
      }
    }
  }
}

// ============================================================================
// Function Builder
// ============================================================================

/**
 * Define a synchronous function that can be called from the isolate.
 * Arguments are automatically unmarshalled, return values are automatically marshalled.
 */
export function defineFunction(
  context: ivm.Context,
  name: string,
  fn: (...args: unknown[]) => unknown
): ivm.Reference {
  const callback = new ivm.Callback(
    (...args: unknown[]) => {
      try {
        const result = fn(...args);
        return result;
      } catch (err) {
        if (err instanceof Error) {
          // Throw a transferable error object
          throw new Error(err.message);
        }
        throw err;
      }
    },
    { async: false }
  );

  // Set it on the global object in the context
  const global = context.global;
  global.setSync(name, callback);

  return global.getSync(name) as ivm.Reference;
}

/**
 * Define an async function that can be called from the isolate.
 * Returns a Promise that resolves/rejects with marshalled values.
 */
export function defineAsyncFunction(
  context: ivm.Context,
  name: string,
  fn: (...args: unknown[]) => Promise<unknown>
): ivm.Reference {
  const callback = new ivm.Callback(
    async (...args: unknown[]) => {
      try {
        const result = await fn(...args);
        return result;
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(err.message);
        }
        throw err;
      }
    },
    { async: true }
  );

  // Set it on the global object in the context
  const global = context.global;
  global.setSync(name, callback);

  return global.getSync(name) as ivm.Reference;
}

// ============================================================================
// Class Builder
// ============================================================================

export interface PropertyDescriptor<TState = unknown> {
  get?: (state: TState) => unknown;
  set?: (state: TState, value: unknown) => void;
  value?: unknown;
  writable?: boolean;
  enumerable?: boolean;
  configurable?: boolean;
}

export interface ClassDefinition<TState extends object = object> {
  name: string;
  construct?: (args: unknown[]) => TState;
  methods?: Record<
    string,
    { fn: (state: TState, ...args: unknown[]) => unknown; async?: boolean }
  >;
  properties?: Record<string, PropertyDescriptor<TState>>;
  staticMethods?: Record<
    string,
    { fn: (...args: unknown[]) => unknown; async?: boolean }
  >;
  staticProperties?: Record<string, unknown>;
  extends?: string;
}

/**
 * Define a class that can be instantiated in the isolate.
 * Instance state is stored on the host side, accessed via unique IDs.
 */
export function defineClass<TState extends object = object>(
  context: ivm.Context,
  definition: ClassDefinition<TState>
): ivm.Reference {
  const {
    name,
    construct,
    methods = {},
    properties = {},
    staticMethods = {},
    staticProperties = {},
  } = definition;
  const stateMap = getInstanceStateMapForContext(context);

  // Helper to get the Error constructor code for a specific error type
  const getErrorConstructor = (errorType: string) => {
    const knownErrors = [
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "URIError",
      "EvalError",
    ];
    return knownErrors.includes(errorType) ? errorType : "Error";
  };

  // Helper to encode error type in message (survives isolate boundary)
  const encodeError = (err: Error): Error => {
    const errorType = getErrorConstructor(err.name);
    return new Error(`[${errorType}]${err.message}`);
  };

  // Build method callback registrations
  const methodCallbacks: Record<string, ivm.Callback> = {};
  for (const [methodName, methodDef] of Object.entries(methods)) {
    methodCallbacks[`__${name}_${methodName}`] = new ivm.Callback(
      (instanceId: number, ...args: unknown[]) => {
        const state = stateMap.get(instanceId) as TState | undefined;
        if (!state) {
          throw new Error(`Instance ${instanceId} not found`);
        }
        try {
          return methodDef.fn(state, ...args);
        } catch (err) {
          if (err instanceof Error) {
            throw encodeError(err);
          }
          throw err;
        }
      },
      { async: methodDef.async ?? false }
    );
  }

  // Build property getter/setter callbacks
  const propertyCallbacks: Record<string, ivm.Callback> = {};
  for (const [propName, propDef] of Object.entries(properties)) {
    if (propDef.get) {
      const getter = propDef.get;
      propertyCallbacks[`__${name}_get_${propName}`] = new ivm.Callback(
        (instanceId: number) => {
          const state = stateMap.get(instanceId) as TState | undefined;
          if (!state) {
            throw new Error(`Instance ${instanceId} not found`);
          }
          try {
            return getter(state);
          } catch (err) {
            if (err instanceof Error) {
              throw encodeError(err);
            }
            throw err;
          }
        }
      );
    }
    if (propDef.set) {
      const setter = propDef.set;
      propertyCallbacks[`__${name}_set_${propName}`] = new ivm.Callback(
        (instanceId: number, value: unknown) => {
          const state = stateMap.get(instanceId) as TState | undefined;
          if (!state) {
            throw new Error(`Instance ${instanceId} not found`);
          }
          try {
            setter(state, value);
          } catch (err) {
            if (err instanceof Error) {
              throw encodeError(err);
            }
            throw err;
          }
        }
      );
    }
  }

  // Build static method callbacks
  const staticMethodCallbacks: Record<string, ivm.Callback> = {};
  for (const [methodName, methodDef] of Object.entries(staticMethods)) {
    staticMethodCallbacks[`__${name}_static_${methodName}`] = new ivm.Callback(
      (...args: unknown[]) => {
        try {
          return methodDef.fn(...args);
        } catch (err) {
          if (err instanceof Error) {
            throw encodeError(err);
          }
          throw err;
        }
      },
      { async: methodDef.async ?? false }
    );
  }

  // Constructor callback
  const constructorCallback = new ivm.Callback((...args: unknown[]) => {
    const instanceId = nextInstanceId++;
    if (construct) {
      try {
        const state = construct(args);
        stateMap.set(instanceId, state);
      } catch (err) {
        if (err instanceof Error) {
          throw encodeError(err);
        }
        throw err;
      }
    } else {
      stateMap.set(instanceId, {} as TState);
    }
    return instanceId;
  });

  // Register all callbacks on global
  const global = context.global;
  global.setSync(`__${name}_construct`, constructorCallback);

  for (const [callbackName, callback] of Object.entries(methodCallbacks)) {
    global.setSync(callbackName, callback);
  }
  for (const [callbackName, callback] of Object.entries(propertyCallbacks)) {
    global.setSync(callbackName, callback);
  }
  for (const [callbackName, callback] of Object.entries(
    staticMethodCallbacks
  )) {
    global.setSync(callbackName, callback);
  }

  // Build the class definition JavaScript code
  let classCode = `
(function() {
  // Helper to decode error type from message
  function __decodeError(err) {
    const match = err.message.match(/^\\[(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|Error)\\](.*)$/);
    if (match) {
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  class ${name} {
    #instanceId;

    constructor(...args) {
      try {
        this.#instanceId = __${name}_construct(...args);
      } catch (err) {
        throw __decodeError(err);
      }
    }
`;

  // Add methods
  for (const [methodName, methodDef] of Object.entries(methods)) {
    if (methodDef.async) {
      classCode += `
    async ${methodName}(...args) {
      try {
        return await __${name}_${methodName}(this.#instanceId, ...args);
      } catch (err) {
        throw __decodeError(err);
      }
    }
`;
    } else {
      classCode += `
    ${methodName}(...args) {
      try {
        return __${name}_${methodName}(this.#instanceId, ...args);
      } catch (err) {
        throw __decodeError(err);
      }
    }
`;
    }
  }

  // Add properties
  for (const [propName, propDef] of Object.entries(properties)) {
    if (propDef.get || propDef.set) {
      if (propDef.get) {
        classCode += `
    get ${propName}() {
      try {
        return __${name}_get_${propName}(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }
    }
`;
      }
      if (propDef.set) {
        classCode += `
    set ${propName}(value) {
      try {
        __${name}_set_${propName}(this.#instanceId, value);
      } catch (err) {
        throw __decodeError(err);
      }
    }
`;
      }
    }
  }

  classCode += `
  }
`;

  // Add static methods
  for (const [methodName, methodDef] of Object.entries(staticMethods)) {
    if (methodDef.async) {
      classCode += `
  ${name}.${methodName} = async function(...args) {
    try {
      return await __${name}_static_${methodName}(...args);
    } catch (err) {
      throw __decodeError(err);
    }
  };
`;
    } else {
      classCode += `
  ${name}.${methodName} = function(...args) {
    try {
      return __${name}_static_${methodName}(...args);
    } catch (err) {
      throw __decodeError(err);
    }
  };
`;
    }
  }

  // Add static properties
  for (const [propName, propValue] of Object.entries(staticProperties)) {
    classCode += `
  ${name}.${propName} = ${JSON.stringify(propValue)};
`;
  }

  classCode += `
  globalThis.${name} = ${name};
  return ${name};
})()
`;

  // Evaluate the class and assign it directly to globalThis in the isolate
  context.evalSync(classCode);

  return global.getSync(name) as ivm.Reference;
}

// ============================================================================
// SetupCore - Inject WHATWG APIs
// ============================================================================

export interface SetupCoreOptions {
  /** Whether to inject TextEncoder/TextDecoder */
  textEncoding?: boolean;
  /** Whether to inject URL/URLSearchParams */
  url?: boolean;
  /** Whether to inject Blob/File */
  blob?: boolean;
  /** Whether to inject Streams */
  streams?: boolean;
}

export interface CoreHandle {
  dispose(): void;
}

/**
 * Setup core APIs in an isolated-vm context.
 *
 * Injects the following globals:
 * - ReadableStream, WritableStream, TransformStream
 * - ReadableStreamDefaultReader, WritableStreamDefaultWriter
 * - Blob
 * - File
 * - DOMException
 * - URL, URLSearchParams
 * - TextEncoder, TextDecoder
 */
export async function setupCore(
  context: ivm.Context,
  options?: SetupCoreOptions
): Promise<CoreHandle> {
  const opts = {
    textEncoding: true,
    url: true,
    blob: true,
    streams: true,
    ...options,
  };

  const stateMap = getInstanceStateMapForContext(context);

  // Inject TextEncoder/TextDecoder
  if (opts.textEncoding) {
    await injectTextEncoding(context);
  }

  // Inject URL/URLSearchParams
  if (opts.url) {
    await injectURL(context);
  }

  // Inject DOMException (needed by AbortController)
  await injectDOMException(context);

  // Inject AbortController/AbortSignal (needed by Streams)
  await injectAbortController(context);

  // Inject Blob/File
  if (opts.blob) {
    await injectBlob(context, stateMap);
  }

  // Inject Streams
  if (opts.streams) {
    await injectStreams(context, stateMap);
  }

  return {
    dispose() {
      cleanupUnmarshaledHandles(context);
    },
  };
}

// ============================================================================
// TextEncoder / TextDecoder Implementation
// ============================================================================

async function injectTextEncoding(context: ivm.Context): Promise<void> {
  // TextEncoder and TextDecoder are pure JS implementations
  const code = `
(function() {
  class TextEncoder {
    get encoding() { return 'utf-8'; }

    encode(input = '') {
      const str = String(input);
      const octets = [];
      for (let i = 0; i < str.length; i++) {
        let codePoint = str.codePointAt(i);
        if (codePoint > 0xFFFF) {
          i++; // Skip the next code unit for surrogate pairs
        }
        if (codePoint < 0x80) {
          octets.push(codePoint);
        } else if (codePoint < 0x800) {
          octets.push(0xC0 | (codePoint >> 6));
          octets.push(0x80 | (codePoint & 0x3F));
        } else if (codePoint < 0x10000) {
          octets.push(0xE0 | (codePoint >> 12));
          octets.push(0x80 | ((codePoint >> 6) & 0x3F));
          octets.push(0x80 | (codePoint & 0x3F));
        } else {
          octets.push(0xF0 | (codePoint >> 18));
          octets.push(0x80 | ((codePoint >> 12) & 0x3F));
          octets.push(0x80 | ((codePoint >> 6) & 0x3F));
          octets.push(0x80 | (codePoint & 0x3F));
        }
      }
      return new Uint8Array(octets);
    }

    encodeInto(source, destination) {
      const encoded = this.encode(source);
      const len = Math.min(encoded.length, destination.length);
      for (let i = 0; i < len; i++) {
        destination[i] = encoded[i];
      }
      return { read: source.length, written: len };
    }
  }

  class TextDecoder {
    #encoding;
    #fatal;
    #ignoreBOM;

    constructor(encoding = 'utf-8', options = {}) {
      const normalizedEncoding = String(encoding).toLowerCase().trim();
      if (normalizedEncoding !== 'utf-8' && normalizedEncoding !== 'utf8') {
        throw new RangeError('TextDecoder only supports UTF-8 encoding');
      }
      this.#encoding = 'utf-8';
      this.#fatal = Boolean(options.fatal);
      this.#ignoreBOM = Boolean(options.ignoreBOM);
    }

    get encoding() { return this.#encoding; }
    get fatal() { return this.#fatal; }
    get ignoreBOM() { return this.#ignoreBOM; }

    decode(input, options = {}) {
      if (input === undefined) return '';

      let bytes;
      if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
      } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      } else {
        throw new TypeError('Input must be ArrayBuffer or ArrayBufferView');
      }

      let result = '';
      let i = 0;

      // Skip BOM if present and not ignored
      if (!this.#ignoreBOM && bytes.length >= 3 &&
          bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        i = 3;
      }

      while (i < bytes.length) {
        const byte1 = bytes[i++];

        if (byte1 < 0x80) {
          result += String.fromCodePoint(byte1);
        } else if ((byte1 & 0xE0) === 0xC0) {
          const byte2 = bytes[i++];
          if ((byte2 & 0xC0) !== 0x80) {
            if (this.#fatal) throw new TypeError('Invalid UTF-8');
            result += '\\uFFFD';
            continue;
          }
          result += String.fromCodePoint(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        } else if ((byte1 & 0xF0) === 0xE0) {
          const byte2 = bytes[i++];
          const byte3 = bytes[i++];
          if ((byte2 & 0xC0) !== 0x80 || (byte3 & 0xC0) !== 0x80) {
            if (this.#fatal) throw new TypeError('Invalid UTF-8');
            result += '\\uFFFD';
            continue;
          }
          result += String.fromCodePoint(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        } else if ((byte1 & 0xF8) === 0xF0) {
          const byte2 = bytes[i++];
          const byte3 = bytes[i++];
          const byte4 = bytes[i++];
          if ((byte2 & 0xC0) !== 0x80 || (byte3 & 0xC0) !== 0x80 || (byte4 & 0xC0) !== 0x80) {
            if (this.#fatal) throw new TypeError('Invalid UTF-8');
            result += '\\uFFFD';
            continue;
          }
          const codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
          result += String.fromCodePoint(codePoint);
        } else {
          if (this.#fatal) throw new TypeError('Invalid UTF-8');
          result += '\\uFFFD';
        }
      }

      return result;
    }
  }

  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
})();
`;

  context.evalSync(code);
}

// ============================================================================
// URL / URLSearchParams Implementation
// ============================================================================

async function injectURL(context: ivm.Context): Promise<void> {
  // URL and URLSearchParams implementation in pure JS
  const code = `
(function() {
  class URLSearchParams {
    #params = [];

    constructor(init = '') {
      if (typeof init === 'string') {
        const query = init.startsWith('?') ? init.slice(1) : init;
        if (query) {
          for (const pair of query.split('&')) {
            const idx = pair.indexOf('=');
            if (idx === -1) {
              this.#params.push([decodeURIComponent(pair), '']);
            } else {
              this.#params.push([
                decodeURIComponent(pair.slice(0, idx)),
                decodeURIComponent(pair.slice(idx + 1))
              ]);
            }
          }
        }
      } else if (Array.isArray(init)) {
        for (const pair of init) {
          if (Array.isArray(pair) && pair.length >= 2) {
            this.#params.push([String(pair[0]), String(pair[1])]);
          }
        }
      } else if (init && typeof init === 'object') {
        for (const [key, value] of Object.entries(init)) {
          this.#params.push([String(key), String(value)]);
        }
      }
    }

    get size() {
      return this.#params.length;
    }

    append(name, value) {
      this.#params.push([String(name), String(value)]);
    }

    delete(name, value) {
      const nameStr = String(name);
      if (value === undefined) {
        this.#params = this.#params.filter(([k]) => k !== nameStr);
      } else {
        const valueStr = String(value);
        this.#params = this.#params.filter(([k, v]) => !(k === nameStr && v === valueStr));
      }
    }

    get(name) {
      const nameStr = String(name);
      const pair = this.#params.find(([k]) => k === nameStr);
      return pair ? pair[1] : null;
    }

    getAll(name) {
      const nameStr = String(name);
      return this.#params.filter(([k]) => k === nameStr).map(([, v]) => v);
    }

    has(name, value) {
      const nameStr = String(name);
      if (value === undefined) {
        return this.#params.some(([k]) => k === nameStr);
      }
      const valueStr = String(value);
      return this.#params.some(([k, v]) => k === nameStr && v === valueStr);
    }

    set(name, value) {
      const nameStr = String(name);
      const valueStr = String(value);
      let found = false;
      this.#params = this.#params.filter(([k]) => {
        if (k === nameStr) {
          if (!found) {
            found = true;
            return true;
          }
          return false;
        }
        return true;
      });
      if (found) {
        const idx = this.#params.findIndex(([k]) => k === nameStr);
        if (idx !== -1) {
          this.#params[idx] = [nameStr, valueStr];
        }
      } else {
        this.#params.push([nameStr, valueStr]);
      }
    }

    sort() {
      this.#params.sort((a, b) => a[0].localeCompare(b[0]));
    }

    toString() {
      return this.#params
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
    }

    *entries() {
      for (const pair of this.#params) {
        yield [pair[0], pair[1]];
      }
    }

    *keys() {
      for (const [k] of this.#params) {
        yield k;
      }
    }

    *values() {
      for (const [, v] of this.#params) {
        yield v;
      }
    }

    forEach(callback, thisArg) {
      for (const [k, v] of this.#params) {
        callback.call(thisArg, v, k, this);
      }
    }

    [Symbol.iterator]() {
      return this.entries();
    }
  }

  class URL {
    #protocol = '';
    #username = '';
    #password = '';
    #hostname = '';
    #port = '';
    #pathname = '/';
    #search = '';
    #hash = '';
    #searchParams = null;

    constructor(url, base) {
      if (arguments.length === 0) {
        throw new TypeError("Failed to construct 'URL': 1 argument required, but only 0 present.");
      }

      let urlStr = String(url);

      if (base !== undefined) {
        const baseUrl = new URL(String(base));
        if (urlStr.startsWith('//')) {
          urlStr = baseUrl.protocol + urlStr;
        } else if (urlStr.startsWith('/')) {
          urlStr = baseUrl.origin + urlStr;
        } else if (!urlStr.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)) {
          const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
          urlStr = baseUrl.origin + basePath + urlStr;
        }
      }

      // Parse the URL
      const match = urlStr.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(\\/\\/)?(.*)$/);
      if (!match) {
        throw new TypeError("Failed to construct 'URL': Invalid URL");
      }

      this.#protocol = match[1].toLowerCase() + ':';
      let rest = match[3];

      if (match[2]) {
        // Has authority (//...)
        let authEnd = rest.indexOf('/');
        if (authEnd === -1) authEnd = rest.indexOf('?');
        if (authEnd === -1) authEnd = rest.indexOf('#');
        if (authEnd === -1) authEnd = rest.length;

        const authority = rest.substring(0, authEnd);
        rest = rest.substring(authEnd);

        // Parse authority: [userinfo@]host[:port]
        let hostPart = authority;
        const atIdx = authority.indexOf('@');
        if (atIdx !== -1) {
          const userinfo = authority.substring(0, atIdx);
          hostPart = authority.substring(atIdx + 1);
          const colonIdx = userinfo.indexOf(':');
          if (colonIdx !== -1) {
            this.#username = decodeURIComponent(userinfo.substring(0, colonIdx));
            this.#password = decodeURIComponent(userinfo.substring(colonIdx + 1));
          } else {
            this.#username = decodeURIComponent(userinfo);
          }
        }

        // Handle IPv6
        if (hostPart.startsWith('[')) {
          const bracketEnd = hostPart.indexOf(']');
          if (bracketEnd !== -1) {
            this.#hostname = hostPart.substring(0, bracketEnd + 1);
            if (hostPart.length > bracketEnd + 1 && hostPart[bracketEnd + 1] === ':') {
              this.#port = hostPart.substring(bracketEnd + 2);
            }
          }
        } else {
          const colonIdx = hostPart.lastIndexOf(':');
          if (colonIdx !== -1) {
            this.#hostname = hostPart.substring(0, colonIdx);
            this.#port = hostPart.substring(colonIdx + 1);
          } else {
            this.#hostname = hostPart;
          }
        }
      }

      // Parse path, query, fragment
      let hashIdx = rest.indexOf('#');
      if (hashIdx !== -1) {
        this.#hash = rest.substring(hashIdx);
        rest = rest.substring(0, hashIdx);
      }

      let queryIdx = rest.indexOf('?');
      if (queryIdx !== -1) {
        this.#search = rest.substring(queryIdx);
        rest = rest.substring(0, queryIdx);
      }

      this.#pathname = rest || '/';
      if (!this.#pathname.startsWith('/') && this.#hostname) {
        this.#pathname = '/' + this.#pathname;
      }
    }

    get protocol() { return this.#protocol; }
    set protocol(value) { this.#protocol = String(value).toLowerCase() + (String(value).endsWith(':') ? '' : ':'); }

    get username() { return this.#username; }
    set username(value) { this.#username = String(value); }

    get password() { return this.#password; }
    set password(value) { this.#password = String(value); }

    get hostname() { return this.#hostname; }
    set hostname(value) { this.#hostname = String(value); }

    get port() { return this.#port; }
    set port(value) { this.#port = String(value); }

    get pathname() { return this.#pathname; }
    set pathname(value) { this.#pathname = String(value); }

    get search() { return this.#search; }
    set search(value) {
      const str = String(value);
      this.#search = str.startsWith('?') ? str : (str ? '?' + str : '');
      this.#searchParams = null;
    }

    get hash() { return this.#hash; }
    set hash(value) {
      const str = String(value);
      this.#hash = str.startsWith('#') ? str : (str ? '#' + str : '');
    }

    get host() {
      return this.#port ? this.#hostname + ':' + this.#port : this.#hostname;
    }
    set host(value) {
      const str = String(value);
      const colonIdx = str.lastIndexOf(':');
      if (colonIdx !== -1 && !str.includes('[')) {
        this.#hostname = str.substring(0, colonIdx);
        this.#port = str.substring(colonIdx + 1);
      } else {
        this.#hostname = str;
        this.#port = '';
      }
    }

    get origin() {
      if (this.#protocol === 'blob:') {
        try {
          return new URL(this.#pathname).origin;
        } catch {
          return 'null';
        }
      }
      return this.#protocol + '//' + this.host;
    }

    get href() {
      let result = this.#protocol;
      if (this.#hostname) {
        result += '//';
        if (this.#username) {
          result += encodeURIComponent(this.#username);
          if (this.#password) {
            result += ':' + encodeURIComponent(this.#password);
          }
          result += '@';
        }
        result += this.host;
      }
      result += this.#pathname + this.#search + this.#hash;
      return result;
    }
    set href(value) {
      const newUrl = new URL(String(value));
      this.#protocol = newUrl.protocol;
      this.#username = newUrl.username;
      this.#password = newUrl.password;
      this.#hostname = newUrl.hostname;
      this.#port = newUrl.port;
      this.#pathname = newUrl.pathname;
      this.#search = newUrl.search;
      this.#hash = newUrl.hash;
      this.#searchParams = null;
    }

    get searchParams() {
      if (!this.#searchParams) {
        this.#searchParams = new URLSearchParams(this.#search);
      }
      return this.#searchParams;
    }

    toString() { return this.href; }
    toJSON() { return this.href; }

    static canParse(url, base) {
      try {
        new URL(url, base);
        return true;
      } catch {
        return false;
      }
    }
  }

  globalThis.URL = URL;
  globalThis.URLSearchParams = URLSearchParams;
})();
`;

  context.evalSync(code);
}

// ============================================================================
// Blob / File Implementation
// ============================================================================

interface BlobState {
  parts: Uint8Array[];
  type: string;
  size: number;
}

interface FileState extends BlobState {
  name: string;
  lastModified: number;
}

async function injectBlob(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): Promise<void> {
  // Helper function to convert parts to bytes
  const partsToBytes = (parts: unknown[]): Uint8Array[] => {
    return parts.map((part) => {
      if (typeof part === "string") {
        return new TextEncoder().encode(part);
      }
      if (part instanceof Uint8Array) {
        return part;
      }
      if (part instanceof ArrayBuffer) {
        return new Uint8Array(part);
      }
      if (ArrayBuffer.isView(part)) {
        return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      }
      // For blob parts, we'd need to get their bytes - handled in isolate
      return new TextEncoder().encode(String(part));
    });
  };

  // Register helper callbacks
  const global = context.global;

  // Blob constructor
  global.setSync(
    "__Blob_construct",
    new ivm.Callback((parts: unknown[], options?: { type?: string }) => {
      const instanceId = nextInstanceId++;
      const bytes = partsToBytes(parts || []);
      const size = bytes.reduce((acc, b) => acc + b.length, 0);
      const state: BlobState = {
        parts: bytes,
        type: options?.type?.toLowerCase() || "",
        size,
      };
      stateMap.set(instanceId, state);
      return instanceId;
    })
  );

  global.setSync(
    "__Blob_get_size",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as BlobState;
      return state?.size ?? 0;
    })
  );

  global.setSync(
    "__Blob_get_type",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as BlobState;
      return state?.type ?? "";
    })
  );

  global.setSync(
    "__Blob_text",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as BlobState;
      if (!state) return "";
      const combined = new Uint8Array(state.size);
      let offset = 0;
      for (const part of state.parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      return new TextDecoder().decode(combined);
    })
  );

  global.setSync(
    "__Blob_arrayBuffer",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as BlobState;
      if (!state) return new ivm.ExternalCopy(new ArrayBuffer(0)).copyInto();
      const combined = new Uint8Array(state.size);
      let offset = 0;
      for (const part of state.parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      return new ivm.ExternalCopy(combined.buffer).copyInto();
    })
  );

  global.setSync(
    "__Blob_bytes",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as BlobState;
      if (!state) return new ivm.ExternalCopy(new Uint8Array(0)).copyInto();
      const combined = new Uint8Array(state.size);
      let offset = 0;
      for (const part of state.parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      return new ivm.ExternalCopy(combined).copyInto();
    })
  );

  global.setSync(
    "__Blob_slice",
    new ivm.Callback(
      (
        instanceId: number,
        start?: number,
        end?: number,
        contentType?: string
      ) => {
        const state = stateMap.get(instanceId) as BlobState;
        if (!state) {
          const newId = nextInstanceId++;
          stateMap.set(newId, { parts: [], type: "", size: 0 });
          return newId;
        }

        // Combine all parts
        const combined = new Uint8Array(state.size);
        let offset = 0;
        for (const part of state.parts) {
          combined.set(part, offset);
          offset += part.length;
        }

        // Handle negative indices
        let s = start ?? 0;
        let e = end ?? state.size;
        if (s < 0) s = Math.max(0, state.size + s);
        if (e < 0) e = Math.max(0, state.size + e);
        s = Math.min(s, state.size);
        e = Math.min(e, state.size);

        const sliced = combined.slice(s, e);
        const newId = nextInstanceId++;
        const newState: BlobState = {
          parts: [sliced],
          type: contentType ?? state.type,
          size: sliced.length,
        };
        stateMap.set(newId, newState);
        return newId;
      }
    )
  );

  // File constructor (extends Blob)
  global.setSync(
    "__File_construct",
    new ivm.Callback(
      (
        parts: unknown[],
        name: string,
        options?: { type?: string; lastModified?: number }
      ) => {
        const instanceId = nextInstanceId++;
        const bytes = partsToBytes(parts || []);
        const size = bytes.reduce((acc, b) => acc + b.length, 0);
        const state: FileState = {
          parts: bytes,
          type: options?.type?.toLowerCase() || "",
          size,
          name: String(name),
          lastModified: options?.lastModified ?? Date.now(),
        };
        stateMap.set(instanceId, state);
        return instanceId;
      }
    )
  );

  global.setSync(
    "__File_get_name",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as FileState;
      return state?.name ?? "";
    })
  );

  global.setSync(
    "__File_get_lastModified",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as FileState;
      return state?.lastModified ?? 0;
    })
  );

  // Inject Blob and File classes
  // Using a WeakMap inside the isolate to store instance IDs (avoids private field issues)
  const blobCode = `
(function() {
  const _blobInstanceIds = new WeakMap();

  class Blob {
    constructor(parts = [], options = {}) {
      if (parts === null && options === null) {
        // Internal: creating from existing instance ID (set via _setInstanceId)
        return;
      }
      const instanceId = __Blob_construct(parts, options);
      _blobInstanceIds.set(this, instanceId);
    }

    static _createFromInstanceId(instanceId) {
      const blob = new Blob(null, null);
      _blobInstanceIds.set(blob, instanceId);
      return blob;
    }

    _getInstanceId() {
      return _blobInstanceIds.get(this);
    }

    get size() {
      return __Blob_get_size(this._getInstanceId());
    }

    get type() {
      return __Blob_get_type(this._getInstanceId());
    }

    async text() {
      return await __Blob_text(this._getInstanceId());
    }

    async arrayBuffer() {
      return await __Blob_arrayBuffer(this._getInstanceId());
    }

    async bytes() {
      return await __Blob_bytes(this._getInstanceId());
    }

    slice(start, end, contentType) {
      const newInstanceId = __Blob_slice(this._getInstanceId(), start, end, contentType);
      return Blob._createFromInstanceId(newInstanceId);
    }

    stream() {
      const blob = this;
      return new ReadableStream({
        async start(controller) {
          const buffer = await blob.arrayBuffer();
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        }
      });
    }
  }

  class File extends Blob {
    constructor(parts, name, options = {}) {
      // Create file through host callback
      super(null, null);
      const instanceId = __File_construct(parts, name, options);
      _blobInstanceIds.set(this, instanceId);
    }

    get name() {
      return __File_get_name(this._getInstanceId());
    }

    get lastModified() {
      return __File_get_lastModified(this._getInstanceId());
    }

    slice(start, end, contentType) {
      const newInstanceId = __Blob_slice(this._getInstanceId(), start, end, contentType);
      return Blob._createFromInstanceId(newInstanceId);
    }
  }

  globalThis.Blob = Blob;
  globalThis.File = File;
})();
`;

  context.evalSync(blobCode);
}

// ============================================================================
// DOMException Implementation
// ============================================================================

async function injectDOMException(context: ivm.Context): Promise<void> {
  const code = `
(function() {
  class DOMException extends Error {
    #code;

    static INDEX_SIZE_ERR = 1;
    static DOMSTRING_SIZE_ERR = 2;
    static HIERARCHY_REQUEST_ERR = 3;
    static WRONG_DOCUMENT_ERR = 4;
    static INVALID_CHARACTER_ERR = 5;
    static NO_DATA_ALLOWED_ERR = 6;
    static NO_MODIFICATION_ALLOWED_ERR = 7;
    static NOT_FOUND_ERR = 8;
    static NOT_SUPPORTED_ERR = 9;
    static INUSE_ATTRIBUTE_ERR = 10;
    static INVALID_STATE_ERR = 11;
    static SYNTAX_ERR = 12;
    static INVALID_MODIFICATION_ERR = 13;
    static NAMESPACE_ERR = 14;
    static INVALID_ACCESS_ERR = 15;
    static VALIDATION_ERR = 16;
    static TYPE_MISMATCH_ERR = 17;
    static SECURITY_ERR = 18;
    static NETWORK_ERR = 19;
    static ABORT_ERR = 20;
    static URL_MISMATCH_ERR = 21;
    static QUOTA_EXCEEDED_ERR = 22;
    static TIMEOUT_ERR = 23;
    static INVALID_NODE_TYPE_ERR = 24;
    static DATA_CLONE_ERR = 25;

    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
      this.#code = this.#getCode(name);
    }

    get code() {
      return this.#code;
    }

    #getCode(name) {
      const codes = {
        'IndexSizeError': 1,
        'HierarchyRequestError': 3,
        'WrongDocumentError': 4,
        'InvalidCharacterError': 5,
        'NoModificationAllowedError': 7,
        'NotFoundError': 8,
        'NotSupportedError': 9,
        'InUseAttributeError': 10,
        'InvalidStateError': 11,
        'SyntaxError': 12,
        'InvalidModificationError': 13,
        'NamespaceError': 14,
        'InvalidAccessError': 15,
        'TypeMismatchError': 17,
        'SecurityError': 18,
        'NetworkError': 19,
        'AbortError': 20,
        'URLMismatchError': 21,
        'QuotaExceededError': 22,
        'TimeoutError': 23,
        'InvalidNodeTypeError': 24,
        'DataCloneError': 25,
      };
      return codes[name] ?? 0;
    }
  }

  globalThis.DOMException = DOMException;
})();
`;

  context.evalSync(code);
}

// ============================================================================
// AbortController / AbortSignal Implementation
// ============================================================================

async function injectAbortController(context: ivm.Context): Promise<void> {
  const code = `
(function() {
  // Use WeakMap for private state (similar to Blob pattern)
  const _abortSignalState = new WeakMap();

  class AbortSignal {
    constructor() {
      // AbortSignal should not be constructed directly
      // Only AbortController can create it
      _abortSignalState.set(this, { aborted: false, reason: undefined, listeners: [] });
    }

    get aborted() {
      return _abortSignalState.get(this)?.aborted ?? false;
    }

    get reason() {
      return _abortSignalState.get(this)?.reason;
    }

    throwIfAborted() {
      const state = _abortSignalState.get(this);
      if (state?.aborted) {
        throw state.reason;
      }
    }

    addEventListener(type, listener) {
      if (type !== 'abort') return;
      const state = _abortSignalState.get(this);
      if (state) {
        state.listeners.push(listener);
      }
    }

    removeEventListener(type, listener) {
      if (type !== 'abort') return;
      const state = _abortSignalState.get(this);
      if (state) {
        const idx = state.listeners.indexOf(listener);
        if (idx !== -1) state.listeners.splice(idx, 1);
      }
    }

    _abort(reason) {
      const state = _abortSignalState.get(this);
      if (!state || state.aborted) return;
      state.aborted = true;
      state.reason = reason !== undefined ? reason : new DOMException('The operation was aborted.', 'AbortError');
      const event = { type: 'abort', target: this };
      for (const listener of state.listeners) {
        try {
          listener(event);
        } catch (e) {
          // Ignore listener errors
        }
      }
    }

    static abort(reason) {
      const controller = new AbortController();
      controller.abort(reason);
      return controller.signal;
    }

    static timeout(milliseconds) {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      }, milliseconds);
      return controller.signal;
    }
  }

  class AbortController {
    #signal = null;

    constructor() {
      this.#signal = new AbortSignal();
    }

    get signal() {
      return this.#signal;
    }

    abort(reason) {
      this.#signal._abort(reason);
    }
  }

  globalThis.AbortController = AbortController;
  globalThis.AbortSignal = AbortSignal;
})();
`;

  context.evalSync(code);
}

// ============================================================================
// Streams Implementation
// ============================================================================

async function injectStreams(
  context: ivm.Context,
  _stateMap: Map<number, unknown>
): Promise<void> {
  // WHATWG Streams implementation
  const streamsCode = `
(function() {
  // Simple queue implementation
  class SimpleQueue {
    #items = [];

    enqueue(item) {
      this.#items.push(item);
    }

    dequeue() {
      return this.#items.shift();
    }

    peek() {
      return this.#items[0];
    }

    get length() {
      return this.#items.length;
    }

    isEmpty() {
      return this.#items.length === 0;
    }
  }

  // ReadableStream
  class ReadableStream {
    #state = 'readable';
    #reader = null;
    #storedError = undefined;
    #controller = null;
    #underlyingSource = null;

    constructor(underlyingSource = {}, strategy = {}) {
      this.#underlyingSource = underlyingSource;

      const controller = {
        stream: this,
        queue: new SimpleQueue(),
        started: false,
        closeRequested: false,
        pullAgain: false,
        pulling: false,

        close: () => {
          if (this.#state !== 'readable') return;
          controller.closeRequested = true;
          if (controller.queue.isEmpty()) {
            this.#state = 'closed';
            if (this.#reader) {
              this.#reader._resolveClose?.();
            }
          }
        },

        enqueue: (chunk) => {
          if (this.#state !== 'readable') return;
          controller.queue.enqueue(chunk);
          if (this.#reader && this.#reader._pendingRead) {
            const { resolve } = this.#reader._pendingRead;
            this.#reader._pendingRead = null;
            const chunk = controller.queue.dequeue();
            resolve({ value: chunk, done: false });
            if (controller.closeRequested && controller.queue.isEmpty()) {
              this.#state = 'closed';
              this.#reader._resolveClose?.();
            }
          }
        },

        error: (e) => {
          if (this.#state !== 'readable') return;
          this.#state = 'errored';
          this.#storedError = e;
          if (this.#reader && this.#reader._pendingRead) {
            const { reject } = this.#reader._pendingRead;
            this.#reader._pendingRead = null;
            reject(e);
          }
        },

        desiredSize: strategy.highWaterMark ?? 1
      };

      this.#controller = controller;

      // Start the underlying source
      const startPromise = Promise.resolve(underlyingSource.start?.(controller));
      startPromise.then(() => {
        controller.started = true;
      }).catch((e) => {
        controller.error(e);
      });
    }

    get locked() {
      return this.#reader !== null;
    }

    cancel(reason) {
      if (this.#reader) {
        return Promise.reject(new TypeError('Cannot cancel a stream that has a reader'));
      }
      this.#state = 'closed';
      return Promise.resolve(this.#underlyingSource?.cancel?.(reason));
    }

    getReader(options = {}) {
      if (this.#reader) {
        throw new TypeError('ReadableStream is already locked');
      }
      const reader = new ReadableStreamDefaultReader(this);
      this.#reader = reader;
      return reader;
    }

    pipeThrough(transform, options = {}) {
      const readable = transform.readable;
      const writable = transform.writable;
      this.pipeTo(writable, options);
      return readable;
    }

    async pipeTo(destination, options = {}) {
      const reader = this.getReader();
      const writer = destination.getWriter();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
        await writer.close();
      } catch (e) {
        await writer.abort(e);
        throw e;
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    }

    tee() {
      const reader = this.getReader();
      const branch1Queue = new SimpleQueue();
      const branch2Queue = new SimpleQueue();
      let reading = false;
      let canceled1 = false;
      let canceled2 = false;
      let reason1;
      let reason2;

      const pullAlgorithm = async () => {
        if (reading) return;
        reading = true;

        try {
          const { value, done } = await reader.read();
          reading = false;

          if (done) {
            if (!canceled1) branch1Controller.close();
            if (!canceled2) branch2Controller.close();
            return;
          }

          if (!canceled1) branch1Queue.enqueue(value);
          if (!canceled2) branch2Queue.enqueue(value);
        } catch (e) {
          if (!canceled1) branch1Controller.error(e);
          if (!canceled2) branch2Controller.error(e);
        }
      };

      let branch1Controller;
      let branch2Controller;

      const branch1 = new ReadableStream({
        start(controller) {
          branch1Controller = controller;
        },
        pull(controller) {
          return pullAlgorithm();
        },
        cancel(reason) {
          canceled1 = true;
          reason1 = reason;
          if (canceled2) {
            reader.cancel([reason1, reason2]);
          }
        }
      });

      const branch2 = new ReadableStream({
        start(controller) {
          branch2Controller = controller;
        },
        pull(controller) {
          return pullAlgorithm();
        },
        cancel(reason) {
          canceled2 = true;
          reason2 = reason;
          if (canceled1) {
            reader.cancel([reason1, reason2]);
          }
        }
      });

      return [branch1, branch2];
    }

    async *[Symbol.asyncIterator]() {
      const reader = this.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }

    // Internal methods for reader access
    _getController() {
      return this.#controller;
    }

    _getState() {
      return this.#state;
    }

    _getStoredError() {
      return this.#storedError;
    }

    _setReader(reader) {
      this.#reader = reader;
    }

    _pull() {
      const controller = this.#controller;
      if (!controller.started || controller.pulling) return;
      controller.pulling = true;

      Promise.resolve(this.#underlyingSource?.pull?.(controller))
        .then(() => {
          controller.pulling = false;
          if (controller.pullAgain) {
            controller.pullAgain = false;
            this._pull();
          }
        })
        .catch((e) => {
          controller.error(e);
        });
    }

    static from(asyncIterable) {
      const iterator = asyncIterable[Symbol.asyncIterator]?.() ?? asyncIterable[Symbol.iterator]?.();

      return new ReadableStream({
        async pull(controller) {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        },
        cancel(reason) {
          iterator.return?.(reason);
        }
      });
    }
  }

  // ReadableStreamDefaultReader
  class ReadableStreamDefaultReader {
    #stream = null;
    _pendingRead = null;
    _resolveClose = null;
    _rejectClose = null;
    #closed = null;

    constructor(stream) {
      if (stream.locked) {
        throw new TypeError('ReadableStream is already locked');
      }
      this.#stream = stream;
      stream._setReader(this);

      this.#closed = new Promise((resolve, reject) => {
        this._resolveClose = resolve;
        this._rejectClose = reject;
      });
    }

    get closed() {
      return this.#closed;
    }

    async read() {
      if (!this.#stream) {
        throw new TypeError('Reader has been released');
      }

      const controller = this.#stream._getController();
      const state = this.#stream._getState();

      if (state === 'closed') {
        return { value: undefined, done: true };
      }

      if (state === 'errored') {
        throw this.#stream._getStoredError();
      }

      if (!controller.queue.isEmpty()) {
        const chunk = controller.queue.dequeue();
        if (controller.closeRequested && controller.queue.isEmpty()) {
          this._resolveClose?.();
        }
        return { value: chunk, done: false };
      }

      // Need to wait for data
      return new Promise((resolve, reject) => {
        this._pendingRead = { resolve, reject };
        this.#stream._pull();
      });
    }

    cancel(reason) {
      if (!this.#stream) {
        return Promise.reject(new TypeError('Reader has been released'));
      }
      return this.#stream.cancel(reason);
    }

    releaseLock() {
      if (!this.#stream) return;
      if (this._pendingRead) {
        this._pendingRead.reject(new TypeError('Reader was released'));
        this._pendingRead = null;
      }
      this.#stream._setReader(null);
      this.#stream = null;
    }
  }

  // WritableStream
  class WritableStream {
    #state = 'writable';
    #writer = null;
    #storedError = undefined;
    #controller = null;
    #underlyingSink = null;
    #writeQueue = [];
    #closePromise = null;

    constructor(underlyingSink = {}, strategy = {}) {
      this.#underlyingSink = underlyingSink;

      const controller = {
        stream: this,
        signal: new AbortController().signal,
        error: (e) => {
          if (this.#state !== 'writable') return;
          this.#state = 'errored';
          this.#storedError = e;
        }
      };

      this.#controller = controller;

      Promise.resolve(underlyingSink.start?.(controller))
        .catch((e) => {
          controller.error(e);
        });
    }

    get locked() {
      return this.#writer !== null;
    }

    abort(reason) {
      if (this.#writer) {
        return Promise.reject(new TypeError('Cannot abort a stream that has a writer'));
      }
      this.#state = 'errored';
      this.#storedError = reason;
      return Promise.resolve(this.#underlyingSink?.abort?.(reason));
    }

    close() {
      if (this.#writer) {
        return Promise.reject(new TypeError('Cannot close a stream that has a writer'));
      }
      return this._close();
    }

    _close() {
      if (this.#closePromise) return this.#closePromise;

      this.#closePromise = Promise.resolve(this.#underlyingSink?.close?.())
        .then(() => {
          this.#state = 'closed';
        });

      return this.#closePromise;
    }

    getWriter() {
      if (this.#writer) {
        throw new TypeError('WritableStream is already locked');
      }
      const writer = new WritableStreamDefaultWriter(this);
      this.#writer = writer;
      return writer;
    }

    // Internal methods
    _getState() {
      return this.#state;
    }

    _getStoredError() {
      return this.#storedError;
    }

    _setWriter(writer) {
      this.#writer = writer;
    }

    async _write(chunk) {
      if (this.#state !== 'writable') {
        throw this.#storedError || new TypeError('Stream is not writable');
      }
      return this.#underlyingSink?.write?.(chunk, this.#controller);
    }
  }

  // WritableStreamDefaultWriter
  class WritableStreamDefaultWriter {
    #stream = null;
    #ready = null;
    #closed = null;

    constructor(stream) {
      if (stream.locked) {
        throw new TypeError('WritableStream is already locked');
      }
      this.#stream = stream;
      stream._setWriter(this);

      this.#ready = Promise.resolve();
      this.#closed = new Promise((resolve) => {
        // Will be resolved when stream closes
      });
    }

    get closed() {
      return this.#closed;
    }

    get ready() {
      return this.#ready;
    }

    get desiredSize() {
      return 1;
    }

    abort(reason) {
      if (!this.#stream) {
        return Promise.reject(new TypeError('Writer has been released'));
      }
      return this.#stream.abort(reason);
    }

    close() {
      if (!this.#stream) {
        return Promise.reject(new TypeError('Writer has been released'));
      }
      return this.#stream._close();
    }

    write(chunk) {
      if (!this.#stream) {
        return Promise.reject(new TypeError('Writer has been released'));
      }
      return this.#stream._write(chunk);
    }

    releaseLock() {
      if (!this.#stream) return;
      this.#stream._setWriter(null);
      this.#stream = null;
    }
  }

  // TransformStream
  class TransformStream {
    #readable;
    #writable;

    constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
      let readableController;

      this.#readable = new ReadableStream({
        start(controller) {
          readableController = controller;
        }
      }, readableStrategy);

      const transformerController = {
        enqueue: (chunk) => {
          readableController.enqueue(chunk);
        },
        error: (e) => {
          readableController.error(e);
        },
        terminate: () => {
          readableController.close();
        },
        desiredSize: readableController?.desiredSize ?? 1
      };

      this.#writable = new WritableStream({
        start() {
          return transformer.start?.(transformerController);
        },
        write(chunk) {
          return transformer.transform?.(chunk, transformerController);
        },
        close() {
          return transformer.flush?.(transformerController);
        },
        abort(reason) {
          return Promise.resolve();
        }
      }, writableStrategy);
    }

    get readable() {
      return this.#readable;
    }

    get writable() {
      return this.#writable;
    }
  }

  // ByteLengthQueuingStrategy
  class ByteLengthQueuingStrategy {
    #highWaterMark;

    constructor({ highWaterMark }) {
      this.#highWaterMark = highWaterMark;
    }

    get highWaterMark() {
      return this.#highWaterMark;
    }

    get size() {
      return (chunk) => chunk.byteLength;
    }
  }

  // CountQueuingStrategy
  class CountQueuingStrategy {
    #highWaterMark;

    constructor({ highWaterMark }) {
      this.#highWaterMark = highWaterMark;
    }

    get highWaterMark() {
      return this.#highWaterMark;
    }

    get size() {
      return () => 1;
    }
  }

  globalThis.ReadableStream = ReadableStream;
  globalThis.ReadableStreamDefaultReader = ReadableStreamDefaultReader;
  globalThis.WritableStream = WritableStream;
  globalThis.WritableStreamDefaultWriter = WritableStreamDefaultWriter;
  globalThis.TransformStream = TransformStream;
  globalThis.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
  globalThis.CountQueuingStrategy = CountQueuingStrategy;
})();
`;

  context.evalSync(streamsCode);
}
