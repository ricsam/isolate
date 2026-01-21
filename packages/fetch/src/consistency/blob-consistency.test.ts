import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getBlobFromOrigin,
  type ConsistencyTestContext,
  type BlobOrigin,
  BLOB_ORIGINS,
} from "./origins.ts";

describe("Blob Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // Property Existence
  // ============================================================================

  describe("Property Existence", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`size property exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test content");
        await ctx.eval(`
          setResult(typeof __testBlob.size === 'number');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`type property exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test content", { type: "text/plain" });
        await ctx.eval(`
          setResult(typeof __testBlob.type === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // Property Values
  // ============================================================================

  describe("Property Values", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`size returns correct value when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "12345");
        await ctx.eval(`
          setResult(__testBlob.size);
        `);
        assert.strictEqual(ctx.getResult(), 5);
      });

      test(`type returns correct value when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test", { type: "text/plain" });
        await ctx.eval(`
          setResult(__testBlob.type);
        `);
        assert.strictEqual(ctx.getResult(), "text/plain");
      });

      test(`type is empty string when not specified from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(__testBlob.type);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });
    }
  });

  // ============================================================================
  // Method Existence
  // ============================================================================

  describe("Method Existence", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`text() method exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(typeof __testBlob.text === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`arrayBuffer() method exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(typeof __testBlob.arrayBuffer === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`slice() method exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(typeof __testBlob.slice === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`stream() method exists when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(typeof __testBlob.stream === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // text() Behavior
  // ============================================================================

  describe("text() Behavior", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`text() returns string content when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const text = await __testBlob.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "hello world");
      });

      test(`text() returns empty string for empty blob when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "");
        await ctx.eval(`
          const text = await __testBlob.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });
    }
  });

  // ============================================================================
  // arrayBuffer() Behavior
  // ============================================================================

  describe("arrayBuffer() Behavior", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`arrayBuffer() returns ArrayBuffer when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "ABCDE");
        await ctx.eval(`
          const buffer = await __testBlob.arrayBuffer();
          setResult({
            isArrayBuffer: buffer instanceof ArrayBuffer,
            byteLength: buffer.byteLength,
          });
        `);
        const result = ctx.getResult() as { isArrayBuffer: boolean; byteLength: number };
        assert.strictEqual(result.isArrayBuffer, true);
        assert.strictEqual(result.byteLength, 5);
      });

      test(`arrayBuffer() has correct bytes when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "ABC");
        await ctx.eval(`
          const buffer = await __testBlob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(buffer));
          setResult(bytes);
        `);
        const result = ctx.getResult() as number[];
        assert.deepStrictEqual(result, [65, 66, 67]); // A=65, B=66, C=67
      });
    }
  });

  // ============================================================================
  // slice() Behavior
  // ============================================================================

  describe("slice() Behavior", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`slice() returns Blob when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const sliced = __testBlob.slice(0, 5);
          setResult(sliced instanceof Blob);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`slice(start, end) extracts correct portion when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const sliced = __testBlob.slice(0, 5);
          const text = await sliced.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "hello");
      });

      test(`slice(start) extracts from start to end when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const sliced = __testBlob.slice(6);
          const text = await sliced.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "world");
      });

      test(`slice() with negative indices works when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world");
        await ctx.eval(`
          const sliced = __testBlob.slice(-5);
          const text = await sliced.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "world");
      });

      test(`slice() with content type works when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello world", { type: "text/plain" });
        await ctx.eval(`
          const sliced = __testBlob.slice(0, 5, "text/html");
          setResult(sliced.type);
        `);
        assert.strictEqual(ctx.getResult(), "text/html");
      });

      test(`slice() creates independent blob when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "original content");
        await ctx.eval(`
          const sliced = __testBlob.slice(0, 8);
          setResult({
            originalSize: __testBlob.size,
            slicedSize: sliced.size,
          });
        `);
        const result = ctx.getResult() as { originalSize: number; slicedSize: number };
        assert.strictEqual(result.originalSize, 16);
        assert.strictEqual(result.slicedSize, 8);
      });
    }
  });

  // ============================================================================
  // stream() Behavior
  // ============================================================================

  describe("stream() Behavior", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`stream() returns ReadableStream when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test content");
        await ctx.eval(`
          const stream = __testBlob.stream();
          setResult({
            hasGetReader: typeof stream.getReader === 'function',
          });
        `);
        const result = ctx.getResult() as { hasGetReader: boolean };
        assert.strictEqual(result.hasGetReader, true);
      });

      test(`stream() can be consumed via reader when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "hello");
        await ctx.eval(`
          const stream = __testBlob.stream();
          const reader = stream.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(...value);
          }
          setResult(String.fromCharCode(...chunks));
        `);
        assert.strictEqual(ctx.getResult(), "hello");
      });
    }
  });

  // ============================================================================
  // instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`blob instanceof Blob when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(__testBlob instanceof Blob);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`blob.constructor.name is Blob when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "test");
        await ctx.eval(`
          setResult(__testBlob.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "Blob");
      });
    }
  });

  // ============================================================================
  // Constructor Variations
  // ============================================================================

  describe("Constructor Variations", () => {
    test("new Blob() creates empty blob", async () => {
      await ctx.eval(`
        const blob = new Blob();
        setResult({
          size: blob.size,
          type: blob.type,
        });
      `);
      const result = ctx.getResult() as { size: number; type: string };
      assert.strictEqual(result.size, 0);
      assert.strictEqual(result.type, "");
    });

    test("new Blob([string]) creates blob from string", async () => {
      await ctx.eval(`
        const blob = new Blob(["hello"]);
        setResult({
          size: blob.size,
        });
      `);
      const result = ctx.getResult() as { size: number };
      assert.strictEqual(result.size, 5);
    });

    test("new Blob([Uint8Array]) creates blob from bytes", async () => {
      await ctx.eval(`
        const bytes = new Uint8Array([65, 66, 67]);
        const blob = new Blob([bytes]);
        const text = await blob.text();
        setResult({
          size: blob.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 3);
      assert.strictEqual(result.text, "ABC");
    });

    test("new Blob([ArrayBuffer]) creates blob from buffer", async () => {
      await ctx.eval(`
        const buffer = new ArrayBuffer(4);
        const view = new Uint8Array(buffer);
        view[0] = 65; view[1] = 66; view[2] = 67; view[3] = 68;
        const blob = new Blob([buffer]);
        const text = await blob.text();
        setResult({
          size: blob.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 4);
      assert.strictEqual(result.text, "ABCD");
    });

    test("new Blob([multiple parts]) concatenates parts", async () => {
      await ctx.eval(`
        const blob = new Blob(["hello", " ", "world"]);
        const text = await blob.text();
        setResult({
          size: blob.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 11);
      assert.strictEqual(result.text, "hello world");
    });

    test("new Blob(parts, { type }) sets type", async () => {
      await ctx.eval(`
        const blob = new Blob(["test"], { type: "text/plain" });
        setResult(blob.type);
      `);
      assert.strictEqual(ctx.getResult(), "text/plain");
    });

    test("new Blob([Blob]) creates blob from other blob with correct content", async () => {
      await ctx.eval(`
        const original = new Blob(["hello"]);
        const copy = new Blob([original]);
        const text = await copy.text();
        setResult({
          size: copy.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 5, "Blob size should match original content");
      assert.strictEqual(result.text, "hello", "Blob content should match original");
    });
  });

  // ============================================================================
  // Multiple reads
  // ============================================================================

  describe("Multiple Reads", () => {
    for (const origin of BLOB_ORIGINS) {
      test(`blob can be read multiple times when from ${origin}`, async () => {
        await getBlobFromOrigin(ctx, origin, "reusable content");
        await ctx.eval(`
          const text1 = await __testBlob.text();
          const text2 = await __testBlob.text();
          const buffer = await __testBlob.arrayBuffer();
          setResult({
            text1,
            text2,
            bufferSize: buffer.byteLength,
            equal: text1 === text2,
          });
        `);
        const result = ctx.getResult() as {
          text1: string;
          text2: string;
          bufferSize: number;
          equal: boolean;
        };
        assert.strictEqual(result.text1, "reusable content");
        assert.strictEqual(result.text2, "reusable content");
        assert.strictEqual(result.bufferSize, 16);
        assert.strictEqual(result.equal, true);
      });
    }
  });
});
