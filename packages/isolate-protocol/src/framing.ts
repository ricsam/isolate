/**
 * Frame parser and builder for the isolate protocol.
 *
 * Frame format:
 * ┌──────────┬──────────┬─────────────────┐
 * │ Length   │ Type     │ Payload         │
 * │ (4 bytes)│ (1 byte) │ (MessagePack)   │
 * └──────────┴──────────┴─────────────────┘
 *
 * - Length: uint32 BE, size of Type + Payload (excludes the length field itself)
 * - Type: uint8, message type from MessageType enum
 * - Payload: MessagePack encoded message body
 */

import { MessageType, MessageTypeName, type Message } from "./types.ts";
import { encodeMessage, decodeMessage } from "./codec.ts";

/** Header size: 4 bytes for length + 1 byte for type */
export const HEADER_SIZE = 5;

/** Maximum frame size (10MB) */
export const MAX_FRAME_SIZE = 10 * 1024 * 1024;

/** Threshold above which bodies should be streamed (1MB) */
export const STREAM_THRESHOLD = 1 * 1024 * 1024;

/** Default chunk size for streaming (256KB) */
export const STREAM_CHUNK_SIZE = 256 * 1024;

/** Default credit for backpressure (1MB) */
export const STREAM_DEFAULT_CREDIT = 1 * 1024 * 1024;

// ============================================================================
// Frame Building
// ============================================================================

/**
 * Build a frame from a message.
 *
 * @param message - The message to encode
 * @returns Complete frame as Uint8Array
 */
export function buildFrame(message: Message): Uint8Array {
  // Encode the message payload (without the type field for the payload)
  const payloadWithoutType = { ...message };
  delete (payloadWithoutType as Record<string, unknown>).type;

  const payload = encodeMessage(payloadWithoutType as Message);
  const messageType = message.type;

  // Total size: 1 byte type + payload length
  const frameBodySize = 1 + payload.length;

  // Build frame: 4 bytes length + 1 byte type + payload
  const frame = new Uint8Array(4 + frameBodySize);
  const view = new DataView(frame.buffer);

  // Write length (big-endian)
  view.setUint32(0, frameBodySize, false);

  // Write message type
  frame[4] = messageType;

  // Write payload
  frame.set(payload, 5);

  return frame;
}

/**
 * Build multiple frames from messages.
 *
 * @param messages - Messages to encode
 * @returns Combined frames as single Uint8Array
 */
export function buildFrames(messages: Message[]): Uint8Array {
  const frames = messages.map(buildFrame);
  const totalLength = frames.reduce((sum, f) => sum + f.length, 0);

  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const frame of frames) {
    combined.set(frame, offset);
    offset += frame.length;
  }

  return combined;
}

// ============================================================================
// Frame Parsing
// ============================================================================

/**
 * Parse result from the frame parser.
 */
export interface ParsedFrame {
  type: MessageType;
  message: Message;
}

/**
 * Incremental frame parser for streaming data.
 *
 * Usage:
 * ```ts
 * const parser = createFrameParser();
 * socket.on('data', (chunk) => {
 *   for (const frame of parser.feed(chunk)) {
 *     handleMessage(frame.message);
 *   }
 * });
 * ```
 */
export interface FrameParser {
  /**
   * Feed data to the parser and yield complete frames.
   * @param chunk - Incoming data chunk
   */
  feed(chunk: Uint8Array): Generator<ParsedFrame>;

  /**
   * Get the number of bytes currently buffered.
   */
  bufferedBytes(): number;

  /**
   * Reset the parser state.
   */
  reset(): void;
}

/**
 * Create a new frame parser.
 */
export function createFrameParser(): FrameParser {
  let buffer: Uint8Array = new Uint8Array(0);

  function* feed(chunk: Uint8Array): Generator<ParsedFrame> {
    // Append chunk to buffer
    const newBuffer = new Uint8Array(buffer.length + chunk.length);
    newBuffer.set(buffer);
    newBuffer.set(chunk, buffer.length);
    buffer = newBuffer;

    // Try to parse frames
    while (buffer.length >= 4) {
      // Read length
      const view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      );
      const frameBodySize = view.getUint32(0, false);

      // Validate frame size
      if (frameBodySize > MAX_FRAME_SIZE) {
        throw new Error(
          `Frame size ${frameBodySize} exceeds maximum ${MAX_FRAME_SIZE}`
        );
      }

      // Check if we have the complete frame
      const totalFrameSize = 4 + frameBodySize;
      if (buffer.length < totalFrameSize) {
        break; // Wait for more data
      }

      // Extract frame
      const messageType = buffer[4] as MessageType;
      const payload = buffer.slice(5, totalFrameSize);

      // Decode payload
      const decodedPayload = decodeMessage(payload);
      const message = { ...decodedPayload, type: messageType } as Message;

      yield { type: messageType, message };

      // Remove processed frame from buffer
      buffer = buffer.slice(totalFrameSize);
    }
  }

  function bufferedBytes(): number {
    return buffer.length;
  }

  function reset(): void {
    buffer = new Uint8Array(0);
  }

  return { feed, bufferedBytes, reset };
}

// ============================================================================
// Single Frame Parsing (for testing/debugging)
// ============================================================================

/**
 * Parse a single complete frame.
 *
 * @param data - Complete frame data
 * @returns Parsed frame or null if incomplete
 * @throws Error if frame is invalid
 */
export function parseFrame(data: Uint8Array): ParsedFrame | null {
  if (data.length < 4) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frameBodySize = view.getUint32(0, false);

  if (frameBodySize > MAX_FRAME_SIZE) {
    throw new Error(
      `Frame size ${frameBodySize} exceeds maximum ${MAX_FRAME_SIZE}`
    );
  }

  const totalFrameSize = 4 + frameBodySize;
  if (data.length < totalFrameSize) {
    return null;
  }

  const messageType = data[4] as MessageType;
  const payload = data.slice(5, totalFrameSize);

  const decodedPayload = decodeMessage(payload);
  const message = { ...decodedPayload, type: messageType } as Message;

  return { type: messageType, message };
}

/**
 * Get the message type name for debugging.
 */
export function getMessageTypeName(type: MessageType): string {
  return MessageTypeName[type] ?? `Unknown(${type})`;
}
