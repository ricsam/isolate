/**
 * Value marshalling for custom function arguments and return values.
 *
 * Provides type-preserving serialization for JavaScript types that would
 * otherwise lose fidelity when JSON stringified.
 */

import {
  type CallbackRef,
  type DateRef,
  type RegExpRef,
  type UndefinedRef,
  type BigIntRef,
  type Uint8ArrayRef,
  type RequestRef,
  type ResponseRef,
  type HeadersRef,
  type FileRef,
  type FormDataRef,
  type URLRef,
  type PromiseRef,
  type AsyncIteratorRef,
  type BlobRef,
  createCallbackRef,
  createDateRef,
  createRegExpRef,
  createUndefinedRef,
  createBigIntRef,
  createUint8ArrayRef,
  createRequestRef,
  createResponseRef,
  createHeadersRef,
  createFileRef,
  createFormDataRef,
  createURLRef,
  createPromiseRef,
  createAsyncIteratorRef,
  createBlobRef,
} from "./codec.ts";

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown when a value cannot be marshalled.
 */
export class MarshalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarshalError";
  }
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context for marshalling values (host → isolate).
 */
export interface MarshalContext {
  /** Register a function callback and return its ID */
  registerCallback?: (fn: Function) => number;
  /** Register a Promise and return its ID */
  registerPromise?: (promise: Promise<unknown>) => number;
  /** Register an AsyncIterator and return its ID */
  registerIterator?: (iterator: AsyncIterator<unknown>) => number;
  /** Register a Blob and return its ID */
  registerBlob?: (blob: Blob) => number;
}

/**
 * Context for unmarshalling values (isolate → host).
 */
export interface UnmarshalContext {
  /** Get a callback function by ID */
  getCallback?: (id: number) => ((...args: unknown[]) => unknown) | undefined;
  /** Create a proxy Promise for a PromiseRef */
  createPromiseProxy?: (promiseId: number) => Promise<unknown>;
  /** Create a proxy AsyncIterator for an AsyncIteratorRef */
  createIteratorProxy?: (iteratorId: number) => AsyncIterator<unknown>;
  /** Get a Blob by ID */
  getBlob?: (blobId: number) => Blob | undefined;
}

// ============================================================================
// Type Guards for Ref Types
// ============================================================================

/**
 * Type guard for PromiseRef values.
 */
export function isPromiseRef(value: unknown): value is { __type: "PromiseRef"; promiseId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: string }).__type === 'PromiseRef'
  );
}

/**
 * Type guard for AsyncIteratorRef values.
 */
export function isAsyncIteratorRef(value: unknown): value is { __type: "AsyncIteratorRef"; iteratorId: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __type?: string }).__type === 'AsyncIteratorRef'
  );
}

// ============================================================================
// Supported Class Detection
// ============================================================================

/**
 * Set of class names that are supported for marshalling.
 */
const SUPPORTED_CLASSES = new Set([
  "Date",
  "RegExp",
  "Request",
  "Response",
  "Headers",
  "File",
  "Blob",
  "FormData",
  "URL",
  // Typed arrays are natively supported by msgpack
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ArrayBuffer",
  "DataView",
]);

/**
 * Check if a value is a typed array.
 */
function isTypedArray(value: unknown): value is ArrayBufferView {
  return (
    value instanceof Uint8Array ||
    value instanceof Int8Array ||
    value instanceof Uint16Array ||
    value instanceof Int16Array ||
    value instanceof Uint32Array ||
    value instanceof Int32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array ||
    value instanceof DataView
  );
}

/**
 * Check if a value is an async iterable (has Symbol.asyncIterator).
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
  );
}

// ============================================================================
// Marshalling (JavaScript → Refs)
// ============================================================================

const MAX_DEPTH = 100;

/**
 * Marshal a JavaScript value to a serializable format.
 *
 * Converts JavaScript types that lose fidelity when JSON stringified into
 * Ref objects that can be reconstructed on the other side.
 *
 * @param value - The value to marshal
 * @param ctx - Optional context for registering callbacks, promises, etc.
 * @param depth - Current recursion depth (used for circular reference detection)
 * @param seen - WeakSet of seen objects (for circular reference detection)
 * @returns The marshalled value (may be async for Request/Response/File/Blob/FormData)
 */
