# @ricsam/isolate-playwright

Playwright bridge for running browser automation in a V8 sandbox. Execute untrusted Playwright code against a real browser page while keeping the logic isolated.

## Installation

```bash
npm add @ricsam/isolate-playwright playwright
```

## Usage with isolate-runtime (Recommended)

The easiest way to use this package is through `@ricsam/isolate-runtime`:

### Script Mode (No Tests)

Run browser automation scripts without a test framework:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    page,
    baseUrl: "https://example.com",
    console: true, // Print browser console logs to stdout
  },
});

// Run a script - page is available, but expect is not
await runtime.eval(`
  await page.goto("/");
  const title = await page.title();
  console.log("Page title:", title);
`);

// Get collected network data
const data = runtime.playwright.getCollectedData();
console.log("Network requests:", data.networkRequests.length);

await runtime.dispose();
await browser.close();
```

### Test Mode (With Test Framework)

For tests, enable `testEnvironment` which provides `describe`, `it`, and `expect`. Playwright extends `expect` with locator matchers:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  testEnvironment: true, // Provides describe, it, expect
  playwright: {
    page,
    baseUrl: "https://example.com",
    onBrowserConsoleLog: (entry) => console.log("[browser]", entry.level, entry.stdout),
    onNetworkRequest: (info) => console.log("Request:", info.url),
  },
});

await runtime.eval(`
  describe("homepage", () => {
    it("loads correctly", async () => {
      await page.goto("/");
      const heading = page.getByRole("heading", { name: "Example Domain" });
      await expect(heading).toBeVisible(); // Locator matcher from playwright
      expect(await page.title()).toBe("Example Domain"); // Primitive matcher from test-environment
    });
  });
`);

// Run tests using test-environment
const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} tests passed`);

// Get collected browser data
const data = runtime.playwright.getCollectedData();
console.log("Browser console logs:", data.browserConsoleLogs);

await runtime.dispose();
await browser.close();
```

## Low-level Usage (Direct ivm)

For advanced use cases with direct isolated-vm access:

```typescript
import ivm from "isolated-vm";
import { chromium } from "playwright";
import { setupPlaywright } from "@ricsam/isolate-playwright";
import { setupTestEnvironment, runTests } from "@ricsam/isolate-test-environment";

const browser = await chromium.launch();
const page = await browser.newPage();

const isolate = new ivm.Isolate();
const context = await isolate.createContext();

// Setup test-environment first (provides describe, it, expect)
await setupTestEnvironment(context);

// Then setup playwright (extends expect with locator matchers)
const handle = await setupPlaywright(context, {
  page,
  timeout: 30000,
  baseUrl: "https://example.com",
  onNetworkRequest: (info) => console.log("Request:", info.url),
  onNetworkResponse: (info) => console.log("Response:", info.status),
  onBrowserConsoleLog: (entry) => console.log(`[${entry.level}]`, entry.stdout),
});

// Load and run untrusted test code
await context.eval(`
  describe("homepage", () => {
    it("loads correctly", async () => {
      await page.goto("/");
      const heading = page.getByRole("heading", { name: "Example Domain" });
      await expect(heading).toBeVisible();
    });
  });
`);

// Run tests
const results = await runTests(context);
console.log(`${results.passed}/${results.total} tests passed`);

// Cleanup
handle.dispose();
context.release();
isolate.dispose();
await browser.close();
```

## Handler-based API (for Remote Execution)

For daemon/client architectures where the browser runs on the client:

```typescript
import { createPlaywrightHandler, setupPlaywright, type PlaywrightCallback } from "@ricsam/isolate-playwright";
import { chromium } from "playwright";

// On the client: create handler from page
const browser = await chromium.launch();
const page = await browser.newPage();
const handler: PlaywrightCallback = createPlaywrightHandler(page, {
  timeout: 30000,
  baseUrl: "https://example.com",
});

// On the daemon: setup playwright with handler (instead of page)
const handle = await setupPlaywright(context, {
  handler, // Handler callback instead of direct page
  onBrowserConsoleLog: (entry) => sendToClient("browserConsoleLog", entry),
});
```

## Injected Globals (in isolate)

- `page` - Page object with navigation and locator methods
- `Locator` - Locator class for element interactions
- `expect` - Extended with locator matchers (only if test-environment is loaded first)

## Page Methods

- `page.goto(url, options?)` - Navigate to URL
- `page.reload()` - Reload page
- `page.url()` - Get current URL (sync)
- `page.title()` - Get page title
- `page.content()` - Get page HTML
- `page.click(selector)` - Click element (shorthand)
- `page.fill(selector, value)` - Fill input (shorthand)
- `page.waitForSelector(selector, options?)` - Wait for element
- `page.waitForTimeout(ms)` - Wait for milliseconds
- `page.waitForLoadState(state?)` - Wait for load state
- `page.evaluate(script)` - Evaluate JS in browser context
- `page.locator(selector)` - Get locator by CSS selector
- `page.getByRole(role, options?)` - Get locator by ARIA role
- `page.getByText(text)` - Get locator by text content
- `page.getByLabel(label)` - Get locator by label
- `page.getByPlaceholder(text)` - Get locator by placeholder
- `page.getByTestId(id)` - Get locator by test ID
- `page.request.get(url)` - HTTP GET request with page cookies
- `page.request.post(url, options?)` - HTTP POST request with page cookies

## Locator Methods

- `click()`, `dblclick()`, `hover()`, `focus()`
- `fill(text)`, `type(text)`, `clear()`, `press(key)`
- `check()`, `uncheck()`, `selectOption(value)`
- `textContent()`, `inputValue()`
- `isVisible()`, `isEnabled()`, `isChecked()`, `count()`
- `nth(index)` - Get nth matching element

## Expect Matchers (for Locators)

These matchers are available when using playwright with test-environment:

- `toBeVisible(options?)`, `toBeEnabled(options?)`, `toBeChecked(options?)`
- `toContainText(text, options?)`, `toHaveValue(value, options?)`
- All matchers support `.not` modifier
- All matchers support `{ timeout: number }` option

## Handle Methods

- `dispose()` - Clean up event listeners
- `getBrowserConsoleLogs()` - Get captured browser console logs
- `getNetworkRequests()` - Get captured network requests
- `getNetworkResponses()` - Get captured network responses
- `clearCollected()` - Clear all collected data

## Setup Options

```typescript
interface PlaywrightSetupOptions {
  page?: Page;                    // Direct page object (for local use)
  handler?: PlaywrightCallback;   // Handler callback (for remote use)
  timeout?: number;               // Default timeout for operations
  baseUrl?: string;               // Base URL for relative navigation
  console?: boolean;              // Route browser console logs through console handler
  onEvent?: (event: PlaywrightEvent) => void;  // Unified event callback
}

type PlaywrightEvent =
  | { type: "browserConsoleLog"; level: string; stdout: string; timestamp: number }
  | { type: "networkRequest"; url: string; method: string; headers: Record<string, string>; ... }
  | { type: "networkResponse"; url: string; status: number; headers: Record<string, string>; ... };
```

## License

MIT
