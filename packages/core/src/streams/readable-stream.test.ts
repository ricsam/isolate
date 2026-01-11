import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "../index.ts";

describe("ReadableStream", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("creates a ReadableStream", async () => {
      // TODO: Implement test
    });

    test("ReadableStream is a function", async () => {
      // TODO: Implement test
    });
  });

  describe("locked property", () => {
    test("is false initially", async () => {
      // TODO: Implement test
    });
  });

  describe("cancel()", () => {
    test("returns a promise", async () => {
      // TODO: Implement test
    });
  });

  describe("prototype methods exist", () => {
    test("has getReader method", async () => {
      // TODO: Implement test
    });

    test("has cancel method", async () => {
      // TODO: Implement test
    });

    test("has tee method", async () => {
      // TODO: Implement test
    });

    test("has pipeTo method", async () => {
      // TODO: Implement test
    });

    test("has pipeThrough method", async () => {
      // TODO: Implement test
    });
  });
});

describe("ReadableStream controller.error()", () => {
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

  test("controller.error() puts stream in errored state", async () => {
    // TODO: Implement test
  });

  test("enqueue during pending read fulfills the read request", async () => {
    // TODO: Implement test
  });

  test("controller.close() resolves pending reads with done:true", async () => {
    // TODO: Implement test
  });

  test("read from queue before pending read", async () => {
    // TODO: Implement test
  });

  test("multiple reads fulfilled in order", async () => {
    // TODO: Implement test
  });
});
