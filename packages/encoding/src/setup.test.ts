import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupEncoding } from "./index.ts";

describe("@ricsam/isolate-encoding", () => {
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

  describe("btoa", () => {
    test("encodes string to base64", async () => {
      // TODO: Implement test
      // await setupEncoding(context);
      // const result = await context.eval(`btoa("hello")`);
      // assert.strictEqual(result, "aGVsbG8=");
    });

    test("handles empty string", async () => {
      // TODO: Implement test
    });

    test("handles unicode characters", async () => {
      // TODO: Implement test
    });
  });

  describe("atob", () => {
    test("decodes base64 to string", async () => {
      // TODO: Implement test
      // await setupEncoding(context);
      // const result = await context.eval(`atob("aGVsbG8=")`);
      // assert.strictEqual(result, "hello");
    });

    test("handles empty string", async () => {
      // TODO: Implement test
    });

    test("throws on invalid base64", async () => {
      // TODO: Implement test
    });
  });

  describe("roundtrip", () => {
    test("btoa and atob are inverse operations", async () => {
      // TODO: Implement test
    });
  });
});
