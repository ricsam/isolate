# @ricsam/isolate-playwright

Playwright bridge for running browser tests in a V8 sandbox. Execute untrusted Playwright test code against a real browser page while keeping the test logic isolated.

## Installation

```bash
npm add @ricsam/isolate-playwright playwright
```

## Usage

```typescript
import ivm from "isolated-vm";
import { chromium } from "playwright";
import { setupPlaywright, runPlaywrightTests } from "@ricsam/isolate-playwright";

// Create browser and page
const browser = await chromium.launch();
const page = await browser.newPage();

// Create isolate and context
const isolate = new ivm.Isolate();
const context = await isolate.createContext();

// Setup playwright bridge
const handle = await setupPlaywright(context, {
  page,
  timeout: 30000,
  baseUrl: "https://example.com",
  onNetworkRequest: (info) => console.log("Request:", info.url),
  onNetworkResponse: (info) => console.log("Response:", info.status),
  onConsoleLog: (level, ...args) => console.log(`[${level}]`, ...args),
});

// Load and run untrusted test code
await context.eval(`
  test("homepage loads correctly", async () => {
    await page.goto("/");
    const heading = page.getByRole("heading", { name: "Example Domain" });
    await expect(heading).toBeVisible();
  });

  test("can interact with elements", async () => {
    const link = page.locator("a");
    await expect(link).toBeVisible();
    const text = await link.textContent();
    expect(text).toContain("More information");
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
