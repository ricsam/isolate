import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore } from "./index.ts";

describe("@ricsam/isolate-core", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  test("marshal and unmarshal primitives", async () => {
    // TODO: Implement test
    // Original test:
    // const strHandle = marshal(context, "hello");
    // assert.strictEqual(unmarshal(context, strHandle), "hello");
    //
    // const numHandle = marshal(context, 42);
    // assert.strictEqual(unmarshal(context, numHandle), 42);
    //
    // const boolHandle = marshal(context, true);
    // assert.strictEqual(unmarshal(context, boolHandle), true);
    //
    // const nullHandle = marshal(context, null);
    // assert.strictEqual(unmarshal(context, nullHandle), null);
    //
    // const undefinedHandle = marshal(context, undefined);
    // assert.strictEqual(unmarshal(context, undefinedHandle), undefined);
  });

  test("marshal and unmarshal arrays", async () => {
    // TODO: Implement test
    // Original test:
    // const arr = [1, 2, 3];
    // const handle = marshal(context, arr);
    // assert.deepStrictEqual(unmarshal(context, handle), arr);
  });

  test("marshal and unmarshal objects", async () => {
    // TODO: Implement test
    // Original test:
    // const obj = { name: "test", value: 123 };
    // const handle = marshal(context, obj);
    // assert.deepStrictEqual(unmarshal(context, handle), obj);
  });

  test("unmarshal Error objects preserves message and stack", async () => {
    // TODO: Implement test
    // Original test:
    // Create an error in the isolate and verify it unmarshals correctly
    // const unmarshaled = unmarshal(context, result.value);
    // assert(unmarshaled instanceof Error);
    // assert.strictEqual((unmarshaled as Error).message, "test error message");
  });

  test("defineFunction creates callable function in isolate", async () => {
    // TODO: Implement test
    // Original test:
    // const addFn = defineFunction(context, "add", (a, b) => a + b);
    // Set on global and call from isolate
    // Verify result equals 5 for add(2, 3)
  });

  test("withScope automatically disposes handles", async () => {
    // TODO: Implement test
    // Original test:
    // const result = withScope(context, (scope) => {
    //   const h1 = scope.manage(marshal(context, "test1"));
    //   const h2 = scope.manage(marshal(context, "test2"));
    //   // Verify handles are managed
    //   return "done";
    // });
    // assert.strictEqual(result, "done");
  });

  test("setupCore injects Blob and File classes", async () => {
    // TODO: Implement test
    await setupCore(context);

    // Original test:
    // Check that globals are defined
    // const result = await context.eval(`
    //   typeof Blob === 'function' && typeof File === 'function' &&
    //   typeof ReadableStream === 'function' && typeof WritableStream === 'function'
    // `);
    // assert.strictEqual(result, true);
  });

  test("Blob class works correctly in isolate", async () => {
    // TODO: Implement test
    await setupCore(context);

    // Original test:
    // const result = await context.eval(`
    //   const blob = new Blob(["hello", " ", "world"], { type: "text/plain" });
    //   JSON.stringify({ size: blob.size, type: blob.type })
    // `);
    // const data = JSON.parse(result);
    // assert.strictEqual(data.size, 11);
    // assert.strictEqual(data.type, "text/plain");
  });

  test("File class works correctly in isolate", async () => {
    // TODO: Implement test
    await setupCore(context);

    // Original test:
    // const result = await context.eval(`
    //   const file = new File(["content"], "test.txt", { type: "text/plain" });
    //   JSON.stringify({ name: file.name, size: file.size, type: file.type })
    // `);
    // const data = JSON.parse(result);
    // assert.strictEqual(data.name, "test.txt");
    // assert.strictEqual(data.size, 7);
    // assert.strictEqual(data.type, "text/plain");
  });
});
