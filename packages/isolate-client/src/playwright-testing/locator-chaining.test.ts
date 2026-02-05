/**
 * Tests for Playwright locator chaining functionality.
 * Verifies that locators can be chained (e.g., page.getByRole('dialog').getByText('Submit'))
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-locator-chaining.sock";

describe("playwright locator chaining", () => {
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

  it("should chain getByText after getByRole", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chain getByText after getByRole', async () => {
          await page.goto('data:text/html,<div role="dialog"><span>Submit</span><span>Cancel</span></div>');

          const dialog = page.getByRole('dialog');
          const submitBtn = dialog.getByText('Submit');

          const isVisible = await submitBtn.isVisible();
          expect(isVisible).toBe(true);

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

  it("should chain getByRole after getByRole group", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chain getByRole after getByRole group', async () => {
          await page.goto('data:text/html,<fieldset><legend>Profile</legend><button>Edit</button><button>Delete</button></fieldset>');

          const profile = page.getByRole('group', { name: 'Profile' });
          const editBtn = profile.getByRole('button', { name: 'Edit' });

          const isVisible = await editBtn.isVisible();
          expect(isVisible).toBe(true);

          const text = await editBtn.textContent();
          expect(text).toBe('Edit');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should chain multiple locators deeply", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chain multiple locators', async () => {
          await page.goto('data:text/html,<div role="dialog"><form><label>Username<input type="text" /></label></form></div>');

          const input = page.getByRole('dialog').locator('form').getByLabel('Username');

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

  it("should chain getByPlaceholder after parent locator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chain getByPlaceholder', async () => {
          await page.goto('data:text/html,<div class="search-box"><input placeholder="Search..." /></div>');

          const searchBox = page.locator('.search-box');
          const input = searchBox.getByPlaceholder('Search...');

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

  it("should chain getByTestId after parent locator", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chain getByTestId', async () => {
          await page.goto('data:text/html,<div class="container"><button data-testid="submit-btn">Submit</button></div>');

          const container = page.locator('.container');
          const btn = container.getByTestId('submit-btn');

          const text = await btn.textContent();
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

  it("should support locator.and() for combining conditions", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('locator and method', async () => {
          await page.goto('data:text/html,<button class="primary">Submit</button><button class="secondary">Cancel</button>');

          // Find button that is both a button AND has class primary
          const btn = page.getByRole('button').and(page.locator('.primary'));

          const text = await btn.textContent();
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

  it("should support getByAltText", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('getByAltText', async () => {
          await page.goto('data:text/html,<img alt="Company Logo" src="logo.png" />');

          const img = page.getByAltText('Company Logo');
          const isVisible = await img.isVisible();
          expect(isVisible).toBe(true);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support getByTitle", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('getByTitle', async () => {
          await page.goto('data:text/html,<span title="Helpful tooltip">Hover me</span>');

          const el = page.getByTitle('Helpful tooltip');
          const text = await el.textContent();
          expect(text).toBe('Hover me');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("should support chained getByAltText and getByTitle", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('chained getByAltText and getByTitle', async () => {
          await page.goto('data:text/html,<div class="gallery"><img alt="Photo 1" src="1.jpg" /><span title="Caption">Nice photo</span></div>');

          const gallery = page.locator('.gallery');
          const img = gallery.getByAltText('Photo 1');
          const caption = gallery.getByTitle('Caption');

          expect(await img.isVisible()).toBe(true);
          expect(await caption.textContent()).toBe('Nice photo');
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
