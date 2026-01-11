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
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("crypto.randomUUID", () => {
    test("returns a valid UUID", async () => {
      // TODO: Implement test
      // await setupCrypto(context);
      // const uuid = await context.eval(`crypto.randomUUID()`);
      // assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test("returns unique values", async () => {
      // TODO: Implement test
    });
  });

  describe("crypto.getRandomValues", () => {
    test("fills Uint8Array with random values", async () => {
      // TODO: Implement test
    });

    test("fills Uint16Array with random values", async () => {
      // TODO: Implement test
    });

    test("fills Uint32Array with random values", async () => {
      // TODO: Implement test
    });

    test("throws for non-typed arrays", async () => {
      // TODO: Implement test
    });

    test("throws for arrays larger than 65536 bytes", async () => {
      // TODO: Implement test
    });
  });
});
