import { test, describe } from "node:test";
import assert from "node:assert";
import {
  transformEntryCode,
  transformModuleCode,
  mapErrorStack,
  contentHash,
  type SourceMap,
} from "./index.ts";

describe("@ricsam/isolate-transform", () => {
  describe("transformEntryCode", () => {
    test("strips TypeScript types", async () => {
      const result = await transformEntryCode(
        "const x: number = 42;\nconsole.log(x);",
        "/entry.ts"
      );
      assert.ok(result.code.includes("const x"));
      assert.ok(result.code.includes("= 42;"));
      assert.ok(!result.code.includes(": number"));
    });

    test("wraps body in async function", async () => {
      const result = await transformEntryCode(
        "console.log('hello');",
        "/entry.ts"
      );
      assert.ok(result.code.includes("export default async function()"));
      assert.ok(result.code.includes("console.log('hello')"));
      assert.ok(result.code.endsWith("}"));
    });

    test("preserves imports at top level", async () => {
      const result = await transformEntryCode(
        'import { foo } from "./bar";\nconsole.log(foo);',
        "/entry.ts"
      );
      assert.ok(result.code.startsWith('import { foo } from "./bar";'));
      assert.ok(result.code.includes("export default async function()"));
    });

    test("strips type-only imports", async () => {
      const result = await transformEntryCode(
        'import type { Foo } from "./types";\nimport { bar } from "./bar";\nconsole.log(bar);',
        "/entry.ts"
      );
      assert.ok(!result.code.includes("Foo"));
      assert.ok(result.code.includes('import { bar } from "./bar";'));
    });

    test("strips inline type specifiers", async () => {
      const result = await transformEntryCode(
        'import { type Foo, bar } from "./mod";\nconsole.log(bar);',
        "/entry.ts"
      );
      assert.ok(!result.code.includes("Foo"));
      assert.ok(result.code.includes("bar"));
    });

    test("rejects require()", async () => {
      await assert.rejects(
        () => transformEntryCode('const x = require("fs");', "/entry.ts"),
        /require\(\) is not allowed/
      );
    });

    test("rejects dynamic import()", async () => {
      await assert.rejects(
        () => transformEntryCode('const x = import("./mod");', "/entry.ts"),
        /Dynamic import\(\) is not allowed/
      );
    });

    test("rejects top-level return", async () => {
      await assert.rejects(
        () => transformEntryCode("return 42;", "/entry.ts"),
        /Top-level return is not allowed/
      );
    });

    test("produces source map", async () => {
      const result = await transformEntryCode(
        "const x: number = 42;\nconsole.log(x);",
        "/entry.ts"
      );
      assert.ok(result.sourceMap);
      assert.strictEqual(result.sourceMap!.version, 3);
    });

    test("handles code with top-level await", async () => {
      const result = await transformEntryCode(
        'const x = await Promise.resolve(42);\nconsole.log(x);',
        "/entry.ts"
      );
      assert.ok(result.code.includes("await Promise.resolve(42)"));
      assert.ok(result.code.includes("export default async function()"));
    });
  });

  describe("transformModuleCode", () => {
    test("strips TypeScript types from module code", async () => {
      const result = await transformModuleCode(
        "export const x: number = 42;",
        "/mod.ts"
      );
      assert.ok(result.code.includes("export const x"));
      assert.ok(result.code.includes("= 42;"));
      assert.ok(!result.code.includes(": number"));
    });

    test("preserves imports in module code", async () => {
      const result = await transformModuleCode(
        'import { foo } from "./bar";\nexport const x = foo + 1;',
        "/mod.ts"
      );
      assert.ok(result.code.includes('import { foo } from "./bar";'));
      assert.ok(result.code.includes("export const x = foo + 1;"));
    });

    test("does not wrap module code", async () => {
      const result = await transformModuleCode(
        "export const x = 42;",
        "/mod.ts"
      );
      assert.ok(!result.code.includes("export default async function"));
    });

    test("produces source map for module code", async () => {
      const result = await transformModuleCode(
        "const x: number = 42;",
        "/mod.ts"
      );
      assert.ok(result.sourceMap);
    });
  });

  describe("mapErrorStack", () => {
    test("maps stack traces through source maps", () => {
      // Create a simple source map that shifts line 3 → line 1
      const sourceMap: SourceMap = {
        version: 3,
        sources: ["/entry.ts"],
        mappings: ";;AAAA",  // 2 empty lines, then mapping to line 0, col 0 of source
        names: [],
      };

      const sourceMaps = new Map<string, SourceMap>();
      sourceMaps.set("/entry.ts", sourceMap);

      const stack = "Error: test\n    at Object.<anonymous> (/entry.ts:3:1)";
      const mapped = mapErrorStack(stack, sourceMaps);
      assert.ok(mapped.includes("/entry.ts:1:1"));
    });

    test("preserves unmapped frames", () => {
      const sourceMaps = new Map<string, SourceMap>();
      const stack = "Error: test\n    at Object.<anonymous> (/unknown.ts:3:1)";
      const mapped = mapErrorStack(stack, sourceMaps);
      assert.strictEqual(mapped, stack);
    });
  });

  describe("contentHash", () => {
    test("produces consistent hashes", () => {
      const hash1 = contentHash("hello");
      const hash2 = contentHash("hello");
      assert.strictEqual(hash1, hash2);
    });

    test("produces different hashes for different content", () => {
      const hash1 = contentHash("hello");
      const hash2 = contentHash("world");
      assert.notStrictEqual(hash1, hash2);
    });
  });
});
