/**
 * Tests for Playwright page-level expect assertions.
 * Verifies expect(page).toHaveURL() and expect(page).toHaveTitle() work correctly.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-page-assertions.sock";

describe("playwright page-level assertions", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  describe("toHaveURL", () => {
    it("should match exact URL", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveURL matches exact URL', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');
            await expect(page).toHaveURL('data:text/html,<h1>Test</h1>');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should match URL with regex", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveURL matches regex', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');
            await expect(page).toHaveURL(/^data:text\\/html/);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support not.toHaveURL", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('not.toHaveURL works', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');
            await expect(page).not.toHaveURL('http://example.com');
            await expect(page).not.toHaveURL(/^https:/);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });
  });

  describe("toHaveTitle", () => {
    it("should match exact title", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveTitle matches exact title', async () => {
            await page.goto('data:text/html,<title>My Page Title</title><h1>Content</h1>');
            await expect(page).toHaveTitle('My Page Title');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should match title with regex", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveTitle matches regex', async () => {
            await page.goto('data:text/html,<title>My Page Title</title><h1>Content</h1>');
            await expect(page).toHaveTitle(/Page Title$/);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support not.toHaveTitle", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('not.toHaveTitle works', async () => {
            await page.goto('data:text/html,<title>My Page</title><h1>Content</h1>');
            await expect(page).not.toHaveTitle('Wrong Title');
            await expect(page).not.toHaveTitle(/^Other/);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });
  });
});
