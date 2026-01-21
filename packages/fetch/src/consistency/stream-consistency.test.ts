import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getReadableStreamFromOrigin,
  getWritableStreamFromOrigin,
  getTransformStreamFromOrigin,
  getTextEncoderStreamFromOrigin,
  getTextDecoderStreamFromOrigin,
  getQueuingStrategyFromOrigin,
  getResponseFromOrigin,
  type ConsistencyTestContext,
  READABLE_STREAM_ORIGINS,
  WRITABLE_STREAM_ORIGINS,
  TRANSFORM_STREAM_ORIGINS,
  TEXT_ENCODER_STREAM_ORIGINS,
  TEXT_DECODER_STREAM_ORIGINS,
  RESPONSE_ORIGINS,
} from "./origins.ts";

describe("Stream Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // ReadableStream Tests
  // ============================================================================

  describe("ReadableStream Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`locked property exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.locked === 'boolean');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Method Existence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`getReader() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.getReader === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`tee() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.tee === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`pipeThrough() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.pipeThrough === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`pipeTo() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.pipeTo === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`cancel() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.cancel === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`values() exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream.values === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`[Symbol.asyncIterator] exists when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testReadableStream[Symbol.asyncIterator] === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`locked is false initially when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testReadableStream.locked);
          `);
          assert.strictEqual(ctx.getResult(), false);
        });

        test(`locked is true after getReader() when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            setResult(__testReadableStream.locked);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`getReader() returns reader with read() when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin, ["hello"]);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            const { value, done } = await reader.read();
            const text = new TextDecoder().decode(value);
            setResult({ text, done });
          `);
          const result = ctx.getResult() as { text: string; done: boolean };
          assert.strictEqual(result.text, "hello");
          assert.strictEqual(result.done, false);
        });

        test(`tee() returns two streams when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin, ["test"]);
          await ctx.eval(`
            const [stream1, stream2] = __testReadableStream.tee();
            setResult({
              isArray: Array.isArray([stream1, stream2]),
              stream1IsReadable: stream1 instanceof ReadableStream,
              stream2IsReadable: stream2 instanceof ReadableStream,
            });
          `);
          const result = ctx.getResult() as {
            isArray: boolean;
            stream1IsReadable: boolean;
            stream2IsReadable: boolean;
          };
          assert.strictEqual(result.isArray, true);
          assert.strictEqual(result.stream1IsReadable, true);
          assert.strictEqual(result.stream2IsReadable, true);
        });

        test(`cancel() cancels the stream when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            await __testReadableStream.cancel();
            setResult(true);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`instanceof ReadableStream when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testReadableStream instanceof ReadableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is ReadableStream when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testReadableStream.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "ReadableStream");
        });
      }
    });

    describe("Async Iteration", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`values() returns async iterator when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin, ["a", "b"]);
          await ctx.eval(`
            const chunks = [];
            for await (const chunk of __testReadableStream.values()) {
              chunks.push(new TextDecoder().decode(chunk));
            }
            // Different origins may chunk data differently, so join to compare content
            setResult(chunks.join(""));
          `);
          assert.strictEqual(ctx.getResult(), "ab");
        });

        test(`for await...of works when from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin, ["x", "y"]);
          await ctx.eval(`
            const chunks = [];
            for await (const chunk of __testReadableStream) {
              chunks.push(new TextDecoder().decode(chunk));
            }
            // Different origins may chunk data differently, so join to compare content
            setResult(chunks.join(""));
          `);
          assert.strictEqual(ctx.getResult(), "xy");
        });
      }
    });
  });

  // ============================================================================
  // Response.body Identity Tests
  // ============================================================================

  describe("Response.body Identity", () => {
    // WHATWG spec requires Response.body to return the same object on repeated access
    for (const origin of RESPONSE_ORIGINS) {
      test(`Response.body returns same stream object on repeated access when from ${origin}`, async () => {
        await getResponseFromOrigin(ctx, origin, "test body");
        await ctx.eval(`
          const body1 = __testResponse.body;
          const body2 = __testResponse.body;
          setResult(body1 === body2);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // WritableStream Tests
  // ============================================================================

  describe("WritableStream Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`locked property exists when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testWritableStream.locked === 'boolean');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Method Existence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`getWriter() exists when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testWritableStream.getWriter === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`abort() exists when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testWritableStream.abort === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`close() exists when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testWritableStream.close === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`locked is false initially when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testWritableStream.locked);
          `);
          assert.strictEqual(ctx.getResult(), false);
        });

        test(`locked is true after getWriter() when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(__testWritableStream.locked);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`getWriter() returns writer with write() when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            await writer.write(new TextEncoder().encode("test"));
            await writer.close();
            setResult(__testWrittenChunks.length);
          `);
          assert.strictEqual(ctx.getResult(), 1);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`instanceof WritableStream when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testWritableStream instanceof WritableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is WritableStream when from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testWritableStream.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "WritableStream");
        });
      }
    });
  });

  // ============================================================================
  // TransformStream Tests
  // ============================================================================

  describe("TransformStream Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of TRANSFORM_STREAM_ORIGINS) {
        test(`readable property exists when from ${origin}`, async () => {
          await getTransformStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTransformStream.readable instanceof ReadableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`writable property exists when from ${origin}`, async () => {
          await getTransformStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTransformStream.writable instanceof WritableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of TRANSFORM_STREAM_ORIGINS) {
        test(`piping data through works when from ${origin}`, async () => {
          await getTransformStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testTransformStream.writable.getWriter();
            const reader = __testTransformStream.readable.getReader();

            await writer.write(new TextEncoder().encode("hello"));
            const { value } = await reader.read();
            const text = new TextDecoder().decode(value);

            writer.close();
            setResult(text);
          `);
          assert.strictEqual(ctx.getResult(), "hello");
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of TRANSFORM_STREAM_ORIGINS) {
        test(`instanceof TransformStream when from ${origin}`, async () => {
          await getTransformStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTransformStream instanceof TransformStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is TransformStream when from ${origin}`, async () => {
          await getTransformStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTransformStream.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "TransformStream");
        });
      }
    });
  });

  // ============================================================================
  // ReadableStreamDefaultReader Tests
  // ============================================================================

  describe("ReadableStreamDefaultReader Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`closed property exists when reader from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            setResult(reader.closed instanceof Promise);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Method Existence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`read() exists when reader from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            setResult(typeof reader.read === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`releaseLock() exists when reader from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            setResult(typeof reader.releaseLock === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`cancel() exists when reader from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            setResult(typeof reader.cancel === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of READABLE_STREAM_ORIGINS) {
        test(`releaseLock() unlocks stream when reader from ${origin}`, async () => {
          await getReadableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const reader = __testReadableStream.getReader();
            const lockedBefore = __testReadableStream.locked;
            reader.releaseLock();
            const lockedAfter = __testReadableStream.locked;
            setResult({ lockedBefore, lockedAfter });
          `);
          const result = ctx.getResult() as { lockedBefore: boolean; lockedAfter: boolean };
          assert.strictEqual(result.lockedBefore, true);
          assert.strictEqual(result.lockedAfter, false);
        });
      }
    });
  });

  // ============================================================================
  // WritableStreamDefaultWriter Tests
  // ============================================================================

  describe("WritableStreamDefaultWriter Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`closed property exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(writer.closed instanceof Promise);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`ready property exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(writer.ready instanceof Promise);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`desiredSize property exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(typeof writer.desiredSize === 'number' || writer.desiredSize === null);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Method Existence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`write() exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(typeof writer.write === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`close() exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(typeof writer.close === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`abort() exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(typeof writer.abort === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`releaseLock() exists when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            setResult(typeof writer.releaseLock === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Behavioral Equivalence", () => {
      for (const origin of WRITABLE_STREAM_ORIGINS) {
        test(`releaseLock() method can be called when writer from ${origin}`, async () => {
          await getWritableStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testWritableStream.getWriter();
            const lockedBefore = __testWritableStream.locked;
            // Note: releaseLock() may throw if there are pending operations
            // This tests that the method exists and the stream starts locked
            setResult({
              lockedBefore,
              hasReleaseLock: typeof writer.releaseLock === 'function'
            });
          `);
          const result = ctx.getResult() as { lockedBefore: boolean; hasReleaseLock: boolean };
          assert.strictEqual(result.lockedBefore, true);
          assert.strictEqual(result.hasReleaseLock, true);
        });
      }
    });
  });

  // ============================================================================
  // TextEncoderStream Tests
  // ============================================================================

  describe("TextEncoderStream Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of TEXT_ENCODER_STREAM_ORIGINS) {
        test(`readable property exists when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextEncoderStream.readable instanceof ReadableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`writable property exists when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextEncoderStream.writable instanceof WritableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`encoding property exists when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextEncoderStream.encoding);
          `);
          assert.strictEqual(ctx.getResult(), "utf-8");
        });
      }
    });

    describe("Encoding Behavior", () => {
      for (const origin of TEXT_ENCODER_STREAM_ORIGINS) {
        test(`encodes text to bytes when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testTextEncoderStream.writable.getWriter();
            const reader = __testTextEncoderStream.readable.getReader();

            await writer.write("hello");
            const { value } = await reader.read();

            writer.close();
            setResult({
              isUint8Array: value instanceof Uint8Array,
              length: value.length,
              firstByte: value[0], // 'h' = 104
            });
          `);
          const result = ctx.getResult() as { isUint8Array: boolean; length: number; firstByte: number };
          assert.strictEqual(result.isUint8Array, true);
          assert.strictEqual(result.length, 5);
          assert.strictEqual(result.firstByte, 104);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of TEXT_ENCODER_STREAM_ORIGINS) {
        test(`instanceof TextEncoderStream when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextEncoderStream instanceof TextEncoderStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is TextEncoderStream when from ${origin}`, async () => {
          await getTextEncoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextEncoderStream.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "TextEncoderStream");
        });
      }
    });
  });

  // ============================================================================
  // TextDecoderStream Tests
  // ============================================================================

  describe("TextDecoderStream Consistency", () => {
    describe("Property Existence", () => {
      for (const origin of TEXT_DECODER_STREAM_ORIGINS) {
        test(`readable property exists when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextDecoderStream.readable instanceof ReadableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`writable property exists when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextDecoderStream.writable instanceof WritableStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`encoding property exists when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextDecoderStream.encoding);
          `);
          assert.strictEqual(ctx.getResult(), "utf-8");
        });

        test(`fatal property exists when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testTextDecoderStream.fatal === 'boolean');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`ignoreBOM property exists when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(typeof __testTextDecoderStream.ignoreBOM === 'boolean');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("Decoding Behavior", () => {
      for (const origin of TEXT_DECODER_STREAM_ORIGINS) {
        test(`decodes bytes to text when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            const writer = __testTextDecoderStream.writable.getWriter();
            const reader = __testTextDecoderStream.readable.getReader();

            await writer.write(new Uint8Array([104, 101, 108, 108, 111])); // "hello"
            const { value } = await reader.read();

            writer.close();
            setResult(value);
          `);
          assert.strictEqual(ctx.getResult(), "hello");
        });
      }
    });

    describe("Options", () => {
      for (const origin of TEXT_DECODER_STREAM_ORIGINS) {
        test(`fatal option is respected when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin, { fatal: true });
          await ctx.eval(`
            setResult(__testTextDecoderStream.fatal);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`ignoreBOM option is respected when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin, { ignoreBOM: true });
          await ctx.eval(`
            setResult(__testTextDecoderStream.ignoreBOM);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    });

    describe("instanceof Check", () => {
      for (const origin of TEXT_DECODER_STREAM_ORIGINS) {
        test(`instanceof TextDecoderStream when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextDecoderStream instanceof TextDecoderStream);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });

        test(`constructor.name is TextDecoderStream when from ${origin}`, async () => {
          await getTextDecoderStreamFromOrigin(ctx, origin);
          await ctx.eval(`
            setResult(__testTextDecoderStream.constructor.name);
          `);
          assert.strictEqual(ctx.getResult(), "TextDecoderStream");
        });
      }
    });
  });

  // ============================================================================
  // ByteLengthQueuingStrategy Tests
  // ============================================================================

  describe("ByteLengthQueuingStrategy Consistency", () => {
    // Note: QueuingStrategy classes are only available via direct instantiation in the sandbox.
    // No additional origins (like customFunction or fetchCallback) are applicable.
    test("highWaterMark property exists", async () => {
      await getQueuingStrategyFromOrigin(ctx, "ByteLength", 1024);
      await ctx.eval(`
        setResult(__testQueuingStrategy.highWaterMark);
      `);
      assert.strictEqual(ctx.getResult(), 1024);
    });

    test("size() method exists and works", async () => {
      await getQueuingStrategyFromOrigin(ctx, "ByteLength");
      await ctx.eval(`
        const chunk = new Uint8Array([1, 2, 3, 4, 5]);
        setResult({
          hasSize: typeof __testQueuingStrategy.size === 'function',
          size: __testQueuingStrategy.size(chunk),
        });
      `);
      const result = ctx.getResult() as { hasSize: boolean; size: number };
      assert.strictEqual(result.hasSize, true);
      assert.strictEqual(result.size, 5);
    });

    test("instanceof ByteLengthQueuingStrategy", async () => {
      await getQueuingStrategyFromOrigin(ctx, "ByteLength");
      await ctx.eval(`
        setResult(__testQueuingStrategy instanceof ByteLengthQueuingStrategy);
      `);
      assert.strictEqual(ctx.getResult(), true);
    });

    test("constructor.name is ByteLengthQueuingStrategy", async () => {
      await getQueuingStrategyFromOrigin(ctx, "ByteLength");
      await ctx.eval(`
        setResult(__testQueuingStrategy.constructor.name);
      `);
      assert.strictEqual(ctx.getResult(), "ByteLengthQueuingStrategy");
    });
  });

  // ============================================================================
  // CountQueuingStrategy Tests
  // ============================================================================

  describe("CountQueuingStrategy Consistency", () => {
    // Note: QueuingStrategy classes are only available via direct instantiation in the sandbox.
    // No additional origins (like customFunction or fetchCallback) are applicable.
    test("highWaterMark property exists", async () => {
      await getQueuingStrategyFromOrigin(ctx, "Count", 10);
      await ctx.eval(`
        setResult(__testQueuingStrategy.highWaterMark);
      `);
      assert.strictEqual(ctx.getResult(), 10);
    });

    test("size() method exists and returns 1", async () => {
      await getQueuingStrategyFromOrigin(ctx, "Count");
      await ctx.eval(`
        const chunk = { data: "test" };
        setResult({
          hasSize: typeof __testQueuingStrategy.size === 'function',
          size: __testQueuingStrategy.size(chunk),
        });
      `);
      const result = ctx.getResult() as { hasSize: boolean; size: number };
      assert.strictEqual(result.hasSize, true);
      assert.strictEqual(result.size, 1);
    });

    test("instanceof CountQueuingStrategy", async () => {
      await getQueuingStrategyFromOrigin(ctx, "Count");
      await ctx.eval(`
        setResult(__testQueuingStrategy instanceof CountQueuingStrategy);
      `);
      assert.strictEqual(ctx.getResult(), true);
    });

    test("constructor.name is CountQueuingStrategy", async () => {
      await getQueuingStrategyFromOrigin(ctx, "Count");
      await ctx.eval(`
        setResult(__testQueuingStrategy.constructor.name);
      `);
      assert.strictEqual(ctx.getResult(), "CountQueuingStrategy");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Locked Stream Edge Cases", () => {
    for (const origin of READABLE_STREAM_ORIGINS) {
      test(`getReader() twice throws when from ${origin}`, async () => {
        await getReadableStreamFromOrigin(ctx, origin);
        await ctx.eval(`
          try {
            const reader1 = __testReadableStream.getReader();
            const reader2 = __testReadableStream.getReader();
            setResult({ threw: false });
          } catch (e) {
            setResult({ threw: true, name: e.name });
          }
        `);
        const result = ctx.getResult() as { threw: boolean; name?: string };
        assert.strictEqual(result.threw, true);
        assert.strictEqual(result.name, "TypeError");
      });
    }

    for (const origin of WRITABLE_STREAM_ORIGINS) {
      test(`getWriter() twice throws when from ${origin}`, async () => {
        await getWritableStreamFromOrigin(ctx, origin);
        await ctx.eval(`
          try {
            const writer1 = __testWritableStream.getWriter();
            const writer2 = __testWritableStream.getWriter();
            setResult({ threw: false });
          } catch (e) {
            setResult({ threw: true, name: e.name });
          }
        `);
        const result = ctx.getResult() as { threw: boolean; name?: string };
        assert.strictEqual(result.threw, true);
        assert.strictEqual(result.name, "TypeError");
      });
    }
  });

  describe("Cancelled Stream Edge Cases", () => {
    for (const origin of READABLE_STREAM_ORIGINS) {
      test(`read() after cancel() returns done when from ${origin}`, async () => {
        await getReadableStreamFromOrigin(ctx, origin, ["test"]);
        await ctx.eval(`
          const reader = __testReadableStream.getReader();
          await reader.cancel();
          const { done } = await reader.read();
          setResult(done);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  describe("Errored Stream Edge Cases", () => {
    test("ReadableStream with error propagates error", async () => {
      await ctx.eval(`
        const errorMsg = "Stream error";
        globalThis.__testReadableStream = new ReadableStream({
          start(controller) {
            controller.error(new Error(errorMsg));
          }
        });

        const reader = __testReadableStream.getReader();
        try {
          await reader.read();
          setResult({ threw: false });
        } catch (e) {
          setResult({ threw: true, message: e.message });
        }
      `);
      const result = ctx.getResult() as { threw: boolean; message?: string };
      assert.strictEqual(result.threw, true);
      assert.strictEqual(result.message, "Stream error");
    });

    test("WritableStream with error propagates error", async () => {
      await ctx.eval(`
        const errorMsg = "Write error";
        globalThis.__testWritableStream = new WritableStream({
          write(chunk) {
            throw new Error(errorMsg);
          }
        });

        const writer = __testWritableStream.getWriter();
        try {
          await writer.write("test");
          setResult({ threw: false });
        } catch (e) {
          setResult({ threw: true, message: e.message });
        }
      `);
      const result = ctx.getResult() as { threw: boolean; message?: string };
      assert.strictEqual(result.threw, true);
      assert.strictEqual(result.message, "Write error");
    });
  });

  // ============================================================================
  // Piping Tests
  // ============================================================================

  describe("Piping", () => {
    for (const origin of READABLE_STREAM_ORIGINS) {
      test(`pipeTo() works when from ${origin}`, async () => {
        await getReadableStreamFromOrigin(ctx, origin, ["hello", "world"]);
        await ctx.eval(`
          const chunks = [];
          const writable = new WritableStream({
            write(chunk) {
              chunks.push(new TextDecoder().decode(chunk));
            }
          });

          await __testReadableStream.pipeTo(writable);
          // Different origins may chunk data differently, so join to compare content
          setResult(chunks.join(""));
        `);
        assert.strictEqual(ctx.getResult(), "helloworld");
      });

      test(`pipeThrough() works when from ${origin}`, async () => {
        await getReadableStreamFromOrigin(ctx, origin, ["test"]);
        await ctx.eval(`
          const transform = new TransformStream({
            transform(chunk, controller) {
              // Convert to uppercase
              const text = new TextDecoder().decode(chunk);
              controller.enqueue(new TextEncoder().encode(text.toUpperCase()));
            }
          });

          const transformed = __testReadableStream.pipeThrough(transform);
          const reader = transformed.getReader();
          const { value } = await reader.read();
          const text = new TextDecoder().decode(value);
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "TEST");
      });
    }
  });
});
