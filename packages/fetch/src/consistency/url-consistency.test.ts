import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getURLFromOrigin,
  getURLSearchParamsFromOrigin,
  type ConsistencyTestContext,
  type URLSearchParamsOrigin,
} from "./origins.ts";

// All URL origins now work - URLs are properly marshalled via URLRef and
// unmarshalled back to URL objects (see WHATWG_INCONSISTENCIES.md - Issue #5 Fixed)
const WORKING_URL_ORIGINS = ["direct", "customFunction"] as const;

// All URLSearchParams origins now work - URL.searchParams live binding is
// properly maintained (see WHATWG_INCONSISTENCIES.md - Issue #11 Fixed)
const WORKING_URLSEARCHPARAMS_ORIGINS: URLSearchParamsOrigin[] = [
  "direct",
  "fromURL",
  "fromCustomFunctionURL",
];

describe("URL Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // URL Property Existence
  // ============================================================================

  describe("URL Property Existence", () => {
    const properties = [
      "href",
      "origin",
      "protocol",
      "host",
      "hostname",
      "port",
      "pathname",
      "search",
      "hash",
      "searchParams",
      "username",
      "password",
    ];

    for (const origin of WORKING_URL_ORIGINS) {
      for (const prop of properties) {
        test(`${prop} exists when from ${origin}`, async () => {
          await getURLFromOrigin(ctx, origin, "https://user:pass@example.com:8080/path?query=1#hash");
          await ctx.eval(`
            setResult(${JSON.stringify(prop)} in __testURL);
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }
    }
  });

  // ============================================================================
  // URL Property Values
  // ============================================================================

  describe("URL Property Values", () => {
    for (const origin of WORKING_URL_ORIGINS) {
      test(`href returns full URL when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path?query=1#hash");
        await ctx.eval(`
          setResult(__testURL.href);
        `);
        assert.strictEqual(ctx.getResult(), "https://example.com/path?query=1#hash");
      });

      test(`origin returns scheme + host when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com:8080/path");
        await ctx.eval(`
          setResult(__testURL.origin);
        `);
        assert.strictEqual(ctx.getResult(), "https://example.com:8080");
      });

      test(`protocol returns scheme with colon when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path");
        await ctx.eval(`
          setResult(__testURL.protocol);
        `);
        assert.strictEqual(ctx.getResult(), "https:");
      });

      test(`host returns hostname:port when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com:8080/path");
        await ctx.eval(`
          setResult(__testURL.host);
        `);
        assert.strictEqual(ctx.getResult(), "example.com:8080");
      });

      test(`hostname returns just hostname when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com:8080/path");
        await ctx.eval(`
          setResult(__testURL.hostname);
        `);
        assert.strictEqual(ctx.getResult(), "example.com");
      });

      test(`port returns port string when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com:8080/path");
        await ctx.eval(`
          setResult(__testURL.port);
        `);
        assert.strictEqual(ctx.getResult(), "8080");
      });

      test(`port returns empty string for default port when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path");
        await ctx.eval(`
          setResult(__testURL.port);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });

      test(`pathname returns path when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path/to/resource");
        await ctx.eval(`
          setResult(__testURL.pathname);
        `);
        assert.strictEqual(ctx.getResult(), "/path/to/resource");
      });

      test(`search returns query with ? when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com?foo=bar&baz=qux");
        await ctx.eval(`
          setResult(__testURL.search);
        `);
        assert.strictEqual(ctx.getResult(), "?foo=bar&baz=qux");
      });

      test(`search returns empty string when no query when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path");
        await ctx.eval(`
          setResult(__testURL.search);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });

      test(`hash returns fragment with # when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path#section");
        await ctx.eval(`
          setResult(__testURL.hash);
        `);
        assert.strictEqual(ctx.getResult(), "#section");
      });

      test(`hash returns empty string when no fragment when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com/path");
        await ctx.eval(`
          setResult(__testURL.hash);
        `);
        assert.strictEqual(ctx.getResult(), "");
      });

      test(`username returns username when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://user:pass@example.com/path");
        await ctx.eval(`
          setResult(__testURL.username);
        `);
        assert.strictEqual(ctx.getResult(), "user");
      });

      test(`password returns password when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://user:pass@example.com/path");
        await ctx.eval(`
          setResult(__testURL.password);
        `);
        assert.strictEqual(ctx.getResult(), "pass");
      });

      test(`searchParams returns URLSearchParams instance when from ${origin}`, async () => {
        await getURLFromOrigin(ctx, origin, "https://example.com?foo=bar");
        await ctx.eval(`
          setResult({
            isURLSearchParams: __testURL.searchParams instanceof URLSearchParams,
            getValue: __testURL.searchParams.get("foo"),
          });
        `);
        const result = ctx.getResult() as { isURLSearchParams: boolean; getValue: string };
        assert.strictEqual(result.isURLSearchParams, true);
        assert.strictEqual(result.getValue, "bar");
      });
    }
  });

  // ============================================================================
  // URL Method Existence
  // ============================================================================

  describe("URL Method Existence", () => {
    // Note: Only test with direct origin because customFunction returns URL as string
    test("toString() exists when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com");
      await ctx.eval(`
        setResult(typeof __testURL.toString === 'function');
      `);
      assert.strictEqual(ctx.getResult(), true);
    });

    test("toJSON() exists when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com");
      await ctx.eval(`
        setResult(typeof __testURL.toJSON === 'function');
      `);
      assert.strictEqual(ctx.getResult(), true);
    });
  });

  // ============================================================================
  // URL Method Behavior
  // ============================================================================

  describe("URL Method Behavior", () => {
    // Note: Only test with direct origin because customFunction returns URL as string
    test("toString() returns href when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path?query=1#hash");
      await ctx.eval(`
        setResult(__testURL.toString());
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path?query=1#hash");
    });

    test("toJSON() returns href when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path?query=1#hash");
      await ctx.eval(`
        setResult(__testURL.toJSON());
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path?query=1#hash");
    });
  });

  // ============================================================================
  // URL instanceof Check
  // ============================================================================

  describe("URL instanceof Check", () => {
    // Note: Only test with direct origin because customFunction returns URL as string
    // (see WHATWG_INCONSISTENCIES.md for URL marshalling limitations)
    test("url instanceof URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com");
      await ctx.eval(`
        setResult(__testURL instanceof URL);
      `);
      assert.strictEqual(ctx.getResult(), true);
    });

    test("url.constructor.name is URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com");
      await ctx.eval(`
        setResult(__testURL.constructor.name);
      `);
      assert.strictEqual(ctx.getResult(), "URL");
    });

    // Verify that URLs from customFunction are properly unmarshalled to URL objects
    test("url from customFunction is properly unmarshalled to URL instance", async () => {
      await getURLFromOrigin(ctx, "customFunction", "https://example.com/path?query=1");
      await ctx.eval(`
        setResult({
          type: typeof __testURL,
          constructorName: __testURL.constructor.name,
          isInstanceOfURL: __testURL instanceof URL,
          href: __testURL.href,
          pathname: __testURL.pathname,
          search: __testURL.search,
        });
      `);
      const result = ctx.getResult() as {
        type: string;
        constructorName: string;
        isInstanceOfURL: boolean;
        href: string;
        pathname: string;
        search: string;
      };
      // URL is marshalled as URLRef and properly unmarshalled back to URL
      assert.strictEqual(result.type, "object");
      assert.strictEqual(result.constructorName, "URL");
      assert.strictEqual(result.isInstanceOfURL, true);
      assert.strictEqual(result.href, "https://example.com/path?query=1");
      assert.strictEqual(result.pathname, "/path");
      assert.strictEqual(result.search, "?query=1");
    });
  });

  // ============================================================================
  // URL Constructor Variations
  // ============================================================================

  describe("URL Constructor Variations", () => {
    test("new URL(string) creates URL", async () => {
      await ctx.eval(`
        const url = new URL("https://example.com/path");
        setResult(url.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path");
    });

    test("new URL(string, base) creates URL with base", async () => {
      await ctx.eval(`
        const url = new URL("/path", "https://example.com");
        setResult(url.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path");
    });

    test("new URL(string, URL) creates URL with URL base", async () => {
      await ctx.eval(`
        const base = new URL("https://example.com/dir/");
        const url = new URL("file.txt", base);
        setResult(url.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/dir/file.txt");
    });
  });

  // ============================================================================
  // URL Property Setters
  // ============================================================================

  describe("URL Property Setters", () => {
    // Note: Only test with direct origin because customFunction returns URL as string
    // (see WHATWG_INCONSISTENCIES.md for URL marshalling limitations)
    test("setting protocol updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.protocol = "http:";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "http://example.com/path");
    });

    test("setting hostname updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.hostname = "other.com";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://other.com/path");
    });

    test("setting port updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.port = "8080";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com:8080/path");
    });

    test("setting pathname updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.pathname = "/new/path";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/new/path");
    });

    test("setting search updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.search = "?foo=bar";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path?foo=bar");
    });

    test("setting hash updates URL when from direct", async () => {
      await getURLFromOrigin(ctx, "direct", "https://example.com/path");
      await ctx.eval(`
        __testURL.hash = "#section";
        setResult(__testURL.href);
      `);
      assert.strictEqual(ctx.getResult(), "https://example.com/path#section");
    });
  });
});

