/**
 * Tests for the 5 original Playwright issues:
 * 1. toHaveAttribute - not available
 * 2. getByLabel(...).getByText(...) fails - locator chaining
 * 3. Locator chaining produces invalid selectors
 * 4. page.evaluate with parameters returns undefined
 * 5. filter({ has: locator }) throws frame error
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-original-issues.sock";

describe("original playwright issues", () => {
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

  describe("Issue 1: toHaveAttribute matcher", () => {
    it("should have toHaveAttribute matcher available", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveAttribute is available', async () => {
            await page.goto('data:text/html,<div data-state="active" id="tab">Tab</div>');

            const tab = page.locator('#tab');
            await expect(tab).toHaveAttribute('data-state', 'active');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support toHaveAttribute with negation", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveAttribute with negation', async () => {
            await page.goto('data:text/html,<div data-state="inactive" id="tab">Tab</div>');

            const tab = page.locator('#tab');
            await expect(tab).not.toHaveAttribute('data-state', 'active');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support toHaveAttribute with regex", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('toHaveAttribute with regex', async () => {
            await page.goto('data:text/html,<a href="/users/123/profile" id="link">Profile</a>');

            const link = page.locator('#link');
            await expect(link).toHaveAttribute('href', /\\/users\\/\\d+\\/profile/);
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

  describe("Issue 2: getByRole group().getByText() - locator chaining with getBy* methods", () => {
    it("should support getByRole group().getByText()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('getByRole group().getByText() works', async () => {
            await page.goto('data:text/html,<fieldset><legend>Profile</legend><span>testuser</span><span>other</span></fieldset>');

            const profile = page.getByRole('group', { name: 'Profile' });
            const text = profile.getByText('testuser');

            const isVisible = await text.isVisible();
            expect(isVisible).toBe(true);

            const content = await text.textContent();
            expect(content).toBe('testuser');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support getByRole().getByText()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('getByRole().getByText() works', async () => {
            await page.goto('data:text/html,<div role="dialog"><span>Submit</span><span>Cancel</span></div>');

            const dialog = page.getByRole('dialog');
            const submitText = dialog.getByText('Submit');

            expect(await submitText.isVisible()).toBe(true);
            expect(await submitText.textContent()).toBe('Submit');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support getByRole().getByRole()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('getByRole().getByRole() works', async () => {
            await page.goto('data:text/html,<div role="dialog"><button>Save</button><button>Cancel</button></div>');

            const saveBtn = page.getByRole('dialog').getByRole('button', { name: 'Save' });

            expect(await saveBtn.isVisible()).toBe(true);
            expect(await saveBtn.textContent()).toBe('Save');
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

  describe("Issue 3: Locator chaining produces invalid selectors", () => {
    it("should handle locator().locator() chaining correctly", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('locator().locator() chaining works', async () => {
            await page.goto('data:text/html,<div role="dialog"><div class="content"><span>testuser</span></div></div>');

            // This previously produced invalid selector: [role="dialog"] .content
            const el = page.locator('[role="dialog"]').locator('.content').locator('span');

            expect(await el.isVisible()).toBe(true);
            expect(await el.textContent()).toBe('testuser');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should handle locator().getByText() chaining correctly", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('locator().getByText() chaining works', async () => {
            await page.goto('data:text/html,<div role="dialog"><span>testuser</span></div>');

            // This previously produced invalid selector: [role="dialog"] text=testuser
            const el = page.locator('[role="dialog"]').getByText('testuser');

            expect(await el.isVisible()).toBe(true);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should handle deeply nested locator chaining", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('deeply nested locator chaining', async () => {
            await page.goto('data:text/html,<div role="dialog"><form><label>Login<input type="text" /></label></form></div>');

            const input = page
              .getByRole('dialog')
              .locator('form')
              .getByLabel('Login');

            await input.fill('myuser');
            const value = await input.inputValue();
            expect(value).toBe('myuser');
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

  describe("Issue 4: page.evaluate with parameters returns undefined", () => {
    it("should pass parameters to page.evaluate correctly", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate with single parameter', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const key = 'test-api-key';
            const result = await page.evaluate((k) => {
              return { value: k };
            }, key);

            expect(result.value).toBe('test-api-key');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should pass object parameters to page.evaluate", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate with object parameter', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const config = { apiKey: 'secret', timeout: 5000 };
            const result = await page.evaluate((cfg) => {
              return { key: cfg.apiKey, time: cfg.timeout };
            }, config);

            expect(result.key).toBe('secret');
            expect(result.time).toBe(5000);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should pass array parameters to page.evaluate", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate with array parameter', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const items = ['a', 'b', 'c'];
            const result = await page.evaluate((arr) => {
              return arr.join('-');
            }, items);

            expect(result).toBe('a-b-c');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should work without parameters", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate without parameters', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const result = await page.evaluate(() => {
              return document.querySelector('h1').textContent;
            });

            expect(result).toBe('Test');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should work with async function and parameters", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate with async function and parameters', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const delay = 10;
            const result = await page.evaluate(async (ms) => {
              await new Promise(r => setTimeout(r, ms));
              return 'done';
            }, delay);

            expect(result).toBe('done');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should work with fetch inside page.evaluate and parameter passing", async () => {
      // Start a local server to simulate httpbin /headers endpoint
      const server = await import("node:http").then(http => {
        return new Promise<import("node:http").Server>((resolve) => {
          const srv = http.createServer((req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            if (req.method === "OPTIONS") {
              res.writeHead(204);
              res.end();
              return;
            }
            res.writeHead(200);
            res.end(JSON.stringify({
              headers: {
                Authorization: req.headers.authorization || "",
                "Content-Type": req.headers["content-type"] || "",
              }
            }));
          });
          srv.listen(0, "127.0.0.1", () => resolve(srv));
        });
      });
      const port = (server.address() as import("node:net").AddressInfo).port;

      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('page.evaluate with fetch and parameters', async () => {
            // Navigate to a page that allows fetch
            await page.goto('http://127.0.0.1:${port}/');

            const apiKey = 'test-bearer-token';
            const result = await page.evaluate(async (key) => {
              try {
                const response = await fetch('http://127.0.0.1:${port}/headers', {
                  method: 'GET',
                  headers: {
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/json',
                  },
                });

                const body = await response.json();
                return { status: response.status, body };
              } catch (err) {
                return { error: String(err) };
              }
            }, apiKey);

            // Verify result is defined and has expected structure
            expect(result).toBeDefined();
            expect(result.status).toBe(200);
            expect(result.body).toBeDefined();
            expect(result.body.headers).toBeDefined();
            expect(result.body.headers.Authorization).toBe('Bearer test-bearer-token');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
        server.close();
      }
    });
  });

  describe("Issue 5: filter({ has: locator }) throws frame error", () => {
    it("should support filter with has locator", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('filter with has locator', async () => {
            await page.goto('data:text/html,<div class="item"><span>Item 1</span></div><div class="item"><span>Item 2</span><button>Click</button></div>');

            const item = page.locator('.item').filter({ has: page.locator('button') });
            const text = await item.locator('span').textContent();
            expect(text).toBe('Item 2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support filter with hasNot locator", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) },
      });

      try {
        await runtime.eval(`
          test('filter with hasNot locator', async () => {
            await page.goto('data:text/html,<div class="item"><span>Item 1</span></div><div class="item"><span>Item 2</span><button>Click</button></div>');

            const item = page.locator('.item').filter({ hasNot: page.locator('button') });
            const text = await item.locator('span').textContent();
            expect(text).toBe('Item 1');
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
