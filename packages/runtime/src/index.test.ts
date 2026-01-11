import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createRuntime } from "./index.ts";

describe("@ricsam/isolate-runtime", () => {
  describe("createRuntime", () => {
    test("creates runtime with default options", async () => {
      // TODO: Implement test
      // const runtime = await createRuntime();
      // assert(runtime.isolate);
      // assert(runtime.context);
      // runtime.dispose();
    });

    test("runtime has all globals defined", async () => {
      // TODO: Implement test
      // const runtime = await createRuntime();
      // const result = await runtime.context.eval(`
      //   typeof fetch === 'function' &&
      //   typeof console === 'object' &&
      //   typeof crypto === 'object'
      // `);
      // assert.strictEqual(result, true);
      // runtime.dispose();
    });

    test("dispose cleans up resources", async () => {
      // TODO: Implement test
    });
  });

  describe("console integration", () => {
    test("console.log is captured", async () => {
      // TODO: Implement test
    });
  });

  describe("fetch integration", () => {
    test("fetch calls onFetch handler", async () => {
      // TODO: Implement test
    });
  });

  describe("timers integration", () => {
    test("setTimeout works with tick()", async () => {
      // TODO: Implement test
    });
  });

  describe("GC disposal", () => {
    test("resources are cleaned up on dispose", async () => {
      // TODO: Implement test
    });
  });
});
