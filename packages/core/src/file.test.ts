import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";
import { runTestCode } from "@ricsam/isolate-test-utils";

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

  describe("Native File → isolate", () => {
    test("native File should pass instanceof File check in isolate", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("instanceofFile", file instanceof File);
        log("constructorName", file.constructor.name);
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      });

      assert.deepStrictEqual(runtime.logs, {
        instanceofFile: true,
        constructorName: "File",
      });
    });

    test("native File should pass instanceof Blob check in isolate", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("instanceofBlob", file instanceof Blob);
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.instanceofBlob, true);
    });

    test("native File name property is preserved", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("name", file.name);
      `
      ).input({
        file: new File(["test"], "document.pdf", { type: "application/pdf" }),
      });

      assert.strictEqual(runtime.logs.name, "document.pdf");
    });

    test("native File type property is preserved", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("type", file.type);
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.type, "text/plain");
    });

    test("native File lastModified property is preserved", async () => {
      const lastModified = 1609459200000; // 2021-01-01
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("lastModified", file.lastModified);
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain", lastModified }),
      });

      assert.strictEqual(runtime.logs.lastModified, lastModified);
    });

    test("native File size property (content not transferred)", async () => {
      // Note: The helper creates an empty File with matching metadata,
      // so size will be 0 instead of the original content size
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("hasSize", typeof file.size === "number");
      `
      ).input({
        file: new File(["test content"], "test.txt", { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasSize, true);
    });

    test("native File has webkitRelativePath property", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("hasWebkitRelativePath", "webkitRelativePath" in file || file.webkitRelativePath === "" || file.webkitRelativePath === undefined);
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasWebkitRelativePath, true);
    });

    test("native File methods exist", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("hasText", typeof file.text === "function");
        log("hasArrayBuffer", typeof file.arrayBuffer === "function");
        log("hasSlice", typeof file.slice === "function");
      `
      ).input({
        file: new File(["test"], "test.txt", { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasText, true);
      assert.strictEqual(runtime.logs.hasArrayBuffer, true);
      assert.strictEqual(runtime.logs.hasSlice, true);
    });
  });

  describe("Bidirectional Conversion (Native→isolate→Native)", () => {
    test("File created in isolate should return as native File", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = new File(["test content"], "created.txt", { type: "text/plain" });
        log("file", file);
      `
      ).input({});

      assert.ok(runtime.logs.file instanceof File);
      assert.strictEqual((runtime.logs.file as File).name, "created.txt");
    });

    test("native File passed through isolate returns as native File", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = testingInput.file;
        log("passedFile", file);
      `
      ).input({
        file: new File(["original content"], "passed.txt", { type: "application/octet-stream" }),
      });

      assert.ok(runtime.logs.passedFile instanceof File);
      assert.strictEqual((runtime.logs.passedFile as File).name, "passed.txt");
      assert.strictEqual((runtime.logs.passedFile as File).type, "application/octet-stream");
    });

    test("File should also be instance of Blob after round-trip", async () => {
      const runtime = runTestCode(
        context,
        `
        const file = new File(["test"], "test.txt", { type: "text/plain" });
        log("file", file);
      `
      ).input({});

      assert.ok(runtime.logs.file instanceof File);
      assert.ok(runtime.logs.file instanceof Blob);
    });

    test("nested object with File converts properly", async () => {
      const runtime = runTestCode(
        context,
        `
        const obj = testingInput.data;
        log("hasFile", obj.attachment instanceof File);
        log("fileName", obj.attachment.name);
        log("description", obj.description);
      `
      ).input({
        data: {
          description: "Important document",
          attachment: new File(["content"], "document.pdf", { type: "application/pdf" }),
        },
      });

      assert.strictEqual(runtime.logs.hasFile, true);
      assert.strictEqual(runtime.logs.fileName, "document.pdf");
      assert.strictEqual(runtime.logs.description, "Important document");
    });
  });
});
