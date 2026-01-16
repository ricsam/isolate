/**
 * MessagePack codec with custom extension types for the isolate protocol.
 */

import { encode, decode, ExtensionCodec } from "@msgpack/msgpack";
import type { Message } from "./types.ts";

// ============================================================================
// Custom Extension Types
// ============================================================================

/**
 * Extension type codes for custom data types.
 */
export const ExtType = {
  /** Reference to an isolate instance */
  ISOLATE_REF: 1,
  /** Reference to a registered callback */
  CALLBACK_REF: 2,
  /** Reference to a stream */
  STREAM_REF: 3,
  /** Structured error object */
  ERROR: 4,
  /** Reference to Blob/File data */
  BLOB_REF: 5,
  /** Date value */
  DATE: 6,
  /** RegExp value */
  REGEXP: 7,
  /** Undefined value (null is natively supported) */
  UNDEFINED: 8,
  /** BigInt value */
  BIGINT: 9,
  /** Request object */
  REQUEST: 10,
  /** Response object */
  RESPONSE: 11,
  /** Headers object */
  HEADERS: 12,
  /** File object */
  FILE: 13,
  /** FormData object */
  FORMDATA: 14,
  /** URL object */
  URL_REF: 15,
  /** Promise reference */
  PROMISE: 16,
  /** AsyncIterator reference */
  ASYNC_ITERATOR: 17,
} as const;

export type ExtType = (typeof ExtType)[keyof typeof ExtType];

/**
 * Represents a reference to an isolate.
 */
export interface IsolateRef {
  __type: "IsolateRef";
  isolateId: string;
}

/**
 * Represents a reference to a callback.
 */
export interface CallbackRef {
  __type: "CallbackRef";
  callbackId: number;
}

/**
 * Represents a reference to a stream.
 */
export interface StreamRef {
  __type: "StreamRef";
  streamId: number;
  direction: "upload" | "download";
}

/**
 * Represents a structured error.
 */
export interface ErrorRef {
  __type: "ErrorRef";
  name: string;
  message: string;
  stack?: string;
  code?: number;
}

/**
 * Represents a reference to blob data.
 */
export interface BlobRef {
  __type: "BlobRef";
  blobId: number;
  size: number;
  type: string;
}

/**
 * Represents a serialized Date value.
 */
export interface DateRef {
  __type: "DateRef";
  timestamp: number;
}

/**
 * Represents a serialized RegExp value.
 */
export interface RegExpRef {
  __type: "RegExpRef";
  source: string;
  flags: string;
}

/**
 * Represents an undefined value (since msgpack doesn't natively support undefined).
 */
export interface UndefinedRef {
  __type: "UndefinedRef";
}

/**
 * Represents a serialized BigInt value.
 */
export interface BigIntRef {
  __type: "BigIntRef";
  value: string;
}

/**
 * Represents a serialized Uint8Array value.
 * Uses number[] instead of Uint8Array for JSON compatibility.
 */
export interface Uint8ArrayRef {
  __type: "Uint8ArrayRef";
  data: number[];
}

/**
 * Represents a serialized Request object.
 * Uses number[] instead of Uint8Array for JSON compatibility.
 */
export interface RequestRef {
  __type: "RequestRef";
  url: string;
  method: string;
  headers: [string, string][];
  body: number[] | null;
  mode?: string;
  credentials?: string;
  cache?: string;
  redirect?: string;
  referrer?: string;
  referrerPolicy?: string;
  integrity?: string;
}

/**
 * Represents a serialized Response object.
 * Uses number[] instead of Uint8Array for JSON compatibility.
 */
export interface ResponseRef {
  __type: "ResponseRef";
  status: number;
  statusText: string;
  headers: [string, string][];
  body: number[] | null;
}

/**
 * Represents a serialized Headers object.
 */
export interface HeadersRef {
  __type: "HeadersRef";
  pairs: [string, string][];
}

/**
 * Represents a serialized File object (includes the data inline).
 * Uses number[] instead of Uint8Array for JSON compatibility.
 */
export interface FileRef {
  __type: "FileRef";
  name: string;
  type: string;
  lastModified: number;
  data: number[];
}

/**
 * Represents a serialized FormData object.
 */
export interface FormDataRef {
  __type: "FormDataRef";
  entries: [string, string | FileRef][];
}

/**
 * Represents a serialized URL object.
 */
export interface URLRef {
  __type: "URLRef";
  href: string;
}

