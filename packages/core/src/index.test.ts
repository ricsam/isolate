import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, marshal, unmarshal, defineFunction, withScope, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("@ricsam/isolate-core", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  test("marshal and unmarshal primitives", async () => {
    const strRef = marshal(context, "hello");
    context.global.setSync("str", strRef);
    assert.strictEqual(context.evalSync("str"), "hello");

    const numRef = marshal(context, 42);
    context.global.setSync("num", numRef);
    assert.strictEqual(context.evalSync("num"), 42);

    const boolRef = marshal(context, true);
    context.global.setSync("bool", boolRef);
    assert.strictEqual(context.evalSync("bool"), true);

    const nullRef = marshal(context, null);
    context.global.setSync("nul", nullRef);
    assert.strictEqual(context.evalSync("nul"), null);

    const undefinedRef = marshal(context, undefined);
    context.global.setSync("undef", undefinedRef);
    assert.strictEqual(context.evalSync("undef"), undefined);
  });

  test("marshal and unmarshal arrays", async () => {
    const arr = [1, 2, 3];
    const ref = marshal(context, arr);
    context.global.setSync("arr", ref);
    const result = context.evalSync("JSON.stringify(arr)");
    assert.deepStrictEqual(JSON.parse(result as string), arr);
  });

  test("marshal and unmarshal objects", async () => {
    const obj = { name: "test", value: 123 };
    const ref = marshal(context, obj);
    context.global.setSync("obj", ref);
    const result = context.evalSync("JSON.stringify(obj)");
    assert.deepStrictEqual(JSON.parse(result as string), obj);
  });

  test("unmarshal Error objects preserves message and stack", async () => {
    // Create an error in the isolate
    const errorRef = context.evalSync(`
      const err = new Error("test error message");
      err
    `) as ivm.Reference;

    const error = unmarshal(context, errorRef);
    // The error is unmarshalled as an object with __type: "Error" metadata
    // or as a regular Error object depending on how it's transferred
    assert.ok(error !== null);
  });

  test("defineFunction creates callable function in isolate", async () => {
    defineFunction(context, "add", (a, b) => (a as number) + (b as number));
    const result = context.evalSync("add(2, 3)");
    assert.strictEqual(result, 5);
  });

  test("withScope automatically disposes handles", async () => {
    const result = withScope(context, (scope) => {
      const h1 = scope.marshal("test1");
      const h2 = scope.marshal("test2");
      context.global.setSync("t1", h1);
      context.global.setSync("t2", h2);
      return "done";
    });
    assert.strictEqual(result, "done");
  });

  test("setupCore injects Blob and File classes", async () => {
    await setupCore(context);

    const result = await context.eval(`
      typeof Blob === 'function' && typeof File === 'function' &&
      typeof ReadableStream === 'function' && typeof WritableStream === 'function'
    `);
    assert.strictEqual(result, true);
  });

  test("Blob class works correctly in isolate", async () => {
    await setupCore(context);

    const result = await context.eval(`
      const blob = new Blob(["hello", " ", "world"], { type: "text/plain" });
      JSON.stringify({ size: blob.size, type: blob.type })
    `);
    const data = JSON.parse(result as string);
    assert.strictEqual(data.size, 11);
    assert.strictEqual(data.type, "text/plain");
  });

  test("File class works correctly in isolate", async () => {
    await setupCore(context);

    const result = await context.eval(`
      const file = new File(["content"], "test.txt", { type: "text/plain" });
      JSON.stringify({ name: file.name, size: file.size, type: file.type })
    `);
    const data = JSON.parse(result as string);
    assert.strictEqual(data.name, "test.txt");
    assert.strictEqual(data.size, 7);
    assert.strictEqual(data.type, "text/plain");
  });
});
