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
    assert.ok(profile.capabilities.includes("crypto"));
    assert.ok(profile.capabilities.includes("tests"));
    assert.ok(profile.capabilities.includes("files"));
    assert.ok(profile.include.includes("crypto"));
    assert.ok(profile.include.includes("playwright"));
    assert.ok(profile.include.includes("testEnvironment"));
    assert.ok(profile.files.some((file) => file.name === "isolate-crypto.d.ts"));
    assert.ok(profile.files.some((file) => file.name === "isolate-playwright.d.ts"));
  });

  test("typechecks browser-test code without implicit page globals", () => {
    const ok = typecheck({
      code: `
        let page;
        beforeAll(async () => {
          const context = await browser.newContext();
          page = await context.newPage();
        });
      `,
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

  test("supports browser factory-style globals through the browser capability", () => {
    const profile = getTypeProfile({
      capabilities: ["browser"],
    });
    const ok = typecheck({
      code: `
        export {};
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("/");
      `,
      capabilities: ["browser"],
    });
    const missingPageGlobal = typecheck({
      code: "await page.goto('/')",
      capabilities: ["browser"],
    });

    assert.ok(profile.include.includes("playwright"));
    assert.ok(profile.files.some((file) => file.name === "isolate-playwright.d.ts"));
    assert.equal(ok.success, true);
    assert.equal(missingPageGlobal.success, false);
    assert.ok(
      missingPageGlobal.errors.some((error) => error.message.includes("page")),
    );
  });

  test("types Playwright screenshots as Promise<void>", () => {
    const ok = typecheck({
      code: `
        export {};
        const context = await browser.newContext();
        const page = await context.newPage();
        const result: void = await page.screenshot({ path: "/tmp/page.jpg" });
        const locatorResult: void = await page.locator("#ready").screenshot({ path: "/tmp/locator.jpg" });
        void result;
        void locatorResult;
      `,
      capabilities: ["browser"],
    });
    const mismatch = typecheck({
      code: `
        export {};
        const context = await browser.newContext();
        const page = await context.newPage();
        const result: string = await page.screenshot({ path: "/tmp/page.jpg" });
        void result;
      `,
      capabilities: ["browser"],
    });

    assert.equal(ok.success, true);
    assert.equal(mismatch.success, false);
    assert.ok(
      mismatch.errors.some((error) => /void.*string|string.*void/i.test(error.message)),
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

  test("includes crypto in built-in profiles and crypto code typechecks", () => {
    const profile = getTypeProfile({
      profile: "backend",
    });
    const result = typecheck({
      code: `
        export {};
        const pair = await crypto.subtle.generateKey(
          {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
        );

        if ("publicKey" in pair) {
          const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
          const importedPublicKey = await crypto.subtle.importKey(
            "spki",
            spki,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt", "wrapKey"],
          );
          void importedPublicKey;
        }
      `,
      profile: "backend",
    });

    assert.ok(profile.capabilities.includes("crypto"));
    assert.ok(profile.include.includes("crypto"));
    assert.ok(profile.files.some((file) => file.name === "isolate-crypto.d.ts"));
    assert.equal(result.success, true);
  });
});
