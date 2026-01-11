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
      const receivedArgs: unknown[] = [];
      defineFunction(context, "testFn", (...args) => {
        receivedArgs.push(...args);
        return "result";
      });

      const result = await context.eval(`testFn("hello", 42, true)`);
      assert.strictEqual(result, "result");
      assert.deepStrictEqual(receivedArgs, ["hello", 42, true]);
    });

    test("marshals Error thrown by host function", async () => {
      defineFunction(context, "throwError", () => {
        throw new Error("host error message");
      });

      const result = await context.eval(`
        try {
          throwError();
          "no error";
        } catch (e) {
          e.message;
        }
      `);
      assert.strictEqual(result, "host error message");
    });

    test("marshals non-Error thrown by host function", async () => {
      defineFunction(context, "throwString", () => {
        throw "string error";
      });

      const result = await context.eval(`
        try {
          throwString();
          "no error";
        } catch (e) {
          typeof e === "string" ? e : "not a string";
        }
      `);
      assert.strictEqual(result, "string error");
    });

    test("returns marshalled object result", async () => {
      defineFunction(context, "getObject", () => {
        return { name: "test", value: 123 };
      });

      const result = await context.eval(`
        const obj = getObject();
        JSON.stringify(obj)
      `);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed, { name: "test", value: 123 });
    });
  });

  describe("defineAsyncFunction", () => {
    test("returns the resolved value directly (blocking via applySyncPromise)", async () => {
      defineAsyncFunction(context, "asyncFn", async () => {
        return "async result";
      });

      // With applySyncPromise, the function blocks and returns the value directly
      const result = await context.eval(`asyncFn()`);
      assert.strictEqual(result, "async result");
    });

    test("receives unmarshalled arguments", async () => {
      const receivedArgs: unknown[] = [];
      defineAsyncFunction(context, "asyncWithArgs", async (...args) => {
        receivedArgs.push(...args);
        return "done";
      });

      const result = await context.eval(`
        (async () => {
          return await asyncWithArgs("async", 99, false);
        })()
      `, { promise: true });
      assert.strictEqual(result, "done");
      assert.deepStrictEqual(receivedArgs, ["async", 99, false]);
    });
  });
});
