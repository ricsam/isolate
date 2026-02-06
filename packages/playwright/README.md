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
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    handler: defaultPlaywrightHandler(page),
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
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  testEnvironment: true, // Provides describe, it, expect
  playwright: {
    handler: defaultPlaywrightHandler(page),
    onEvent: (event) => {
      if (event.type === "browserConsoleLog") {
        console.log("[browser]", event.level, event.stdout);
      } else if (event.type === "networkRequest") {
        console.log("Request:", event.url);
      }
    },
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
  onEvent: (event) => {
    if (event.type === "networkRequest") {
      console.log("Request:", event.url);
    } else if (event.type === "networkResponse") {
      console.log("Response:", event.status);
    } else if (event.type === "browserConsoleLog") {
      console.log(`[${event.level}]`, event.stdout);
    }
  },
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

For daemon/client architectures where the browser runs on the client, use the
handler-first contract (`playwright.handler`):

```typescript
import { defaultPlaywrightHandler, setupPlaywright, type PlaywrightCallback } from "@ricsam/isolate-playwright";
import { chromium } from "playwright";

// On the client: create handler from page
const browser = await chromium.launch();
const page = await browser.newPage();
const handler: PlaywrightCallback = defaultPlaywrightHandler(page, {
  timeout: 30000,
});

// On the daemon: setup playwright with handler (instead of page)
const handle = await setupPlaywright(context, {
  handler,
  onEvent: (event) => sendToClient("playwright-event", event),
});
```

## Injected Globals (in isolate)

- `page` - Page object with navigation and locator methods
- `context` - BrowserContext object with `newPage()`, cookie methods
- `browser` - Browser object with `newContext()` method
- `Locator` - Locator class for element interactions
- `expect` - Extended with locator matchers (only if test-environment is loaded first)

## Page Methods

- `page.goto(url, options?)` - Navigate to URL
- `page.reload()` - Reload page
- `page.goBack()` - Navigate back
- `page.goForward()` - Navigate forward
- `page.url()` - Get current URL (sync)
- `page.title()` - Get page title
- `page.content()` - Get page HTML
- `page.click(selector)` - Click element (shorthand)
- `page.fill(selector, value)` - Fill input (shorthand)
- `page.waitForSelector(selector, options?)` - Wait for element
- `page.waitForTimeout(ms)` - Wait for milliseconds
- `page.waitForLoadState(state?)` - Wait for load state
- `page.waitForURL(url, options?)` - Wait for URL match
- `page.evaluate(script, arg?)` - Evaluate JS in browser context
- `page.locator(selector)` - Get locator by CSS selector
- `page.getByRole(role, options?)` - Get locator by ARIA role
- `page.getByText(text)` - Get locator by text content
- `page.getByLabel(label)` - Get locator by label
- `page.getByPlaceholder(text)` - Get locator by placeholder
- `page.getByTestId(id)` - Get locator by test ID
- `page.screenshot(options?)` - Take screenshot, returns base64
- `page.pdf(options?)` - Generate PDF (Chromium only), returns base64
- `page.request.get(url)` - HTTP GET request with page cookies
- `page.request.post(url, options?)` - HTTP POST request with page cookies
- `page.context()` - Get the context object for this page
- `page.close()` - Close the page

## Context Methods

- `context.newPage()` - Create a new page (requires `createPage` callback)
- `context.close()` - Close the context
- `context.cookies(urls?)` - Get cookies
- `context.addCookies(cookies)` - Add cookies
- `context.clearCookies()` - Clear cookies

## Browser Methods

- `browser.newContext(options?)` - Create a new context (requires `createContext` callback)

## Locator Methods

- `click()`, `dblclick()`, `hover()`, `focus()`
- `fill(text)`, `type(text)`, `clear()`, `press(key)`
- `check()`, `uncheck()`, `selectOption(value)`
- `setInputFiles(files)` - Set files for file input (paths or inline data)
- `screenshot(options?)` - Take element screenshot, returns base64
- `textContent()`, `inputValue()`, `getAttribute(name)`
- `isVisible()`, `isEnabled()`, `isChecked()`, `count()`
- `nth(index)`, `first()`, `last()` - Get specific matching element
- `locator(selector)` - Chain with another selector
- `getByRole()`, `getByText()`, `getByLabel()`, etc. - Chain with getBy* methods

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

`@ricsam/isolate-runtime` and `@ricsam/isolate-client` expose a handler-first
public contract (`playwright.handler`). The `page` field below is for low-level
`setupPlaywright(...)` usage.

```typescript
interface PlaywrightSetupOptions {
  page?: Page;                    // Direct page object (for local use)
  handler?: PlaywrightCallback;   // Handler callback (for remote use)
  timeout?: number;               // Default timeout for operations
  console?: boolean;              // Route browser console logs through console handler
  onEvent?: (event: PlaywrightEvent) => void;  // Unified event callback
  // Security callbacks for file operations
  readFile?: (filePath: string) => Promise<FileData> | FileData;
  writeFile?: (filePath: string, data: Buffer) => Promise<void> | void;
  // Multi-page lifecycle callbacks
  createPage?: (context: BrowserContext) => Promise<Page> | Page;
  createContext?: (options?: BrowserContextOptions) => Promise<BrowserContext> | BrowserContext;
}

interface FileData {
  name: string;      // File name
  mimeType: string;  // MIME type
  buffer: Buffer;    // File contents
}

type PlaywrightEvent =
  | { type: "browserConsoleLog"; level: string; stdout: string; timestamp: number }
  | { type: "networkRequest"; url: string; method: string; headers: Record<string, string>; ... }
  | { type: "networkResponse"; url: string; status: number; headers: Record<string, string>; ... };
```

## Multi-Page Testing

For tests that need multiple pages or contexts, provide the `createPage` and/or `createContext` callbacks:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const browserContext = await browser.newContext();
const page = await browserContext.newPage();

const runtime = await createRuntime({
  testEnvironment: true,
  playwright: {
    handler: defaultPlaywrightHandler(page, {
      // Called when isolate code calls context.newPage(); receive the BrowserContext and call context.newPage()
      createPage: async (context) => context.newPage(),
      // Called when isolate code calls browser.newContext()
      createContext: async (options) => browser.newContext(options),
    }),
  },
});

await runtime.eval(`
  describe("multi-page tests", () => {
    it("can work with multiple pages", async () => {
      // Create a second page in the same context
      const page2 = await context.newPage();

      // Navigate both pages
      await page.goto("https://example.com/page1");
      await page2.goto("https://example.com/page2");

      // Each page maintains its own state
      expect(page.url()).toContain("page1");
      expect(page2.url()).toContain("page2");

      // Interact with elements on different pages
      await page.locator("#button1").click();
      await page2.locator("#button2").click();

      await page2.close();
    });

    it("can work with multiple contexts", async () => {
      // Create an isolated context (separate cookies, storage)
      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();

      await page2.goto("https://example.com");

      // Cookies are isolated between contexts
      await context.addCookies([{ name: "test", value: "1", domain: "example.com", path: "/" }]);
      const ctx1Cookies = await context.cookies();
      const ctx2Cookies = await ctx2.cookies();

      expect(ctx1Cookies.some(c => c.name === "test")).toBe(true);
      expect(ctx2Cookies.some(c => c.name === "test")).toBe(false);

      await ctx2.close();
    });
  });
`);

const results = await runtime.testEnvironment.runTests();
await runtime.dispose();
await browser.close();
```

## File Operations

### Screenshots and PDFs

Screenshots and PDFs return base64-encoded data by default. To save to disk, provide a `writeFile` callback:

```typescript
const handle = await setupPlaywright(context, {
  page,
  writeFile: async (filePath, data) => {
    // Validate and write file
    await fs.writeFile(filePath, data);
  },
});

// In isolate code:
await context.eval(`
  // Returns base64, no file written
  const base64 = await page.screenshot();

  // Returns base64 AND calls writeFile callback
  const base64WithSave = await page.screenshot({ path: '/output/screenshot.png' });

  // PDF works the same way
  const pdfBase64 = await page.pdf({ path: '/output/document.pdf' });
`);
```

With handler-first runtime APIs (`createRuntime({ playwright: { handler } })`), provide
`writeFile` when creating the handler:

```typescript
const handler = defaultPlaywrightHandler(page, {
  writeFile: async (filePath, data) => {
    await fs.writeFile(filePath, data);
  },
});
```

### File Uploads (setInputFiles)

File uploads support these input shapes:

- `"/uploads/document.pdf"`
- `["/uploads/file1.pdf", "/uploads/file2.pdf"]`
- `{ name, mimeType, buffer }`
- `[{ name, mimeType, buffer }, ...]`
- `[]` (clear files)

Mixing paths and inline objects in the same array throws an error.

In page-mode (`setupPlaywright(context, { page, ... })`), provide `readFile` in
`setupPlaywright` options:

```typescript
const handle = await setupPlaywright(context, {
  page,
  readFile: async (filePath) => {
    const buffer = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      mimeType: 'application/octet-stream',
      buffer,
    };
  },
});

// In isolate code:
await context.eval(`
  // Inline data object - no callback needed
  await page.locator('#upload').setInputFiles({
    name: 'single.txt',
    mimeType: 'text/plain',
    buffer: new TextEncoder().encode('Hello!'),
  });

  // Inline data array - no callback needed
  await page.locator('#upload').setInputFiles([{
    name: 'test.txt',
    mimeType: 'text/plain',
    buffer: new TextEncoder().encode('Hello!'),
  }]);

  // File path - calls readFile callback
  await page.locator('#upload').setInputFiles('/uploads/document.pdf');

  // Multiple files
  await page.locator('#upload').setInputFiles([
    '/uploads/file1.pdf',
    '/uploads/file2.pdf',
  ]);

  // Clear files
  await page.locator('#upload').setInputFiles([]);
`);
```

With handler-first runtime APIs (`createRuntime({ playwright: { handler } })`),
provide `readFile` when creating the handler:

```typescript
const handler = defaultPlaywrightHandler(page, {
  readFile: async (filePath) => {
    const buffer = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      mimeType: 'application/octet-stream',
      buffer,
    };
  },
});
```

## License

MIT
