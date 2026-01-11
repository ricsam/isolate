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
      const result = await context.eval(`
        const params = new URLSearchParams();
        params.toString()
      `);
      assert.strictEqual(result, "");
    });

    test("parses query string", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("foo=bar&baz=qux");
        params.get("foo")
      `);
      assert.strictEqual(result, "bar");
    });

    test("parses query string with leading ?", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("?foo=bar");
        params.get("foo")
      `);
      assert.strictEqual(result, "bar");
    });

    test("creates from array of pairs", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams([["a", "1"], ["b", "2"]]);
        JSON.stringify({ a: params.get("a"), b: params.get("b") })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.a, "1");
      assert.strictEqual(parsed.b, "2");
    });

    test("creates from object", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams({ foo: "bar", baz: "qux" });
        JSON.stringify({ foo: params.get("foo"), baz: params.get("baz") })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.foo, "bar");
      assert.strictEqual(parsed.baz, "qux");
    });
  });

  describe("append()", () => {
    test("adds new entry", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams();
        params.append("key", "value");
        params.get("key")
      `);
      assert.strictEqual(result, "value");
    });

    test("allows duplicate keys", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams();
        params.append("key", "value1");
        params.append("key", "value2");
        JSON.stringify(params.getAll("key"))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["value1", "value2"]);
    });
  });

  describe("delete()", () => {
    test("removes all entries with name", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2&b=3");
        params.delete("a");
        params.toString()
      `);
      assert.strictEqual(result, "b=3");
    });

    test("removes entries with specific value", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2&a=3");
        params.delete("a", "2");
        JSON.stringify(params.getAll("a"))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["1", "3"]);
    });
  });

  describe("get()", () => {
    test("returns first value for key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2");
        params.get("a")
      `);
      assert.strictEqual(result, "1");
    });

    test("returns null for missing key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1");
        params.get("b")
      `);
      assert.strictEqual(result, null);
    });
  });

  describe("getAll()", () => {
    test("returns all values for key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2&a=3");
        JSON.stringify(params.getAll("a"))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["1", "2", "3"]);
    });

    test("returns empty array for missing key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1");
        JSON.stringify(params.getAll("b"))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), []);
    });
  });

  describe("has()", () => {
    test("returns true for existing key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1");
        params.has("a")
      `);
      assert.strictEqual(result, true);
    });

    test("returns false for missing key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1");
        params.has("b")
      `);
      assert.strictEqual(result, false);
    });

    test("checks for specific value", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2");
        JSON.stringify({ has1: params.has("a", "1"), has3: params.has("a", "3") })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.has1, true);
      assert.strictEqual(parsed.has3, false);
    });
  });

  describe("set()", () => {
    test("replaces all values for key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&a=2");
        params.set("a", "3");
        JSON.stringify(params.getAll("a"))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["3"]);
    });

    test("adds new key if not exists", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams();
        params.set("a", "1");
        params.get("a")
      `);
      assert.strictEqual(result, "1");
    });
  });

  describe("sort()", () => {
    test("sorts entries by key", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("c=3&a=1&b=2");
        params.sort();
        params.toString()
      `);
      assert.strictEqual(result, "a=1&b=2&c=3");
    });
  });

  describe("size property", () => {
    test("returns number of entries", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2&c=3");
        params.size
      `);
      assert.strictEqual(result, 3);
    });
  });

  describe("iteration methods", () => {
    test("entries() returns array of pairs", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        JSON.stringify(Array.from(params.entries()))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), [["a", "1"], ["b", "2"]]);
    });

    test("keys() returns array of keys", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        JSON.stringify(Array.from(params.keys()))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["a", "b"]);
    });

    test("values() returns array of values", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        JSON.stringify(Array.from(params.values()))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), ["1", "2"]);
    });

    test("forEach() iterates over entries", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        const entries = [];
        params.forEach((value, key) => entries.push([key, value]));
        JSON.stringify(entries)
      `);
      assert.deepStrictEqual(JSON.parse(result as string), [["a", "1"], ["b", "2"]]);
    });

    test("Symbol.iterator works with for...of", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        const entries = [];
        for (const [key, value] of params) {
          entries.push([key, value]);
        }
        JSON.stringify(entries)
      `);
      assert.deepStrictEqual(JSON.parse(result as string), [["a", "1"], ["b", "2"]]);
    });

    test("Array.from works with URLSearchParams", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("a=1&b=2");
        JSON.stringify(Array.from(params))
      `);
      assert.deepStrictEqual(JSON.parse(result as string), [["a", "1"], ["b", "2"]]);
    });
  });

  describe("URL encoding", () => {
    test("encodes special characters", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams();
        params.append("key", "hello world");
        params.toString()
      `);
      assert.strictEqual(result, "key=hello%20world");
    });

    test("decodes special characters in constructor", async () => {
      const result = await context.eval(`
        const params = new URLSearchParams("key=hello%20world");
        params.get("key")
      `);
      assert.strictEqual(result, "hello world");
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
      const result = await context.eval(`
        const url = new URL("https://example.com/path");
        JSON.stringify({
          protocol: url.protocol,
          hostname: url.hostname,
          pathname: url.pathname
        })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.protocol, "https:");
      assert.strictEqual(parsed.hostname, "example.com");
      assert.strictEqual(parsed.pathname, "/path");
    });

    test("parses URL with all components", async () => {
      const result = await context.eval(`
        const url = new URL("https://user:pass@example.com:8080/path?query=1#hash");
        JSON.stringify({
          protocol: url.protocol,
          username: url.username,
          password: url.password,
          hostname: url.hostname,
          port: url.port,
          pathname: url.pathname,
          search: url.search,
          hash: url.hash
        })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.protocol, "https:");
      assert.strictEqual(parsed.username, "user");
      assert.strictEqual(parsed.password, "pass");
      assert.strictEqual(parsed.hostname, "example.com");
      assert.strictEqual(parsed.port, "8080");
      assert.strictEqual(parsed.pathname, "/path");
      assert.strictEqual(parsed.search, "?query=1");
      assert.strictEqual(parsed.hash, "#hash");
    });

    test("parses URL with base URL", async () => {
      const result = await context.eval(`
        const url = new URL("/path", "https://example.com");
        url.href
      `);
      assert.strictEqual(result, "https://example.com/path");
    });

    test("throws on invalid URL", async () => {
      const result = await context.eval(`
        try {
          new URL("not a url");
          "no error";
        } catch (e) {
          e instanceof TypeError ? "TypeError" : "other";
        }
      `);
      assert.strictEqual(result, "TypeError");
    });

    test("throws when no arguments provided", async () => {
      const result = await context.eval(`
        try {
          new URL();
          "no error";
        } catch (e) {
          e instanceof TypeError ? "TypeError" : "other";
        }
      `);
      assert.strictEqual(result, "TypeError");
    });
  });

  describe("properties", () => {
    test("origin is read-only", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com:8080/path");
        url.origin
      `);
      assert.strictEqual(result, "https://example.com:8080");
    });

    test("host includes port", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com:8080");
        url.host
      `);
      assert.strictEqual(result, "example.com:8080");
    });

    test("href returns full URL", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com/path?query=1#hash");
        url.href
      `);
      assert.strictEqual(result, "https://example.com/path?query=1#hash");
    });
  });

  describe("searchParams", () => {
    test("returns URLSearchParams instance", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com?foo=bar");
        url.searchParams instanceof URLSearchParams
      `);
      assert.strictEqual(result, true);
    });

    test("searchParams contains query parameters", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com?foo=bar&baz=qux");
        JSON.stringify({ foo: url.searchParams.get("foo"), baz: url.searchParams.get("baz") })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.foo, "bar");
      assert.strictEqual(parsed.baz, "qux");
    });

    test("searchParams is cached", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com?foo=bar");
        url.searchParams === url.searchParams
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("methods", () => {
    test("toString() returns href", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com/path");
        url.toString()
      `);
      assert.strictEqual(result, "https://example.com/path");
    });

    test("toJSON() returns href", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com/path");
        url.toJSON()
      `);
      assert.strictEqual(result, "https://example.com/path");
    });

    test("JSON.stringify uses toJSON", async () => {
      const result = await context.eval(`
        const url = new URL("https://example.com/path");
        JSON.stringify(url)
      `);
      assert.strictEqual(result, '"https://example.com/path"');
    });
  });

  describe("static methods", () => {
    test("URL.canParse() returns true for valid URL", async () => {
      const result = await context.eval(`
        URL.canParse("https://example.com")
      `);
      assert.strictEqual(result, true);
    });

    test("URL.canParse() returns false for invalid URL", async () => {
      const result = await context.eval(`
        URL.canParse("not a url")
      `);
      assert.strictEqual(result, false);
    });

    test("URL.canParse() with base URL", async () => {
      const result = await context.eval(`
        URL.canParse("/path", "https://example.com")
      `);
      assert.strictEqual(result, true);
    });
  });

  describe("spec examples", () => {
    test("parse request URL for pathname", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   // Simulate request.url
      //   const requestUrl = "https://example.com/api/hello?name=world";
      //   const url = new URL(requestUrl);
      //   url.pathname
      // `);
      // assert.strictEqual(result, "/api/hello");
    });

    test("get query parameter from request URL", async () => {
      // TODO: Implement test
      // const result = await context.eval(`
      //   const requestUrl = "https://example.com/api/search?q=test&limit=10";
      //   const url = new URL(requestUrl);
      //   url.searchParams.get("q") + "," + url.searchParams.get("limit")
      // `);
      // assert.strictEqual(result, "test,10");
    });
  });
});

