import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCrypto } from "./index.ts";

describe("@ricsam/isolate-crypto", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCrypto(context);
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("crypto.randomUUID", () => {
    test("returns a valid UUID", async () => {
      const uuid = context.evalSync(`crypto.randomUUID()`) as string;
      assert.match(
        uuid,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    test("returns unique values", async () => {
      const uuids = context.evalSync(`
        const uuids = [];
        for (let i = 0; i < 100; i++) {
          uuids.push(crypto.randomUUID());
        }
        JSON.stringify(uuids);
      `) as string;
      const parsed = JSON.parse(uuids) as string[];
      const unique = new Set(parsed);
      assert.strictEqual(unique.size, 100, "All 100 UUIDs should be unique");
    });
  });

  describe("crypto.getRandomValues", () => {
    test("fills Uint8Array with random values", async () => {
      const result = context.evalSync(`
        const arr = new Uint8Array(16);
        const returned = crypto.getRandomValues(arr);
        JSON.stringify({
          sameReference: returned === arr,
          hasNonZero: arr.some(v => v !== 0),
          length: arr.length
        });
      `) as string;
      const data = JSON.parse(result);
      assert.strictEqual(data.sameReference, true, "Should return the same array");
      assert.strictEqual(data.hasNonZero, true, "Should have non-zero values");
      assert.strictEqual(data.length, 16);
    });

    test("fills Uint16Array with random values", async () => {
      const result = context.evalSync(`
        const arr = new Uint16Array(8);
        crypto.getRandomValues(arr);
        JSON.stringify({
          hasNonZero: arr.some(v => v !== 0),
          length: arr.length
        });
      `) as string;
      const data = JSON.parse(result);
      assert.strictEqual(data.hasNonZero, true, "Should have non-zero values");
      assert.strictEqual(data.length, 8);
    });

    test("fills Uint32Array with random values", async () => {
      const result = context.evalSync(`
        const arr = new Uint32Array(4);
        crypto.getRandomValues(arr);
        JSON.stringify({
          hasNonZero: arr.some(v => v !== 0),
          length: arr.length
        });
      `) as string;
      const data = JSON.parse(result);
      assert.strictEqual(data.hasNonZero, true, "Should have non-zero values");
      assert.strictEqual(data.length, 4);
    });

    test("throws for non-typed arrays", async () => {
      assert.throws(
        () => {
          context.evalSync(`crypto.getRandomValues([1, 2, 3])`);
        },
        /TypeError.*integer typed array/i
      );
    });

    test("throws for arrays larger than 65536 bytes", async () => {
      assert.throws(
        () => {
          context.evalSync(`crypto.getRandomValues(new Uint8Array(65537))`);
        },
        /QuotaExceededError/
      );
    });
  });
});
