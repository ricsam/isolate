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
  memoryLimitMB: 128,
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
  memoryLimitMB?: number;
  console?: ConsoleCallbacks;
  fetch?: FetchCallback;
  fs?: FsOptions;
  moduleLoader?: ModuleLoaderCallback;
  customFunctions?: CustomFunctions;
  cwd?: string;
  /** Enable test environment (describe, it, expect) */
  testEnvironment?: boolean | TestEnvironmentOptions;
  /** Playwright options (handler-first public API) */
  playwright?: PlaywrightOptions;
}

interface PlaywrightOptions {
  handler: (op: PlaywrightOperation) => Promise<PlaywrightResult>;
  timeout?: number;
  /** Print browser console logs to stdout */
  console?: boolean;
  onEvent?: (event: PlaywrightEvent) => void;
}
```

## Module Loader

Provide custom ES modules. The loader receives the module specifier and importer info, and returns an object with the source code and `resolveDir` (used to resolve nested relative imports):

```typescript
const runtime = await createRuntime({
  moduleLoader: async (moduleName, importer) => {
    // importer.path = resolved path of importing module
    // importer.resolveDir = directory for relative resolution
    if (moduleName === "@/utils") {
      return {
        code: `
          export function add(a, b) { return a + b; }
        `,
        resolveDir: "/modules",
      };
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

Expose host functions to the isolate. Each function must specify its `type`:

- `'sync'` - Synchronous function, returns value directly
- `'async'` - Asynchronous function, returns a Promise
- `'asyncIterator'` - Async generator, yields values via `for await...of`

```typescript
const runtime = await createRuntime({
  customFunctions: {
    // Async function
    hashPassword: {
      fn: async (password) => bcrypt.hash(password, 10),
      type: 'async',
    },
    // Sync function
    getConfig: {
      fn: () => ({ env: "production" }),
      type: 'sync',
    },
    // Async iterator (generator)
    streamData: {
      fn: async function* (count: number) {
        for (let i = 0; i < count; i++) {
          yield { chunk: i, timestamp: Date.now() };
        }
      },
      type: 'asyncIterator',
    },
  },
});

await runtime.eval(`
  const hash = await hashPassword("secret");
  const config = getConfig();  // sync function, no await needed

  // Consume async iterator
  for await (const data of streamData(5)) {
    console.log(data.chunk);  // 0, 1, 2, 3, 4
  }
`);
```

### Supported Data Types

Custom function arguments and return values support the following types:

| Category | Types |
|----------|-------|
| **Primitives** | `string`, `number`, `boolean`, `null`, `undefined`, `bigint` |
| **Complex** | `Date`, `RegExp`, `URL`, `Headers` |
| **Binary** | `Uint8Array`, `ArrayBuffer` |
| **Web API** | `Request`, `Response`, `File`, `Blob`, `FormData` |
| **Containers** | Arrays, plain objects (nested) |
| **Async** | `Promise` (nested), `AsyncIterator` (nested), `Function` (returned) |

**Advanced return types:**

```typescript
const runtime = await createRuntime({
  customFunctions: {
    // Return a function - callable from isolate
    getMultiplier: {
      fn: (factor: number) => (x: number) => x * factor,
      type: 'sync',
    },
    // Return nested promises - awaitable from isolate
    fetchBoth: {
      fn: () => ({
        users: fetch('/api/users').then(r => r.json()),
        posts: fetch('/api/posts').then(r => r.json()),
      }),
      type: 'sync',
    },
  },
});

await runtime.eval(`
  const double = getMultiplier(2);
  console.log(double(5)); // 10

  const { users, posts } = fetchBoth();
  console.log(await users, await posts);
`);
```

**Unsupported types:**
- Custom class instances (use plain objects instead)
- `Symbol`
- Circular references

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

Run browser automation with untrusted code. Public API is handler-first:

```typescript
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

playwright: { handler: defaultPlaywrightHandler(page) }
```

### Script Mode (No Tests)

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";
import { chromium } from "playwright";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    handler: defaultPlaywrightHandler(page),
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
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  testEnvironment: true, // Provides describe, it, expect
  playwright: {
    handler: defaultPlaywrightHandler(page),
    onEvent: (event) => {
      if (event.type === "browserConsoleLog") {
        console.log("[browser]", event.stdout);
      }
    },
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

### Multi-Page Testing

For tests that need multiple pages or browser contexts, provide `createPage` and/or `createContext` callbacks:

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
      // Called when isolate code calls context.newPage()
      createPage: async (context) => context.newPage(),
      // Called when isolate code calls browser.newContext()
      createContext: async (options) => browser.newContext(options),
    }),
  },
});

await runtime.eval(`
  test('multi-page test', async () => {
    // Create additional pages
    const page2 = await context.newPage();

    // Navigate independently
    await page.goto('https://example.com/page1');
    await page2.goto('https://example.com/page2');

    // Work with multiple pages
    await page.locator('#button').click();
    await page2.locator('#input').fill('text');

    await page2.close();
  });

  test('multi-context test', async () => {
    // Create isolated context (separate cookies, storage)
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    // Cookies are isolated between contexts
    await context.addCookies([{ name: 'test', value: '1', domain: 'example.com', path: '/' }]);
    const ctx1Cookies = await context.cookies();
    const ctx2Cookies = await ctx2.cookies();

    expect(ctx1Cookies.some(c => c.name === 'test')).toBe(true);
    expect(ctx2Cookies.some(c => c.name === 'test')).toBe(false);

    await ctx2.close();
  });
`);

const results = await runtime.testEnvironment.runTests();
await runtime.dispose();
await browser.close();
```

**Behavior without lifecycle callbacks:**
- `context.newPage()` without `createPage`: Throws error
- `browser.newContext()` without `createContext`: Throws error
- `context.cookies()`, `context.addCookies()`, `context.clearCookies()`: Work without callbacks

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
- Playwright (if handler provided)

## License

MIT
