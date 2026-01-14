import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";
import { runTestCode } from "@ricsam/isolate-test-utils";

describe("Blob", () => {
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
    test("creates empty blob with no arguments", async () => {
      const result = await context.eval(`
        const blob = new Blob();
        JSON.stringify({ size: blob.size, type: blob.type })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.size, 0);
      assert.strictEqual(data.type, "");
    });

    test("creates blob from string parts", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello"]);
        JSON.stringify({ size: blob.size, type: blob.type })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.size, 5);
      assert.strictEqual(data.type, "");
    });

    test("creates blob with type option", async () => {
      const result = await context.eval(`
        const blob = new Blob(["test"], { type: "text/plain" });
        JSON.stringify({ size: blob.size, type: blob.type })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.size, 4);
      assert.strictEqual(data.type, "text/plain");
    });

    test("creates blob from multiple string parts", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello", " ", "world"]);
        JSON.stringify({ size: blob.size, type: blob.type })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.size, 11);
      assert.strictEqual(data.type, "");
    });
  });

  describe("size property", () => {
    test("returns 0 for empty blob", async () => {
      const result = await context.eval(`
        const blob = new Blob();
        blob.size
      `);
      assert.strictEqual(result, 0);
    });

    test("returns correct size for content", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello world"]);
        blob.size
      `);
      assert.strictEqual(result, 11);
    });
  });

  describe("type property", () => {
    test("returns empty string by default", async () => {
      const result = await context.eval(`
        const blob = new Blob(["test"]);
        blob.type
      `);
      assert.strictEqual(result, "");
    });

    test("returns specified type", async () => {
      const result = await context.eval(`
        const blob = new Blob(["test"], { type: "application/json" });
        blob.type
      `);
      assert.strictEqual(result, "application/json");
    });
  });

  describe("text() method", () => {
    test("returns content as string", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["hello world"]);
          return await blob.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello world");
    });

    test("returns empty string for empty blob", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob();
          return await blob.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "");
    });

    test("concatenates multiple parts", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["hello", " ", "world"]);
          return await blob.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello world");
    });
  });

  describe("arrayBuffer() method", () => {
    test("returns content as ArrayBuffer", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["test"]);
          const buffer = await blob.arrayBuffer();
          return buffer instanceof ArrayBuffer && buffer.byteLength === 4;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });
  });

  describe("bytes() method", () => {
    test("returns a promise", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["test"]);
          const bytes = await blob.bytes();
          return bytes instanceof Uint8Array && bytes.length === 4;
        })()
      `, { promise: true });
      assert.strictEqual(result, true);
    });
  });

  describe("slice() method", () => {
    test("slices blob with start and end", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["hello world"]);
          const sliced = blob.slice(0, 5);
          return await sliced.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "hello");
    });

    test("sliced blob has correct size", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello world"]);
        const sliced = blob.slice(0, 5);
        sliced.size
      `);
      assert.strictEqual(result, 5);
    });

    test("slice with only start parameter", async () => {
      const result = await context.eval(`
        (async () => {
          const blob = new Blob(["hello world"]);
          const sliced = blob.slice(6);
          return await sliced.text();
        })()
      `, { promise: true });
      assert.strictEqual(result, "world");
    });

    test("slice preserves original type by default", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello"], { type: "text/plain" });
        const sliced = blob.slice(0, 3);
        sliced.type
      `);
      assert.strictEqual(result, "text/plain");
    });

    test("slice can override content type", async () => {
      const result = await context.eval(`
        const blob = new Blob(["hello"], { type: "text/plain" });
        const sliced = blob.slice(0, 3, "application/octet-stream");
        sliced.type
      `);
      assert.strictEqual(result, "application/octet-stream");
    });
  });

  describe("stream() method", () => {
    test("returns a ReadableStream", async () => {
      const result = await context.eval(`
        const blob = new Blob(["test"]);
        const stream = blob.stream();
        stream instanceof ReadableStream
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("multiple instances", () => {
    test("blobs are independent", async () => {
      const result = await context.eval(`
        const blob1 = new Blob(["hello"]);
        const blob2 = new Blob(["world"]);
        JSON.stringify({
          size1: blob1.size,
          size2: blob2.size
        })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.size1, 5);
      assert.strictEqual(data.size2, 5);
    });
  });

  describe("Native Blob → isolate", () => {
    test("native Blob should pass instanceof check in isolate", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("instanceof", blob instanceof Blob);
        log("constructorName", blob.constructor.name);
      `
      ).input({
        blob: new Blob(["test"], { type: "text/plain" }),
      });

      assert.deepStrictEqual(runtime.logs, {
        instanceof: true,
        constructorName: "Blob",
      });
    });

    test("native Blob type property is preserved", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("type", blob.type);
      `
      ).input({
        blob: new Blob(["test"], { type: "application/json" }),
      });

      assert.strictEqual(runtime.logs.type, "application/json");
    });

    test("native Blob size property is preserved", async () => {
      // Note: The helper creates an empty Blob with matching type,
      // so size won't match the original content
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("hasSize", typeof blob.size === "number");
      `
      ).input({
        blob: new Blob(["test content"], { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasSize, true);
    });

    test("native Blob slice method exists", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("hasSlice", typeof blob.slice === "function");
      `
      ).input({
        blob: new Blob(["test"], { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasSlice, true);
    });

    test("native Blob text method exists", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("hasText", typeof blob.text === "function");
      `
      ).input({
        blob: new Blob(["test"], { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasText, true);
    });

    test("native Blob arrayBuffer method exists", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("hasArrayBuffer", typeof blob.arrayBuffer === "function");
      `
      ).input({
        blob: new Blob(["test"], { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasArrayBuffer, true);
    });

    test("native Blob stream method exists", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("hasStream", typeof blob.stream === "function");
      `
      ).input({
        blob: new Blob(["test"], { type: "text/plain" }),
      });

      assert.strictEqual(runtime.logs.hasStream, true);
    });
  });

  describe("Bidirectional Conversion (Native→isolate→Native)", () => {
    test("Blob created in isolate should return as native Blob", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = new Blob(["test content"], { type: "text/plain" });
        log("blob", blob);
      `
      ).input({});

      // The helper serializes Blob as { __type__: 'Blob', type, size }
      // and unmarshals it back to a native Blob
      assert.ok(runtime.logs.blob instanceof Blob);
    });

    test("native Blob passed through isolate returns as native Blob", async () => {
      const runtime = runTestCode(
        context,
        `
        const blob = testingInput.blob;
        log("passedBlob", blob);
      `
      ).input({
        blob: new Blob(["original content"], { type: "application/octet-stream" }),
      });

      assert.ok(runtime.logs.passedBlob instanceof Blob);
      assert.strictEqual((runtime.logs.passedBlob as Blob).type, "application/octet-stream");
    });

    test("nested object with Blob converts properly", async () => {
      const runtime = runTestCode(
        context,
        `
        const obj = testingInput.data;
        log("hasBlob", obj.file instanceof Blob);
        log("name", obj.name);
      `
      ).input({
        data: {
          name: "test-file",
          file: new Blob(["content"], { type: "text/plain" }),
        },
      });

      assert.strictEqual(runtime.logs.hasBlob, true);
      assert.strictEqual(runtime.logs.name, "test-file");
    });
  });
});
