import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { defineFunction, defineAsyncFunction, clearAllInstanceState } from "./index.ts";

describe("function-builder", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("defineFunction", () => {
    test("calls host function with unmarshalled arguments", async () => {
      // TODO: Implement test
      // const receivedArgs: unknown[] = [];
      // const fn = defineFunction(context, "testFn", (...args) => {
      //   receivedArgs.push(...args);
      //   return "result";
      // });
      // Set on global and call from isolate
      // assert.deepStrictEqual(receivedArgs, ["hello", 42, true]);
    });

    test("marshals Error thrown by host function", async () => {
      // TODO: Implement test
    });

    test("marshals non-Error thrown by host function", async () => {
      // TODO: Implement test
    });

    test("returns marshalled object result", async () => {
      // TODO: Implement test
    });
  });

  describe("defineAsyncFunction", () => {
    test("returns a promise type", async () => {
      // TODO: Implement test
    });

    test("receives unmarshalled arguments", async () => {
      // TODO: Implement test
    });
  });
});
