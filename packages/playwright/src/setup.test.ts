import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { chromium, type Browser, type Page } from "playwright";
import {
  setupPlaywright,
  runPlaywrightTests,
  resetPlaywrightTests,
  type NetworkRequestInfo,
  type NetworkResponseInfo,
} from "./index.ts";

describe("playwright bridge", () => {
  let browser: Browser;
  let page: Page;
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
  });

  afterEach(async () => {
    context.release();
    isolate.dispose();
    await browser.close();
  });

  test("navigates to a page and gets title", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("navigation test", async () => {
        await page.goto("https://example.com");
        const title = await page.title();
        expect(title).toBe("Example Domain");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 1);
    assert.strictEqual(results.failed, 0);
    assert.strictEqual(results.total, 1);
    assert.strictEqual(results.results[0]?.passed, true);

    handle.dispose();
  });

  test("captures network requests", async () => {
    const capturedRequests: NetworkRequestInfo[] = [];
    const handle = await setupPlaywright(context, {
      page,
      onNetworkRequest: (info) => capturedRequests.push(info),
    });

    await context.eval(`
      test("network test", async () => {
        await page.goto("https://example.com");
      });
    `);

    await runPlaywrightTests(context);

    // Verify requests were captured
    assert.ok(capturedRequests.length > 0, "Should capture network requests");
    const mainRequest = capturedRequests.find((r) => r.url === "https://example.com/");
    assert.ok(mainRequest, "Should capture main request");
    assert.strictEqual(mainRequest?.method, "GET");

    // Verify handle also has the requests
    const handleRequests = handle.getNetworkRequests();
    assert.ok(handleRequests.length > 0, "Handle should have network requests");

    handle.dispose();
  });

  test("captures network responses", async () => {
    const capturedResponses: NetworkResponseInfo[] = [];
    const handle = await setupPlaywright(context, {
      page,
      onNetworkResponse: (info) => capturedResponses.push(info),
    });

    await context.eval(`
      test("response test", async () => {
        await page.goto("https://example.com");
      });
    `);

    await runPlaywrightTests(context);

    // Verify responses were captured
    assert.ok(capturedResponses.length > 0, "Should capture network responses");
    const mainResponse = capturedResponses.find((r) => r.url === "https://example.com/");
    assert.ok(mainResponse, "Should capture main response");
    assert.strictEqual(mainResponse?.status, 200);

    // Verify handle also has the responses
    const handleResponses = handle.getNetworkResponses();
    assert.ok(handleResponses.length > 0, "Handle should have network responses");

    handle.dispose();
  });

  test("uses locators to interact with page", async () => {
    const handle = await setupPlaywright(context, { page });

    // Navigate to a page with a heading
    await context.eval(`
      test("locator test", async () => {
        await page.goto("https://example.com");
        const heading = page.getByRole("heading", { name: "Example Domain" });
        await expect(heading).toBeVisible();
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 1);

    handle.dispose();
  });

  test("handles test failures correctly", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("failing test", async () => {
        await page.goto("https://example.com");
        expect(await page.title()).toBe("Wrong Title");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 0);
    assert.strictEqual(results.failed, 1);
    assert.strictEqual(results.results[0]?.passed, false);
    assert.ok(results.results[0]?.error?.includes("Wrong Title"));

    handle.dispose();
  });

  test("runs multiple tests sequentially", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("test 1", async () => {
        await page.goto("https://example.com");
      });

      test("test 2", async () => {
        const title = await page.title();
        expect(title).toBe("Example Domain");
      });

      test("test 3", async () => {
        const url = page.url();
        expect(url).toContain("example.com");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.total, 3);
    assert.strictEqual(results.passed, 3);
    assert.strictEqual(results.failed, 0);

    // Verify all tests have durations
    for (const result of results.results) {
      assert.ok(result.duration >= 0, "Each test should have a duration");
    }

    handle.dispose();
  });

  test("resets tests between runs", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("first run test", async () => {
        await page.goto("https://example.com");
      });
    `);

    const results1 = await runPlaywrightTests(context);
    assert.strictEqual(results1.total, 1);

    // Reset and add new tests
    await resetPlaywrightTests(context);

    await context.eval(`
      test("second run test 1", async () => {
        const title = await page.title();
        expect(title).toBe("Example Domain");
      });

      test("second run test 2", async () => {
        expect(page.url()).toContain("example.com");
      });
    `);

    const results2 = await runPlaywrightTests(context);
    assert.strictEqual(results2.total, 2);

    handle.dispose();
  });

  test("clears collected data", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("navigation test", async () => {
        await page.goto("https://example.com");
      });
    `);

    await runPlaywrightTests(context);

    // Verify data was collected
    assert.ok(handle.getNetworkRequests().length > 0);
    assert.ok(handle.getNetworkResponses().length > 0);

    // Clear collected data
    handle.clearCollected();

    // Verify data was cleared
    assert.strictEqual(handle.getNetworkRequests().length, 0);
    assert.strictEqual(handle.getNetworkResponses().length, 0);
    assert.strictEqual(handle.getConsoleLogs().length, 0);

    handle.dispose();
  });

  test("handles page.evaluate", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("evaluate test", async () => {
        await page.goto("https://example.com");
        const result = await page.evaluate("document.title");
        expect(result).toBe("Example Domain");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 1);

    handle.dispose();
  });

  test("handles baseUrl option", async () => {
    const handle = await setupPlaywright(context, {
      page,
      baseUrl: "https://example.com",
    });

    await context.eval(`
      test("baseUrl test", async () => {
        await page.goto("/");
        const title = await page.title();
        expect(title).toBe("Example Domain");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 1);

    handle.dispose();
  });

  test("locator getText and inputValue", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("text content test", async () => {
        await page.goto("https://example.com");
        const heading = page.locator("h1");
        const text = await heading.textContent();
        expect(text).toBe("Example Domain");
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 1);

    handle.dispose();
  });

  test("primitive expect matchers", async () => {
    const handle = await setupPlaywright(context, { page });

    await context.eval(`
      test("primitive matchers", async () => {
        expect(1 + 1).toBe(2);
        expect({ a: 1 }).toEqual({ a: 1 });
        expect(true).toBeTruthy();
        expect(false).toBeFalsy();
        expect("hello world").toContain("world");
        expect([1, 2, 3]).toContain(2);
      });

      test("negated matchers", async () => {
        expect(1).not.toBe(2);
        expect({ a: 1 }).not.toEqual({ b: 2 });
        expect(false).not.toBeTruthy();
        expect(true).not.toBeFalsy();
        expect("hello").not.toContain("world");
        expect([1, 2]).not.toContain(3);
      });
    `);

    const results = await runPlaywrightTests(context);
    assert.strictEqual(results.passed, 2);
    assert.strictEqual(results.failed, 0);

    handle.dispose();
  });
});
