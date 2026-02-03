import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getHeadersFromOrigin,
  type ConsistencyTestContext,
  type HeadersOrigin,
  HEADERS_ORIGINS,
} from "./origins.ts";

describe("Headers Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // Method Existence
  // ============================================================================

  describe("Method Existence", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`append() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.append === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`delete() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.delete === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`get() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.get === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`getSetCookie() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.getSetCookie === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`has() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.has === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`set() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.set === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`forEach() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.forEach === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`entries() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.entries === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`keys() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.keys === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`values() exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders.values === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`[Symbol.iterator] exists when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(typeof __testHeaders[Symbol.iterator] === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // get() Behavior
  // ============================================================================

  describe("get() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`get() returns header value when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "Content-Type": "application/json" });
        await ctx.eval(`
          setResult(__testHeaders.get("Content-Type"));
        `);
        assert.strictEqual(ctx.getResult(), "application/json");
      });

      test(`get() is case-insensitive when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "Content-Type": "application/json" });
        await ctx.eval(`
          setResult({
            lower: __testHeaders.get("content-type"),
            upper: __testHeaders.get("CONTENT-TYPE"),
            mixed: __testHeaders.get("Content-Type"),
          });
        `);
        const result = ctx.getResult() as { lower: string; upper: string; mixed: string };
        assert.strictEqual(result.lower, "application/json");
        assert.strictEqual(result.upper, "application/json");
        assert.strictEqual(result.mixed, "application/json");
      });

      test(`get() returns null for missing header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(__testHeaders.get("X-Missing"));
        `);
        assert.strictEqual(ctx.getResult(), null);
      });
    }
  });

  // ============================================================================
  // has() Behavior
  // ============================================================================

  describe("has() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`has() returns true for existing header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Custom": "value" });
        await ctx.eval(`
          setResult(__testHeaders.has("X-Custom"));
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`has() returns false for missing header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(__testHeaders.has("X-Missing"));
        `);
        assert.strictEqual(ctx.getResult(), false);
      });

      test(`has() is case-insensitive when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Custom": "value" });
        await ctx.eval(`
          setResult({
            lower: __testHeaders.has("x-custom"),
            upper: __testHeaders.has("X-CUSTOM"),
            mixed: __testHeaders.has("X-Custom"),
          });
        `);
        const result = ctx.getResult() as { lower: boolean; upper: boolean; mixed: boolean };
        assert.strictEqual(result.lower, true);
        assert.strictEqual(result.upper, true);
        assert.strictEqual(result.mixed, true);
      });
    }
  });

  // ============================================================================
  // set() Behavior
  // ============================================================================

  describe("set() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`set() adds new header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          __testHeaders.set("X-New", "value");
          setResult(__testHeaders.get("X-New"));
        `);
        assert.strictEqual(ctx.getResult(), "value");
      });

      test(`set() overwrites existing header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Custom": "original" });
        await ctx.eval(`
          __testHeaders.set("X-Custom", "new-value");
          setResult(__testHeaders.get("X-Custom"));
        `);
        assert.strictEqual(ctx.getResult(), "new-value");
      });
    }
  });

  // ============================================================================
  // append() Behavior
  // ============================================================================

  describe("append() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`append() adds new header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          __testHeaders.append("X-New", "value");
          setResult(__testHeaders.get("X-New"));
        `);
        assert.strictEqual(ctx.getResult(), "value");
      });

      test(`append() combines with existing header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Multi": "first" });
        await ctx.eval(`
          __testHeaders.append("X-Multi", "second");
          setResult(__testHeaders.get("X-Multi"));
        `);
        assert.strictEqual(ctx.getResult(), "first, second");
      });

      test(`append() multiple times combines all values when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          __testHeaders.append("X-Multi", "a");
          __testHeaders.append("X-Multi", "b");
          __testHeaders.append("X-Multi", "c");
          setResult(__testHeaders.get("X-Multi"));
        `);
        assert.strictEqual(ctx.getResult(), "a, b, c");
      });
    }
  });

  // ============================================================================
  // delete() Behavior
  // ============================================================================

  describe("delete() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`delete() removes header when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Delete": "value" });
        await ctx.eval(`
          __testHeaders.delete("X-Delete");
          setResult({
            has: __testHeaders.has("X-Delete"),
            get: __testHeaders.get("X-Delete"),
          });
        `);
        const result = ctx.getResult() as { has: boolean; get: null };
        assert.strictEqual(result.has, false);
        assert.strictEqual(result.get, null);
      });

      test(`delete() is case-insensitive when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-Delete": "value" });
        await ctx.eval(`
          __testHeaders.delete("x-delete");
          setResult(__testHeaders.has("X-Delete"));
        `);
        assert.strictEqual(ctx.getResult(), false);
      });
    }
  });

  // ============================================================================
  // Iterator Methods
  // ============================================================================

  describe("Iterator Methods", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`entries() iterates over all headers when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-One": "1", "X-Two": "2" });
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testHeaders.entries()) {
            entries.push([key, value]);
          }
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        const result = ctx.getResult() as [string, string][];
        // Per WHATWG spec, iterator keys are lowercase and sorted
        assert.deepStrictEqual(result, [
          ["x-one", "1"],
          ["x-two", "2"],
        ]);
      });

      test(`keys() iterates over all keys when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-One": "1", "X-Two": "2" });
        await ctx.eval(`
          const keys = [];
          for (const key of __testHeaders.keys()) {
            keys.push(key);
          }
          setResult(keys.sort());
        `);
        const result = ctx.getResult() as string[];
        // Per WHATWG spec, iterator keys are lowercase and sorted
        assert.deepStrictEqual(result, ["x-one", "x-two"]);
      });

      test(`values() iterates over all values when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-One": "1", "X-Two": "2" });
        await ctx.eval(`
          const values = [];
          for (const value of __testHeaders.values()) {
            values.push(value);
          }
          setResult(values.sort());
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["1", "2"]);
      });

      test(`[Symbol.iterator] works with for...of when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-One": "1", "X-Two": "2" });
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testHeaders) {
            entries.push([key, value]);
          }
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        const result = ctx.getResult() as [string, string][];
        // Per WHATWG spec, iterator keys are lowercase and sorted
        assert.deepStrictEqual(result, [
          ["x-one", "1"],
          ["x-two", "2"],
        ]);
      });

      test(`forEach() iterates over all headers when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "X-One": "1", "X-Two": "2" });
        await ctx.eval(`
          const entries = [];
          __testHeaders.forEach((value, key) => {
            entries.push([key, value]);
          });
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        const result = ctx.getResult() as [string, string][];
        // Per WHATWG spec, iterator keys are lowercase and sorted
        assert.deepStrictEqual(result, [
          ["x-one", "1"],
          ["x-two", "2"],
        ]);
      });
    }
  });

  // ============================================================================
  // getSetCookie() Behavior
  // ============================================================================

  describe("getSetCookie() Behavior", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`getSetCookie() returns empty array when no cookies when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(__testHeaders.getSetCookie());
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, []);
      });

      test(`getSetCookie() returns array of cookies when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, { "Set-Cookie": "a=1" });
        await ctx.eval(`
          __testHeaders.append("Set-Cookie", "b=2");
          setResult(__testHeaders.getSetCookie());
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["a=1", "b=2"]);
      });
    }
  });

  // ============================================================================
  // instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of HEADERS_ORIGINS) {
      test(`headers instanceof Headers when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(__testHeaders instanceof Headers);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`headers.constructor.name is Headers when from ${origin}`, async () => {
        await getHeadersFromOrigin(ctx, origin, {});
        await ctx.eval(`
          setResult(__testHeaders.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "Headers");
      });
    }
  });

  // ============================================================================
  // Constructor Variations
  // ============================================================================

  describe("Constructor Variations", () => {
    test("new Headers() creates empty headers", async () => {
      await ctx.eval(`
        const headers = new Headers();
        setResult({
          hasContentType: headers.has("Content-Type"),
          size: [...headers].length,
        });
      `);
      const result = ctx.getResult() as { hasContentType: boolean; size: number };
      assert.strictEqual(result.hasContentType, false);
      assert.strictEqual(result.size, 0);
    });

    test("new Headers(undefined) creates empty headers", async () => {
      await ctx.eval(`
        const headers = new Headers(undefined);
        setResult({
          size: [...headers].length,
        });
      `);
      const result = ctx.getResult() as { size: number };
      assert.strictEqual(result.size, 0);
    });

    test("new Headers(object) creates from object", async () => {
      await ctx.eval(`
        const headers = new Headers({ "Content-Type": "application/json", "X-Custom": "value" });
        setResult({
          contentType: headers.get("Content-Type"),
          custom: headers.get("X-Custom"),
        });
      `);
      const result = ctx.getResult() as { contentType: string; custom: string };
      assert.strictEqual(result.contentType, "application/json");
      assert.strictEqual(result.custom, "value");
    });

    test("new Headers(array) creates from entries array", async () => {
      await ctx.eval(`
        const headers = new Headers([
          ["Content-Type", "application/json"],
          ["X-Custom", "value"]
        ]);
        setResult({
          contentType: headers.get("Content-Type"),
          custom: headers.get("X-Custom"),
        });
      `);
      const result = ctx.getResult() as { contentType: string; custom: string };
      assert.strictEqual(result.contentType, "application/json");
      assert.strictEqual(result.custom, "value");
    });

    test("new Headers(Headers) copies from Headers instance", async () => {
      await ctx.eval(`
        const original = new Headers({ "Content-Type": "text/html" });
        const copy = new Headers(original);
        setResult({
          contentType: copy.get("Content-Type"),
          isIndependent: (original.set("Content-Type", "changed"), copy.get("Content-Type") === "text/html"),
        });
      `);
      const result = ctx.getResult() as { contentType: string; isIndependent: boolean };
      assert.strictEqual(result.contentType, "text/html");
      assert.strictEqual(result.isIndependent, true);
    });
  });
});
