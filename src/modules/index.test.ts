import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { createModuleResolver } from "./index.ts";
import type { HostCallContext } from "../types.ts";

const TEST_CONTEXT: HostCallContext = {
  signal: AbortSignal.abort(),
  runtimeId: "test-runtime",
  resourceId: "test-resource",
  metadata: {},
};

describe("createModuleResolver", () => {
  test("resolves virtual modules and preserves explicit metadata", async () => {
    const resolver = createModuleResolver().virtual(
      "virtual:test",
      "export const value = 1;",
      { filename: "virtual-test.ts", resolveDir: "/virtual" },
    );

    const result = await resolver.resolve(
      "virtual:test",
      { path: "/app/main.ts", resolveDir: "/app" },
      TEST_CONTEXT,
    );

    assert.equal(result.code, "export const value = 1;");
    assert.equal(result.filename, "virtual-test.ts");
    assert.equal(result.resolveDir, "/virtual");
  });

  test("uses source trees before fallback resolution", async () => {
    const resolver = createModuleResolver()
      .sourceTree("/src/", (relativePath) => ({
        code: `export default ${JSON.stringify(relativePath)};`,
        filename: "tree-entry.ts",
        resolveDir: "/src",
      }))
      .fallback((specifier) => ({
        code: `export default ${JSON.stringify(specifier)};`,
        filename: "fallback-entry.ts",
        resolveDir: "/fallback",
      }));

    const sourceTreeResult = await resolver.resolve(
      "/src/utils/math.ts",
      { path: "/app/main.ts", resolveDir: "/app" },
      TEST_CONTEXT,
    );
    const fallbackResult = await resolver.resolve(
      "./local.ts",
      { path: "/app/main.ts", resolveDir: "/app" },
      TEST_CONTEXT,
    );

    assert.equal(sourceTreeResult.filename, "tree-entry.ts");
    assert.match(sourceTreeResult.code, /"utils\/math\.ts"/);
    assert.equal(fallbackResult.filename, "fallback-entry.ts");
    assert.match(fallbackResult.code, /"\.\/local\.ts"/);
  });

  test("lets virtual modules override mounted node_modules packages", async () => {
    const nodeModulesPath = path.resolve(import.meta.dirname, "../../node_modules");
    assert.equal(fs.existsSync(nodeModulesPath), true);

    const resolver = createModuleResolver()
      .mountNodeModules("/node_modules", nodeModulesPath)
      .virtual("mime-types", {
        code: "export const value = 'stubbed';",
        filename: "mime-types-stub.ts",
        resolveDir: "/virtual",
        static: true,
      });

    const result = await resolver.resolve(
      "mime-types",
      { path: "/app/main.ts", resolveDir: "/app" },
      TEST_CONTEXT,
    );

    assert.equal(result.filename, "mime-types-stub.ts");
    assert.equal(result.resolveDir, "/virtual");
    assert.match(result.code, /stubbed/);
  });

  test("preserves nested package resolution across transitive bare imports", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-module-resolver-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageARoot = path.join(nodeModulesPath, "package-a");
    const packageBRoot = path.join(packageARoot, "node_modules", "package-b");

    fs.mkdirSync(packageBRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageARoot, "package.json"),
      JSON.stringify({ name: "package-a", type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
      path.join(packageARoot, "index.js"),
      "export { value } from 'package-b';\n",
    );
    fs.writeFileSync(
      path.join(packageBRoot, "package.json"),
      JSON.stringify({ name: "package-b", type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
      path.join(packageBRoot, "index.js"),
      "export const value = 42;\n",
    );

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const packageA = await resolver.resolve(
        "package-a",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );
      assert.match(packageA.code, /package-b/);

      const packageB = await resolver.resolve(
        "package-b",
        { path: path.posix.join(packageA.resolveDir, packageA.filename), resolveDir: packageA.resolveDir },
        TEST_CONTEXT,
      );

      assert.equal(packageB.filename, "package-b.bundled.js");
      assert.match(packageB.code, /42/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("bundles package-private imports from a package imports map", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-package-imports-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageRoot = path.join(nodeModulesPath, "package-a");

    fs.mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "package-a",
        type: "module",
        exports: "./index.js",
        imports: {
          "#internal": {
            default: "./lib/internal.js",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "index.js"),
      "export { value } from '#internal';\n",
    );
    fs.writeFileSync(
      path.join(packageRoot, "lib/internal.js"),
      "export const value = 42;\n",
    );

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const result = await resolver.resolve(
        "package-a",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );

      assert.equal(result.filename, "package-a.bundled.js");
      assert.doesNotMatch(result.code, /#internal/);
      assert.match(result.code, /42/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prefers worker or default exports over browser-only entrypoints", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-export-conditions-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageRoot = path.join(nodeModulesPath, "package-a");

    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "package-a",
        type: "module",
        exports: {
          browser: "./browser.js",
          default: "./index.js",
        },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "index.js"),
      "export const value = 42;\n",
    );
    fs.writeFileSync(
      path.join(packageRoot, "browser.js"),
      "const element = document.createElement('div'); export const value = element.tagName;\n",
    );

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const result = await resolver.resolve(
        "package-a",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );

      assert.equal(result.filename, "package-a.bundled.js");
      assert.match(result.code, /42/);
      assert.doesNotMatch(result.code, /document\.createElement/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("applies package browser remaps for internal files without preferring browser-only package entries", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-browser-remaps-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageRoot = path.join(nodeModulesPath, "package-a");
    const packageBNodeRoot = path.join(nodeModulesPath, "package-b-node");
    const packageBBrowserRoot = path.join(nodeModulesPath, "package-b-browser");

    fs.mkdirSync(path.join(packageRoot, "dist-es"), { recursive: true });
    fs.mkdirSync(packageBNodeRoot, { recursive: true });
    fs.mkdirSync(packageBBrowserRoot, { recursive: true });

    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "package-a",
        type: "module",
        exports: "./dist-es/index.js",
        module: "./dist-es/index.js",
        browser: {
          "./dist-es/runtimeConfig": "./dist-es/runtimeConfig.browser",
        },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist-es/index.js"),
      'export { value } from "./runtimeConfig";\n',
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist-es/runtimeConfig.js"),
      'export { value } from "package-b-node";\n',
    );
    fs.writeFileSync(
      path.join(packageRoot, "dist-es/runtimeConfig.browser.js"),
      'export { value } from "package-b-browser";\n',
    );

    fs.writeFileSync(
      path.join(packageBNodeRoot, "package.json"),
      JSON.stringify({ name: "package-b-node", type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
      path.join(packageBNodeRoot, "index.js"),
      'export const value = "node";\n',
    );
    fs.writeFileSync(
      path.join(packageBBrowserRoot, "package.json"),
      JSON.stringify({ name: "package-b-browser", type: "module", exports: "./index.js" }),
    );
    fs.writeFileSync(
      path.join(packageBBrowserRoot, "index.js"),
      'export const value = "browser";\n',
    );

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const result = await resolver.resolve(
        "package-a",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );

      assert.equal(result.filename, "package-a.bundled.js");
      assert.match(result.code, /package-b-browser/);
      assert.doesNotMatch(result.code, /package-b-node/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("resolves wildcard subpath exports to their import entrypoints", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-subpath-exports-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageRoot = path.join(nodeModulesPath, "package-a");

    fs.mkdirSync(path.join(packageRoot, "esm"), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, "cjs"), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "package-a",
        type: "module",
        exports: {
          "./*": {
            import: "./esm/*.js",
            require: "./cjs/*.js",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(packageRoot, "esm/webhooks.js"),
      "export function validateEvent() { return 42; }\n",
    );
    fs.writeFileSync(
      path.join(packageRoot, "cjs/webhooks.js"),
      "exports.validateEvent = () => 42;\n",
    );

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const result = await resolver.resolve(
        "package-a/webhooks",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );

      assert.equal(result.filename, "webhooks.bundled.js");
      assert.match(result.code, /validateEvent/);
      assert.doesNotMatch(result.code, /__packageDefault/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("rethrows node_modules loader errors when fallback returns null", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-loader-errors-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");

    fs.mkdirSync(nodeModulesPath, { recursive: true });

    try {
      const resolver = createModuleResolver()
        .mountNodeModules("/node_modules", nodeModulesPath)
        .fallback(() => null);

      await assert.rejects(
        resolver.resolve(
          "missing-package",
          { path: "/app/main.ts", resolveDir: "/app" },
          TEST_CONTEXT,
        ),
        /Cannot resolve bare specifier "missing-package"/,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("resolves explicit subpath exports with nested import conditions", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-explicit-subpath-exports-"));
    const nodeModulesPath = path.join(tempRoot, "node_modules");
    const packageRoot = path.join(nodeModulesPath, "@lexical", "react");

    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@lexical/react",
        type: "module",
        exports: {
          "./LexicalComposer": {
            import: {
              types: "./LexicalComposer.d.ts",
              development: "./LexicalComposer.dev.mjs",
              production: "./LexicalComposer.prod.mjs",
              node: "./LexicalComposer.node.mjs",
              default: "./LexicalComposer.mjs",
            },
            require: {
              types: "./LexicalComposer.d.ts",
              development: "./LexicalComposer.dev.js",
              production: "./LexicalComposer.prod.js",
              default: "./LexicalComposer.js",
            },
          },
        },
      }),
    );
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.d.ts"), "export declare const source: string;\n");
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.dev.mjs"), 'export const source = "esm-development";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.prod.mjs"), 'export const source = "esm-production";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.node.mjs"), 'export const source = "esm-node";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.mjs"), 'export const source = "esm-default";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.dev.js"), 'exports.source = "cjs-development";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.prod.js"), 'exports.source = "cjs-production";\n');
    fs.writeFileSync(path.join(packageRoot, "LexicalComposer.js"), 'exports.source = "cjs-default";\n');

    try {
      const resolver = createModuleResolver().mountNodeModules("/node_modules", nodeModulesPath);

      const result = await resolver.resolve(
        "@lexical/react/LexicalComposer",
        { path: "/app/main.ts", resolveDir: "/app" },
        TEST_CONTEXT,
      );

      assert.equal(result.filename, "LexicalComposer.bundled.js");
      assert.match(result.code, /esm-(development|production|node|default)/);
      assert.doesNotMatch(result.code, /cjs-default/);
      assert.doesNotMatch(result.code, /cjs-development/);
      assert.doesNotMatch(result.code, /cjs-production/);
      assert.doesNotMatch(result.code, /LexicalComposer\.d\.ts/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
