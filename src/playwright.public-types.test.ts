import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext, Page } from "playwright";
import { createPlaywrightSessionHandler } from "./playwright.ts";
import type { HostBrowserBindings } from "./types.ts";

function verifyPublicPlaywrightTypes(
  context: BrowserContext,
  page: Page,
): HostBrowserBindings {
  const helper = createPlaywrightSessionHandler<BrowserContext, Page>({
    createContext: async () => context,
    createPage: async (ctx) => {
      const typedContext: BrowserContext = ctx;
      void typedContext;
      return page;
    },
    readFile: async (filePath) => ({
      name: filePath,
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    }),
    writeFile: async () => {},
    timeout: 1_000,
  });

  return {
    handler: helper.handler,
    captureConsole: true,
  };
}

test("public Playwright helper types accept app-side Playwright types", () => {
  assert.ok(true);
  void verifyPublicPlaywrightTypes;
});
