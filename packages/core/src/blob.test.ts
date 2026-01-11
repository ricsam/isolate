import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

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
      // TODO: Implement test
      // const result = await context.eval(`
      //   const blob = new Blob();
      //   JSON.stringify({ size: blob.size, type: blob.type })
      // `);
      // const data = JSON.parse(result);
      // assert.strictEqual(data.size, 0);
      // assert.strictEqual(data.type, "");
    });

    test("creates blob from string parts", async () => {
      // TODO: Implement test
    });

    test("creates blob with type option", async () => {
      // TODO: Implement test
    });

    test("creates blob from multiple string parts", async () => {
      // TODO: Implement test
    });
  });

  describe("size property", () => {
    test("returns 0 for empty blob", async () => {
      // TODO: Implement test
    });

    test("returns correct size for content", async () => {
      // TODO: Implement test
    });
  });

  describe("type property", () => {
    test("returns empty string by default", async () => {
      // TODO: Implement test
    });

    test("returns specified type", async () => {
      // TODO: Implement test
    });
  });

  describe("text() method", () => {
    test("returns content as string", async () => {
      // TODO: Implement test
    });

    test("returns empty string for empty blob", async () => {
      // TODO: Implement test
    });

    test("concatenates multiple parts", async () => {
      // TODO: Implement test
    });
  });

  describe("arrayBuffer() method", () => {
    test("returns content as ArrayBuffer", async () => {
      // TODO: Implement test
    });
  });

  describe("bytes() method", () => {
    test("returns a promise", async () => {
      // TODO: Implement test
    });
  });

  describe("slice() method", () => {
    test("slices blob with start and end", async () => {
      // TODO: Implement test
    });

    test("sliced blob has correct size", async () => {
      // TODO: Implement test
    });

    test("slice with only start parameter", async () => {
      // TODO: Implement test
    });

    test("slice preserves original type by default", async () => {
      // TODO: Implement test
    });

    test("slice can override content type", async () => {
      // TODO: Implement test
    });
  });

  describe("stream() method", () => {
    test("returns a ReadableStream", async () => {
      // TODO: Implement test
    });
  });

  describe("multiple instances", () => {
    test("blobs are independent", async () => {
      // TODO: Implement test
    });
  });
});
