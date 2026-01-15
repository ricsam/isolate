# @ricsam/isolate-playwright

Playwright bridge for running browser tests in a V8 sandbox. Execute untrusted Playwright test code against a real browser page while keeping the test logic isolated.

## Installation

```bash
npm add @ricsam/isolate-playwright playwright
```

## Usage with isolate-runtime (Recommended)

The easiest way to use this package is through `@ricsam/isolate-runtime`:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";

// Launch browser (you own the browser)
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    page,
    baseUrl: "https://example.com",
    onConsoleLog: (entry) => console.log("[browser]", entry.level, ...entry.args),
    onNetworkRequest: (info) => console.log("Request:", info.url),
  },
});

await runtime.eval(`
  test("homepage loads correctly", async () => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Example Domain" });
    await expect(heading).toBeVisible();
  });
`);

const results = await runtime.playwright.runTests();
console.log(`${results.passed}/${results.total} tests passed`);

// Get collected network data
const data = runtime.playwright.getCollectedData();
console.log("Console logs:", data.consoleLogs);

await runtime.dispose();
await browser.close();
```

## Low-level Usage (Direct ivm)

For advanced use cases with direct isolated-vm access:

```typescript
import ivm from "isolated-vm";
import { chromium } from "playwright";
import { setupPlaywright, runPlaywrightTests, createPlaywrightHandler } from "@ricsam/isolate-playwright";

// Create browser and page
const browser = await chromium.launch();
const page = await browser.newPage();

// Create isolate and context
const isolate = new ivm.Isolate();
const context = await isolate.createContext();

// Setup playwright bridge
const handle = await setupPlaywright(context, {
  page,  // Direct page object
  timeout: 30000,
  baseUrl: "https://example.com",
  onNetworkRequest: (info) => console.log("Request:", info.url),
  onNetworkResponse: (info) => console.log("Response:", info.status),
  onConsoleLog: (entry) => console.log(`[${entry.level}]`, ...entry.args),
});

// Load and run untrusted test code
await context.eval(`
  test("homepage loads correctly", async () => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Example Domain" });
    await expect(heading).toBeVisible();
  });
`);

// Run tests and get results
const results = await runPlaywrightTests(context);
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
  handler,  // Handler callback instead of direct page
  onConsoleLog: (entry) => sendToClient("consoleLog", entry),
});
```

## Injected Globals (in isolate)

- `page` - Page object with navigation and locator methods
- `test(name, fn)` - Register a test
- `expect(actual)` - Assertion helper for locators and primitives
- `Locator` - Locator class for element interactions

## Page Methods

- `page.goto(url, options?)` - Navigate to URL
- `page.reload()` - Reload page
- `page.url()` - Get current URL (sync)
- `page.title()` - Get page title
- `page.content()` - Get page HTML
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

## Locator Methods

- `click()`, `dblclick()`, `hover()`, `focus()`
- `fill(text)`, `type(text)`, `clear()`, `press(key)`
- `check()`, `uncheck()`, `selectOption(value)`
- `textContent()`, `inputValue()`
- `isVisible()`, `isEnabled()`, `isChecked()`, `count()`

## Expect Matchers (for Locators)

- `toBeVisible()`, `toBeEnabled()`, `toBeChecked()`
- `toContainText(text)`, `toHaveValue(value)`
- All matchers support `.not` modifier

## Expect Matchers (for Primitives)

- `toBe(expected)`, `toEqual(expected)`
- `toBeTruthy()`, `toBeFalsy()`
- `toContain(item)`

## Handle Methods

- `dispose()` - Clean up event listeners
- `getConsoleLogs()` - Get captured browser console logs
- `getNetworkRequests()` - Get captured network requests
- `getNetworkResponses()` - Get captured network responses
- `clearCollected()` - Clear all collected data

## Test Results

```typescript
interface PlaywrightExecutionResult {
  passed: number;
  failed: number;
  total: number;
  results: Array<{
    name: string;
    passed: boolean;
    error?: string;
    duration: number;
  }>;
}
```

## License

MIT
