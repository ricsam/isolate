import { test, describe } from "node:test";
import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createRuntime, type RuntimeHandle } from "@ricsam/isolate-runtime";
import {
  defaultModuleLoader,
  parseMappings,
  virtualToHost,
  findNodeModulesMapping,
  resolveFilePath,
  detectFormat,
  parseSpecifier,
  isBareSpecifier,
  clearBundleCache,
} from "./index.ts";

describe("mappings", () => {
  test("parseMappings parses glob pattern", () => {
    const mappings = parseMappings([
      { from: "/host/project/node_modules/**/*", to: "/node_modules" },
    ]);

    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0]!.isGlob, true);
    assert.strictEqual(mappings[0]!.hostBase, "/host/project/node_modules");
    assert.strictEqual(mappings[0]!.virtualMount, "/node_modules");
    assert.strictEqual(mappings[0]!.isNodeModules, true);
  });

  test("parseMappings parses direct file path", () => {
    const mappings = parseMappings([
      { from: "/host/project/src/entry.ts", to: "/app/entry.ts" },
    ]);

    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0]!.isGlob, false);
    assert.strictEqual(mappings[0]!.hostBase, "/host/project/src/entry.ts");
    assert.strictEqual(mappings[0]!.virtualMount, "/app/entry.ts");
    assert.strictEqual(mappings[0]!.isNodeModules, false);
  });

  test("parseMappings detects node_modules without glob", () => {
    const mappings = parseMappings([
      { from: "/host/node_modules", to: "/node_modules" },
    ]);

    assert.strictEqual(mappings[0]!.isNodeModules, true);
    assert.strictEqual(mappings[0]!.isGlob, false);
  });

  test("virtualToHost maps glob paths", () => {
    const mappings = parseMappings([
      { from: "/host/project/node_modules/**/*", to: "/node_modules" },
    ]);

    assert.strictEqual(
      virtualToHost("/node_modules/lodash/index.js", mappings),
      "/host/project/node_modules/lodash/index.js",
    );
    assert.strictEqual(
      virtualToHost("/node_modules", mappings),
      "/host/project/node_modules",
    );
  });

  test("virtualToHost maps direct paths", () => {
    const mappings = parseMappings([
      { from: "/host/project/src/entry.ts", to: "/app/entry.ts" },
    ]);

    assert.strictEqual(
      virtualToHost("/app/entry.ts", mappings),
      "/host/project/src/entry.ts",
    );
    assert.strictEqual(
      virtualToHost("/app/other.ts", mappings),
      null,
    );
  });

  test("virtualToHost returns null for unmatched paths", () => {
    const mappings = parseMappings([
      { from: "/host/node_modules/**/*", to: "/node_modules" },
    ]);

    assert.strictEqual(virtualToHost("/app/something.ts", mappings), null);
  });

  test("findNodeModulesMapping returns the correct mapping", () => {
    const mappings = parseMappings([
      { from: "/host/src/**/*", to: "/src" },
      { from: "/host/node_modules/**/*", to: "/node_modules" },
    ]);

    const nm = findNodeModulesMapping(mappings);
    assert.ok(nm);
    assert.strictEqual(nm.hostBase, "/host/node_modules");
  });
});

