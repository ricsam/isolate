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
});
