import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { marshal, unmarshal, clearAllInstanceState } from "./index.ts";

describe("marshal", () => {
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

  describe("circular reference detection", () => {
    test("throws on self-referencing object", async () => {
      const obj: Record<string, unknown> = { name: "test" };
      obj.self = obj;
      assert.throws(() => marshal(context, obj), /Circular reference detected/);
    });

    test("throws on circular object graph (a -> b -> a)", async () => {
      const a: Record<string, unknown> = { name: "a" };
      const b: Record<string, unknown> = { name: "b" };
      a.ref = b;
      b.ref = a;
      assert.throws(() => marshal(context, a), /Circular reference detected/);
    });

    test("throws on deep circular reference", async () => {
      const a: Record<string, unknown> = { name: "a" };
      const b: Record<string, unknown> = { name: "b" };
      const c: Record<string, unknown> = { name: "c" };
      a.b = b;
      b.c = c;
      c.a = a;
      assert.throws(() => marshal(context, a), /Circular reference detected/);
    });

    test("allows same object referenced twice (DAG, not cycle)", async () => {
      const shared = { value: 42 };
      const obj = { first: shared, second: shared };
      // This should NOT throw because it's a DAG, not a cycle
      // Marshal succeeds and the value can be used in the isolate
      const marshaled = marshal(context, obj);
      context.global.setSync("dagTest", marshaled);

      // Verify the value is correct inside the isolate
      const result = await context.eval(`
        JSON.stringify({ first: dagTest.first, second: dagTest.second })
      `);
      const parsed = JSON.parse(result as string);
      assert.deepStrictEqual(parsed.first, shared);
      assert.deepStrictEqual(parsed.second, shared);
    });
  });

  describe("Uint8Array marshalling", () => {
    test("marshals Uint8Array correctly", async () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      const ref = marshal(context, arr);
      context.global.setSync("data", ref);
      const result = await context.eval(`
        const arr = data;
        arr instanceof Uint8Array && arr.length === 5 && arr[0] === 1 && arr[4] === 5
      `);
      assert.strictEqual(result, true);
    });

    test("marshals Uint8Array with byte offset", async () => {
      const buffer = new ArrayBuffer(10);
      const fullView = new Uint8Array(buffer);
      for (let i = 0; i < 10; i++) fullView[i] = i;
      const offsetView = new Uint8Array(buffer, 2, 5);
      const ref = marshal(context, offsetView);
      context.global.setSync("data", ref);
      const result = await context.eval(`
        const arr = data;
        arr instanceof Uint8Array && arr.length === 5 && arr[0] === 2 && arr[4] === 6
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("function marshalling", () => {
    test("marshals function that throws Error", async () => {
      const fn = () => {
        throw new Error("test error");
      };
      const ref = marshal(context, fn);
      context.global.setSync("testFn", ref);
      const result = await context.eval(`
        try {
          testFn();
          "no error";
        } catch (e) {
          e.message;
        }
      `);
      assert.strictEqual(result, "test error");
    });
  });

  describe("max depth", () => {
    test("throws when max depth exceeded", async () => {
      // Create deeply nested object
      let obj: Record<string, unknown> = { value: "deep" };
      for (let i = 0; i < 150; i++) {
        obj = { nested: obj };
      }
      assert.throws(() => marshal(context, obj), /Max depth.*exceeded/);
    });

    test("respects custom max depth", async () => {
      let obj: Record<string, unknown> = { value: "deep" };
      for (let i = 0; i < 5; i++) {
        obj = { nested: obj };
      }
      assert.throws(() => marshal(context, obj, { maxDepth: 3 }), /Max depth.*exceeded/);
    });
  });
});
