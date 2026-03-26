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
});
