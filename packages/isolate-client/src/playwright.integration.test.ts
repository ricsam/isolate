/**
 * Playwright integration tests for the isolate client and daemon.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "./types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";
import http from "node:http";
import type { AddressInfo } from "node:net";

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
      playwright: { handler: defaultPlaywrightHandler(page) },
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
      playwright: { handler: defaultPlaywrightHandler(page) },
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
      playwright: { handler: defaultPlaywrightHandler(page) },
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
      playwright: { handler: defaultPlaywrightHandler(page) },
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
      playwright: { handler: defaultPlaywrightHandler(page), onEvent: (event) => {
          if (event.type === "browserConsoleLog") {
            consoleLogs.push({ level: event.level, stdout: event.stdout });
          }
        } },
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
      playwright: { handler: defaultPlaywrightHandler(page), console: true },
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
      playwright: { handler: defaultPlaywrightHandler(page), console: true },
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

  it("should support getByRole with regex name option", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('getByRole with regex', async () => {
          await page.goto('data:text/html,<button>Add Model</button><button>Delete</button>');

          // This should find the "Add Model" button using regex
          const btn = page.getByRole('button', { name: /add model/i });
          const isVisible = await btn.isVisible();
          expect(isVisible).toBe(true);

          // Verify it found the right button
          const text = await btn.textContent();
          expect(text).toBe('Add Model');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support locator.or() method", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('locator or method', async () => {
          await page.goto('https://example.com');

          // Button doesn't exist, link does - .or() should find the link
          const btnOrLink = page.getByRole('button', { name: 'NonExistent' })
            .or(page.getByRole('link', { name: 'Learn more' }));

          const isVisible = await btnOrLink.isVisible();
          expect(isVisible).toBe(true);

          // Verify it found the link
          const text = await btnOrLink.textContent();
          expect(text).toBe('Learn more');
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

// ============================================================================
// Predicate function tests for waitForURL, waitForRequest, waitForResponse
// ============================================================================

function createPredicateTestServer(): Promise<http.Server> {
  return new Promise<http.Server>((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === "/api/data") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ message: "hello" }));
      } else if (req.url === "/api/other") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ message: "other" }));
      } else if (req.url === "/page2") {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        res.end(`<html><body><h1>Page 2</h1></body></html>`);
      } else {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        res.end(`<html><body>
          <button id="fetch-btn" onclick="fetch('/api/data')">Fetch Data</button>
          <button id="fetch-other" onclick="fetch('/api/other')">Fetch Other</button>
          <a id="nav-link" href="/page2">Go to page 2</a>
        </body></html>`);
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

describe("predicate function support", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let server: http.Server;
  let port: number;

  const TEST_SOCKET_PRED = "/tmp/isolate-test-predicates.sock";

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET_PRED });
    client = await connect({ socket: TEST_SOCKET_PRED });
    server = await createPredicateTestServer();
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await client.close();
    await daemon.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("waitForURL with predicate function", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForURL with predicate', async () => {
          await page.goto('http://127.0.0.1:${port}/');
          expect(page.url()).toContain('127.0.0.1');

          await page.click('#nav-link');
          await page.waitForURL((url) => url.includes('/page2'));

          expect(page.url()).toContain('/page2');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForURL with predicate using closure variable", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForURL with closure', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const targetPath = '/page2';
          await page.click('#nav-link');
          await page.waitForURL((url) => url.includes(targetPath));

          expect(page.url()).toContain('/page2');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForResponse with predicate function", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForResponse with predicate', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const responsePromise = page.waitForResponse(
            (response) => response.url().includes('/api/data') && response.status() === 200
          );
          await page.click('#fetch-btn');
          const response = await responsePromise;

          expect(response.ok()).toBe(true);
          const json = await response.json();
          expect(json.message).toBe('hello');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForResponse with predicate using closure variable", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForResponse with closure', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const targetUrl = '/api/data';
          const responsePromise = page.waitForResponse(
            (response) => response.url().includes(targetUrl)
          );
          await page.click('#fetch-btn');
          const response = await responsePromise;

          expect(response.url()).toContain('/api/data');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForRequest with predicate function", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForRequest with predicate', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const requestPromise = page.waitForRequest(
            (request) => request.url().includes('/api/data')
          );
          await page.click('#fetch-btn');
          const request = await requestPromise;

          expect(request.url()).toContain('/api/data');
          expect(request.method()).toBe('GET');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForRequest with string URL matcher", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForRequest with string', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const requestPromise = page.waitForRequest('http://127.0.0.1:${port}/api/data');
          await page.click('#fetch-btn');
          const request = await requestPromise;

          expect(request.url()).toContain('/api/data');
          expect(request.method()).toBe('GET');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForRequest with RegExp matcher", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForRequest with regex', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const requestPromise = page.waitForRequest(/\\/api\\/data/);
          await page.click('#fetch-btn');
          const request = await requestPromise;

          expect(request.url()).toContain('/api/data');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForURL with string still works", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForURL with string', async () => {
          await page.goto('http://127.0.0.1:${port}/');
          await page.click('#nav-link');
          await page.waitForURL('**/page2');
          expect(page.url()).toContain('/page2');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("waitForURL with RegExp still works", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForURL with regex', async () => {
          await page.goto('http://127.0.0.1:${port}/');
          await page.click('#nav-link');
          await page.waitForURL(/\\/page2/);
          expect(page.url()).toContain('/page2');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("async predicate throws clear error", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('async predicate error', async () => {
          await page.goto('http://127.0.0.1:${port}/');
          let error;
          try {
            await page.waitForURL(async (url) => url.includes('/page2'));
          } catch (e) {
            error = e;
          }
          expect(error).toBeDefined();
          expect(error.message).toContain('Async predicates are not supported');
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
