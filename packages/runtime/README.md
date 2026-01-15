# @ricsam/isolate-runtime

Complete isolated-vm V8 sandbox runtime with all APIs.

## Installation

```bash
npm add @ricsam/isolate-runtime isolated-vm
```

## Usage

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  memoryLimit: 128,
  console: {
    onEntry: (entry) => console.log("[sandbox]", entry),
  },
  fetch: async (request) => fetch(request),
});

// Run code as ES module (supports top-level await)
await runtime.eval(`
  const response = await fetch("https://api.example.com/data");
  console.log(await response.json());
`);

// Set up HTTP server
await runtime.eval(`
  serve({
    fetch(request) {
      return Response.json({ message: "Hello!" });
    }
  });
`);

// Dispatch requests via fetch handle
const response = await runtime.fetch.dispatchRequest(
  new Request("http://localhost/api")
);

// Timers fire automatically with real time
// Clear all pending timers if needed
runtime.timers.clearAll();

// Console state access
const counters = runtime.console.getCounters();
const timers = runtime.console.getTimers();
runtime.console.reset();

// Cleanup
await runtime.dispose();
```

## Runtime Interface

```typescript
interface RuntimeHandle {
  readonly id: string;
  eval(code: string, filename?: string): Promise<void>;
  dispose(): Promise<void>;

  // Module handles
  readonly fetch: RuntimeFetchHandle;
  readonly timers: RuntimeTimersHandle;
  readonly console: RuntimeConsoleHandle;
  readonly testEnvironment: RuntimeTestEnvironmentHandle;
  readonly playwright: RuntimePlaywrightHandle;
}

interface RuntimeFetchHandle {
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  hasServeHandler(): boolean;
  hasActiveConnections(): boolean;
  getUpgradeRequest(): UpgradeRequest | null;
  // WebSocket methods...
}

interface RuntimeTimersHandle {
  clearAll(): void;
}

interface RuntimeConsoleHandle {
  reset(): void;
  getTimers(): Map<string, number>;
  getCounters(): Map<string, number>;
  getGroupDepth(): number;
}

interface RuntimeTestEnvironmentHandle {
  runTests(timeout?: number): Promise<RunResults>;
  hasTests(): boolean;
  getTestCount(): number;
  reset(): void;
}

interface RuntimePlaywrightHandle {
  getCollectedData(): CollectedData;
  clearCollectedData(): void;
}
```

## Options

```typescript
interface RuntimeOptions {
  memoryLimit?: number;
  console?: ConsoleCallbacks;
  fetch?: FetchCallback;
  fs?: FsOptions;
  moduleLoader?: ModuleLoaderCallback;
  customFunctions?: CustomFunctions;
  cwd?: string;
  /** Enable test environment (describe, it, expect) */
  testEnvironment?: boolean | TestEnvironmentOptions;
  /** Playwright options - user provides page object */
  playwright?: PlaywrightOptions;
}

interface PlaywrightOptions {
  page: import("playwright").Page;
  timeout?: number;
  baseUrl?: string;
  /** Print browser console logs to stdout */
  console?: boolean;
  /** Browser console log callback (from the page, not sandbox) */
  onBrowserConsoleLog?: (entry: { level: string; args: unknown[]; timestamp: number }) => void;
  onNetworkRequest?: (info: { url: string; method: string; headers: Record<string, string>; timestamp: number }) => void;
  onNetworkResponse?: (info: { url: string; status: number; headers: Record<string, string>; timestamp: number }) => void;
}
```

## Module Loader

Provide custom ES modules:

```typescript
const runtime = await createRuntime({
  moduleLoader: async (moduleName) => {
    if (moduleName === "@/utils") {
      return `
        export function add(a, b) { return a + b; }
      `;
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
});

await runtime.eval(`
  import { add } from "@/utils";
  console.log(add(2, 3)); // 5
`);
```

## Custom Functions

Expose host functions to the isolate:

```typescript
const runtime = await createRuntime({
  customFunctions: {
    hashPassword: {
      fn: async (password) => bcrypt.hash(password, 10),
      async: true,
    },
    getConfig: {
      fn: () => ({ env: "production" }),
      async: false,
    },
  },
});

await runtime.eval(`
  const hash = await hashPassword("secret");
  const config = getConfig();  // sync function, no await needed
`);
```

## Test Environment

Enable test environment to run tests inside the sandbox:

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  testEnvironment: {
    onEvent: (event) => {
      // Receive lifecycle events during test execution
      if (event.type === "testEnd") {
        const icon = event.test.status === "pass" ? "✓" : "✗";
        console.log(`${icon} ${event.test.fullName}`);
      }
    },
  },
});

await runtime.eval(`
  describe("math", () => {
    it("adds numbers", () => {
      expect(1 + 1).toBe(2);
    });
    it.todo("subtract numbers");
  });
`);

// Check if tests exist before running
if (runtime.testEnvironment.hasTests()) {
  console.log(`Found ${runtime.testEnvironment.getTestCount()} tests`);
}

const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} passed, ${results.todo} todo`);

// Reset for new tests
runtime.testEnvironment.reset();
```

### TestEnvironmentOptions

```typescript
interface TestEnvironmentOptions {
  onEvent?: (event: TestEvent) => void;
  testTimeout?: number;
}

type TestEvent =
  | { type: "runStart"; testCount: number; suiteCount: number }
  | { type: "suiteStart"; suite: SuiteInfo }
  | { type: "suiteEnd"; suite: SuiteResult }
  | { type: "testStart"; test: TestInfo }
  | { type: "testEnd"; test: TestResult }
  | { type: "runEnd"; results: RunResults };
```

## Playwright Integration

Run browser automation with untrusted code. **You provide the Playwright page object**:

### Script Mode (No Tests)

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    page,
    baseUrl: "https://example.com",
    console: true, // Print browser console to stdout
  },
});

// Run automation script - no test framework needed
await runtime.eval(`
  await page.goto("/");
  const title = await page.title();
  console.log("Page title:", title);
`);

// Get collected data
const data = runtime.playwright.getCollectedData();
console.log("Network requests:", data.networkRequests);

await runtime.dispose();
await browser.close();
```

### Test Mode (With Test Framework)

Combine `testEnvironment` and `playwright` for browser testing. Playwright extends `expect` with locator matchers:

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
    onBrowserConsoleLog: (entry) => console.log("[browser]", ...entry.args),
  },
});

await runtime.eval(`
  describe("homepage", () => {
    it("loads correctly", async () => {
      await page.goto("/");
      await expect(page.getByText("Example Domain")).toBeVisible(); // Locator matcher
      expect(await page.title()).toBe("Example Domain"); // Primitive matcher
    });
  });
`);

// Run tests via test-environment
const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} passed`);

// Get browser data
const data = runtime.playwright.getCollectedData();
console.log("Browser logs:", data.browserConsoleLogs);

await runtime.dispose();
await browser.close();
```

## Included APIs

- Core (Blob, File, streams, URL, TextEncoder/Decoder)
- Console
- Encoding (atob/btoa)
- Timers (setTimeout, setInterval)
- Path utilities
- Crypto (randomUUID, getRandomValues, subtle)
- Fetch API
- File System (if handler provided)
- Test Environment (if enabled)
- Playwright (if page provided)

## Legacy API

For backwards compatibility with code that needs direct isolate/context access:

```typescript
import { createLegacyRuntime } from "@ricsam/isolate-runtime";

const runtime = await createLegacyRuntime();
// runtime.isolate and runtime.context are available
await runtime.context.eval(`console.log("Hello")`);
runtime.dispose(); // sync
```

## License

MIT
