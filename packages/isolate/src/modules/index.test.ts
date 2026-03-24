import assert from "node:assert/strict";
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
});
