import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { marshal, clearAllInstanceState } from "./index.ts";

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
      // TODO: Implement test
      // Original test:
      // const obj = { name: "test" };
      // obj.self = obj;
      // assert.throws(() => marshal(context, obj), /Circular reference detected/);
    });

    test("throws on circular object graph (a -> b -> a)", async () => {
      // TODO: Implement test
      // Original test:
      // const a = { name: "a" };
      // const b = { name: "b" };
      // a.ref = b;
      // b.ref = a;
      // assert.throws(() => marshal(context, a), /Circular reference detected/);
    });

    test("throws on deep circular reference", async () => {
      // TODO: Implement test
    });

    test("allows same object referenced twice (DAG, not cycle)", async () => {
      // TODO: Implement test
      // Original test:
      // const shared = { value: 42 };
      // const obj = { first: shared, second: shared };
      // This should NOT throw because it's a DAG, not a cycle
    });
  });

  describe("Uint8Array marshalling", () => {
    test("marshals Uint8Array correctly", async () => {
      // TODO: Implement test
    });

    test("marshals Uint8Array with byte offset", async () => {
      // TODO: Implement test
    });
  });

  describe("function marshalling", () => {
    test("marshals function that throws Error", async () => {
      // TODO: Implement test
    });
  });

  describe("max depth", () => {
    test("throws when max depth exceeded", async () => {
      // TODO: Implement test
    });

    test("respects custom max depth", async () => {
      // TODO: Implement test
    });
  });
});