/**
 * Represents a reference to a pending Promise.
 */
export interface PromiseRef {
  __type: "PromiseRef";
  promiseId: number;
}

/**
 * Represents a reference to an async iterator.
 */
export interface AsyncIteratorRef {
  __type: "AsyncIteratorRef";
  iteratorId: number;
}

export type ExtensionType =
  | IsolateRef
  | CallbackRef
  | StreamRef
  | ErrorRef
  | BlobRef
  | DateRef
  | RegExpRef
  | UndefinedRef
  | BigIntRef
  | RequestRef
  | ResponseRef
  | HeadersRef
  | FileRef
  | FormDataRef
  | URLRef
  | PromiseRef
  | AsyncIteratorRef;

// ============================================================================
// Extension Codec Setup
// ============================================================================

/**
 * Create the extension codec for custom types.
 */
function createExtensionCodec(): ExtensionCodec {
  const extensionCodec = new ExtensionCodec();

  // IsolateRef
  extensionCodec.register({
    type: ExtType.ISOLATE_REF,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as IsolateRef).__type === "IsolateRef"
      ) {
        const ref = value as IsolateRef;
        return encode({ isolateId: ref.isolateId });
      }
      return null;
    },
    decode: (data: Uint8Array): IsolateRef => {
      const decoded = decode(data) as { isolateId: string };
      return { __type: "IsolateRef", isolateId: decoded.isolateId };
    },
  });

  // CallbackRef
  extensionCodec.register({
    type: ExtType.CALLBACK_REF,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as CallbackRef).__type === "CallbackRef"
      ) {
        const ref = value as CallbackRef;
        return encode({ callbackId: ref.callbackId });
      }
      return null;
    },
    decode: (data: Uint8Array): CallbackRef => {
      const decoded = decode(data) as { callbackId: number };
      return { __type: "CallbackRef", callbackId: decoded.callbackId };
    },
  });

  // StreamRef
  extensionCodec.register({
    type: ExtType.STREAM_REF,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as StreamRef).__type === "StreamRef"
      ) {
        const ref = value as StreamRef;
        return encode({ streamId: ref.streamId, direction: ref.direction });
      }
      return null;
    },
    decode: (data: Uint8Array): StreamRef => {
      const decoded = decode(data) as {
        streamId: number;
        direction: "upload" | "download";
      };
      return {
        __type: "StreamRef",
        streamId: decoded.streamId,
        direction: decoded.direction,
      };
    },
  });

  // ErrorRef
  extensionCodec.register({
    type: ExtType.ERROR,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as ErrorRef).__type === "ErrorRef"
      ) {
        const ref = value as ErrorRef;
        return encode({
          name: ref.name,
          message: ref.message,
          stack: ref.stack,
          code: ref.code,
        });
      }
      return null;
    },
    decode: (data: Uint8Array): ErrorRef => {
      const decoded = decode(data) as {
        name: string;
        message: string;
        stack?: string;
        code?: number;
      };
      return {
        __type: "ErrorRef",
        name: decoded.name,
        message: decoded.message,
        stack: decoded.stack,
        code: decoded.code,
      };
    },
  });

  // BlobRef
  extensionCodec.register({
    type: ExtType.BLOB_REF,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as BlobRef).__type === "BlobRef"
      ) {
        const ref = value as BlobRef;
        return encode({
          blobId: ref.blobId,
          size: ref.size,
          type: ref.type,
        });
      }
      return null;
    },
    decode: (data: Uint8Array): BlobRef => {
      const decoded = decode(data) as {
        blobId: number;
        size: number;
        type: string;
      };
      return {
        __type: "BlobRef",
        blobId: decoded.blobId,
        size: decoded.size,
        type: decoded.type,
      };
    },
  });

  // Date - only handle actual Date instances
  // DateRef objects are passed through as plain objects (preserved for isolate unmarshalling)
  extensionCodec.register({
    type: ExtType.DATE,
    encode: (value: unknown): Uint8Array | null => {
      // Only handle actual Date instances
      if (value instanceof Date) {
        return encode({ timestamp: value.getTime() });
      }
      return null;
    },
    decode: (data: Uint8Array): Date => {
      const decoded = decode(data) as { timestamp: number };
      return new Date(decoded.timestamp);
    },
  });

  // RegExp - only handle actual RegExp instances
  // RegExpRef objects are passed through as plain objects (preserved for isolate unmarshalling)
  extensionCodec.register({
    type: ExtType.REGEXP,
    encode: (value: unknown): Uint8Array | null => {
      // Only handle actual RegExp instances
      if (value instanceof RegExp) {
        return encode({ source: value.source, flags: value.flags });
      }
      return null;
    },
    decode: (data: Uint8Array): RegExp => {
      const decoded = decode(data) as { source: string; flags: string };
      return new RegExp(decoded.source, decoded.flags);
    },
  });

  // undefined - only handle actual undefined values
  // UndefinedRef objects are passed through as plain objects (preserved for isolate unmarshalling)
  extensionCodec.register({
    type: ExtType.UNDEFINED,
    encode: (value: unknown): Uint8Array | null => {
      // Only handle actual undefined
      if (value === undefined) {
        return encode({});
      }
      return null;
    },
    decode: (): undefined => {
      return undefined;
    },
  });

  // BigInt - only handle actual BigInt values
  // BigIntRef objects are passed through as plain objects (preserved for isolate unmarshalling)
  extensionCodec.register({
    type: ExtType.BIGINT,
    encode: (value: unknown): Uint8Array | null => {
      // Only handle actual BigInt values
      if (typeof value === "bigint") {
        return encode({ value: value.toString() });
      }
      return null;
    },
    decode: (data: Uint8Array): bigint => {
      const decoded = decode(data) as { value: string };
      return BigInt(decoded.value);
    },
  });

  // RequestRef - decodes to actual Request object
  extensionCodec.register({
    type: ExtType.REQUEST,
    encode: (value: unknown): Uint8Array | null => {
      // Handle RequestRef objects (actual Request instances need async handling via marshalValue)
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as RequestRef).__type === "RequestRef"
      ) {
        const ref = value as RequestRef;
        return encode({
          url: ref.url,
          method: ref.method,
          headers: ref.headers,
          body: ref.body,
          mode: ref.mode,
          credentials: ref.credentials,
          cache: ref.cache,
          redirect: ref.redirect,
          referrer: ref.referrer,
          referrerPolicy: ref.referrerPolicy,
          integrity: ref.integrity,
        });
      }
      return null;
    },
    decode: (data: Uint8Array): RequestRef => {
      // Return RequestRef instead of reconstructing Request - the daemon passes this through
      // and the isolate's unmarshalFromHost will reconstruct the Request
      const decoded = decode(data) as Omit<RequestRef, "__type">;
      return {
        __type: "RequestRef",
        url: decoded.url,
        method: decoded.method,
        headers: decoded.headers,
        body: decoded.body,
        mode: decoded.mode,
        credentials: decoded.credentials,
        cache: decoded.cache,
        redirect: decoded.redirect,
        referrer: decoded.referrer,
        referrerPolicy: decoded.referrerPolicy,
        integrity: decoded.integrity,
      };
    },
  });

  // ResponseRef - decodes to actual Response object
  extensionCodec.register({
    type: ExtType.RESPONSE,
    encode: (value: unknown): Uint8Array | null => {
      // Handle ResponseRef objects (actual Response instances need async handling via marshalValue)
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as ResponseRef).__type === "ResponseRef"
      ) {
        const ref = value as ResponseRef;
        return encode({
          status: ref.status,
          statusText: ref.statusText,
          headers: ref.headers,
          body: ref.body,
        });
      }
      return null;
    },
    decode: (data: Uint8Array): ResponseRef => {
      // Return ResponseRef instead of reconstructing Response - the daemon passes this through
      // and the isolate's unmarshalFromHost will reconstruct the Response
      const decoded = decode(data) as Omit<ResponseRef, "__type">;
      return {
        __type: "ResponseRef",
        status: decoded.status,
        statusText: decoded.statusText,
        headers: decoded.headers,
        body: decoded.body,
      };
    },
  });

  // HeadersRef - handles both Headers instances and HeadersRef objects
  extensionCodec.register({
    type: ExtType.HEADERS,
    encode: (value: unknown): Uint8Array | null => {
      // Handle actual Headers instances
      if (typeof Headers !== "undefined" && value instanceof Headers) {
        const pairs: [string, string][] = [];
        (value as Headers).forEach((v, k) => pairs.push([k, v]));
        return encode({ pairs });
      }
      // Handle HeadersRef objects
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as HeadersRef).__type === "HeadersRef"
      ) {
        const ref = value as HeadersRef;
        return encode({ pairs: ref.pairs });
      }
      return null;
    },
    decode: (data: Uint8Array): Headers => {
      const decoded = decode(data) as { pairs: [string, string][] };
      return new Headers(decoded.pairs);
    },
  });

  // FileRef - decodes to actual File/Blob objects
  extensionCodec.register({
    type: ExtType.FILE,
    encode: (value: unknown): Uint8Array | null => {
      // Handle FileRef objects (actual File instances need async handling via marshalValue)
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as FileRef).__type === "FileRef"
      ) {
        const ref = value as FileRef;
        return encode({
          name: ref.name,
          type: ref.type,
          lastModified: ref.lastModified,
          data: ref.data,
        });
      }
      return null;
    },
    decode: (data: Uint8Array): FileRef => {
      // Return FileRef instead of reconstructing File - the daemon passes this through
      // and the isolate's unmarshalFromHost will reconstruct the File
      const decoded = decode(data) as Omit<FileRef, "__type">;
      return {
        __type: "FileRef",
        name: decoded.name,
        type: decoded.type,
        lastModified: decoded.lastModified,
        data: decoded.data,
      };
    },
  });

  // FormDataRef - decodes to actual FormData object
  extensionCodec.register({
    type: ExtType.FORMDATA,
    encode: (value: unknown): Uint8Array | null => {
      // Handle FormDataRef objects (actual FormData instances need async handling via marshalValue)
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as FormDataRef).__type === "FormDataRef"
      ) {
        const ref = value as FormDataRef;
        return encode({ entries: ref.entries });
      }
      return null;
    },
    decode: (data: Uint8Array): FormDataRef => {
      // Return FormDataRef instead of reconstructing FormData - the daemon passes this through
      // and the isolate's unmarshalFromHost will reconstruct the FormData
      const decoded = decode(data) as { entries: [string, string | FileRef][] };
      return {
        __type: "FormDataRef",
        entries: decoded.entries,
      };
    },
  });

  // URLRef - handles both URL instances and URLRef objects
  extensionCodec.register({
    type: ExtType.URL_REF,
    encode: (value: unknown): Uint8Array | null => {
      // Handle actual URL instances
      if (typeof URL !== "undefined" && value instanceof URL) {
        return encode({ href: (value as URL).href });
      }
      // Handle URLRef objects
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as URLRef).__type === "URLRef"
      ) {
        const ref = value as URLRef;
        return encode({ href: ref.href });
      }
      return null;
    },
    decode: (data: Uint8Array): URL => {
      const decoded = decode(data) as { href: string };
      return new URL(decoded.href);
    },
  });

  // PromiseRef - preserves all fields including callback IDs
  extensionCodec.register({
    type: ExtType.PROMISE,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as PromiseRef).__type === "PromiseRef"
      ) {
        const ref = value as PromiseRef;
        // Encode all fields, not just promiseId
        const encoded: Record<string, unknown> = { promiseId: ref.promiseId };
        // Preserve callback ID fields if present
        if ("__resolveCallbackId" in ref) {
          encoded.__resolveCallbackId = (ref as Record<string, unknown>).__resolveCallbackId;
        }
        return encode(encoded);
      }
      return null;
    },
    decode: (data: Uint8Array): PromiseRef => {
      const decoded = decode(data) as Record<string, unknown>;
      const result: PromiseRef = { __type: "PromiseRef", promiseId: decoded.promiseId as number };
      // Restore callback ID fields if present
      if ("__resolveCallbackId" in decoded) {
        (result as Record<string, unknown>).__resolveCallbackId = decoded.__resolveCallbackId;
      }
      return result;
    },
  });

  // AsyncIteratorRef - preserves all fields including callback IDs
  extensionCodec.register({
    type: ExtType.ASYNC_ITERATOR,
    encode: (value: unknown): Uint8Array | null => {
      if (
        typeof value === "object" &&
        value !== null &&
        "__type" in value &&
        (value as AsyncIteratorRef).__type === "AsyncIteratorRef"
      ) {
        const ref = value as AsyncIteratorRef;
        // Encode all fields, not just iteratorId
        const encoded: Record<string, unknown> = { iteratorId: ref.iteratorId };
        // Preserve callback ID fields if present
        if ("__nextCallbackId" in ref) {
          encoded.__nextCallbackId = (ref as Record<string, unknown>).__nextCallbackId;
        }
        if ("__returnCallbackId" in ref) {
          encoded.__returnCallbackId = (ref as Record<string, unknown>).__returnCallbackId;
        }
        return encode(encoded);
      }
      return null;
    },
    decode: (data: Uint8Array): AsyncIteratorRef => {
      const decoded = decode(data) as Record<string, unknown>;
      const result: AsyncIteratorRef = { __type: "AsyncIteratorRef", iteratorId: decoded.iteratorId as number };
      // Restore callback ID fields if present
      if ("__nextCallbackId" in decoded) {
        (result as Record<string, unknown>).__nextCallbackId = decoded.__nextCallbackId;
      }
      if ("__returnCallbackId" in decoded) {
        (result as Record<string, unknown>).__returnCallbackId = decoded.__returnCallbackId;
      }
      return result;
    },
  });

  return extensionCodec;
}

