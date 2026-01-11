import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("URLSearchParams", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("creates empty params with no arguments", async () => {
      // TODO: Implement test
    });

    test("parses query string", async () => {
      // TODO: Implement test
    });

    test("parses query string with leading ?", async () => {
      // TODO: Implement test
    });

    test("creates from array of pairs", async () => {
      // TODO: Implement test
    });

    test("creates from object", async () => {
      // TODO: Implement test
    });
  });

  describe("append()", () => {
    test("adds new entry", async () => {
      // TODO: Implement test
    });

    test("allows duplicate keys", async () => {
      // TODO: Implement test
    });
  });

  describe("delete()", () => {
    test("removes all entries with name", async () => {
      // TODO: Implement test
    });

    test("removes entries with specific value", async () => {
      // TODO: Implement test
    });
  });

  describe("get()", () => {
    test("returns first value for key", async () => {
      // TODO: Implement test
    });

    test("returns null for missing key", async () => {
      // TODO: Implement test
    });
  });

  describe("getAll()", () => {
    test("returns all values for key", async () => {
      // TODO: Implement test
    });

    test("returns empty array for missing key", async () => {
      // TODO: Implement test
    });
  });

  describe("has()", () => {
    test("returns true for existing key", async () => {
      // TODO: Implement test
    });

    test("returns false for missing key", async () => {
      // TODO: Implement test
    });

    test("checks for specific value", async () => {
      // TODO: Implement test
    });
  });

  describe("set()", () => {
    test("replaces all values for key", async () => {
      // TODO: Implement test
    });

    test("adds new key if not exists", async () => {
      // TODO: Implement test
    });
  });

  describe("sort()", () => {
    test("sorts entries by key", async () => {
      // TODO: Implement test
    });
  });

  describe("size property", () => {
    test("returns number of entries", async () => {
      // TODO: Implement test
    });
  });

  describe("iteration methods", () => {
    test("entries() returns array of pairs", async () => {
      // TODO: Implement test
    });

    test("keys() returns array of keys", async () => {
      // TODO: Implement test
    });

    test("values() returns array of values", async () => {
      // TODO: Implement test
    });

    test("forEach() iterates over entries", async () => {
      // TODO: Implement test
    });

    test("Symbol.iterator works with for...of", async () => {
      // TODO: Implement test
    });

    test("Array.from works with URLSearchParams", async () => {
      // TODO: Implement test
    });
  });

  describe("URL encoding", () => {
    test("encodes special characters", async () => {
      // TODO: Implement test
    });

    test("decodes special characters in constructor", async () => {
      // TODO: Implement test
    });
  });
});

describe("URL", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("parses basic URL", async () => {
      // TODO: Implement test
    });

    test("parses URL with all components", async () => {
      // TODO: Implement test
    });

    test("parses URL with base URL", async () => {
      // TODO: Implement test
    });

    test("throws on invalid URL", async () => {
      // TODO: Implement test
    });

    test("throws when no arguments provided", async () => {
      // TODO: Implement test
    });
  });

  describe("properties", () => {
    test("origin is read-only", async () => {
      // TODO: Implement test
    });

    test("host includes port", async () => {
      // TODO: Implement test
    });

    test("href returns full URL", async () => {
      // TODO: Implement test
    });
  });

  describe("searchParams", () => {
    test("returns URLSearchParams instance", async () => {
      // TODO: Implement test
    });

    test("searchParams contains query parameters", async () => {
      // TODO: Implement test
    });

    test("searchParams is cached", async () => {
      // TODO: Implement test
    });
  });

  describe("methods", () => {
    test("toString() returns href", async () => {
      // TODO: Implement test
    });

    test("toJSON() returns href", async () => {
      // TODO: Implement test
    });

    test("JSON.stringify uses toJSON", async () => {
      // TODO: Implement test
    });
  });

  describe("static methods", () => {
    test("URL.canParse() returns true for valid URL", async () => {
      // TODO: Implement test
    });

    test("URL.canParse() returns false for invalid URL", async () => {
      // TODO: Implement test
    });

    test("URL.canParse() with base URL", async () => {
      // TODO: Implement test
    });
  });
});
