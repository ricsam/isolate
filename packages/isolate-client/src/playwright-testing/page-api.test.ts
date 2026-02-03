/**
 * Tests for Playwright page API enhancements.
 * Covers keyboard, mouse, frames, cookies, emulation, and other page methods.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";

const TEST_SOCKET = "/tmp/isolate-test-page-api.sock";

describe("playwright page API enhancements", () => {
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

  describe("keyboard API", () => {
    it("should support keyboard.type()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('keyboard.type', async () => {
            await page.goto('data:text/html,<input id="input" />');

            await page.locator('#input').focus();
            await page.keyboard.type('Hello World');

            const value = await page.locator('#input').inputValue();
            expect(value).toBe('Hello World');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support keyboard.press()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('keyboard.press', async () => {
            await page.goto('data:text/html,<input id="input" value="test" />');

            await page.locator('#input').focus();
            // Use Meta+a on macOS, Control+a on other platforms
            await page.keyboard.press('Meta+a');
            await page.keyboard.press('Backspace');

            const value = await page.locator('#input').inputValue();
            expect(value).toBe('');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support keyboard.down() and keyboard.up()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('keyboard.down and keyboard.up', async () => {
            await page.goto('data:text/html,<div id="target" tabindex="0">Press keys</div><div id="result"></div>');

            // Add event listeners via evaluate
            await page.evaluate(() => {
              const target = document.getElementById("target")!;
              const result = document.getElementById("result")!;
              let shiftDown = false;
              target.addEventListener("keydown", (e) => {
                if (e.key === "Shift") shiftDown = true;
                result.textContent = "shift:" + shiftDown;
              });
              target.addEventListener("keyup", (e) => {
                if (e.key === "Shift") shiftDown = false;
                result.textContent = "shift:" + shiftDown;
              });
            });

            await page.locator('#target').focus();
            await page.keyboard.down('Shift');

            let result = await page.locator('#result').textContent();
            expect(result).toBe('shift:true');

            await page.keyboard.up('Shift');
            result = await page.locator('#result').textContent();
            expect(result).toBe('shift:false');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support keyboard.insertText()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('keyboard.insertText', async () => {
            await page.goto('data:text/html,<input id="input" />');

            await page.locator('#input').focus();
            await page.keyboard.insertText('Inserted text');

            const value = await page.locator('#input').inputValue();
            expect(value).toBe('Inserted text');
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

  describe("mouse API", () => {
    it("should support mouse.click()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('mouse.click', async () => {
            await page.goto('data:text/html,<button style="width:100px;height:50px;position:absolute;top:100px;left:100px" onclick="this.textContent=\\'clicked\\'">Click</button>');

            await page.mouse.click(150, 125); // Center of button

            const text = await page.locator('button').textContent();
            expect(text).toBe('clicked');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support mouse.move()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('mouse.move', async () => {
            await page.goto('data:text/html,<div id="target" style="width:200px;height:200px;background:%23ccc"></div><div id="coords"></div>');

            // Wait for the element to be present
            await page.locator('#target').waitFor();

            // Add event listener via evaluate
            await page.evaluate(() => {
              const target = document.getElementById("target");
              const coords = document.getElementById("coords");
              if (target && coords) {
                target.addEventListener("mousemove", (e) => {
                  coords.textContent = e.clientX + "," + e.clientY;
                });
              }
            });

            await page.mouse.move(100, 100);

            const coords = await page.locator('#coords').textContent();
            expect(coords).toBe('100,100');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support mouse.down() and mouse.up()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('mouse.down and mouse.up', async () => {
            await page.goto('data:text/html,<div id="result"></div>');

            // Add event listeners via evaluate
            await page.evaluate(() => {
              document.addEventListener("mousedown", () => { document.getElementById("result")!.textContent = "down"; });
              document.addEventListener("mouseup", () => { document.getElementById("result")!.textContent = "up"; });
            });

            await page.mouse.down();
            let result = await page.locator('#result').textContent();
            expect(result).toBe('down');

            await page.mouse.up();
            result = await page.locator('#result').textContent();
            expect(result).toBe('up');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support mouse.wheel()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('mouse.wheel', async () => {
            await page.goto('data:text/html,<div style="height:2000px">Scrollable content</div>');

            const scrollBefore = await page.evaluate(() => window.scrollY);
            expect(scrollBefore).toBe(0);

            await page.mouse.wheel(0, 500);
            await page.waitForTimeout(100);

            const scrollAfter = await page.evaluate(() => window.scrollY);
            expect(scrollAfter).toBeGreaterThan(0);
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

  describe("viewport and emulation", () => {
    it("should support setViewportSize()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('setViewportSize', async () => {
            await page.goto('data:text/html,<div id="size"></div><script>document.getElementById("size").textContent=window.innerWidth+"x"+window.innerHeight</script>');

            await page.setViewportSize({ width: 800, height: 600 });
            await page.reload();

            const size = await page.locator('#size').textContent();
            expect(size).toBe('800x600');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support viewportSize()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('viewportSize', async () => {
            await page.setViewportSize({ width: 1024, height: 768 });

            const size = await page.viewportSize();
            expect(size.width).toBe(1024);
            expect(size.height).toBe(768);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support emulateMedia()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('emulateMedia', async () => {
            await page.goto('data:text/html,<style>@media print { body { background: red; } }</style><body></body>');

            await page.emulateMedia({ media: 'print' });

            const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
            expect(bgColor).toBe('rgb(255, 0, 0)');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support emulateMedia with colorScheme", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('emulateMedia colorScheme', async () => {
            await page.goto('data:text/html,<style>@media (prefers-color-scheme: dark) { body { background: black; } }</style><body></body>');

            await page.emulateMedia({ colorScheme: 'dark' });

            const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
            expect(bgColor).toBe('rgb(0, 0, 0)');
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

  describe("cookies API", () => {
    it("should support addCookies()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('addCookies', async () => {
            await page.goto('https://example.com');

            await page.context().addCookies([
              { name: 'test_cookie', value: 'test_value', domain: 'example.com', path: '/' }
            ]);

            const cookies = await page.context().cookies();
            const testCookie = cookies.find(c => c.name === 'test_cookie');
            expect(testCookie).toBeDefined();
            expect(testCookie.value).toBe('test_value');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support cookies()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('cookies', async () => {
            await page.goto('https://example.com');

            await page.context().addCookies([
              { name: 'cookie1', value: 'value1', domain: 'example.com', path: '/' },
              { name: 'cookie2', value: 'value2', domain: 'example.com', path: '/' }
            ]);

            const cookies = await page.context().cookies();
            expect(cookies.length).toBeGreaterThanOrEqual(2);

            const names = cookies.map(c => c.name);
            expect(names).toContain('cookie1');
            expect(names).toContain('cookie2');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support clearCookies()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('clearCookies', async () => {
            await page.goto('https://example.com');

            await page.context().addCookies([
              { name: 'test', value: 'value', domain: 'example.com', path: '/' }
            ]);

            let cookies = await page.context().cookies();
            expect(cookies.some(c => c.name === 'test')).toBe(true);

            await page.context().clearCookies();

            cookies = await page.context().cookies();
            expect(cookies.some(c => c.name === 'test')).toBe(false);
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

  describe("frames API", () => {
    it("should support frames()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('frames', async () => {
            await page.goto('data:text/html,<iframe name="child" src="about:blank"></iframe>');

            const frames = await page.frames();
            expect(frames.length).toBeGreaterThanOrEqual(2); // main + iframe

            const names = frames.map(f => f.name);
            expect(names).toContain('child');
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support mainFrame()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('mainFrame', async () => {
            await page.goto('data:text/html,<h1>Main Frame</h1>');

            const mainFrame = await page.mainFrame();
            expect(mainFrame).toBeDefined();
            expect(mainFrame.url).toContain('data:text/html');
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

  describe("page lifecycle", () => {
    it("should support bringToFront()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('bringToFront', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            // Should not throw
            await page.bringToFront();

            expect(true).toBe(true);
          });
        `);

        const results = await runtime.testEnvironment.runTests();
        assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      } finally {
        await runtime.dispose();
        await browser.close();
      }
    });

    it("should support isClosed()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('isClosed', async () => {
            await page.goto('data:text/html,<h1>Test</h1>');

            const isClosed = await page.isClosed();
            expect(isClosed).toBe(false);
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

  describe("extra HTTP headers", () => {
    it("should support setExtraHTTPHeaders()", async () => {
      const browser = await chromium.launch({ headless: true });
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();

      const runtime = await client.createRuntime({
        testEnvironment: true,
        playwright: { page },
      });

      try {
        await runtime.eval(`
          test('setExtraHTTPHeaders', async () => {
            await page.setExtraHTTPHeaders({
              'X-Custom-Header': 'custom-value'
            });

            // Navigate to a page - the header would be sent
            await page.goto('data:text/html,<h1>Test</h1>');

            // Just verify it doesn't throw
            expect(true).toBe(true);
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
