/**
 * Tests for Playwright assertion matchers.
 * Verifies all expect() matchers work correctly in the isolate.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "../connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium } from "playwright";
import type { DaemonConnection } from "../types.ts";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const TEST_SOCKET = "/tmp/isolate-test-assertions.sock";

describe("playwright assertion matchers", () => {
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

  it("toBeVisible and toBeHidden", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeVisible and toBeHidden', async () => {
          await page.goto('data:text/html,<div id="visible">Visible</div><div id="hidden" style="display:none">Hidden</div>');

          await expect(page.locator('#visible')).toBeVisible();
          await expect(page.locator('#hidden')).toBeHidden();
          await expect(page.locator('#visible')).not.toBeHidden();
          await expect(page.locator('#hidden')).not.toBeVisible();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeEnabled and toBeDisabled", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeEnabled and toBeDisabled', async () => {
          await page.goto('data:text/html,<button id="enabled">Enabled</button><button id="disabled" disabled>Disabled</button>');

          await expect(page.locator('#enabled')).toBeEnabled();
          await expect(page.locator('#disabled')).toBeDisabled();
          await expect(page.locator('#enabled')).not.toBeDisabled();
          await expect(page.locator('#disabled')).not.toBeEnabled();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeChecked", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeChecked', async () => {
          await page.goto('data:text/html,<input type="checkbox" id="checked" checked /><input type="checkbox" id="unchecked" />');

          await expect(page.locator('#checked')).toBeChecked();
          await expect(page.locator('#unchecked')).not.toBeChecked();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveText and toContainText", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveText and toContainText', async () => {
          await page.goto('data:text/html,<div id="text">Hello World</div>');

          await expect(page.locator('#text')).toHaveText('Hello World');
          await expect(page.locator('#text')).toContainText('Hello');
          await expect(page.locator('#text')).toContainText('World');
          await expect(page.locator('#text')).not.toContainText('Goodbye');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveText with regex", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveText with regex', async () => {
          await page.goto('data:text/html,<div id="text">Hello World 123</div>');

          await expect(page.locator('#text')).toHaveText(/hello world/i);
          await expect(page.locator('#text')).toContainText(/\\d+/);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveValue", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveValue', async () => {
          await page.goto('data:text/html,<input id="input" value="initial" />');

          await expect(page.locator('#input')).toHaveValue('initial');

          await page.locator('#input').fill('updated');
          await expect(page.locator('#input')).toHaveValue('updated');
          await expect(page.locator('#input')).not.toHaveValue('initial');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveAttribute", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveAttribute', async () => {
          await page.goto('data:text/html,<a id="link" href="/page" target="_blank">Link</a>');

          await expect(page.locator('#link')).toHaveAttribute('href', '/page');
          await expect(page.locator('#link')).toHaveAttribute('target', '_blank');
          await expect(page.locator('#link')).not.toHaveAttribute('href', '/other');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveCount", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveCount', async () => {
          await page.goto('data:text/html,<ul><li>One</li><li>Two</li><li>Three</li></ul>');

          await expect(page.locator('li')).toHaveCount(3);
          await expect(page.locator('li')).not.toHaveCount(2);
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeAttached", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeAttached', async () => {
          await page.goto('data:text/html,<div id="exists">I exist</div>');

          await expect(page.locator('#exists')).toBeAttached();
          await expect(page.locator('#nonexistent')).not.toBeAttached();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeEditable", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeEditable', async () => {
          await page.goto('data:text/html,<input id="editable" /><input id="readonly" readonly /><input id="disabled" disabled />');

          await expect(page.locator('#editable')).toBeEditable();
          await expect(page.locator('#readonly')).not.toBeEditable();
          await expect(page.locator('#disabled')).not.toBeEditable();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveClass and toContainClass", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveClass and toContainClass', async () => {
          await page.goto('data:text/html,<div id="el" class="foo bar baz">Element</div>');

          await expect(page.locator('#el')).toHaveClass('foo bar baz');
          await expect(page.locator('#el')).toContainClass('foo');
          await expect(page.locator('#el')).toContainClass('bar');
          await expect(page.locator('#el')).not.toContainClass('qux');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveId", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveId', async () => {
          await page.goto('data:text/html,<div id="my-element">Element</div>');

          await expect(page.locator('div')).toHaveId('my-element');
          await expect(page.locator('div')).not.toHaveId('other-id');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeFocused", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeFocused', async () => {
          await page.goto('data:text/html,<input id="input1" /><input id="input2" />');

          const input1 = page.locator('#input1');
          const input2 = page.locator('#input2');

          await input1.focus();
          await expect(input1).toBeFocused();
          await expect(input2).not.toBeFocused();

          await input2.focus();
          await expect(input2).toBeFocused();
          await expect(input1).not.toBeFocused();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeEmpty", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeEmpty', async () => {
          await page.goto('data:text/html,<input id="empty" /><input id="filled" value="text" /><div id="emptyDiv"></div><div id="filledDiv">content</div>');

          await expect(page.locator('#empty')).toBeEmpty();
          await expect(page.locator('#filled')).not.toBeEmpty();
          await expect(page.locator('#emptyDiv')).toBeEmpty();
          await expect(page.locator('#filledDiv')).not.toBeEmpty();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toBeInViewport", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toBeInViewport', async () => {
          await page.goto('data:text/html,<div id="visible">Visible</div><div id="offscreen" style="position:absolute;top:10000px">Offscreen</div>');

          await expect(page.locator('#visible')).toBeInViewport();
          await expect(page.locator('#offscreen')).not.toBeInViewport();
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveCSS", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveCSS', async () => {
          await page.goto('data:text/html,<div id="styled" style="color: rgb(255, 0, 0); font-size: 16px;">Styled</div>');

          await expect(page.locator('#styled')).toHaveCSS('color', 'rgb(255, 0, 0)');
          await expect(page.locator('#styled')).toHaveCSS('font-size', '16px');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveJSProperty", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveJSProperty', async () => {
          await page.goto('data:text/html,<input id="input" type="text" />');

          await expect(page.locator('#input')).toHaveJSProperty('type', 'text');
          await expect(page.locator('#input')).toHaveJSProperty('tagName', 'INPUT');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveAccessibleName", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveAccessibleName', async () => {
          await page.goto('data:text/html,<button aria-label="Close dialog">X</button>');

          await expect(page.locator('button')).toHaveAccessibleName('Close dialog');
        });
      `);

      const results = await runtime.testEnvironment.runTests();
      assert.strictEqual(results.passed, 1, `Expected test to pass, got: ${JSON.stringify(results.tests)}`);
    } finally {
      await runtime.dispose();
      await browser.close();
    }
  });

  it("toHaveRole", async () => {
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    const runtime = await client.createRuntime({
      testEnvironment: true,
      playwright: { handler: defaultPlaywrightHandler(page) },
    });

    try {
      await runtime.eval(`
        test('toHaveRole', async () => {
          await page.goto('data:text/html,<div role="dialog">Dialog</div><nav>Navigation</nav>');

          await expect(page.locator('[role="dialog"]')).toHaveRole('dialog');
          await expect(page.locator('nav')).toHaveRole('nav');
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
