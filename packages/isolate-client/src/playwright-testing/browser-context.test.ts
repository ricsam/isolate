/**
 * Tests for Playwright browser/context/page lifecycle management.
 * Covers creating new pages via context.newPage(), new contexts via browser.newContext(),
 * and working with multiple pages simultaneously.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-browser-context.sock";

describe("playwright browser/context/page lifecycle", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let browser: Browser;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser.close();
    await client.close();
    await daemon.close();
  });

  describe("context.newPage()", () => {
    it("should create new page via createPage callback", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();
      const createdPages: Page[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async (contextId) => {
            const newPage = await browserContext.newPage();
            createdPages.push(newPage);
            return newPage;
          } }) },
      });

      try {
        await runtime.eval(`
          test('context.newPage creates new page', async () => {
            const newPage = await page.context().newPage();
            await newPage.goto('data:text/html,<h1>New Page</h1>');
            const title = await newPage.evaluate(() => document.body.innerHTML);
            expect(title).toContain('New Page');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
        assert.strictEqual(createdPages.length, 1, "Expected createPage callback to be called once");
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should track pages independently", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('pages track URLs independently', async () => {
            // Navigate initial page
            await page.goto('data:text/html,<h1>Page 1</h1>');

            // Create and navigate new page
            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<h1>Page 2</h1>');

            // Verify each page has its own URL
            expect(page.url()).toContain('Page 1');
            expect(page2.url()).toContain('Page 2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("browser.newContext()", () => {
    it("should create new context via createContext callback", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (contextId) => {
            // For new contexts, create page in the most recent context
            const ctx = createdContexts[createdContexts.length - 1] || initialContext;
            return await ctx.newPage();
          } }) },
      });

      try {
        await runtime.eval(`
          test('browser.newContext creates new context', async () => {
            const ctx = await browser.newContext();
            const newPage = await ctx.newPage();
            await newPage.goto('data:text/html,<h1>Context Test</h1>');
            expect(newPage.url()).toContain('data:text/html');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
        assert.strictEqual(createdContexts.length, 1, "Expected createContext callback to be called once");
      } finally {
        await runtime.dispose();
        for (const ctx of createdContexts) await ctx.close();
        await initialContext.close();
      }
    });

    it("should isolate cookies between contexts", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (contextId) => {
            const ctx = createdContexts[createdContexts.length - 1] || initialContext;
            return await ctx.newPage();
          } }) },
      });

      try {
        await runtime.eval(`
          test('cookies are isolated between contexts', async () => {
            // Add cookie to initial context
            await page.goto('https://example.com');
            await page.context().addCookies([
              { name: 'ctx1_cookie', value: 'value1', domain: 'example.com', path: '/' }
            ]);

            // Create new context and page
            const ctx2 = await browser.newContext();
            const page2 = await ctx2.newPage();
            await page2.goto('https://example.com');

            // Verify cookies are isolated
            const ctx1Cookies = await page.context().cookies();
            const ctx2Cookies = await ctx2.cookies();

            expect(ctx1Cookies.some(c => c.name === 'ctx1_cookie')).toBe(true);
            expect(ctx2Cookies.some(c => c.name === 'ctx1_cookie')).toBe(false);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        for (const ctx of createdContexts) await ctx.close();
        await initialContext.close();
      }
    });
  });

  describe("multiple pages", () => {
    it("should work with multiple pages simultaneously", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('multiple pages work independently', async () => {
            const page2 = await page.context().newPage();

            await page.goto('data:text/html,<h1>Page 1</h1>');
            await page2.goto('data:text/html,<h1>Page 2</h1>');

            expect(page.url()).toContain('Page 1');
            expect(page2.url()).toContain('Page 2');

            await page2.close();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support locator operations on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('locators work on different pages', async () => {
            await page.goto('data:text/html,<button id="btn">Page 1 Button</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<button id="btn">Page 2 Button</button>');

            const text1 = await page.locator('#btn').textContent();
            const text2 = await page2.locator('#btn').textContent();

            expect(text1).toBe('Page 1 Button');
            expect(text2).toBe('Page 2 Button');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support evaluate on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('evaluate works on different pages', async () => {
            await page.goto('data:text/html,<script>window.pageId = 1;</script>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<script>window.pageId = 2;</script>');

            const id1 = await page.evaluate(() => window.pageId);
            const id2 = await page2.evaluate(() => window.pageId);

            expect(id1).toBe(1);
            expect(id2).toBe(2);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("global context object", () => {
    it("should provide global context with newPage method", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('global context has newPage', async () => {
            const newPage = await context.newPage();
            await newPage.goto('data:text/html,<h1>From Context</h1>');
            expect(newPage.url()).toContain('data:text/html');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should provide global context with cookie methods", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage) },
      });

      try {
        await runtime.eval(`
          test('global context has cookie methods', async () => {
            await page.goto('https://example.com');

            await context.addCookies([
              { name: 'test', value: 'value', domain: 'example.com', path: '/' }
            ]);

            const cookies = await context.cookies();
            expect(cookies.some(c => c.name === 'test')).toBe(true);

            await context.clearCookies();

            const clearedCookies = await context.cookies();
            expect(clearedCookies.some(c => c.name === 'test')).toBe(false);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  // ===========================================
  // PHASE 1 - Critical Tests
  // ===========================================

  describe("page lifecycle", () => {
    it("should close dynamically created page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('page.close() on dynamically created page', async () => {
            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<h1>Page 2</h1>');
            expect(page2.url()).toContain('Page 2');

            await page2.close();
            // After close, operations should fail
            let error = null;
            try {
              await page2.title();
            } catch (e) {
              error = e;
            }
            expect(error).not.toBeNull();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should fail gracefully on operations on closed page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('operations on closed page should fail gracefully', async () => {
            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<h1>Page 2</h1>');
            await page2.close();

            let error = null;
            try {
              await page2.goto('data:text/html,<h1>Should Fail</h1>');
            } catch (e) {
              error = e;
            }
            expect(error).not.toBeNull();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should allow remaining pages to work after one is closed", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('remaining pages work after one is closed', async () => {
            await page.goto('data:text/html,<h1>Page 1</h1>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<h1>Page 2</h1>');

            const page3 = await page.context().newPage();
            await page3.goto('data:text/html,<h1>Page 3</h1>');

            // Close page2
            await page2.close();

            // page and page3 should still work
            const content1 = await page.locator('h1').textContent();
            const content3 = await page3.locator('h1').textContent();

            expect(content1).toBe('Page 1');
            expect(content3).toBe('Page 3');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("context lifecycle", () => {
    it("should close all pages when context is closed", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (contextId) => {
            const ctx = createdContexts[createdContexts.length - 1] || initialContext;
            return await ctx.newPage();
          } }) },
      });

      try {
        await runtime.eval(`
          test('context.close() closes all pages in context', async () => {
            const ctx = await browser.newContext();
            const p1 = await ctx.newPage();
            const p2 = await ctx.newPage();

            await p1.goto('data:text/html,<h1>P1</h1>');
            await p2.goto('data:text/html,<h1>P2</h1>');

            // Pages should work before close
            expect(await p1.locator('h1').textContent()).toBe('P1');
            expect(await p2.locator('h1').textContent()).toBe('P2');

            await ctx.close();

            // After context close, pages should fail
            let error1 = null;
            let error2 = null;
            try {
              await p1.title();
            } catch (e) {
              error1 = e;
            }
            try {
              await p2.title();
            } catch (e) {
              error2 = e;
            }
            expect(error1).not.toBeNull();
            expect(error2).not.toBeNull();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await initialContext.close();
      }
    });

    it("should fail gracefully on operations on closed context", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (contextId) => {
            const ctx = createdContexts[createdContexts.length - 1] || initialContext;
            return await ctx.newPage();
          } }) },
      });

      try {
        await runtime.eval(`
          test('operations on closed context should fail gracefully', async () => {
            const ctx = await browser.newContext();
            await ctx.close();

            let error = null;
            try {
              await ctx.newPage();
            } catch (e) {
              error = e;
            }
            expect(error).not.toBeNull();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await initialContext.close();
      }
    });
  });

  describe("expect matchers on different pages", () => {
    it("should support toBeVisible / toBeHidden", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toBeVisible and toBeHidden on different pages', async () => {
            await page.goto('data:text/html,<div id="visible">Visible</div><div id="hidden" style="display:none">Hidden</div>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<span id="visible2">Visible2</span><span id="hidden2" style="visibility:hidden">Hidden2</span>');

            await expect(page.locator('#visible')).toBeVisible();
            await expect(page.locator('#hidden')).toBeHidden();

            await expect(page2.locator('#visible2')).toBeVisible();
            await expect(page2.locator('#hidden2')).toBeHidden();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support toHaveText / toContainText", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toHaveText and toContainText on different pages', async () => {
            await page.goto('data:text/html,<p id="text">Hello World</p>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<p id="text2">Goodbye World</p>');

            await expect(page.locator('#text')).toHaveText('Hello World');
            await expect(page.locator('#text')).toContainText('Hello');

            await expect(page2.locator('#text2')).toHaveText('Goodbye World');
            await expect(page2.locator('#text2')).toContainText('Goodbye');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support toHaveAttribute", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toHaveAttribute on different pages', async () => {
            await page.goto('data:text/html,<a id="link" href="https://example.com" target="_blank">Link</a>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<img id="img" src="test.png" alt="Test Image">');

            await expect(page.locator('#link')).toHaveAttribute('href', 'https://example.com');
            await expect(page.locator('#link')).toHaveAttribute('target', '_blank');

            await expect(page2.locator('#img')).toHaveAttribute('src', 'test.png');
            await expect(page2.locator('#img')).toHaveAttribute('alt', 'Test Image');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support toBeEnabled / toBeDisabled", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toBeEnabled and toBeDisabled on different pages', async () => {
            await page.goto('data:text/html,<button id="enabled">Enabled</button><button id="disabled" disabled>Disabled</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="input-enabled" type="text"><input id="input-disabled" type="text" disabled>');

            await expect(page.locator('#enabled')).toBeEnabled();
            await expect(page.locator('#disabled')).toBeDisabled();

            await expect(page2.locator('#input-enabled')).toBeEnabled();
            await expect(page2.locator('#input-disabled')).toBeDisabled();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support negated matchers", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('negated matchers on different pages', async () => {
            await page.goto('data:text/html,<div id="hidden" style="display:none">Hidden</div><button id="disabled" disabled>Disabled</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<p id="text">Hello</p>');

            await expect(page.locator('#hidden')).not.toBeVisible();
            await expect(page.locator('#disabled')).not.toBeEnabled();

            await expect(page2.locator('#text')).not.toBeHidden();
            await expect(page2.locator('#text')).not.toHaveText('Goodbye');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("page-level assertions", () => {
    it("should support toHaveURL on new page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toHaveURL on new page', async () => {
            await page.goto('https://example.com/');

            const page2 = await page.context().newPage();
            await page2.goto('https://example.org/');

            await expect(page).toHaveURL(/example\\.com/);
            await expect(page2).toHaveURL(/example\\.org/);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support toHaveTitle on new page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('toHaveTitle on new page', async () => {
            await page.goto('data:text/html,<title>Page One</title><body>1</body>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<title>Page Two</title><body>2</body>');

            await expect(page).toHaveTitle('Page One');
            await expect(page2).toHaveTitle('Page Two');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  // ===========================================
  // PHASE 2 - Important Tests
  // ===========================================

  describe("actions on different pages", () => {
    it("should support fill and click on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('fill and click on different pages', async () => {
            await page.goto('data:text/html,<input id="input1" type="text"><button id="btn1" onclick="document.getElementById(\\'input1\\').value=\\'clicked\\'">Click</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="input2" type="text"><button id="btn2" onclick="document.getElementById(\\'input2\\').value=\\'clicked2\\'">Click2</button>');

            await page.locator('#input1').fill('test1');
            await page2.locator('#input2').fill('test2');

            expect(await page.locator('#input1').inputValue()).toBe('test1');
            expect(await page2.locator('#input2').inputValue()).toBe('test2');

            await page.locator('#btn1').click();
            await page2.locator('#btn2').click();

            expect(await page.locator('#input1').inputValue()).toBe('clicked');
            expect(await page2.locator('#input2').inputValue()).toBe('clicked2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support check and uncheck on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('check and uncheck on different pages', async () => {
            await page.goto('data:text/html,<input id="cb1" type="checkbox"><label for="cb1">Check 1</label>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="cb2" type="checkbox" checked><label for="cb2">Check 2</label>');

            await page.locator('#cb1').check();
            await page2.locator('#cb2').uncheck();

            expect(await page.locator('#cb1').isChecked()).toBe(true);
            expect(await page2.locator('#cb2').isChecked()).toBe(false);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support selectOption on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('selectOption on different pages', async () => {
            await page.goto('data:text/html,<select id="select1"><option value="a">A</option><option value="b">B</option></select>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<select id="select2"><option value="x">X</option><option value="y">Y</option></select>');

            await page.locator('#select1').selectOption('b');
            await page2.locator('#select2').selectOption('y');

            expect(await page.locator('#select1').inputValue()).toBe('b');
            expect(await page2.locator('#select2').inputValue()).toBe('y');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support type and hover on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('type and hover on different pages', async () => {
            await page.goto('data:text/html,<input id="input1" type="text"><div id="hover1" onmouseover="this.textContent=\\'hovered\\'">Hover me</div>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="input2" type="text"><div id="hover2" onmouseover="this.textContent=\\'hovered2\\'">Hover me 2</div>');

            await page.locator('#input1').type('typed1');
            await page2.locator('#input2').type('typed2');

            expect(await page.locator('#input1').inputValue()).toBe('typed1');
            expect(await page2.locator('#input2').inputValue()).toBe('typed2');

            await page.locator('#hover1').hover();
            await page2.locator('#hover2').hover();

            expect(await page.locator('#hover1').textContent()).toBe('hovered');
            expect(await page2.locator('#hover2').textContent()).toBe('hovered2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support focus on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('focus on different pages', async () => {
            await page.goto('data:text/html,<input id="input1" type="text" onfocus="this.value=\\'focused1\\'">');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="input2" type="text" onfocus="this.value=\\'focused2\\'">');

            await page.locator('#input1').focus();
            await page2.locator('#input2').focus();

            expect(await page.locator('#input1').inputValue()).toBe('focused1');
            expect(await page2.locator('#input2').inputValue()).toBe('focused2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("keyboard and mouse on different pages", () => {
    it("should support keyboard.type and keyboard.press on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('keyboard operations on different pages', async () => {
            await page.goto('data:text/html,<input id="input1" type="text">');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<input id="input2" type="text">');

            await page.locator('#input1').click();
            await page.keyboard.type('hello');

            await page2.locator('#input2').click();
            await page2.keyboard.type('world');
            await page2.keyboard.press('Backspace');

            expect(await page.locator('#input1').inputValue()).toBe('hello');
            expect(await page2.locator('#input2').inputValue()).toBe('worl');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support mouse.click and mouse.move on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('mouse operations on different pages', async () => {
            await page.goto('data:text/html,<button id="btn1" style="position:absolute;left:50px;top:50px;width:100px;height:50px" onclick="this.textContent=\\'clicked\\'">Click</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<div id="target" style="position:absolute;left:100px;top:100px;width:100px;height:100px" onmousemove="this.textContent=\\'moved\\'">Move</div>');

            await page.mouse.click(100, 75); // Click on btn1
            await page2.mouse.move(150, 150); // Move over target

            expect(await page.locator('#btn1').textContent()).toBe('clicked');
            expect(await page2.locator('#target').textContent()).toBe('moved');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("page methods on new pages", () => {
    it("should support title and content on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('title and content on different pages', async () => {
            await page.goto('data:text/html,<title>Title 1</title><body>Content 1</body>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<title>Title 2</title><body>Content 2</body>');

            expect(await page.title()).toBe('Title 1');
            expect(await page2.title()).toBe('Title 2');

            expect(await page.content()).toContain('Content 1');
            expect(await page2.content()).toContain('Content 2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support reload on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('reload on different pages', async () => {
            await page.goto('data:text/html,<div id="counter">0</div><script>document.getElementById("counter").textContent = Math.random();</script>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<div id="counter2">0</div><script>document.getElementById("counter2").textContent = Math.random();</script>');

            const val1Before = await page.locator('#counter').textContent();
            const val2Before = await page2.locator('#counter2').textContent();

            await page.reload();
            await page2.reload();

            const val1After = await page.locator('#counter').textContent();
            const val2After = await page2.locator('#counter2').textContent();

            // After reload, values should change (random)
            expect(val1Before).not.toBe(val1After);
            expect(val2Before).not.toBe(val2After);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should update page.url() after history.pushState on same document", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('page.url updates after history.pushState', async () => {
            await page.goto('data:text/html,<h1>History Test</h1>');

            const before = page.url();
            await page.evaluate(() => {
              history.pushState({}, '', '#route-a');
            });
            const after = page.url();

            expect(before.includes('#route-a')).toBe(false);
            expect(after).toContain('#route-a');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support goBack and goForward on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('goBack and goForward on different pages', async () => {
            await page.goto('data:text/html,<h1>Page1-A</h1>');
            await page.goto('data:text/html,<h1>Page1-B</h1>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<h1>Page2-A</h1>');
            await page2.goto('data:text/html,<h1>Page2-B</h1>');

            await page.goBack();
            await page2.goBack();

            expect(page.url()).toContain('Page1-A');
            expect(page2.url()).toContain('Page2-A');

            await page.goForward();
            await page2.goForward();

            expect(page.url()).toContain('Page1-B');
            expect(page2.url()).toContain('Page2-B');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support waitForURL on different pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('waitForURL on different pages', async () => {
            await page.goto('data:text/html,<a id="link1" href="https://example.com">Go</a>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<a id="link2" href="https://example.org">Go</a>');

            // Navigate and wait
            await Promise.all([
              page.waitForURL(/example\\.com/),
              page.locator('#link1').click()
            ]);

            await Promise.all([
              page2.waitForURL(/example\\.org/),
              page2.locator('#link2').click()
            ]);

            expect(page.url()).toContain('example.com');
            expect(page2.url()).toContain('example.org');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("viewport and emulation", () => {
    it("should support setViewportSize independently per page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('setViewportSize independently per page', async () => {
            await page.goto('data:text/html,<div id="size"></div><script>document.getElementById("size").textContent = window.innerWidth + "x" + window.innerHeight;</script>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<div id="size"></div><script>document.getElementById("size").textContent = window.innerWidth + "x" + window.innerHeight;</script>');

            await page.setViewportSize({ width: 800, height: 600 });
            await page2.setViewportSize({ width: 1024, height: 768 });

            // Need to reload or evaluate to get new sizes
            const size1 = await page.evaluate(() => window.innerWidth + 'x' + window.innerHeight);
            const size2 = await page2.evaluate(() => window.innerWidth + 'x' + window.innerHeight);

            expect(size1).toBe('800x600');
            expect(size2).toBe('1024x768');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support emulateMedia independently per page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('emulateMedia independently per page', async () => {
            await page.goto('data:text/html,<div id="media"></div>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<div id="media"></div>');

            await page.emulateMedia({ colorScheme: 'dark' });
            await page2.emulateMedia({ colorScheme: 'light' });

            const scheme1 = await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
            const scheme2 = await page2.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches);

            expect(scheme1).toBe(true);
            expect(scheme2).toBe(true);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("screenshots", () => {
    it("should take page screenshot targeting correct page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('page screenshot targets correct page', async () => {
            await page.goto('data:text/html,<body style="background:red;width:100px;height:100px"></body>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<body style="background:blue;width:100px;height:100px"></body>');

            const screenshot1 = await page.screenshot();
            const screenshot2 = await page2.screenshot();

            // Screenshots should return data
            expect(screenshot1).toBeTruthy();
            expect(screenshot2).toBeTruthy();
            // Screenshots should have length (byte data)
            expect(screenshot1.length).toBeGreaterThan(0);
            expect(screenshot2.length).toBeGreaterThan(0);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should take locator screenshot targeting correct page", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('locator screenshot targets correct page', async () => {
            await page.goto('data:text/html,<div id="box" style="background:green;width:50px;height:50px"></div>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<div id="box" style="background:yellow;width:50px;height:50px"></div>');

            const screenshot1 = await page.locator('#box').screenshot();
            const screenshot2 = await page2.locator('#box').screenshot();

            // Screenshots should return data
            expect(screenshot1).toBeTruthy();
            expect(screenshot2).toBeTruthy();
            // Screenshots should have length (byte data)
            expect(screenshot1.length).toBeGreaterThan(0);
            expect(screenshot2.length).toBeGreaterThan(0);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  // ===========================================
  // PHASE 3 - Complete Coverage
  // ===========================================

  describe("getBy locators on new pages", () => {
    it("should support getByRole on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('getByRole on new pages', async () => {
            await page.goto('data:text/html,<button>Submit Form</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<button>Cancel Action</button>');

            const btn1 = page.getByRole('button', { name: 'Submit Form' });
            const btn2 = page2.getByRole('button', { name: 'Cancel Action' });

            await expect(btn1).toBeVisible();
            await expect(btn2).toBeVisible();
            expect(await btn1.textContent()).toBe('Submit Form');
            expect(await btn2.textContent()).toBe('Cancel Action');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support getByText on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('getByText on new pages', async () => {
            await page.goto('data:text/html,<p>Welcome to Page 1</p>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<p>Welcome to Page 2</p>');

            const text1 = page.getByText('Welcome to Page 1');
            const text2 = page2.getByText('Welcome to Page 2');

            await expect(text1).toBeVisible();
            await expect(text2).toBeVisible();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support getByLabel on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('getByLabel on new pages', async () => {
            await page.goto('data:text/html,<label for="email1">Email Address</label><input id="email1" type="email">');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<label for="phone2">Phone Number</label><input id="phone2" type="tel">');

            const input1 = page.getByLabel('Email Address');
            const input2 = page2.getByLabel('Phone Number');

            await input1.fill('test@example.com');
            await input2.fill('123-456-7890');

            expect(await input1.inputValue()).toBe('test@example.com');
            expect(await input2.inputValue()).toBe('123-456-7890');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("locator chaining", () => {
    it("should support filter and nth on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('filter and nth on new pages', async () => {
            await page.goto('data:text/html,<ul><li class="item">A</li><li class="item active">B</li><li class="item">C</li></ul>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<ul><li class="item">X</li><li class="item">Y</li><li class="item active">Z</li></ul>');

            const activeOnPage1 = page.locator('.item').filter({ hasText: 'B' });
            const secondOnPage2 = page2.locator('.item').nth(1);

            expect(await activeOnPage1.textContent()).toBe('B');
            expect(await secondOnPage2.textContent()).toBe('Y');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should support and/or locator operations on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('and/or locator operations on new pages', async () => {
            await page.goto('data:text/html,<button class="primary">Save</button><button class="secondary">Cancel</button>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<button class="primary">Submit</button><button class="secondary">Reset</button>');

            // Using and() to combine locators
            const primarySave = page.locator('button').and(page.locator('.primary'));
            const secondaryReset = page2.locator('button').and(page2.locator('.secondary'));

            expect(await primarySave.textContent()).toBe('Save');
            expect(await secondaryReset.textContent()).toBe('Reset');

            // Using or() to match either
            const anyButton1 = page.locator('.primary').or(page.locator('.secondary')).first();
            const anyButton2 = page2.locator('.primary').or(page2.locator('.secondary')).first();

            await expect(anyButton1).toBeVisible();
            await expect(anyButton2).toBeVisible();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("frameLocator on different pages", () => {
    it("should support frameLocator on new pages", async () => {
      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('frameLocator on new pages', async () => {
            await page.goto('data:text/html,<iframe id="frame1" srcdoc="<button>Frame1 Button</button>"></iframe>');

            const page2 = await page.context().newPage();
            await page2.goto('data:text/html,<iframe id="frame2" srcdoc="<button>Frame2 Button</button>"></iframe>');

            const frame1Btn = page.frameLocator('#frame1').locator('button');
            const frame2Btn = page2.frameLocator('#frame2').locator('button');

            await expect(frame1Btn).toBeVisible();
            await expect(frame2Btn).toBeVisible();

            expect(await frame1Btn.textContent()).toBe('Frame1 Button');
            expect(await frame2Btn.textContent()).toBe('Frame2 Button');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });

  describe("page.request on different pages", () => {
    it("should support page.request.get on different pages", async () => {
      // Use a local HTTP server instead of external HTTPS sites to avoid SSL issues
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: req.url }));
      });
      await new Promise<void>((resolve) => srv.listen(0, resolve));
      const port = (srv.address() as { port: number }).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const browserContext = await browser.newContext();
      const initialPage = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createPage: async () => await browserContext.newPage() }) },
      });

      try {
        await runtime.eval(`
          test('page.request.get on different pages', async () => {
            await page.goto('${baseUrl}/page1');

            const page2 = await page.context().newPage();
            await page2.goto('${baseUrl}/page2');

            const response1 = await page.request.get('${baseUrl}/api1');
            const response2 = await page2.request.get('${baseUrl}/api2');

            expect(response1.ok()).toBe(true);
            expect(response2.ok()).toBe(true);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
        srv.close();
      }
    });
  });

  describe("multiple contexts with multiple pages", () => {
    it("should work with multiple contexts each having multiple pages", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];
      const contextPageMap = new Map<string, Page[]>();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (context) => {
            // Create page in the provided context
            const newPage = await context.newPage();
            return newPage;
          } }) },
      });

      try {
        await runtime.eval(`
          test('multiple contexts with multiple pages', async () => {
            // Create first new context with 2 pages
            const ctx1 = await browser.newContext();
            const ctx1Page1 = await ctx1.newPage();
            const ctx1Page2 = await ctx1.newPage();

            // Create second new context with 2 pages
            const ctx2 = await browser.newContext();
            const ctx2Page1 = await ctx2.newPage();
            const ctx2Page2 = await ctx2.newPage();

            // Navigate all pages
            await ctx1Page1.goto('data:text/html,<h1>C1P1</h1>');
            await ctx1Page2.goto('data:text/html,<h1>C1P2</h1>');
            await ctx2Page1.goto('data:text/html,<h1>C2P1</h1>');
            await ctx2Page2.goto('data:text/html,<h1>C2P2</h1>');

            // Verify all pages have correct content
            expect(await ctx1Page1.locator('h1').textContent()).toBe('C1P1');
            expect(await ctx1Page2.locator('h1').textContent()).toBe('C1P2');
            expect(await ctx2Page1.locator('h1').textContent()).toBe('C2P1');
            expect(await ctx2Page2.locator('h1').textContent()).toBe('C2P2');

            // Clean up
            await ctx1.close();
            await ctx2.close();
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await initialContext.close();
      }
    });
  });

  describe("contextId in createPage callback", () => {
    it("should pass correct context to createPage callback", async () => {
      const initialContext = await browser.newContext();
      const initialPage = await initialContext.newPage();
      const createdContexts: BrowserContext[] = [];
      const receivedContexts: BrowserContext[] = [];

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(initialPage, { createContext: async (options) => {
            const ctx = await browser.newContext(options);
            createdContexts.push(ctx);
            return ctx;
          }, createPage: async (context) => {
            receivedContexts.push(context);
            return await context.newPage();
          } }) },
      });

      try {
        await runtime.eval(`
          test('contextId passed correctly to createPage callback', async () => {
            // Create page in initial context
            const page1 = await page.context().newPage();
            await page1.goto('data:text/html,<h1>Initial Context Page</h1>');

            // Create new context and page in it
            const ctx = await browser.newContext();
            const page2 = await ctx.newPage();
            await page2.goto('data:text/html,<h1>New Context Page</h1>');

            expect(await page1.locator('h1').textContent()).toBe('Initial Context Page');
            expect(await page2.locator('h1').textContent()).toBe('New Context Page');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
        // Verify that createPage was called with context objects
        assert.strictEqual(receivedContexts.length, 2, "Expected createPage to be called twice");
        // First call should be for the initial context
        assert.strictEqual(receivedContexts[0], initialContext, "First createPage call should receive initial context");
        // Second call should be for the new context
        assert.strictEqual(receivedContexts[1], createdContexts[0], "Second createPage call should receive the new context");
      } finally {
        await runtime.dispose();
        for (const ctx of createdContexts) await ctx.close();
        await initialContext.close();
      }
    });
  });

  describe("error handling", () => {
    it("should error when createPage not provided", async () => {
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) }, // No createPage callback
      });

      try {
        await runtime.eval(`
          test('newPage fails without callback', async () => {
            let error = null;
            try {
              await page.context().newPage();
            } catch (e) {
              error = e;
            }
            expect(error).not.toBeNull();
            expect(error.message).toContain('createPage');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });

    it("should error when createContext not provided", async () => {
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { handler: defaultPlaywrightHandler(page) }, // No createContext callback
      });

      try {
        await runtime.eval(`
          test('newContext fails without callback', async () => {
            let error = null;
            try {
              await browser.newContext();
            } catch (e) {
              error = e;
            }
            expect(error).not.toBeNull();
            expect(error.message).toContain('createContext');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browserContext.close();
      }
    });
  });
});
