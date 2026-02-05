import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";
import http from "node:http";
import type { AddressInfo } from "node:net";

const TEST_SOCKET = "/tmp/isolate-test-wait-for-response.sock";

function createTestServer(): Promise<http.Server> {
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
        res.end(JSON.stringify({ message: "hello", items: [1, 2, 3] }));
      } else if (req.url === "/api/slow") {
        // Respond after a short delay
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(200);
          res.end(JSON.stringify({ message: "slow response" }));
        }, 200);
      } else if (req.url === "/api/not-found") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not found" }));
      } else {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        res.end(`<html><body>
          <button id="fetch-btn" onclick="fetch('/api/data')">Fetch Data</button>
          <button id="fetch-slow" onclick="fetch('/api/slow')">Fetch Slow</button>
          <button id="fetch-404" onclick="fetch('/api/not-found')">Fetch 404</button>
        </body></html>`);
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

describe("page.waitForResponse", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let server: http.Server;
  let port: number;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
    server = await createTestServer();
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await client.close();
    await daemon.close();
    server.close();
  });

  it("should wait for response with string URL matcher", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForResponse with string URL', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const responsePromise = page.waitForResponse('**/api/data');
          await page.click('#fetch-btn');
          const response = await responsePromise;

          expect(response.status()).toBe(200);
          expect(response.ok()).toBe(true);
          expect(response.url()).toContain('/api/data');
          const json = await response.json();
          expect(json.message).toBe('hello');
          expect(json.items).toEqual([1, 2, 3]);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should wait for response with RegExp matcher", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('waitForResponse with RegExp', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const responsePromise = page.waitForResponse(/\\/api\\/data/);
          await page.click('#fetch-btn');
          const response = await responsePromise;

          expect(response.status()).toBe(200);
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

  it("should wait for response with predicate function", async () => {
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

          const responsePromise = page.waitForResponse(response => response.url().includes('/api/data') && response.status() === 200);
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

  it("should support response properties: url, status, statusText, headers, headersArray, text", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('response properties', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const responsePromise = page.waitForResponse('**/api/data');
          await page.click('#fetch-btn');
          const response = await responsePromise;

          expect(response.url()).toContain('/api/data');
          expect(response.status()).toBe(200);
          expect(typeof response.statusText()).toBe('string');
          expect(typeof response.headers()).toBe('object');
          expect(Array.isArray(response.headersArray())).toBe(true);
          expect(response.ok()).toBe(true);

          const text = await response.text();
          expect(typeof text).toBe('string');
          expect(JSON.parse(text).message).toBe('hello');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should handle non-OK responses", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('non-OK response', async () => {
          await page.goto('http://127.0.0.1:${port}/');

          const responsePromise = page.waitForResponse('**/api/not-found');
          await page.click('#fetch-404');
          const response = await responsePromise;

          expect(response.status()).toBe(404);
          expect(response.ok()).toBe(false);
          const json = await response.json();
          expect(json.error).toBe('not found');
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
