/**
 * Tests for Playwright frameLocator functionality.
 * Verifies that locators can work inside iframes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";

const TEST_SOCKET = "/tmp/isolate-test-frame-locator.sock";

describe("playwright frameLocator", () => {
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

  it("should locate elements inside iframe using frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator with CSS selector', async () => {
          // Create a page with an iframe containing content
          await page.goto('data:text/html,<iframe id="myframe" srcdoc="<button id=btn>Click me</button>"></iframe>');
          await page.waitForTimeout(100); // Wait for iframe to load

          const frame = page.frameLocator('#myframe');
          const button = frame.locator('#btn');

          const text = await button.textContent();
          expect(text).toBe('Click me');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByRole inside frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator getByRole', async () => {
          await page.goto('data:text/html,<iframe id="frame" srcdoc="<button>Submit</button><button>Cancel</button>"></iframe>');
          await page.waitForTimeout(100);

          const frame = page.frameLocator('#frame');
          const submitBtn = frame.getByRole('button', { name: 'Submit' });

          const text = await submitBtn.textContent();
          expect(text).toBe('Submit');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByText inside frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator getByText', async () => {
          await page.goto('data:text/html,<iframe id="frame" srcdoc="<p>Hello World</p><p>Goodbye</p>"></iframe>');
          await page.waitForTimeout(100);

          const frame = page.frameLocator('#frame');
          const para = frame.getByText('Hello World');

          const text = await para.textContent();
          expect(text).toBe('Hello World');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByLabel inside frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator getByLabel', async () => {
          await page.goto('data:text/html,<iframe id="frame" srcdoc="<label>Username<input type=text /></label>"></iframe>');
          await page.waitForTimeout(100);

          const frame = page.frameLocator('#frame');
          const input = frame.getByLabel('Username');

          await input.fill('testuser');
          const value = await input.inputValue();
          expect(value).toBe('testuser');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByPlaceholder inside frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator getByPlaceholder', async () => {
          await page.goto('data:text/html,<iframe id="frame" srcdoc="<input placeholder=Search... />"></iframe>');
          await page.waitForTimeout(100);

          const frame = page.frameLocator('#frame');
          const input = frame.getByPlaceholder('Search...');

          await input.fill('query');
          const value = await input.inputValue();
          expect(value).toBe('query');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByTestId inside frameLocator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('frameLocator getByTestId', async () => {
          await page.goto('data:text/html,<iframe id="frame" srcdoc="<div data-testid=my-element>Test Element</div>"></iframe>');
          await page.waitForTimeout(100);

          const frame = page.frameLocator('#frame');
          const el = frame.getByTestId('my-element');

          const text = await el.textContent();
          expect(text).toBe('Test Element');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should click button inside iframe", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { page },
    });

    try {
      await runtime.eval(`
        test('click in frameLocator', async () => {
          await page.goto("data:text/html,<iframe id='frame' srcdoc='<button onclick=&quot;this.textContent=String.fromCharCode(99,108,105,99,107,101,100)&quot;>Click</button>'></iframe>");
          await page.waitForTimeout(200);

          const frame = page.frameLocator('#frame');
          const button = frame.locator('button');

          await button.click();
          await page.waitForTimeout(100);

          const text = await button.textContent();
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
});