// Singleton extension codec instance
const extensionCodec = createExtensionCodec();

// ============================================================================
// Encoding/Decoding Functions
// ============================================================================

/**
 * Encode a message to MessagePack bytes.
 */
export function encodeMessage(message: Message): Uint8Array {
  return encode(message, { extensionCodec });
}

/**
 * Decode MessagePack bytes to a message.
 */
export function decodeMessage(data: Uint8Array): Message {
  return decode(data, { extensionCodec }) as Message;
}

/**
 * Encode any value to MessagePack bytes.
 */
export function encodeValue(value: unknown): Uint8Array {
  return encode(value, { extensionCodec });
}

/**
 * Decode MessagePack bytes to any value.
 */
export function decodeValue(data: Uint8Array): unknown {
  return decode(data, { extensionCodec });
}

// ============================================================================
// Helper Functions for Creating Extension Types
// ============================================================================

export function createIsolateRef(isolateId: string): IsolateRef {
  return { __type: "IsolateRef", isolateId };
}

export function createCallbackRef(callbackId: number): CallbackRef {
  return { __type: "CallbackRef", callbackId };
}

export function createStreamRef(
  streamId: number,
  direction: "upload" | "download"
): StreamRef {
  return { __type: "StreamRef", streamId, direction };
}

export function createErrorRef(
  name: string,
  message: string,
  stack?: string,
  code?: number
): ErrorRef {
  return { __type: "ErrorRef", name, message, stack, code };
}

