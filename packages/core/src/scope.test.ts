import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { withScope, withScopeAsync, marshal } from "./index.ts";

describe("scope", () => {
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

  describe("withScope", () => {
    test("returns the result of the callback", async () => {
      // TODO: Implement test
      // const result = withScope(context, () => 42);
      // assert.strictEqual(result, 42);
    });

    test("manages handles and keeps them alive during scope", async () => {
      // TODO: Implement test
    });

    test("disposes handles after scope exits", async () => {
      // TODO: Implement test
    });

    test("disposes handles in reverse order (LIFO)", async () => {
      // TODO: Implement test
    });

    test("disposes handles even when callback throws", async () => {
      // TODO: Implement test
    });

    test("works with nested scopes", async () => {
      // TODO: Implement test
    });

    test("handles can be used to return values", async () => {
      // TODO: Implement test
    });

    test("works with marshal helper", async () => {
      // TODO: Implement test
    });
  });

  describe("withScopeAsync", () => {
    test("returns the result of the async callback", async () => {
      // TODO: Implement test
    });

    test("manages handles during async operations", async () => {
      // TODO: Implement test
    });

    test("disposes handles after async scope exits", async () => {
      // TODO: Implement test
    });

    test("disposes handles when async callback rejects", async () => {
      // TODO: Implement test
    });

    test("works with real async operations", async () => {
      // TODO: Implement test
    });

    test("nested async scopes work correctly", async () => {
      // TODO: Implement test
    });
  });

  describe("edge cases", () => {
    test("empty scope works", async () => {
      // TODO: Implement test
    });

    test("scope with many handles", async () => {
      // TODO: Implement test
    });

    test("manages already-alive handles correctly", async () => {
      // TODO: Implement test
    });
  });
});
