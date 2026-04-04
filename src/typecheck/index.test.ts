import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getTypeProfile, typecheck } from "./index.ts";

describe("typecheck helpers", () => {
  test("builds type profiles from named capabilities", () => {
    const profile = getTypeProfile({
      profile: "browser-test",
      capabilities: ["files"],
    });

    assert.equal(profile.profile, "browser-test");
    assert.ok(profile.capabilities.includes("browser"));
    assert.ok(profile.capabilities.includes("tests"));
    assert.ok(profile.capabilities.includes("files"));
    assert.ok(profile.include.includes("playwright"));
    assert.ok(profile.include.includes("testEnvironment"));
    assert.ok(profile.files.some((file) => file.name === "isolate-playwright.d.ts"));
  });

  test("typechecks code against the selected capabilities", () => {
    const ok = typecheck({
      code: "page.goto('/');",
      profile: "browser-test",
    });
    const missing = typecheck({
      code: "page.goto('/');",
      profile: "backend",
    });

    assert.equal(ok.success, true);
    assert.equal(missing.success, false);
    assert.ok(missing.errors.some((error) => error.message.includes("page")));
  });

  test("supports the browser factory capability without full page globals", () => {
    const profile = getTypeProfile({
      capabilities: ["browserFactory"],
    });
    const ok = typecheck({
      code: `
        export {};
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("/");
      `,
      capabilities: ["browserFactory"],
    });
    const missingPageGlobal = typecheck({
      code: "await page.goto('/')",
      capabilities: ["browserFactory"],
    });

    assert.ok(profile.include.includes("browserFactory"));
    assert.ok(!profile.include.includes("playwright"));
    assert.ok(profile.files.some((file) => file.name === "isolate-browserFactory.d.ts"));
    assert.equal(ok.success, true);
    assert.equal(missingPageGlobal.success, false);
    assert.ok(
      missingPageGlobal.errors.some((error) => error.message.includes("page")),
    );
  });

  test("typechecks sandbox imports for @ricsam/isolate", () => {
    const result = typecheck({
      code: `
        export {};
        import { createIsolateHost } from "@ricsam/isolate";

        const host = createIsolateHost();
        const runtime = await host.createRuntime();
        await runtime.eval("globalThis.ok = true;");
        await runtime.dispose();
      `,
      profile: "backend",
    });

    assert.equal(result.success, true);
  });
});
