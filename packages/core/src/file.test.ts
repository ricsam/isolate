import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("File", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("creates file with name", async () => {
      const result = await context.eval(`
        const file = new File([], "test.txt");
        file.name
      `);
      assert.strictEqual(result, "test.txt");
    });

    test("creates file with content", async () => {
      const result = await context.eval(`
        const file = new File(["content"], "test.txt");
        file.size
      `);
      assert.strictEqual(result, 7);
    });

    test("creates file with type option", async () => {
      const result = await context.eval(`
        const file = new File(["test"], "test.txt", { type: "text/plain" });
        file.type
      `);
      assert.strictEqual(result, "text/plain");
    });

    test("creates file with custom lastModified", async () => {
      const result = await context.eval(`
        const file = new File(["test"], "test.txt", { lastModified: 1234567890 });
        file.lastModified
      `);
      assert.strictEqual(result, 1234567890);
    });

    test("creates file with multiple parts", async () => {
      const result = await context.eval(`
        const file = new File(["hello", " ", "world"], "test.txt");
        file.size
      `);
      assert.strictEqual(result, 11);
    });
  });

  describe("name property", () => {
    test("returns the file name", async () => {
      const result = await context.eval(`
        const file = new File(["content"], "document.pdf");
        file.name
      `);
      assert.strictEqual(result, "document.pdf");
    });

    test("handles special characters in name", async () => {
      const result = await context.eval(`
        const file = new File(["content"], "file with spaces.txt");
        file.name
      `);
      assert.strictEqual(result, "file with spaces.txt");
    });
  });

  describe("size property", () => {
    test("returns 0 for empty file", async () => {
      const result = await context.eval(`
        const file = new File([], "empty.txt");
        file.size
      `);
      assert.strictEqual(result, 0);
    });

    test("returns correct size for content", async () => {
      const result = await context.eval(`
        const file = new File(["hello world"], "test.txt");
        file.size
      `);
      assert.strictEqual(result, 11);
    });
  });

  describe("type property", () => {
    test("returns empty string by default", async () => {
      const result = await context.eval(`
        const file = new File(["test"], "test.txt");
        file.type
      `);
      assert.strictEqual(result, "");
    });

    test("returns specified type", async () => {
      const result = await context.eval(`
        const file = new File(["test"], "test.json", { type: "application/json" });
        file.type
      `);
      assert.strictEqual(result, "application/json");
    });
  });

  describe("lastModified property", () => {
    test("returns current time by default", async () => {
      const result = await context.eval(`
        const before = Date.now();
        const file = new File(["test"], "test.txt");
        const after = Date.now();
        file.lastModified >= before && file.lastModified <= after
      `);
      assert.strictEqual(result, true);
    });

    test("returns custom lastModified when specified", async () => {
      const result = await context.eval(`
        const file = new File(["test"], "test.txt", { lastModified: 1000000 });
        file.lastModified
      `);
      assert.strictEqual(result, 1000000);
    });
  });

  describe("webkitRelativePath property", () => {
    test("returns empty string", async () => {
      // File.webkitRelativePath is always empty string for files created via constructor
      const result = await context.eval(`
        const file = new File(["test"], "test.txt");
        typeof file.webkitRelativePath === 'undefined' || file.webkitRelativePath === ''
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("text() method", () => {
    test("returns content as string", async () => {
      const result = await context.eval(`
        (async () => {
          const file = new File(["hello world"], "test.txt");
          return await file.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello world");
    });
  });

  describe("arrayBuffer() method", () => {
    test("returns content as ArrayBuffer", async () => {
      const result = await context.eval(`
        (async () => {
          const file = new File(["test"], "test.txt");
          const buffer = await file.arrayBuffer();
          return buffer instanceof ArrayBuffer && buffer.byteLength === 4;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });
  });

  describe("slice() method", () => {
    test("slices file content", async () => {
      const result = await context.eval(`
        (async () => {
          const file = new File(["hello world"], "test.txt");
          const sliced = file.slice(0, 5);
          return await sliced.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello");
    });
  });

  describe("multiple files", () => {
    test("files are independent", async () => {
      const result = await context.eval(`
        const file1 = new File(["hello"], "file1.txt");
        const file2 = new File(["world"], "file2.txt");
        JSON.stringify({
          name1: file1.name,
          name2: file2.name,
          size1: file1.size,
          size2: file2.size
        })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.name1, "file1.txt");
      assert.strictEqual(parsed.name2, "file2.txt");
      assert.strictEqual(parsed.size1, 5);
      assert.strictEqual(parsed.size2, 5);
    });
  });
});
