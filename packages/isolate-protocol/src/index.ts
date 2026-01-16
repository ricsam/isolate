/**
 * @ricsam/isolate-protocol
 *
 * Protocol definitions, codec, and framing for the isolate daemon.
 */

// Types
export * from "./types.ts";

// Codec
export {
  encodeMessage,
  decodeMessage,
  encodeValue,
  decodeValue,
  createIsolateRef,
  createCallbackRef,
  createStreamRef,
  createErrorRef,
  createBlobRef,
  ExtType,
  type IsolateRef,
  type CallbackRef,
  type StreamRef,
  type ErrorRef,
  type BlobRef,
  type ExtensionType,
} from "./codec.ts";

// Framing
export {
  buildFrame,
  buildFrames,
  createFrameParser,
  parseFrame,
  getMessageTypeName,
  HEADER_SIZE,
  MAX_FRAME_SIZE,
  STREAM_THRESHOLD,
  STREAM_CHUNK_SIZE,
  STREAM_DEFAULT_CREDIT,
  type ParsedFrame,
  type FrameParser,
} from "./framing.ts";