export async function marshalValue(
  value: unknown,
  ctx?: MarshalContext,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet()
): Promise<unknown> {
  // Check depth limit
  if (depth > MAX_DEPTH) {
    throw new MarshalError(
      `Maximum marshalling depth (${MAX_DEPTH}) exceeded. Possible circular reference.`
    );
  }

  // Handle null
  if (value === null) {
    return null;
  }

  // Handle undefined
  if (value === undefined) {
    return createUndefinedRef();
  }

  // Handle primitives (pass through)
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }

  // Handle BigInt
  if (type === "bigint") {
    return createBigIntRef((value as bigint).toString());
  }

  // Handle functions
  if (type === "function") {
    if (!ctx?.registerCallback) {
      throw new MarshalError(
        "Cannot marshal function: no registerCallback provided in context"
      );
    }
    const callbackId = ctx.registerCallback(value as Function);
    return createCallbackRef(callbackId);
  }

  // Handle objects
  if (type === "object") {
    const obj = value as object;

    // Check for circular references
    if (seen.has(obj)) {
      throw new MarshalError(
        "Cannot marshal value: circular reference detected"
      );
    }

    // Handle Date
    if (obj instanceof Date) {
      return createDateRef(obj.getTime());
    }

    // Handle RegExp
    if (obj instanceof RegExp) {
      return createRegExpRef(obj.source, obj.flags);
    }

    // Handle URL
    if (obj instanceof URL) {
      return createURLRef(obj.href);
    }

    // Handle Headers
    if (typeof Headers !== "undefined" && obj instanceof Headers) {
      const pairs: [string, string][] = [];
      (obj as Headers).forEach((value, key) => {
        pairs.push([key, value]);
      });
      return createHeadersRef(pairs);
    }

    // Handle Uint8Array and ArrayBuffer - wrap in Uint8ArrayRef for JSON compatibility
    if (obj instanceof Uint8Array) {
      return createUint8ArrayRef(Array.from(obj));
    }
    if (obj instanceof ArrayBuffer) {
      return createUint8ArrayRef(Array.from(new Uint8Array(obj)));
    }

    // Handle other typed arrays (convert to Uint8ArrayRef)
    if (isTypedArray(obj)) {
      const u8 = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength);
      return createUint8ArrayRef(Array.from(u8));
    }

    // Handle Promise
    if (obj instanceof Promise) {
      if (!ctx?.registerPromise) {
        throw new MarshalError(
          "Cannot marshal Promise: no registerPromise provided in context"
        );
      }
      const promiseId = ctx.registerPromise(obj as Promise<unknown>);
      return createPromiseRef(promiseId);
    }

    // Handle AsyncIterable (must check before generic object)
    if (isAsyncIterable(obj)) {
      if (!ctx?.registerIterator) {
        throw new MarshalError(
          "Cannot marshal AsyncIterable: no registerIterator provided in context"
        );
      }
      const iterator = (obj as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const iteratorId = ctx.registerIterator(iterator);
      return createAsyncIteratorRef(iteratorId);
    }

    // Mark as seen for circular reference detection
    seen.add(obj);

    // Handle Request (async - need to read body)
    if (typeof Request !== "undefined" && obj instanceof Request) {
      const req = obj as Request;
      const headers: [string, string][] = [];
      req.headers.forEach((value, key) => {
        headers.push([key, value]);
      });
      let body: number[] | null = null;
      if (req.body) {
        // Clone the request to avoid consuming the body
        const cloned = req.clone();
        body = Array.from(new Uint8Array(await cloned.arrayBuffer()));
      }
      return createRequestRef(req.url, req.method, headers, body, {
        mode: req.mode,
        credentials: req.credentials,
        cache: req.cache,
        redirect: req.redirect,
        referrer: req.referrer,
        referrerPolicy: req.referrerPolicy,
        integrity: req.integrity,
      });
    }

    // Handle Response (async - need to read body)
    if (typeof Response !== "undefined" && obj instanceof Response) {
      const res = obj as Response;
      const headers: [string, string][] = [];
      res.headers.forEach((value, key) => {
        headers.push([key, value]);
      });
      let body: number[] | null = null;
      if (res.body) {
        // Clone the response to avoid consuming the body
        const cloned = res.clone();
        body = Array.from(new Uint8Array(await cloned.arrayBuffer()));
      }
      return createResponseRef(res.status, res.statusText, headers, body);
    }

    // Handle File (async - need to read data)
    if (typeof File !== "undefined" && obj instanceof File) {
      const file = obj as File;
      const data = Array.from(new Uint8Array(await file.arrayBuffer()));
      return createFileRef(file.name, file.type, file.lastModified, data);
    }

    // Handle Blob (async - need to read data, or use BlobRef if registerBlob provided)
    if (typeof Blob !== "undefined" && obj instanceof Blob) {
      const blob = obj as Blob;
      if (ctx?.registerBlob) {
        const blobId = ctx.registerBlob(blob);
        return createBlobRef(blobId, blob.size, blob.type);
      }
      // Inline the blob data as a FileRef without name
      const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
      return createFileRef("", blob.type, Date.now(), data);
    }

    // Handle FormData (async - entries may contain Files)
    if (typeof FormData !== "undefined" && obj instanceof FormData) {
      const fd = obj as FormData;
      const entries: [string, string | FileRef][] = [];
      for (const [key, value] of fd.entries()) {
        if (typeof value === "string") {
          entries.push([key, value]);
        } else {
          // File/Blob - cast to File for type safety
          const file = value as File;
          const data = Array.from(new Uint8Array(await file.arrayBuffer()));
          const fileRef = createFileRef(
            file.name ?? "",
            file.type,
            file.lastModified ?? Date.now(),
            data
          );
          entries.push([key, fileRef]);
        }
      }
      return createFormDataRef(entries);
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      const result: unknown[] = [];
      for (const item of obj) {
        result.push(await marshalValue(item, ctx, depth + 1, seen));
      }
      return result;
    }

    // Handle plain objects
    const constructorName = obj.constructor?.name;
    if (constructorName && constructorName !== "Object") {
      if (!SUPPORTED_CLASSES.has(constructorName)) {
        throw new MarshalError(
          `Cannot marshal class instance of type "${constructorName}". ` +
            `Only plain objects and supported classes are allowed.`
        );
      }
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = await marshalValue(
        (obj as Record<string, unknown>)[key],
        ctx,
        depth + 1,
        seen
      );
    }
    return result;
  }

  // Handle symbols (not serializable)
  if (type === "symbol") {
    throw new MarshalError("Cannot marshal Symbol values");
  }

  // Unknown type
  throw new MarshalError(`Cannot marshal value of type "${type}"`);
}

