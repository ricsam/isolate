import { test, describe } from "node:test";
import assert from "node:assert";
import {
  transformEntryCode,
  transformModuleCode,
  transformModuleCodeAsScript,
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

    test("rewrites require() to __require()", async () => {
      const result = await transformEntryCode(
        'const x = require("fs");',
        "/entry.ts"
      );
      assert.ok(result.code.includes('__require("fs", "/entry.ts")'));
      assert.ok(!result.code.includes('require("fs")'));
    });

    test("rewrites dynamic import() to __dynamicImport()", async () => {
      const result = await transformEntryCode(
        'const x = import("./mod");',
        "/entry.ts"
      );
      assert.ok(result.code.includes('__dynamicImport("./mod", "/entry.ts")'));
      assert.ok(!result.code.includes('import("./mod")'));
    });

    test("does not rewrite method calls like obj.import()", async () => {
      const result = await transformEntryCode(
        'const x = obj.import("./mod");',
        "/entry.ts"
      );
      assert.ok(result.code.includes('obj.import("./mod")'));
      assert.ok(!result.code.includes("__dynamicImport"));
    });

    test("does not rewrite method calls like obj.require()", async () => {
      const result = await transformEntryCode(
        'const x = obj.require("fs");',
        "/entry.ts"
      );
      assert.ok(result.code.includes('obj.require("fs")'));
      assert.ok(!result.code.includes("__require"));
    });

    test("does not rewrite import/require inside strings", async () => {
      const result = await transformEntryCode(
        "const x = 'import(\"./mod\")';\nconst y = \"require('fs')\";",
        "/entry.ts"
      );
      assert.ok(!result.code.includes("__dynamicImport"));
      assert.ok(!result.code.includes("__require"));
    });

    test("does not rewrite import/require inside comments", async () => {
      const result = await transformEntryCode(
        '// import("./mod")\n/* require("fs") */\nconsole.log("ok");',
        "/entry.ts"
      );
      assert.ok(!result.code.includes("__dynamicImport"));
      assert.ok(!result.code.includes("__require"));
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

    test("rewrites dynamic import() in module code", async () => {
      const result = await transformModuleCode(
        'export const x = await import("./dep");',
        "/mod.ts"
      );
      assert.ok(result.code.includes('__dynamicImport("./dep", "/mod.ts")'));
      assert.ok(!result.code.includes('import("./dep")'));
    });

    test("rewrites require() in module code", async () => {
      const result = await transformModuleCode(
        'export const x = require("./dep");',
        "/mod.ts"
      );
      assert.ok(result.code.includes('__require("./dep", "/mod.ts")'));
      assert.ok(!result.code.includes('require("./dep")'));
    });

    test("converts CJS exports.NAME to ESM named exports", async () => {
      const result = await transformModuleCode(
        `'use strict';\nfunction foo() { return 1; }\nexports.foo = foo;`,
        "/mod.cjs"
      );
      assert.ok(result.code.includes("var __cjs_module = { exports: {} }"));
      assert.ok(result.code.includes("(function(module, exports) {"));
      assert.ok(result.code.includes("export var foo = __cjs_module.exports.foo;"));
      assert.ok(result.code.includes("export default __cjs_module.exports;"));
    });

    test("converts CJS module.exports object to ESM default export", async () => {
      const result = await transformModuleCode(
        `module.exports = { hello: "world" };`,
        "/mod.cjs"
      );
      assert.ok(result.code.includes("var __cjs_module = { exports: {} }"));
      assert.ok(result.code.includes("export default __cjs_module.exports;"));
    });

    test("converts CJS with multiple exports.NAME assignments", async () => {
      const result = await transformModuleCode(
        `exports.greet = (name) => "Hello, " + name;\nexports.farewell = (name) => "Bye, " + name;`,
        "/mod.cjs"
      );
      assert.ok(result.code.includes("export var greet = __cjs_module.exports.greet;"));
      assert.ok(result.code.includes("export var farewell = __cjs_module.exports.farewell;"));
    });

    test("does NOT treat ESM with export keyword as CJS", async () => {
      const result = await transformModuleCode(
        `export const foo = 1;`,
        "/mod.ts"
      );
      assert.ok(result.code.includes("export const foo = 1;"));
      assert.ok(!result.code.includes("__cjs_module"));
    });

    test("CJS code with exports.NAME pattern like better-auth", async () => {
      const code = `'use strict';\nfunction createRandomStringGenerator() { return () => "random"; }\nexports.createRandomStringGenerator = createRandomStringGenerator;`;
      const result = await transformModuleCode(code, "/random.cjs");
      assert.ok(result.code.includes("export var createRandomStringGenerator = __cjs_module.exports.createRandomStringGenerator;"));
      assert.ok(result.code.includes("export default __cjs_module.exports;"));
    });

    test("CJS skips 'default' and '__esModule' in named exports", async () => {
      const result = await transformModuleCode(
        `Object.defineProperty(exports, "__esModule", { value: true });\nexports.z = {};\nexports.default = exports.z;`,
        "/mod.cjs"
      );
      assert.ok(result.code.includes("export var z = __cjs_module.exports.z;"));
      assert.ok(!result.code.includes("export var default"));
      assert.ok(!result.code.includes("export var __esModule"));
      assert.ok(result.code.includes("export default __cjs_module.exports;"));
    });

    test("CJS conversion rewrites require() calls", async () => {
      const result = await transformModuleCode(
        `const dep = require("./dep");\nexports.value = dep.value;`,
        "/mod.cjs"
      );
      assert.ok(result.code.includes('__require("./dep", "/mod.cjs")'));
      assert.ok(result.code.includes("export var value = __cjs_module.exports.value;"));
    });
  });

  describe("transformModuleCodeAsScript", () => {
    test("export const becomes local and appears in return", async () => {
      const result = await transformModuleCodeAsScript(
        'export const foo = 42;',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes("const foo = 42;"));
      assert.ok(!result.includes("export const"));
      assert.ok(result.includes("return { foo }"));
    });

    test("export { name } list syntax", async () => {
      const result = await transformModuleCodeAsScript(
        'const foo = 1;\nconst bar = 2;\nexport { foo, bar };',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes("return { foo, bar }"));
      assert.ok(!result.includes("export {"));
    });

    test("export { a as b } renaming", async () => {
      const result = await transformModuleCodeAsScript(
        'const foo = 1;\nexport { foo as bar };',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('"bar": foo'));
    });

    test("export default", async () => {
      const result = await transformModuleCodeAsScript(
        'export default 42;',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes("var __default__ = 42;"));
      assert.ok(result.includes('"default": __default__'));
    });

    test("export { name } from 'mod' generates re-import", async () => {
      const result = await transformModuleCodeAsScript(
        'export { foo } from "@/dep";',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('await __dynamicImport("@/dep", "/mod.ts")'));
      assert.ok(result.includes('"foo": __reexport_0["foo"]'));
    });

    test("export { a as b } from 'mod' generates renamed re-import", async () => {
      const result = await transformModuleCodeAsScript(
        'export { foo as bar } from "@/dep";',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('await __dynamicImport("@/dep", "/mod.ts")'));
      assert.ok(result.includes('"bar": __reexport_0["foo"]'));
    });

    test("export * from 'mod' generates spread re-import", async () => {
      const result = await transformModuleCodeAsScript(
        'export * from "@/dep";',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('await __dynamicImport("@/dep", "/mod.ts")'));
      assert.ok(result.includes("...__reexport_star_"));
    });

    test("export * as ns from 'mod' generates namespace re-import", async () => {
      const result = await transformModuleCodeAsScript(
        'export * as ns from "@/dep";',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('await __dynamicImport("@/dep", "/mod.ts")'));
      assert.ok(result.includes('"ns": __reexport_star_'));
    });

    test("sync mode uses __require instead of __dynamicImport", async () => {
      const result = await transformModuleCodeAsScript(
        'export { foo } from "@/dep";',
        "/mod.ts",
        "sync"
      );
      assert.ok(result.includes('__require("@/dep", "/mod.ts")'));
      assert.ok(!result.includes("await"));
      assert.ok(result.startsWith("(function()"));
    });

    test("mixed local exports and re-exports", async () => {
      const result = await transformModuleCodeAsScript(
        'export const local = 1;\nexport { foo } from "@/dep";\nexport * from "@/base";',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes("const local = 1;"));
      assert.ok(result.includes('__dynamicImport("@/dep"'));
      assert.ok(result.includes('__dynamicImport("@/base"'));
      assert.ok(result.includes("...__reexport_star_"));
      assert.ok(result.includes('"foo": __reexport_0["foo"]'));
      assert.ok(result.includes("local"));
    });

    test("CJS fallback when no exports", async () => {
      const result = await transformModuleCodeAsScript(
        'module.exports = { x: 1 };',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes("return module.exports;"));
    });

    test("re-export in import section (export { } from on same line as imports)", async () => {
      const result = await transformModuleCodeAsScript(
        'import { helper } from "@/utils";\nexport { foo } from "@/dep";\nconst x = helper();',
        "/mod.ts",
        "async"
      );
      assert.ok(result.includes('__dynamicImport("@/utils"'));
      assert.ok(result.includes('__dynamicImport("@/dep"'));
      assert.ok(result.includes('"foo": __reexport_0["foo"]'));
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
