/**
 * Playwright integration tests for the isolate client and daemon.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-test-playwright.sock";

describe("isolate-client playwright integration", () => {
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

  it("should setup and run playwright tests", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Define a simple test
      await runtime.eval(`
        test('simple test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(results.total, 1);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should collect console logs and network data", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Navigate to a page that logs to console
      await runtime.eval(`
        test('console logging', async () => {
          await page.goto('data:text/html,<script>console.log("test message")</script>');
          await page.waitForTimeout(100);
        });
      `);

      await runtime.testEnvironment.runTests();

      // Get collected data
      const data = runtime.playwright.getCollectedData();

      // Should have captured the console log from the browser page
      assert.ok(data.browserConsoleLogs.length > 0, "Expected at least one browser console log");
      assert.ok(
        data.browserConsoleLogs.some((log) => log.stdout.includes("test message")),
        `Expected a log containing "test message", got: ${JSON.stringify(data.browserConsoleLogs)}`
      );
      assert.ok(Array.isArray(data.networkRequests));
      assert.ok(Array.isArray(data.networkResponses));
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should reset playwright tests", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      // Define a test
      await runtime.eval(`
        test('first test', async () => {
          expect(true).toBe(true);
        });
      `);

      // Run tests
      let results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.total, 1);

      // Reset tests
      await runtime.testEnvironment.reset();

      // Define new tests
      await runtime.eval(`
        test('second test', async () => {
          expect(1).toBe(1);
        });
        test('third test', async () => {
          expect(2).toBe(2);
        });
      `);

      // Run tests again
      results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.total, 2);
      assert.strictEqual(results.passed, 2);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should report playwright test failures", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('passing test', async () => {
          expect(true).toBe(true);
        });

        test('failing test', async () => {
          expect(1).toBe(2);
        });
      `);

      const results = await runtime.testEnvironment.runTests();

      assert.strictEqual(results.passed, 1);
      assert.strictEqual(results.failed, 1);
      assert.strictEqual(results.total, 2);

      // Check error message is present
      const failedTest = results.tests.find((t) => t.status === "fail");
      assert.ok(failedTest);
      assert.ok(failedTest.error);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should stream playwright events", async () => {
    const consoleLogs: { level: string; stdout: string }[] = [];
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        page,
        onEvent: (event) => {
          if (event.type === "browserConsoleLog") {
            consoleLogs.push({ level: event.level, stdout: event.stdout });
          }
        },
      },
    });

    try {
      await runtime.eval(`
        test('console test', async () => {
          await page.goto('data:text/html,<script>console.log("streamed message")</script>');
          await page.waitForTimeout(200);
        });
      `);

      await runtime.testEnvironment.runTests();
      // Console logs should have been streamed via client-side page listeners
      assert.ok(consoleLogs.length > 0, "Expected at least one streamed console log");
      assert.ok(
        consoleLogs.some((log) => log.stdout.includes("streamed message")),
        `Expected a log containing "streamed message", got: ${JSON.stringify(consoleLogs)}`
      );
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should execute page.evaluate with a function and capture console output", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        page,
        console: true,
      },
      console: {
        onEntry: () => {},
      },
    });

    try {
      await runtime.eval(`
        test('evaluate with function', async () => {
          await page.goto('data:text/html,<html><body>hello</body></html>');
          await page.evaluate(() => {
            console.log("evaluate-fn-msg");
          });
          await page.waitForTimeout(200);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Test should pass, got: ${JSON.stringify(results.tests)}`);

      const data = runtime.playwright.getCollectedData();
      assert.ok(
        data.browserConsoleLogs.some((log) => log.stdout.includes("evaluate-fn-msg")),
        `Expected a log containing "evaluate-fn-msg", got: ${JSON.stringify(data.browserConsoleLogs)}`
      );
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should route browser console logs to console.onEntry when playwright.console is true", async () => {
    const entries: { type: string; level: string; stdout: string }[] = [];
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        page,
        console: true,
      },
      console: {
        onEntry: (entry) => {
          if (entry.type === "browserOutput") {
            entries.push({ type: entry.type, level: entry.level, stdout: entry.stdout });
          }
        },
      },
    });

    try {
      await runtime.eval(`
        test('browser log routing', async () => {
          await page.goto('data:text/html,<script>console.log("routed message")</script>');
          await page.waitForTimeout(200);
        });
      `);

      await runtime.testEnvironment.runTests();

      assert.ok(entries.length > 0, "Expected at least one browserOutput entry routed to console.onEntry");
      assert.ok(
        entries.some((e) => e.type === "browserOutput" && e.stdout.includes("routed message")),
        `Expected a browserOutput entry containing "routed message", got: ${JSON.stringify(entries)}`
      );
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });
});