/**
 * Synchronous marshal for values that don't require async operations.
 * Throws if the value contains Request, Response, File, Blob, or FormData.
 */
export function marshalValueSync(
  value: unknown,
  ctx?: MarshalContext,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  // Check depth limit
  if (depth > MAX_DEPTH) {
    throw new MarshalError(
      `Maximum marshalling depth (${MAX_DEPTH}) exceeded. Possible circular reference.`
    );
  }

  // Handle null
  if (value === null) {
    return null;
  }

  // Handle undefined
  if (value === undefined) {
    return createUndefinedRef();
  }

  // Handle primitives (pass through)
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }

  // Handle BigInt
  if (type === "bigint") {
    return createBigIntRef((value as bigint).toString());
  }

  // Handle functions
  if (type === "function") {
    if (!ctx?.registerCallback) {
      throw new MarshalError(
        "Cannot marshal function: no registerCallback provided in context"
      );
    }
    const callbackId = ctx.registerCallback(value as Function);
    return createCallbackRef(callbackId);
  }

  // Handle objects
  if (type === "object") {
    const obj = value as object;

    // Check for circular references
    if (seen.has(obj)) {
      throw new MarshalError(
        "Cannot marshal value: circular reference detected"
      );
    }

    // Handle Date
    if (obj instanceof Date) {
      return createDateRef(obj.getTime());
    }

    // Handle RegExp
    if (obj instanceof RegExp) {
      return createRegExpRef(obj.source, obj.flags);
    }

    // Handle URL
    if (obj instanceof URL) {
      return createURLRef(obj.href);
    }

    // Handle Headers
    if (typeof Headers !== "undefined" && obj instanceof Headers) {
      const pairs: [string, string][] = [];
      (obj as Headers).forEach((value, key) => {
        pairs.push([key, value]);
      });
      return createHeadersRef(pairs);
    }

    // Handle Uint8Array and ArrayBuffer - wrap in Uint8ArrayRef for JSON compatibility
    if (obj instanceof Uint8Array) {
      return createUint8ArrayRef(Array.from(obj));
    }
    if (obj instanceof ArrayBuffer) {
      return createUint8ArrayRef(Array.from(new Uint8Array(obj)));
    }

    // Handle other typed arrays (convert to Uint8ArrayRef)
    if (isTypedArray(obj)) {
      const u8 = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength);
      return createUint8ArrayRef(Array.from(u8));
    }

    // Handle Promise
    if (obj instanceof Promise) {
      if (!ctx?.registerPromise) {
        throw new MarshalError(
          "Cannot marshal Promise: no registerPromise provided in context"
        );
      }
      const promiseId = ctx.registerPromise(obj as Promise<unknown>);
      return createPromiseRef(promiseId);
    }

    // Handle AsyncIterable (must check before generic object)
    if (isAsyncIterable(obj)) {
      if (!ctx?.registerIterator) {
        throw new MarshalError(
          "Cannot marshal AsyncIterable: no registerIterator provided in context"
        );
      }
      const iterator = (obj as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const iteratorId = ctx.registerIterator(iterator);
      return createAsyncIteratorRef(iteratorId);
    }

    // Mark as seen for circular reference detection
    seen.add(obj);

    // Async types that can't be marshalled synchronously
    if (typeof Request !== "undefined" && obj instanceof Request) {
      throw new MarshalError(
        "Cannot marshal Request synchronously. Use marshalValue() instead."
      );
    }
    if (typeof Response !== "undefined" && obj instanceof Response) {
      throw new MarshalError(
        "Cannot marshal Response synchronously. Use marshalValue() instead."
      );
    }
    if (typeof File !== "undefined" && obj instanceof File) {
      throw new MarshalError(
        "Cannot marshal File synchronously. Use marshalValue() instead."
      );
    }
    if (typeof Blob !== "undefined" && obj instanceof Blob) {
      throw new MarshalError(
        "Cannot marshal Blob synchronously. Use marshalValue() instead."
      );
    }
    if (typeof FormData !== "undefined" && obj instanceof FormData) {
      throw new MarshalError(
        "Cannot marshal FormData synchronously. Use marshalValue() instead."
      );
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => marshalValueSync(item, ctx, depth + 1, seen));
    }

    // Handle plain objects
    const constructorName = obj.constructor?.name;
    if (constructorName && constructorName !== "Object") {
      if (!SUPPORTED_CLASSES.has(constructorName)) {
        throw new MarshalError(
          `Cannot marshal class instance of type "${constructorName}". ` +
            `Only plain objects and supported classes are allowed.`
        );
      }
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = marshalValueSync(
        (obj as Record<string, unknown>)[key],
        ctx,
        depth + 1,
        seen
      );
    }
    return result;
  }

  // Handle symbols (not serializable)
  if (type === "symbol") {
    throw new MarshalError("Cannot marshal Symbol values");
  }

  // Unknown type
  throw new MarshalError(`Cannot marshal value of type "${type}"`);
}

