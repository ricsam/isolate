import { describe, it } from "node:test";
import assert from "node:assert";
import {
  MessageType,
  type CreateRuntimeRequest,
  type ResponseOk,
  type CallbackInvoke,
} from "./types.ts";
import {
  encodeMessage,
  decodeMessage,
  createIsolateRef,
  createCallbackRef,
  createStreamRef,
  createErrorRef,
} from "./codec.ts";
import {
  buildFrame,
  createFrameParser,
  parseFrame,
  getMessageTypeName,
} from "./framing.ts";

describe("codec", () => {
  it("should encode and decode a simple message", () => {
    const message: CreateRuntimeRequest = {
      type: MessageType.CREATE_RUNTIME,
      requestId: 1,
      options: {
        memoryLimitMB: 128,
      },
    };

    const encoded = encodeMessage(message);
    const decoded = decodeMessage(encoded);

    assert.deepStrictEqual(decoded, {
      type: MessageType.CREATE_RUNTIME,
      requestId: 1,
      options: { memoryLimitMB: 128 },
    });
  });

  it("should encode and decode messages with binary data", () => {
    const message: ResponseOk = {
      type: MessageType.RESPONSE_OK,
      requestId: 42,
      data: {
        body: new Uint8Array([1, 2, 3, 4, 5]),
      },
    };

    const encoded = encodeMessage(message);
    const decoded = decodeMessage(encoded) as ResponseOk;

    assert.strictEqual(decoded.requestId, 42);
    assert.deepStrictEqual(
      (decoded.data as { body: Uint8Array }).body,
      new Uint8Array([1, 2, 3, 4, 5])
    );
  });

  it("should encode and decode extension types", () => {
    const isolateRef = createIsolateRef("test-isolate-123");
    const callbackRef = createCallbackRef(42);
    const streamRef = createStreamRef(1, "upload");
    const errorRef = createErrorRef("TypeError", "Something went wrong");

    const message: CallbackInvoke = {
      type: MessageType.CALLBACK_INVOKE,
      requestId: 1,
      callbackId: 5,
      args: [isolateRef, callbackRef, streamRef, errorRef],
    };

    const encoded = encodeMessage(message);
    const decoded = decodeMessage(encoded) as CallbackInvoke;

    assert.strictEqual(decoded.requestId, 1);
    assert.strictEqual(decoded.callbackId, 5);
    assert.strictEqual(decoded.args.length, 4);

    const [decodedIsolate, decodedCallback, decodedStream, decodedError] =
      decoded.args as [
        ReturnType<typeof createIsolateRef>,
        ReturnType<typeof createCallbackRef>,
        ReturnType<typeof createStreamRef>,
        ReturnType<typeof createErrorRef>,
      ];

    assert.strictEqual(decodedIsolate.__type, "IsolateRef");
    assert.strictEqual(decodedIsolate.isolateId, "test-isolate-123");

    assert.strictEqual(decodedCallback.__type, "CallbackRef");
    assert.strictEqual(decodedCallback.callbackId, 42);

    assert.strictEqual(decodedStream.__type, "StreamRef");
    assert.strictEqual(decodedStream.streamId, 1);
    assert.strictEqual(decodedStream.direction, "upload");

    assert.strictEqual(decodedError.__type, "ErrorRef");
    assert.strictEqual(decodedError.name, "TypeError");
    assert.strictEqual(decodedError.message, "Something went wrong");
  });
});

describe("framing", () => {
  it("should build and parse a single frame", () => {
    const message: CreateRuntimeRequest = {
      type: MessageType.CREATE_RUNTIME,
      requestId: 1,
      options: { memoryLimitMB: 256 },
    };

    const frame = buildFrame(message);
    const parsed = parseFrame(frame);

    assert.ok(parsed);
    assert.strictEqual(parsed.type, MessageType.CREATE_RUNTIME);
    assert.strictEqual((parsed.message as CreateRuntimeRequest).requestId, 1);
    assert.deepStrictEqual((parsed.message as CreateRuntimeRequest).options, {
      memoryLimitMB: 256,
    });
  });

  it("should handle incremental parsing with frame parser", () => {
    const messages: CreateRuntimeRequest[] = [
      {
        type: MessageType.CREATE_RUNTIME,
        requestId: 1,
        options: { memoryLimitMB: 64 },
      },
      {
        type: MessageType.CREATE_RUNTIME,
        requestId: 2,
        options: { memoryLimitMB: 128 },
      },
      {
        type: MessageType.CREATE_RUNTIME,
        requestId: 3,
        options: { memoryLimitMB: 256 },
      },
    ];

    // Build all frames
    const frames = messages.map(buildFrame);
    const combined = new Uint8Array(frames.reduce((s, f) => s + f.length, 0));
    let offset = 0;
    for (const frame of frames) {
      combined.set(frame, offset);
      offset += frame.length;
    }

    // Parse incrementally (simulate chunked data)
    const parser = createFrameParser();
    const parsed: CreateRuntimeRequest[] = [];

    // Feed in small chunks
    const chunkSize = 10;
    for (let i = 0; i < combined.length; i += chunkSize) {
      const chunk = combined.slice(i, Math.min(i + chunkSize, combined.length));
      for (const frame of parser.feed(chunk)) {
        parsed.push(frame.message as CreateRuntimeRequest);
      }
    }

    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0]?.requestId, 1);
    assert.strictEqual(parsed[1]?.requestId, 2);
    assert.strictEqual(parsed[2]?.requestId, 3);
  });

  it("should return null for incomplete frames", () => {
    const message: CreateRuntimeRequest = {
      type: MessageType.CREATE_RUNTIME,
      requestId: 1,
      options: {},
    };

    const frame = buildFrame(message);
    // Only give partial frame
    const partial = frame.slice(0, 5);

    const parsed = parseFrame(partial);
    assert.strictEqual(parsed, null);
  });

  it("should throw for oversized frames", () => {
    // Create a fake frame header with huge size
    const fakeFrame = new Uint8Array(8);
    const view = new DataView(fakeFrame.buffer);
    view.setUint32(0, 100 * 1024 * 1024, false); // 100MB

    assert.throws(() => parseFrame(fakeFrame), /exceeds maximum/);
  });

  it("should get message type names", () => {
    assert.strictEqual(
      getMessageTypeName(MessageType.CREATE_RUNTIME),
      "CREATE_RUNTIME"
    );
    assert.strictEqual(getMessageTypeName(MessageType.RESPONSE_OK), "RESPONSE_OK");
    assert.strictEqual(getMessageTypeName(MessageType.PING), "PING");
  });
});

describe("message types", () => {
  it("should have distinct values for all message types", () => {
    const values = Object.values(MessageType);
    const uniqueValues = new Set(values);

    assert.strictEqual(
      values.length,
      uniqueValues.size,
      "All message type values should be unique"
    );
  });
});