export function createBlobRef(
  blobId: number,
  size: number,
  type: string
): BlobRef {
  return { __type: "BlobRef", blobId, size, type };
}

export function createDateRef(timestamp: number): DateRef {
  return { __type: "DateRef", timestamp };
}

export function createRegExpRef(source: string, flags: string): RegExpRef {
  return { __type: "RegExpRef", source, flags };
}

export function createUndefinedRef(): UndefinedRef {
  return { __type: "UndefinedRef" };
}

export function createBigIntRef(value: string): BigIntRef {
  return { __type: "BigIntRef", value };
}

export function createUint8ArrayRef(data: number[]): Uint8ArrayRef {
  return { __type: "Uint8ArrayRef", data };
}

export function createRequestRef(
  url: string,
  method: string,
  headers: [string, string][],
  body: number[] | null,
  options?: {
    mode?: string;
    credentials?: string;
    cache?: string;
    redirect?: string;
    referrer?: string;
    referrerPolicy?: string;
    integrity?: string;
  }
): RequestRef {
  return {
    __type: "RequestRef",
    url,
    method,
    headers,
    body,
    ...options,
  };
}

export function createResponseRef(
  status: number,
  statusText: string,
  headers: [string, string][],
  body: number[] | null
): ResponseRef {
  return { __type: "ResponseRef", status, statusText, headers, body };
}

export function createHeadersRef(pairs: [string, string][]): HeadersRef {
  return { __type: "HeadersRef", pairs };
}

export function createFileRef(
  name: string,
  type: string,
  lastModified: number,
  data: number[]
): FileRef {
  return { __type: "FileRef", name, type, lastModified, data };
}

export function createFormDataRef(
  entries: [string, string | FileRef][]
): FormDataRef {
  return { __type: "FormDataRef", entries };
}

export function createURLRef(href: string): URLRef {
  return { __type: "URLRef", href };
}

export function createPromiseRef(promiseId: number): PromiseRef {
  return { __type: "PromiseRef", promiseId };
}

export function createAsyncIteratorRef(iteratorId: number): AsyncIteratorRef {
  return { __type: "AsyncIteratorRef", iteratorId };
}
