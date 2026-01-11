import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "../index.ts";

describe("TransformStream", () => {
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
    test("creates a TransformStream", async () => {
      // TODO: Implement test
    });

    test("TransformStream is a function", async () => {
      // TODO: Implement test
    });
  });

  describe("readable property", () => {
    test("returns a ReadableStream", async () => {
      // TODO: Implement test
    });
  });

  describe("writable property", () => {
    test("returns a WritableStream", async () => {
      // TODO: Implement test
    });
  });

  describe("transform()", () => {
    test("transforms chunks through the stream", async () => {
      // TODO: Implement test
    });

    test("can modify chunk data", async () => {
      // TODO: Implement test
    });

    test("can filter out chunks", async () => {
      // TODO: Implement test
    });
  });

  describe("flush()", () => {
    test("flush is called when writer closes", async () => {
      // TODO: Implement test
    });

    test("can enqueue final chunks in flush", async () => {
      // TODO: Implement test
    });
  });
});
