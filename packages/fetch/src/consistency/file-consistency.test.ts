import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getFileFromOrigin,
  type ConsistencyTestContext,
  type FileOrigin,
  FILE_ORIGINS,
} from "./origins.ts";

describe("File Consistency", () => {
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
    for (const origin of FILE_ORIGINS) {
      test(`name property exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.name === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`lastModified property exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.lastModified === 'number');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      // WHATWG Issue: webkitRelativePath should always exist as empty string
      // See WHATWG_INCONSISTENCIES.md#2-filewebkitrelativepath-property-missing
      test.todo(`webkitRelativePath property exists as string when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult({
            hasProperty: 'webkitRelativePath' in __testFile,
            isString: typeof __testFile.webkitRelativePath === 'string',
          });
        `);
        const result = ctx.getResult() as { hasProperty: boolean; isString: boolean };
        assert.strictEqual(result.hasProperty, true, "webkitRelativePath should be a property");
        assert.strictEqual(result.isString, true, "webkitRelativePath should be a string");
      });

      // Inherited from Blob
      test(`size property exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.size === 'number');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`type property exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt", { type: "text/plain" });
        await ctx.eval(`
          setResult(typeof __testFile.type === 'string');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // Property Values
  // ============================================================================

  describe("Property Values", () => {
    for (const origin of FILE_ORIGINS) {
      test(`name returns correct value when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "document.pdf");
        await ctx.eval(`
          setResult(__testFile.name);
        `);
        assert.strictEqual(ctx.getResult(), "document.pdf");
      });

      test(`lastModified returns correct value when from ${origin}`, async () => {
        const timestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
        await getFileFromOrigin(ctx, origin, "content", "test.txt", { lastModified: timestamp });
        await ctx.eval(`
          setResult(__testFile.lastModified);
        `);
        assert.strictEqual(ctx.getResult(), timestamp);
      });

      // WHATWG Issue: webkitRelativePath should be empty string
      // See WHATWG_INCONSISTENCIES.md#2-filewebkitrelativepath-property-missing
      test.todo(`webkitRelativePath is empty string when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(__testFile.webkitRelativePath);
        `);
        assert.strictEqual(ctx.getResult(), "", "webkitRelativePath should be empty string");
      });

      test(`size returns correct value when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "12345", "test.txt");
        await ctx.eval(`
          setResult(__testFile.size);
        `);
        assert.strictEqual(ctx.getResult(), 5);
      });

      test(`type returns correct value when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt", { type: "text/plain" });
        await ctx.eval(`
          setResult(__testFile.type);
        `);
        assert.strictEqual(ctx.getResult(), "text/plain");
      });

      test(`type is empty string when not specified from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(__testFile.type);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });
    }
  });

  // ============================================================================
  // Inherited Blob Methods
  // ============================================================================

  describe("Inherited Blob Methods", () => {
    for (const origin of FILE_ORIGINS) {
      test(`text() method exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.text === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`arrayBuffer() method exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.arrayBuffer === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`slice() method exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.slice === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`stream() method exists when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(typeof __testFile.stream === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`text() returns content when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "hello world", "test.txt");
        await ctx.eval(`
          const text = await __testFile.text();
          setResult(text);
        `);
        assert.strictEqual(ctx.getResult(), "hello world");
      });

      test(`arrayBuffer() returns buffer when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "ABCDE", "test.txt");
        await ctx.eval(`
          const buffer = await __testFile.arrayBuffer();
          setResult({
            isArrayBuffer: buffer instanceof ArrayBuffer,
            byteLength: buffer.byteLength,
          });
        `);
        const result = ctx.getResult() as { isArrayBuffer: boolean; byteLength: number };
        assert.strictEqual(result.isArrayBuffer, true);
        assert.strictEqual(result.byteLength, 5);
      });

      test(`slice() returns Blob when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "hello world", "test.txt");
        await ctx.eval(`
          const sliced = __testFile.slice(0, 5);
          const text = await sliced.text();
          setResult({
            isBlob: sliced instanceof Blob,
            text,
          });
        `);
        const result = ctx.getResult() as { isBlob: boolean; text: string };
        assert.strictEqual(result.isBlob, true);
        assert.strictEqual(result.text, "hello");
      });
    }
  });

  // ============================================================================
  // instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of FILE_ORIGINS) {
      test(`file instanceof File when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(__testFile instanceof File);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`file instanceof Blob when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(__testFile instanceof Blob);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`file.constructor.name is File when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "content", "test.txt");
        await ctx.eval(`
          setResult(__testFile.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "File");
      });
    }
  });

  // ============================================================================
  // Constructor Variations
  // ============================================================================

  describe("Constructor Variations", () => {
    test("new File([string], name) creates file with defaults", async () => {
      await ctx.eval(`
        const file = new File(["content"], "test.txt");
        setResult({
          name: file.name,
          size: file.size,
          type: file.type,
          hasLastModified: typeof file.lastModified === 'number',
        });
      `);
      const result = ctx.getResult() as {
        name: string;
        size: number;
        type: string;
        hasLastModified: boolean;
      };
      assert.strictEqual(result.name, "test.txt");
      assert.strictEqual(result.size, 7);
      assert.strictEqual(result.type, "");
      assert.strictEqual(result.hasLastModified, true);
    });

    test("new File([string], name, { type }) sets type", async () => {
      await ctx.eval(`
        const file = new File(["content"], "test.txt", { type: "text/plain" });
        setResult(file.type);
      `);
      assert.strictEqual(ctx.getResult(), "text/plain");
    });

    test("new File([string], name, { lastModified }) sets lastModified", async () => {
      const timestamp = 1704067200000;
      await ctx.eval(`
        const file = new File(["content"], "test.txt", { lastModified: ${timestamp} });
        setResult(file.lastModified);
      `);
      assert.strictEqual(ctx.getResult(), timestamp);
    });

    test("new File([Uint8Array], name) creates file from bytes", async () => {
      await ctx.eval(`
        const bytes = new Uint8Array([65, 66, 67]);
        const file = new File([bytes], "data.bin");
        const text = await file.text();
        setResult({
          size: file.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 3);
      assert.strictEqual(result.text, "ABC");
    });

    test("new File([ArrayBuffer], name) creates file from buffer", async () => {
      await ctx.eval(`
        const buffer = new ArrayBuffer(4);
        const view = new Uint8Array(buffer);
        view[0] = 65; view[1] = 66; view[2] = 67; view[3] = 68;
        const file = new File([buffer], "data.bin");
        const text = await file.text();
        setResult({
          size: file.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 4);
      assert.strictEqual(result.text, "ABCD");
    });

    test("new File([multiple parts], name) concatenates parts", async () => {
      await ctx.eval(`
        const file = new File(["hello", " ", "world"], "greeting.txt");
        const text = await file.text();
        setResult({
          size: file.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 11);
      assert.strictEqual(result.text, "hello world");
    });

    // WHATWG Issue: File from Blob should read content, not toString()
    // See WHATWG_INCONSISTENCIES.md#1-blob-constructor-doesnt-handle-blobfile-parts
    test.todo("new File([Blob], name) creates file from blob with correct content", async () => {
      await ctx.eval(`
        const blob = new Blob(["blob content"]);
        const file = new File([blob], "from-blob.txt");
        const text = await file.text();
        setResult({
          size: file.size,
          text,
          name: file.name,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string; name: string };
      assert.strictEqual(result.size, 12, "File size should match blob content");
      assert.strictEqual(result.text, "blob content", "File content should match blob");
      assert.strictEqual(result.name, "from-blob.txt");
    });

    // WHATWG Issue: File from File should read content, not toString()
    // See WHATWG_INCONSISTENCIES.md#1-blob-constructor-doesnt-handle-blobfile-parts
    test.todo("new File([File], name) creates file from file with correct content", async () => {
      await ctx.eval(`
        const original = new File(["original content"], "original.txt", { type: "text/plain" });
        const copy = new File([original], "copy.txt");
        const text = await copy.text();
        setResult({
          size: copy.size,
          text,
          originalName: original.name,
          copyName: copy.name,
        });
      `);
      const result = ctx.getResult() as {
        size: number;
        text: string;
        originalName: string;
        copyName: string;
      };
      assert.strictEqual(result.size, 16, "File size should match original content");
      assert.strictEqual(result.text, "original content", "File content should match original");
      assert.strictEqual(result.originalName, "original.txt");
      assert.strictEqual(result.copyName, "copy.txt");
    });
  });

  // ============================================================================
  // Multiple Reads
  // ============================================================================

  describe("Multiple Reads", () => {
    for (const origin of FILE_ORIGINS) {
      test(`file can be read multiple times when from ${origin}`, async () => {
        await getFileFromOrigin(ctx, origin, "reusable content", "test.txt");
        await ctx.eval(`
          const text1 = await __testFile.text();
          const text2 = await __testFile.text();
          const buffer = await __testFile.arrayBuffer();
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

  // ============================================================================
  // File vs Blob Distinction
  // ============================================================================

  describe("File vs Blob Distinction", () => {
    test("File has name while Blob does not", async () => {
      await ctx.eval(`
        const file = new File(["content"], "test.txt");
        const blob = new Blob(["content"]);
        setResult({
          fileHasName: 'name' in file && file.name === "test.txt",
          blobHasNoName: !('name' in blob) || blob.name === undefined,
        });
      `);
      const result = ctx.getResult() as { fileHasName: boolean; blobHasNoName: boolean };
      assert.strictEqual(result.fileHasName, true);
      assert.strictEqual(result.blobHasNoName, true);
    });

    test("File has lastModified while Blob does not", async () => {
      await ctx.eval(`
        const file = new File(["content"], "test.txt");
        const blob = new Blob(["content"]);
        setResult({
          fileHasLastModified: 'lastModified' in file && typeof file.lastModified === 'number',
          blobHasNoLastModified: !('lastModified' in blob),
        });
      `);
      const result = ctx.getResult() as {
        fileHasLastModified: boolean;
        blobHasNoLastModified: boolean;
      };
      assert.strictEqual(result.fileHasLastModified, true);
      assert.strictEqual(result.blobHasNoLastModified, true);
    });
  });
});