// ============================================================================
// Unmarshalling (Refs → JavaScript)
// ============================================================================

/**
 * Type guard for checking if a value is a Ref object.
 */
function isRef(value: unknown): value is { __type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "__type" in value &&
    typeof (value as { __type: unknown }).__type === "string"
  );
}

/**
 * Unmarshal a serialized value back to JavaScript types.
 *
 * @param value - The value to unmarshal
 * @param ctx - Optional context for resolving callbacks, promises, etc.
 * @param depth - Current recursion depth
 * @returns The unmarshalled JavaScript value
 */
export function unmarshalValue(
  value: unknown,
  ctx?: UnmarshalContext,
  depth: number = 0
): unknown {
  // Check depth limit
  if (depth > MAX_DEPTH) {
    throw new MarshalError(
      `Maximum unmarshalling depth (${MAX_DEPTH}) exceeded.`
    );
  }

  // Handle null
  if (value === null) {
    return null;
  }

  // Handle primitives (pass through)
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }

  // Handle Uint8Array (msgpack native support)
  if (value instanceof Uint8Array) {
    return value;
  }

  // Handle objects
  if (type === "object") {
    // Check if it's a Ref type
    if (isRef(value)) {
      const refType = value.__type;

      switch (refType) {
        case "UndefinedRef":
          return undefined;

        case "DateRef": {
          const ref = value as DateRef;
          return new Date(ref.timestamp);
        }

        case "RegExpRef": {
          const ref = value as RegExpRef;
          return new RegExp(ref.source, ref.flags);
        }

        case "BigIntRef": {
          const ref = value as BigIntRef;
          return BigInt(ref.value);
        }

        case "Uint8ArrayRef": {
          const ref = value as Uint8ArrayRef;
          return new Uint8Array(ref.data);
        }

        case "URLRef": {
          const ref = value as URLRef;
          return new URL(ref.href);
        }

        case "HeadersRef": {
          const ref = value as HeadersRef;
          return new Headers(ref.pairs);
        }

        case "RequestRef": {
          const ref = value as RequestRef;
          const body = ref.body ? new Uint8Array(ref.body) : null;
          const init: RequestInit = {
            method: ref.method,
            headers: ref.headers,
            body: body as BodyInit | null | undefined,
          };
          if (ref.mode) init.mode = ref.mode as RequestMode;
          if (ref.credentials) init.credentials = ref.credentials as RequestCredentials;
          if (ref.cache) init.cache = ref.cache as RequestCache;
          if (ref.redirect) init.redirect = ref.redirect as RequestRedirect;
          if (ref.referrer) init.referrer = ref.referrer;
          if (ref.referrerPolicy) init.referrerPolicy = ref.referrerPolicy as ReferrerPolicy;
          if (ref.integrity) init.integrity = ref.integrity;
          return new Request(ref.url, init);
        }

        case "ResponseRef": {
          const ref = value as ResponseRef;
          const body = ref.body ? new Uint8Array(ref.body) : null;
          return new Response(body as BodyInit | null | undefined, {
            status: ref.status,
            statusText: ref.statusText,
            headers: ref.headers,
          });
        }

        case "FileRef": {
          const ref = value as FileRef;
          const data = new Uint8Array(ref.data);
          // If no name, return as Blob
          if (!ref.name) {
            return new Blob([data as BlobPart], { type: ref.type });
          }
          return new File([data as BlobPart], ref.name, {
            type: ref.type,
            lastModified: ref.lastModified,
          });
        }

        case "BlobRef": {
          const ref = value as BlobRef;
          if (ctx?.getBlob) {
            const blob = ctx.getBlob(ref.blobId);
            if (blob) return blob;
          }
          // Can't reconstruct without the actual data
          throw new MarshalError(
            `Cannot unmarshal BlobRef: no getBlob provided or blob not found`
          );
        }

        case "FormDataRef": {
          const ref = value as FormDataRef;
          const fd = new FormData();
          for (const [key, entry] of ref.entries) {
            if (typeof entry === "string") {
              fd.append(key, entry);
            } else {
              // FileRef
              const file = unmarshalValue(entry, ctx, depth + 1) as File | Blob;
              fd.append(key, file);
            }
          }
          return fd;
        }

        case "CallbackRef": {
          const ref = value as CallbackRef;
          if (!ctx?.getCallback) {
            throw new MarshalError(
              `Cannot unmarshal CallbackRef: no getCallback provided`
            );
          }
          const callback = ctx.getCallback(ref.callbackId);
          if (!callback) {
            throw new MarshalError(
              `Cannot unmarshal CallbackRef: callback ${ref.callbackId} not found`
            );
          }
          return callback;
        }

        case "PromiseRef": {
          const ref = value as PromiseRef;
          if (!ctx?.createPromiseProxy) {
            throw new MarshalError(
              `Cannot unmarshal PromiseRef: no createPromiseProxy provided`
            );
          }
          return ctx.createPromiseProxy(ref.promiseId);
        }

        case "AsyncIteratorRef": {
          const ref = value as AsyncIteratorRef;
          if (!ctx?.createIteratorProxy) {
            throw new MarshalError(
              `Cannot unmarshal AsyncIteratorRef: no createIteratorProxy provided`
            );
          }
          const iterator = ctx.createIteratorProxy(ref.iteratorId);
          // Return as async iterable
          return {
            [Symbol.asyncIterator]() {
              return iterator;
            },
          };
        }

        default:
          // Unknown ref type, return as-is (might be handled by higher level)
          return value;
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => unmarshalValue(item, ctx, depth + 1));
    }

    // Handle plain objects (recursively unmarshal values)
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = unmarshalValue(obj[key], ctx, depth + 1);
    }
    return result;
  }

  // Pass through unknown types
  return value;
}
