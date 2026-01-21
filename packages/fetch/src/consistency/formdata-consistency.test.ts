import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createConsistencyTestContext,
  getFormDataFromOrigin,
  type ConsistencyTestContext,
  type FormDataOrigin,
  FORMDATA_ORIGINS,
} from "./origins.ts";

describe("FormData Consistency", () => {
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
    for (const origin of FORMDATA_ORIGINS) {
      test(`append() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.append === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`delete() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.delete === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`get() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.get === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`getAll() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.getAll === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`has() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.has === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`set() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.set === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`entries() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.entries === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`keys() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.keys === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`values() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.values === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`forEach() exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData.forEach === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`[Symbol.iterator] exists when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(typeof __testFormData[Symbol.iterator] === 'function');
        `);
        assert.strictEqual(ctx.getResult(), true);
      });
    }
  });

  // ============================================================================
  // get() Behavior
  // ============================================================================

  describe("get() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`get() returns value when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["name", "John"]]);
        await ctx.eval(`
          setResult(__testFormData.get("name"));
        `);
        assert.strictEqual(ctx.getResult(), "John");
      });

      test(`get() returns null for missing key when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(__testFormData.get("missing"));
        `);
        assert.strictEqual(ctx.getResult(), null);
      });

      test(`get() returns first value for duplicate keys when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["key", "first"]]);
        await ctx.eval(`
          __testFormData.append("key", "second");
          setResult(__testFormData.get("key"));
        `);
        assert.strictEqual(ctx.getResult(), "first");
      });
    }
  });

  // ============================================================================
  // getAll() Behavior
  // ============================================================================

  describe("getAll() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`getAll() returns array of values when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["key", "first"]]);
        await ctx.eval(`
          __testFormData.append("key", "second");
          __testFormData.append("key", "third");
          setResult(__testFormData.getAll("key"));
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["first", "second", "third"]);
      });

      test(`getAll() returns empty array for missing key when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(__testFormData.getAll("missing"));
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, []);
      });
    }
  });

  // ============================================================================
  // has() Behavior
  // ============================================================================

  describe("has() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`has() returns true for existing key when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["name", "John"]]);
        await ctx.eval(`
          setResult(__testFormData.has("name"));
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`has() returns false for missing key when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(__testFormData.has("missing"));
        `);
        assert.strictEqual(ctx.getResult(), false);
      });
    }
  });

  // ============================================================================
  // set() Behavior
  // ============================================================================

  describe("set() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`set() adds new entry when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          __testFormData.set("name", "John");
          setResult(__testFormData.get("name"));
        `);
        assert.strictEqual(ctx.getResult(), "John");
      });

      test(`set() replaces existing entry when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["name", "Original"]]);
        await ctx.eval(`
          __testFormData.set("name", "New");
          setResult(__testFormData.get("name"));
        `);
        assert.strictEqual(ctx.getResult(), "New");
      });

      test(`set() removes all duplicate entries when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["key", "first"]]);
        await ctx.eval(`
          __testFormData.append("key", "second");
          __testFormData.set("key", "only");
          setResult(__testFormData.getAll("key"));
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["only"]);
      });
    }
  });

  // ============================================================================
  // append() Behavior
  // ============================================================================

  describe("append() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`append() adds new entry when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          __testFormData.append("name", "John");
          setResult(__testFormData.get("name"));
        `);
        assert.strictEqual(ctx.getResult(), "John");
      });

      test(`append() adds to existing entries when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["key", "first"]]);
        await ctx.eval(`
          __testFormData.append("key", "second");
          setResult(__testFormData.getAll("key"));
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["first", "second"]);
      });
    }
  });

  // ============================================================================
  // delete() Behavior
  // ============================================================================

  describe("delete() Behavior", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`delete() removes entry when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["name", "John"]]);
        await ctx.eval(`
          __testFormData.delete("name");
          setResult({
            has: __testFormData.has("name"),
            get: __testFormData.get("name"),
          });
        `);
        const result = ctx.getResult() as { has: boolean; get: null };
        assert.strictEqual(result.has, false);
        assert.strictEqual(result.get, null);
      });

      test(`delete() removes all entries with key when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["key", "first"]]);
        await ctx.eval(`
          __testFormData.append("key", "second");
          __testFormData.delete("key");
          setResult(__testFormData.getAll("key"));
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, []);
      });
    }
  });

  // ============================================================================
  // Iterator Methods
  // ============================================================================

  describe("Iterator Methods", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`entries() iterates over all entries when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["a", "1"], ["b", "2"]]);
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testFormData.entries()) {
            entries.push([key, value]);
          }
          setResult(entries);
        `);
        const result = ctx.getResult() as [string, string][];
        assert.deepStrictEqual(result, [
          ["a", "1"],
          ["b", "2"],
        ]);
      });

      test(`keys() iterates over all keys when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["a", "1"], ["b", "2"]]);
        await ctx.eval(`
          const keys = [];
          for (const key of __testFormData.keys()) {
            keys.push(key);
          }
          setResult(keys);
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["a", "b"]);
      });

      test(`values() iterates over all values when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["a", "1"], ["b", "2"]]);
        await ctx.eval(`
          const values = [];
          for (const value of __testFormData.values()) {
            values.push(value);
          }
          setResult(values);
        `);
        const result = ctx.getResult() as string[];
        assert.deepStrictEqual(result, ["1", "2"]);
      });

      test(`[Symbol.iterator] works with for...of when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["a", "1"], ["b", "2"]]);
        await ctx.eval(`
          const entries = [];
          for (const [key, value] of __testFormData) {
            entries.push([key, value]);
          }
          setResult(entries);
        `);
        const result = ctx.getResult() as [string, string][];
        assert.deepStrictEqual(result, [
          ["a", "1"],
          ["b", "2"],
        ]);
      });

      test(`forEach() iterates over all entries when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, [["a", "1"], ["b", "2"]]);
        await ctx.eval(`
          const entries = [];
          __testFormData.forEach((value, key) => {
            entries.push([key, value]);
          });
          setResult(entries);
        `);
        const result = ctx.getResult() as [string, string][];
        assert.deepStrictEqual(result, [
          ["a", "1"],
          ["b", "2"],
        ]);
      });
    }
  });

  // ============================================================================
  // instanceof Check
  // ============================================================================

  describe("instanceof Check", () => {
    for (const origin of FORMDATA_ORIGINS) {
      test(`formData instanceof FormData when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(__testFormData instanceof FormData);
        `);
        assert.strictEqual(ctx.getResult(), true);
      });

      test(`formData.constructor.name is FormData when from ${origin}`, async () => {
        await getFormDataFromOrigin(ctx, origin, []);
        await ctx.eval(`
          setResult(__testFormData.constructor.name);
        `);
        assert.strictEqual(ctx.getResult(), "FormData");
      });
    }
  });

  // ============================================================================
  // File/Blob Values
  // ============================================================================

  describe("File/Blob Values", () => {
    test("append() with File stores File", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const file = new File(["content"], "test.txt", { type: "text/plain" });
        formData.append("file", file);
        const retrieved = formData.get("file");
        setResult({
          isFile: retrieved instanceof File,
          name: retrieved.name,
          size: retrieved.size,
          type: retrieved.type,
        });
      `);
      const result = ctx.getResult() as {
        isFile: boolean;
        name: string;
        size: number;
        type: string;
      };
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.name, "test.txt");
      assert.strictEqual(result.size, 7);
      assert.strictEqual(result.type, "text/plain");
    });

    test("append() with Blob converts to File", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const blob = new Blob(["content"], { type: "text/plain" });
        formData.append("file", blob, "custom.txt");
        const retrieved = formData.get("file");
        setResult({
          isFile: retrieved instanceof File,
          name: retrieved.name,
          hasSize: retrieved.size > 0,
        });
      `);
      const result = ctx.getResult() as { isFile: boolean; name: string; hasSize: boolean };
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.name, "custom.txt");
      assert.strictEqual(result.hasSize, true);
    });

    test("append() with Blob preserves correct content size", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const blob = new Blob(["content"], { type: "text/plain" });
        formData.append("file", blob, "custom.txt");
        const retrieved = formData.get("file");
        const text = await retrieved.text();
        setResult({
          size: retrieved.size,
          text,
        });
      `);
      const result = ctx.getResult() as { size: number; text: string };
      assert.strictEqual(result.size, 7, "File size should match blob content");
      assert.strictEqual(result.text, "content", "File content should match blob");
    });

    test("set() with File stores File", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const file = new File(["content"], "test.txt", { type: "text/plain" });
        formData.set("file", file);
        const retrieved = formData.get("file");
        setResult({
          isFile: retrieved instanceof File,
          name: retrieved.name,
        });
      `);
      const result = ctx.getResult() as { isFile: boolean; name: string };
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.name, "test.txt");
    });

    test("append() with File and filename overrides name", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const file = new File(["content"], "original.txt");
        formData.append("file", file, "override.txt");
        const retrieved = formData.get("file");
        setResult({
          name: retrieved.name,
        });
      `);
      const result = ctx.getResult() as { name: string };
      assert.strictEqual(result.name, "override.txt");
    });
  });

  // ============================================================================
  // Empty FormData
  // ============================================================================

  describe("Empty FormData", () => {
    test("new FormData() creates empty form data", async () => {
      await ctx.eval(`
        const formData = new FormData();
        const entries = [];
        for (const entry of formData) {
          entries.push(entry);
        }
        setResult({
          size: entries.length,
          hasAnything: formData.has("anything"),
        });
      `);
      const result = ctx.getResult() as { size: number; hasAnything: boolean };
      assert.strictEqual(result.size, 0);
      assert.strictEqual(result.hasAnything, false);
    });
  });

  // ============================================================================
  // Duplicate Keys
  // ============================================================================

  describe("Duplicate Keys", () => {
    test("multiple entries with same key are preserved", async () => {
      await ctx.eval(`
        const formData = new FormData();
        formData.append("items", "a");
        formData.append("items", "b");
        formData.append("items", "c");
        setResult({
          get: formData.get("items"),
          getAll: formData.getAll("items"),
          count: formData.getAll("items").length,
        });
      `);
      const result = ctx.getResult() as { get: string; getAll: string[]; count: number };
      assert.strictEqual(result.get, "a");
      assert.deepStrictEqual(result.getAll, ["a", "b", "c"]);
      assert.strictEqual(result.count, 3);
    });

    test("iterator includes duplicate keys multiple times", async () => {
      await ctx.eval(`
        const formData = new FormData();
        formData.append("key", "first");
        formData.append("key", "second");
        const keys = [];
        for (const key of formData.keys()) {
          keys.push(key);
        }
        setResult(keys);
      `);
      const result = ctx.getResult() as string[];
      assert.deepStrictEqual(result, ["key", "key"]);
    });
  });
});