describe("resolve", () => {
  test("parseSpecifier parses simple package", () => {
    const result = parseSpecifier("lodash");
    assert.strictEqual(result.packageName, "lodash");
    assert.strictEqual(result.subpath, "");
  });

  test("parseSpecifier parses package with subpath", () => {
    const result = parseSpecifier("lodash/chunk");
    assert.strictEqual(result.packageName, "lodash");
    assert.strictEqual(result.subpath, "/chunk");
  });

  test("parseSpecifier parses scoped package", () => {
    const result = parseSpecifier("@scope/pkg");
    assert.strictEqual(result.packageName, "@scope/pkg");
    assert.strictEqual(result.subpath, "");
  });

  test("parseSpecifier parses scoped package with subpath", () => {
    const result = parseSpecifier("@scope/pkg/sub/path");
    assert.strictEqual(result.packageName, "@scope/pkg");
    assert.strictEqual(result.subpath, "/sub/path");
  });

  test("isBareSpecifier identifies bare specifiers", () => {
    assert.strictEqual(isBareSpecifier("lodash"), true);
    assert.strictEqual(isBareSpecifier("@scope/pkg"), true);
    assert.strictEqual(isBareSpecifier("./local"), false);
    assert.strictEqual(isBareSpecifier("../parent"), false);
    assert.strictEqual(isBareSpecifier("/absolute"), false);
  });

  test("detectFormat identifies json", () => {
    assert.strictEqual(detectFormat("file.json", "{}"), "json");
  });

  test("detectFormat identifies cjs", () => {
    assert.strictEqual(detectFormat("file.cjs", "module.exports = {}"), "cjs");
  });

  test("detectFormat identifies mjs", () => {
    assert.strictEqual(detectFormat("file.mjs", "export default {}"), "esm");
  });

  test("detectFormat uses heuristic for .js files", () => {
    assert.strictEqual(
      detectFormat("file.js", 'import foo from "bar";\nexport default foo;'),
      "esm",
    );
    assert.strictEqual(
      detectFormat("file.js", 'const x = require("bar");\nmodule.exports = x;'),
      "cjs",
    );
  });

  test("resolveFilePath finds files with extension probing", () => {
    // Create a temp directory with test files
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "foo.ts"), "export const x = 1;");
      fs.writeFileSync(path.join(tmpDir, "bar.js"), "export const y = 2;");
      fs.mkdirSync(path.join(tmpDir, "baz"));
      fs.writeFileSync(
        path.join(tmpDir, "baz", "index.ts"),
        "export const z = 3;",
      );

      // Extension probing
      const fooResult = resolveFilePath(path.join(tmpDir, "foo"));
      assert.strictEqual(fooResult, path.join(tmpDir, "foo.ts"));

      const barResult = resolveFilePath(path.join(tmpDir, "bar"));
      assert.strictEqual(barResult, path.join(tmpDir, "bar.js"));

      // Index fallback
      const bazResult = resolveFilePath(path.join(tmpDir, "baz"));
      assert.strictEqual(bazResult, path.join(tmpDir, "baz", "index.ts"));

      // Not found
      const notFound = resolveFilePath(path.join(tmpDir, "nonexistent"));
      assert.strictEqual(notFound, null);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("defaultModuleLoader", () => {
  test("loads user files via path mapping", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "module-loader-test-"),
    );
    try {
      fs.writeFileSync(
        path.join(tmpDir, "utils.ts"),
        'export const greeting = "hello";',
      );

      const loader = defaultModuleLoader(
        { from: tmpDir + "/**/*", to: "/app" },
      );

      const result = await loader("./utils", {
        path: "/app/entry.ts",
        resolveDir: "/app",
      });

      assert.ok(result.code.includes("greeting"));
      assert.strictEqual(result.filename, "utils.js");
      assert.strictEqual(result.resolveDir, "/app");
      assert.strictEqual(result.static, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("throws for unmapped paths", async () => {
    const loader = defaultModuleLoader(
      { from: "/host/src/**/*", to: "/src" },
    );

    await assert.rejects(
      async () =>
        loader("./something", {
          path: "/app/entry.ts",
          resolveDir: "/app",
        }),
      /no mapping matches/,
    );
  });

  test("throws for bare specifier without node_modules mapping", async () => {
    const loader = defaultModuleLoader(
      { from: "/host/src/**/*", to: "/src" },
    );

    await assert.rejects(
      async () =>
        loader("lodash", {
          path: "/src/entry.ts",
          resolveDir: "/src",
        }),
      /no node_modules mapping/,
    );
  });
});

describe("integration with createRuntime", () => {
  test("imports user files in isolate", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "integration-test-"),
    );
    let runtime: RuntimeHandle | undefined;
    try {
      fs.writeFileSync(
        path.join(tmpDir, "utils.ts"),
        'export const greeting: string = "hello from utils";',
      );

      const loader = defaultModuleLoader(
        { from: tmpDir + "/**/*", to: "/app" },
      );

      let logValue: string | null = null;
      runtime = await createRuntime({
        moduleLoader: loader,
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.stdout;
            }
          },
        },
      });

      await runtime.eval(
        `
        import { greeting } from "./utils";
        console.log(greeting);
        `,
        "/app/entry.ts",
      );

      assert.strictEqual(logValue, "hello from utils");
    } finally {
      await runtime?.dispose();
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("imports npm package in isolate", async () => {
    clearBundleCache();

    // Use the actual project's node_modules
    const projectRoot = path.resolve(
      import.meta.dirname,
      "../../../",
    );
    const nodeModulesPath = path.join(projectRoot, "node_modules");

    // Use ms — a small, pure JS package with no node built-in deps
    const testPkgPath = path.join(nodeModulesPath, "ms");
    if (!fs.existsSync(testPkgPath)) {
      return; // Skip if not installed
    }

    const loader = defaultModuleLoader(
      { from: nodeModulesPath, to: "/node_modules" },
    );

    let logValue: string | null = null;
    const runtime = await createRuntime({
      moduleLoader: loader,
      console: {
        onEntry: (entry) => {
          if (entry.type === "output" && entry.level === "log") {
            logValue = entry.stdout;
          }
        },
      },
    });

    try {
      await runtime.eval(
        `
        import ms from "ms";
        console.log(String(ms("2 days")));
        `,
        "/app/entry.ts",
      );

      assert.strictEqual(logValue, "172800000");
    } finally {
      await runtime.dispose();
    }
  });

  test("nested user file imports", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nested-test-"),
    );
    let runtime: RuntimeHandle | undefined;
    try {
      fs.mkdirSync(path.join(tmpDir, "lib"));
      fs.writeFileSync(
        path.join(tmpDir, "lib", "helper.ts"),
        'export function double(n: number): number { return n * 2; }',
      );
      fs.writeFileSync(
        path.join(tmpDir, "utils.ts"),
        `
import { double } from "./lib/helper";
export const result: number = double(21);
        `.trim(),
      );

      const loader = defaultModuleLoader(
        { from: tmpDir + "/**/*", to: "/app" },
      );

      let logValue: string | null = null;
      runtime = await createRuntime({
        moduleLoader: loader,
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logValue = entry.stdout;
            }
          },
        },
      });

      await runtime.eval(
        `
        import { result } from "./utils";
        console.log(String(result));
        `,
        "/app/entry.ts",
      );

      assert.strictEqual(logValue, "42");
    } finally {
      await runtime?.dispose();
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
