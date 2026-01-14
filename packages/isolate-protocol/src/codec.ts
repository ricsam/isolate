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

export type ExtensionType =
  | IsolateRef
  | CallbackRef
  | StreamRef
  | ErrorRef
  | BlobRef;

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
