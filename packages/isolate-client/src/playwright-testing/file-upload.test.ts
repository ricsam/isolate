/**
 * Tests for Playwright file upload functionality with security callbacks.
 * Verifies that setInputFiles() works with readFile callback for controlled file access.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import * as path from "node:path";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-file-upload.sock";

describe("playwright file upload with security callbacks", () => {
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

  it("should upload file using buffer data directly", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('upload file with buffer', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');

          // Pass file data directly as Uint8Array (base64 encoded internally)
          await input.setInputFiles([{
            name: 'test.txt',
            mimeType: 'text/plain',
            buffer: new TextEncoder().encode('Hello, World!'),
          }]);

          // Verify file was set
          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => ({ name: f.name, size: f.size }));
          });

          expect(files).toHaveLength(1);
          expect(files[0].name).toBe('test.txt');
          expect(files[0].size).toBe(13); // "Hello, World!" length
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should upload multiple files using buffer data", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('upload multiple files with buffer', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" multiple />');

          const input = page.locator('#upload');

          await input.setInputFiles([
            { name: 'file1.txt', mimeType: 'text/plain', buffer: new TextEncoder().encode('Content 1') },
            { name: 'file2.txt', mimeType: 'text/plain', buffer: new TextEncoder().encode('Content 2') },
          ]);

          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => f.name);
          });

          expect(files).toHaveLength(2);
          expect(files).toContain('file1.txt');
          expect(files).toContain('file2.txt');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should upload file using a single inline object payload", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('upload file with single object', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');
          await input.setInputFiles({
            name: 'single-object.txt',
            mimeType: 'text/plain',
            buffer: new TextEncoder().encode('single payload'),
          });

          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => ({ name: f.name, size: f.size }));
          });

          expect(files).toHaveLength(1);
          expect(files[0].name).toBe('single-object.txt');
          expect(files[0].size).toBe(14);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should not call readFile callback for inline object payloads", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const readFileCalls: string[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        handler: defaultPlaywrightHandler(page, {
          readFile: async (filePath: string) => {
            readFileCalls.push(filePath);
            return {
              name: path.basename(filePath),
              mimeType: "text/plain",
              buffer: Buffer.from("should not be used"),
            };
          },
        }),
      },
    });

    try {
      await runtime.eval(`
        test('inline object bypasses readFile callback', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');
          await input.setInputFiles({
            name: 'inline-only.txt',
            mimeType: 'text/plain',
            buffer: new TextEncoder().encode('inline data'),
          });

          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => f.name);
          });

          expect(files).toHaveLength(1);
          expect(files[0]).toBe('inline-only.txt');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      assert.strictEqual(results.failed, 0);
      assert.strictEqual(readFileCalls.length, 0);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should use readFile callback when file path is provided", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const readFileCalls: string[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        handler: defaultPlaywrightHandler(page, {
          readFile: async (filePath: string) => {
            readFileCalls.push(filePath);
            // Simulate reading a file - in real usage this would read from disk
            return {
              name: path.basename(filePath),
              mimeType: 'text/plain',
              buffer: Buffer.from(`Content of ${filePath}`),
            };
          },
        }),
      },
    });

    try {
      await runtime.eval(`
        test('upload file with path using readFile callback', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');
          await input.setInputFiles('/path/to/test-file.txt');

          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => f.name);
          });

          expect(files).toHaveLength(1);
          expect(files[0]).toBe('test-file.txt');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      assert.deepStrictEqual(readFileCalls, ['/path/to/test-file.txt']);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should use readFile callback for multiple file paths", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const readFileCalls: string[] = [];

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: {
        handler: defaultPlaywrightHandler(page, {
          readFile: async (filePath: string) => {
            readFileCalls.push(filePath);
            return {
              name: path.basename(filePath),
              mimeType: 'application/pdf',
              buffer: Buffer.from(`PDF content of ${filePath}`),
            };
          },
        }),
      },
    });

    try {
      await runtime.eval(`
        test('upload multiple files with paths', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" multiple />');

          const input = page.locator('#upload');
          await input.setInputFiles(['/docs/file1.pdf', '/docs/file2.pdf']);

          const files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return Array.from(input.files || []).map(f => f.name);
          });

          expect(files).toHaveLength(2);
          expect(files).toContain('file1.pdf');
          expect(files).toContain('file2.pdf');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      assert.deepStrictEqual(readFileCalls.sort(), ['/docs/file1.pdf', '/docs/file2.pdf'].sort());
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should throw error when file path is used without readFile callback", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    // No readFile callback provided
    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('should fail without readFile callback', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');

          // This should throw because no readFile callback is provided
          let error: Error | null = null;
          try {
            await input.setInputFiles('/path/to/file.txt');
          } catch (e) {
            error = e as Error;
          }
          expect(error).not.toBeNull();
          expect(error!.message).toContain('readFile callback');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should throw validation error when mixing paths and inline objects", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('mixed setInputFiles inputs should fail', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');
          let error: Error | null = null;
          try {
            await input.setInputFiles([
              '/path/to/file.txt',
              { name: 'inline.txt', mimeType: 'text/plain', buffer: new TextEncoder().encode('inline') },
            ]);
          } catch (e) {
            error = e as Error;
          }

          expect(error).not.toBeNull();
          expect(error!.message).toContain('mixing file paths and inline file objects');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
      assert.strictEqual(results.failed, 0);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should clear files with empty array", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('clear files', async () => {
          await page.goto('data:text/html,<input type="file" id="upload" />');

          const input = page.locator('#upload');

          // First set a file
          await input.setInputFiles([{
            name: 'test.txt',
            mimeType: 'text/plain',
            buffer: new TextEncoder().encode('content'),
          }]);

          let files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return input.files?.length ?? 0;
          });
          expect(files).toBe(1);

          // Clear files
          await input.setInputFiles([]);

          files = await page.evaluate(() => {
            const input = document.getElementById('upload') as HTMLInputElement;
            return input.files?.length ?? 0;
          });
          expect(files).toBe(0);
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
