import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "../index.ts";

describe("WritableStream", () => {
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
    test("creates a WritableStream", async () => {
      // TODO: Implement test
    });

    test("WritableStream is a function", async () => {
      // TODO: Implement test
    });
  });

  describe("locked property", () => {
    test("is false initially", async () => {
      // TODO: Implement test
    });

    test("becomes true when writer is acquired", async () => {
      // TODO: Implement test
    });
  });

  describe("getWriter()", () => {
    test("returns a WritableStreamDefaultWriter", async () => {
      // TODO: Implement test
    });

    test("throws if stream is already locked", async () => {
      // TODO: Implement test
    });
  });

  describe("close()", () => {
    test("closes the stream", async () => {
      // TODO: Implement test
    });
  });

  describe("abort()", () => {
    test("aborts the stream", async () => {
      // TODO: Implement test
    });
  });
});

describe("WritableStreamDefaultWriter", () => {
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

  describe("write()", () => {
    test("writes chunks to the stream", async () => {
      // TODO: Implement test
    });
  });

  describe("close()", () => {
    test("closes the writer and stream", async () => {
      // TODO: Implement test
    });
  });

  describe("releaseLock()", () => {
    test("releases the lock on the stream", async () => {
      // TODO: Implement test
    });
  });
});
