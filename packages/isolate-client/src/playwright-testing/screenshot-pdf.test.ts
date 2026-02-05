/**
 * Tests for Playwright screenshot and PDF functionality with security callbacks.
 * Verifies that screenshot()/pdf() work with writeFile callback for controlled file access.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-screenshot-pdf.sock";

describe("playwright screenshot and pdf with security callbacks", () => {
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

  it("should take page screenshot and return base64", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('page screenshot returns base64', async () => {
          await page.goto('data:text/html,<h1>Hello Screenshot</h1>');

          const base64 = await page.screenshot();

          // Should be a valid base64 string (PNG starts with specific bytes)
          expect(typeof base64).toBe('string');
          expect(base64.length).toBeGreaterThan(100);

          // Decode and check PNG magic bytes
          const binaryString = atob(base64);
          // PNG files start with 0x89 0x50 0x4E 0x47
          expect(binaryString.charCodeAt(0)).toBe(0x89);
          expect(binaryString.charCodeAt(1)).toBe(0x50);
          expect(binaryString.charCodeAt(2)).toBe(0x4E);
          expect(binaryString.charCodeAt(3)).toBe(0x47);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should take locator screenshot and return base64", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('locator screenshot returns base64', async () => {
          await page.goto('data:text/html,<div id="target" style="width:100px;height:100px;background:red;">Target</div>');

          const base64 = await page.locator('#target').screenshot();

          expect(typeof base64).toBe('string');
          expect(base64.length).toBeGreaterThan(100);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should use writeFile callback when screenshot path is provided", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const writtenFiles: { path: string; size: number }[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page, { writeFile: async (filePath: string, data: Buffer) => {
          writtenFiles.push({ path: filePath, size: data.length });
        } }) },
    });

    try {
      await runtime.eval(`
        test('screenshot with path uses writeFile callback', async () => {
          await page.goto('data:text/html,<h1>Screenshot Test</h1>');

          const base64 = await page.screenshot({ path: '/screenshots/test.png' });

          // Should still return base64
          expect(typeof base64).toBe('string');
          expect(base64.length).toBeGreaterThan(100);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);

      // Verify writeFile was called
      assert.strictEqual(writtenFiles.length, 1);
      assert.strictEqual(writtenFiles[0]!.path, '/screenshots/test.png');
      assert.ok(writtenFiles[0]!.size > 100, 'Screenshot should have reasonable size');
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should throw error when screenshot path is used without writeFile callback", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    // No writeFile callback provided
    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('screenshot with path fails without writeFile callback', async () => {
          await page.goto('data:text/html,<h1>Test</h1>');

          let error: Error | null = null;
          try {
            await page.screenshot({ path: '/screenshots/test.png' });
          } catch (e) {
            error = e as Error;
          }
          expect(error).not.toBeNull();
          expect(error!.message).toContain('writeFile callback');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support screenshot options (fullPage, type, quality)", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('screenshot with options', async () => {
          await page.goto('data:text/html,<div style="height:2000px;background:linear-gradient(red,blue);">Tall content</div>');

          // Full page screenshot
          const fullPage = await page.screenshot({ fullPage: true });
          expect(fullPage.length).toBeGreaterThan(100);

          // JPEG format with quality
          const jpeg = await page.screenshot({ type: 'jpeg', quality: 50 });
          expect(jpeg.length).toBeGreaterThan(100);

          // Check JPEG magic bytes (0xFF 0xD8 0xFF)
          const jpegBinaryString = atob(jpeg);
          expect(jpegBinaryString.charCodeAt(0)).toBe(0xFF);
          expect(jpegBinaryString.charCodeAt(1)).toBe(0xD8);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should use writeFile callback for locator screenshot with path", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const writtenFiles: { path: string; size: number }[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page, { writeFile: async (filePath: string, data: Buffer) => {
          writtenFiles.push({ path: filePath, size: data.length });
        } }) },
    });

    try {
      await runtime.eval(`
        test('locator screenshot with path uses writeFile callback', async () => {
          await page.goto('data:text/html,<button id="btn">Click me</button>');

          const base64 = await page.locator('#btn').screenshot({ path: '/screenshots/button.png' });
          expect(typeof base64).toBe('string');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);

      assert.strictEqual(writtenFiles.length, 1);
      assert.strictEqual(writtenFiles[0]!.path, '/screenshots/button.png');
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  // PDF tests only work in Chromium
  it("should generate PDF and return base64", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('pdf returns base64', async () => {
          await page.goto('data:text/html,<h1>PDF Test</h1><p>This is a test document.</p>');

          const base64 = await page.pdf();

          expect(typeof base64).toBe('string');
          expect(base64.length).toBeGreaterThan(100);

          // PDF files start with %PDF
          const binaryString = atob(base64);
          const header = binaryString.slice(0, 4);
          expect(header).toBe('%PDF');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should use writeFile callback when pdf path is provided", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const writtenFiles: { path: string; size: number }[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page, { writeFile: async (filePath: string, data: Buffer) => {
          writtenFiles.push({ path: filePath, size: data.length });
        } }) },
    });

    try {
      await runtime.eval(`
        test('pdf with path uses writeFile callback', async () => {
          await page.goto('data:text/html,<h1>PDF Test</h1>');

          const base64 = await page.pdf({ path: '/documents/test.pdf' });
          expect(typeof base64).toBe('string');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);

      assert.strictEqual(writtenFiles.length, 1);
      assert.strictEqual(writtenFiles[0]!.path, '/documents/test.pdf');
      assert.ok(writtenFiles[0]!.size > 100, 'PDF should have reasonable size');
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should throw error when pdf path is used without writeFile callback", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('pdf with path fails without writeFile callback', async () => {
          await page.goto('data:text/html,<h1>Test</h1>');

          let error: Error | null = null;
          try {
            await page.pdf({ path: '/documents/test.pdf' });
          } catch (e) {
            error = e as Error;
          }
          expect(error).not.toBeNull();
          expect(error!.message).toContain('writeFile callback');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support pdf options (format, landscape, margin)", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('pdf with options', async () => {
          await page.goto('data:text/html,<h1>PDF Options Test</h1>');

          const base64 = await page.pdf({
            format: 'A4',
            landscape: true,
            margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
            printBackground: true,
          });

          expect(typeof base64).toBe('string');
          expect(base64.length).toBeGreaterThan(100);
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