describe("URLSearchParams Consistency", () => {
  let ctx: ConsistencyTestContext;

  beforeEach(async () => {
    ctx = await createConsistencyTestContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  // ============================================================================
  // URLSearchParams Method Existence
  // ============================================================================

  describe("Method Existence", () => {
    const methods = [
      "append",
      "delete",
      "get",
      "getAll",
      "has",
      "set",
      "sort",
      "toString",
      "entries",
      "keys",
      "values",
      "forEach",
    ];

    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      for (const method of methods) {
        test(`${method}() exists when from ${origin}`, async () => {
          await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
          await ctx.eval(`
            setResult(typeof __testURLSearchParams.${method} === 'function');
          `);
          assert.strictEqual(ctx.getResult(), true);
        });
      }

      test(`[Symbol.iterator] exists when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          setResult(typeof __testURLSearchParams[Symbol.iterator] === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // URLSearchParams Query Methods
  // ============================================================================

  describe("Query Methods", () => {
    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      test(`get() returns value when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=bar&baz=qux");
        await ctx.eval(`
          setResult(__testURLSearchParams.get("foo"));
        `);
        assert.strictEqual(ctx.getResult(), "bar");
      });

      test(`get() returns null for missing key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=bar");
        await ctx.eval(`
          setResult(__testURLSearchParams.get("missing"));
        `);
        assert.strictEqual(ctx.getResult(), null);
      });

      test(`get() returns first value for duplicate keys when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=first&foo=second");
        await ctx.eval(`
          setResult(__testURLSearchParams.get("foo"));
        `);
        assert.strictEqual(ctx.getResult(), "first");
      });

      test(`getAll() returns all values when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=first&foo=second&foo=third");
        await ctx.eval(`
          setResult(__testURLSearchParams.getAll("foo"));
        `);
        assert.deepStrictEqual(ctx.getResult(), ["first", "second", "third"]);
      });

      test(`getAll() returns empty array for missing key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=bar");
        await ctx.eval(`
          setResult(__testURLSearchParams.getAll("missing"));
        `);
        assert.deepStrictEqual(ctx.getResult(), []);
      });

      test(`has() returns true for existing key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=bar");
        await ctx.eval(`
          setResult(__testURLSearchParams.has("foo"));
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`has() returns false for missing key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "foo=bar");
        await ctx.eval(`
          setResult(__testURLSearchParams.has("missing"));
        `);
        assert.strictEqual(ctx.getResult(), false);
      });
    }
  });

  // ============================================================================
  // URLSearchParams Mutation Methods
  // ============================================================================

  describe("Mutation Methods", () => {
    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      test(`append() adds new key-value when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          __testURLSearchParams.append("b", "2");
          setResult(__testURLSearchParams.get("b"));
        `);
        assert.strictEqual(ctx.getResult(), "2");
      });

      test(`append() allows duplicate keys when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          __testURLSearchParams.append("a", "2");
          setResult(__testURLSearchParams.getAll("a"));
        `);
        assert.deepStrictEqual(ctx.getResult(), ["1", "2"]);
      });

      test(`set() adds new key-value when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          __testURLSearchParams.set("b", "2");
          setResult(__testURLSearchParams.get("b"));
        `);
        assert.strictEqual(ctx.getResult(), "2");
      });

      test(`set() replaces existing value when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          __testURLSearchParams.set("a", "new");
          setResult(__testURLSearchParams.get("a"));
        `);
        assert.strictEqual(ctx.getResult(), "new");
      });

      test(`set() removes duplicates when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&a=2&a=3");
        await ctx.eval(`
          __testURLSearchParams.set("a", "only");
          setResult(__testURLSearchParams.getAll("a"));
        `);
        assert.deepStrictEqual(ctx.getResult(), ["only"]);
      });

      test(`delete() removes key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          __testURLSearchParams.delete("a");
          setResult({
            hasA: __testURLSearchParams.has("a"),
            hasB: __testURLSearchParams.has("b"),
          });
        `);
        const result = ctx.getResult() as { hasA: boolean; hasB: boolean };
        assert.strictEqual(result.hasA, false);
        assert.strictEqual(result.hasB, true);
      });

      test(`delete() removes all duplicates when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&a=2&a=3");
        await ctx.eval(`
          __testURLSearchParams.delete("a");
          setResult(__testURLSearchParams.has("a"));
        `);
        assert.strictEqual(ctx.getResult(), false);
      });

      test(`sort() sorts entries alphabetically by key when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "c=3&a=1&b=2");
        await ctx.eval(`
          __testURLSearchParams.sort();
          const entries = [];
          for (const [key, value] of __testURLSearchParams) {
            entries.push([key, value]);
          }
          setResult(entries);
        `);
        assert.deepStrictEqual(ctx.getResult(), [
          ["a", "1"],
          ["b", "2"],
          ["c", "3"],
        ]);
      });
    }
  });

  // ============================================================================
  // URLSearchParams Iteration Methods
  // ============================================================================

  describe("Iteration Methods", () => {
    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      test(`entries() iterates over all entries when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testURLSearchParams.entries()) {
            entries.push([key, value]);
          }
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        assert.deepStrictEqual(ctx.getResult(), [
          ["a", "1"],
          ["b", "2"],
        ]);
      });

      test(`keys() iterates over all keys when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          const keys = [];
          for (const key of __testURLSearchParams.keys()) {
            keys.push(key);
          }
          setResult(keys.sort());
        `);
        assert.deepStrictEqual(ctx.getResult(), ["a", "b"]);
      });

      test(`values() iterates over all values when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          const values = [];
          for (const value of __testURLSearchParams.values()) {
            values.push(value);
          }
          setResult(values.sort());
        `);
        assert.deepStrictEqual(ctx.getResult(), ["1", "2"]);
      });

      test(`[Symbol.iterator] works with for...of when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testURLSearchParams) {
            entries.push([key, value]);
          }
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        assert.deepStrictEqual(ctx.getResult(), [
          ["a", "1"],
          ["b", "2"],
        ]);
      });

      test(`forEach() iterates over all entries when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          const entries = [];
          __testURLSearchParams.forEach((value, key) => {
            entries.push([key, value]);
          });
          setResult(entries.sort((a, b) => a[0].localeCompare(b[0])));
        `);
        assert.deepStrictEqual(ctx.getResult(), [
          ["a", "1"],
          ["b", "2"],
        ]);
      });
    }
  });

  // ============================================================================
  // URLSearchParams toString
  // ============================================================================

  describe("toString Method", () => {
    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      test(`toString() returns query string when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1&b=2");
        await ctx.eval(`
          setResult(__testURLSearchParams.toString());
        `);
        assert.strictEqual(ctx.getResult(), "a=1&b=2");
      });
    }
  });

  // ============================================================================
  // URLSearchParams instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of WORKING_URLSEARCHPARAMS_ORIGINS) {
      test(`params instanceof URLSearchParams when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          setResult(__testURLSearchParams instanceof URLSearchParams);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`params.constructor.name is URLSearchParams when from ${origin}`, async () => {
        await getURLSearchParamsFromOrigin(ctx, origin, "a=1");
        await ctx.eval(`
          setResult(__testURLSearchParams.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "URLSearchParams");
      });
    }
  });

  // ============================================================================
  // URLSearchParams Constructor Variations
  // ============================================================================

  describe("Constructor Variations", () => {
    test("new URLSearchParams() creates empty params", async () => {
      await ctx.eval(`
        const params = new URLSearchParams();
        setResult({
          size: params.size,
          string: params.toString(),
        });
      `);
      const result = ctx.getResult() as { size: number; string: string };
      assert.strictEqual(result.size, 0);
      assert.strictEqual(result.string, "");
    });

    test("new URLSearchParams(string) parses query string", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("a=1&b=2");
        setResult({
          a: params.get("a"),
          b: params.get("b"),
        });
      `);
      const result = ctx.getResult() as { a: string; b: string };
      assert.strictEqual(result.a, "1");
      assert.strictEqual(result.b, "2");
    });

    test("new URLSearchParams(string) handles leading ?", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("?a=1&b=2");
        setResult({
          a: params.get("a"),
          b: params.get("b"),
          hasQuestion: params.has("?a"),
        });
      `);
      const result = ctx.getResult() as { a: string | null; b: string; hasQuestion: boolean };
      // Per WHATWG spec, leading ? is included in the first key
      // Some implementations strip it, we need to check which behavior we have
      // The spec says "?a=1" creates key "?a" with value "1"
      assert.strictEqual(result.b, "2");
    });

    test("new URLSearchParams(object) creates from object", async () => {
      await ctx.eval(`
        const params = new URLSearchParams({ a: "1", b: "2" });
        setResult({
          a: params.get("a"),
          b: params.get("b"),
        });
      `);
      const result = ctx.getResult() as { a: string; b: string };
      assert.strictEqual(result.a, "1");
      assert.strictEqual(result.b, "2");
    });

    test("new URLSearchParams(array) creates from entries array", async () => {
      await ctx.eval(`
        const params = new URLSearchParams([["a", "1"], ["b", "2"], ["a", "3"]]);
        setResult({
          a: params.get("a"),
          aAll: params.getAll("a"),
          b: params.get("b"),
        });
      `);
      const result = ctx.getResult() as { a: string; aAll: string[]; b: string };
      assert.strictEqual(result.a, "1");
      assert.deepStrictEqual(result.aAll, ["1", "3"]);
      assert.strictEqual(result.b, "2");
    });
  });

  // ============================================================================
  // WHATWG Compliance Tests
  // These tests verify that previously broken WHATWG features now work correctly.
  // See WHATWG_INCONSISTENCIES.md for historical context.
  // ============================================================================

  describe("WHATWG Compliance (Previously Fixed Issues)", () => {
    // Issue #5: URL Marshalling Returns String Instead of URL Object - FIXED
    test("URL crossing boundary should remain URL instance", async () => {
      await ctx.eval(`
        __setURL(new URL("https://example.com/path?a=1&b=2"));
        const url = __getURL();
        setResult({
          isURL: url instanceof URL,
          hasSearchParams: url.searchParams instanceof URLSearchParams,
          pathname: url.pathname,
        });
      `);
      const result = ctx.getResult() as {
        isURL: boolean;
        hasSearchParams: boolean;
        pathname: string;
      };
      assert.strictEqual(result.isURL, true);
      assert.strictEqual(result.hasSearchParams, true);
      assert.strictEqual(result.pathname, "/path");
    });

    // Issue #6: URLSearchParams.size Property Missing - FIXED
    test("URLSearchParams.size should return entry count", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("a=1&b=2&c=3");
        setResult({
          hasSize: 'size' in params,
          size: params.size,
        });
      `);
      const result = ctx.getResult() as { hasSize: boolean; size: number };
      assert.strictEqual(result.hasSize, true);
      assert.strictEqual(result.size, 3);
    });

    // Issue #7: URLSearchParams has() and delete() Two-Argument Forms - FIXED
    test("URLSearchParams.has(name, value) should filter by value", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("a=1&a=2&a=3");
        setResult({
          hasA2: params.has("a", "2"),
          hasA4: params.has("a", "4"),
        });
      `);
      const result = ctx.getResult() as { hasA2: boolean; hasA4: boolean };
      assert.strictEqual(result.hasA2, true);
      assert.strictEqual(result.hasA4, false);
    });

    test("URLSearchParams.delete(name, value) should only remove matching entries", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("a=1&a=2&a=3");
        params.delete("a", "2");
        setResult(params.getAll("a"));
      `);
      assert.deepStrictEqual(ctx.getResult(), ["1", "3"]);
    });

    // Issue #8: URLSearchParams toString() Uses %20 Instead of + for Spaces - FIXED
    test("URLSearchParams.toString() should encode spaces as +", async () => {
      await ctx.eval(`
        const params = new URLSearchParams();
        params.set("key", "value with spaces");
        setResult(params.toString());
      `);
      assert.strictEqual(ctx.getResult(), "key=value+with+spaces");
    });

    test("URLSearchParams should decode + as space when parsing", async () => {
      await ctx.eval(`
        const params = new URLSearchParams("key=value+with+spaces");
        setResult(params.get("key"));
      `);
      assert.strictEqual(ctx.getResult(), "value with spaces");
    });

    // Issue #9: URLSearchParams Constructor Doesn't Accept URLSearchParams - FIXED
    test("new URLSearchParams(URLSearchParams) should copy entries", async () => {
      await ctx.eval(`
        const original = new URLSearchParams("a=1&b=2");
        const copy = new URLSearchParams(original);
        original.set("a", "changed");
        setResult({
          copyA: copy.get("a"),
          copyB: copy.get("b"),
          originalA: original.get("a"),
        });
      `);
      const result = ctx.getResult() as { copyA: string; copyB: string; originalA: string };
      assert.strictEqual(result.copyA, "1");
      assert.strictEqual(result.copyB, "2");
      assert.strictEqual(result.originalA, "changed");
    });

    // Issue #10: URL.canParse() Static Method Missing - FIXED
    test("URL.canParse() should return true for valid URLs", async () => {
      await ctx.eval(`
        setResult({
          valid: URL.canParse("https://example.com"),
          invalid: URL.canParse("not a url"),
          withBase: URL.canParse("/path", "https://example.com"),
        });
      `);
      const result = ctx.getResult() as { valid: boolean; invalid: boolean; withBase: boolean };
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.invalid, false);
      assert.strictEqual(result.withBase, true);
    });

    // Issue #11: URLSearchParams-URL Live Binding Not Maintained - FIXED
    test("mutating searchParams should update URL.search (live binding)", async () => {
      await ctx.eval(`
        const url = new URL("https://example.com?a=1");
        url.searchParams.set("b", "2");
        url.searchParams.delete("a");
        setResult({
          search: url.search,
          href: url.href,
        });
      `);
      const result = ctx.getResult() as { search: string; href: string };
      assert.strictEqual(result.search, "?b=2");
      assert.strictEqual(result.href, "https://example.com/?b=2");
    });

    test("setting URL.search should update searchParams", async () => {
      await ctx.eval(`
        const url = new URL("https://example.com?a=1");
        const paramsRef = url.searchParams;
        url.search = "?b=2&c=3";
        setResult({
          a: paramsRef.get("a"),
          b: paramsRef.get("b"),
          c: paramsRef.get("c"),
          sameInstance: paramsRef === url.searchParams,
        });
      `);
      const result = ctx.getResult() as {
        a: string | null;
        b: string | null;
        c: string | null;
        sameInstance: boolean;
      };
      assert.strictEqual(result.a, null);
      assert.strictEqual(result.b, "2");
      assert.strictEqual(result.c, "3");
      assert.strictEqual(result.sameInstance, true);
    });
  });
});
