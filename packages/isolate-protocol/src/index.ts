/**
 * @ricsam/isolate-protocol
 *
 * Protocol definitions, codec, and framing for the isolate daemon.
 */

// Types and utilities
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
  createDateRef,
  createRegExpRef,
  createUndefinedRef,
  createBigIntRef,
  createRequestRef,
  createResponseRef,
  createHeadersRef,
  createFileRef,
  createFormDataRef,
  createURLRef,
  createPromiseRef,
  createAsyncIteratorRef,
  ExtType,
  type IsolateRef,
  type CallbackRef,
  type StreamRef,
  type ErrorRef,
  type BlobRef,
  type DateRef,
  type RegExpRef,
  type UndefinedRef,
  type BigIntRef,
  type RequestRef,
  type ResponseRef,
  type HeadersRef,
  type FileRef,
  type FormDataRef,
  type URLRef,
  type PromiseRef,
  type AsyncIteratorRef,
  type ExtensionType,
} from "./codec.ts";

// Value marshalling
export {
  marshalValue,
  marshalValueSync,
  unmarshalValue,
  MarshalError,
  isPromiseRef,
  isAsyncIteratorRef,
  type MarshalContext,
  type UnmarshalContext,
} from "./marshalValue.ts";

// Request/Response serialization
export {
  serializeRequest,
  serializeResponse,
  deserializeRequest,
  deserializeResponse,
} from "./serialization.ts";

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