/**
 * Native URL → isolate tests
 *
 * These tests verify that native URL objects passed into isolate
 * behave identically to URL instances created with `new URL()` in isolate.
 */
describe("Native URL → isolate", () => {
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

  test("native URL should pass instanceof check in isolate", async () => {
    // TODO: Implement test
    // const runtime = runTestCode(
    //   context,
    //   `
    //   const url = testingInput.url;
    //   log("instanceof", url instanceof URL);
    //   log("constructorName", url.constructor.name);
    // `
    // ).input({
    //   url: new URL("https://example.com/path"),
    // });
    //
    // assert.deepStrictEqual(runtime.logs, {
    //   instanceof: true,
    //   constructorName: "URL",
    // });
  });

  test("href property is preserved", async () => {
    // TODO: Implement test
  });

  test("all URL properties are preserved", async () => {
    // TODO: Implement test
  });

  test("searchParams is accessible", async () => {
    // TODO: Implement test
  });

  test("toString() returns href", async () => {
    // TODO: Implement test
  });

  test("URL with username and password", async () => {
    // TODO: Implement test
  });

  describe("Bidirectional Conversion (Native→isolate→Native)", () => {
    test("URL created in isolate should return as native URL", async () => {
      // TODO: Implement test
      // const runtime = runTestCode(
      //   context,
      //   `
      //   const url = new URL("https://example.com/path?query=value#hash");
      //   log("url", url);
      // `
      // ).input({});
      //
      // assert.ok(runtime.logs.url instanceof URL);
      // assert.strictEqual((runtime.logs.url as URL).href, "https://example.com/path?query=value#hash");
    });

    test("native URL passed through isolate returns as native URL", async () => {
      // TODO: Implement test
    });

    test("URL properties are preserved after round-trip", async () => {
      // TODO: Implement test
    });

    test("modified URL preserves changes after round-trip", async () => {
      // TODO: Implement test
    });

    test("nested object with URL converts properly", async () => {
      // TODO: Implement test
    });

    test("array of URLs converts properly", async () => {
      // TODO: Implement test
    });
  });
});
