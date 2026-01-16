# @ricsam/isolate-client

Client library for connecting to the isolate daemon. Works with **any JavaScript runtime** (Node.js, Bun, Deno) since it only requires standard socket APIs.

## Installation

```bash
npm add @ricsam/isolate-client
```

## Features

- Connect via Unix socket or TCP
- Create and manage remote runtimes
- Execute code in isolated V8 contexts
- Dispatch HTTP requests to isolate handlers
- Bidirectional callbacks (console, fetch, fs)
- Module loader for custom ES module resolution
- Custom functions callable from isolate code
- Test environment and Playwright support

## Basic Usage

```typescript
import { connect } from "@ricsam/isolate-client";

// Connect to daemon
const client = await connect({
  socket: "/tmp/isolate-daemon.sock",
  // Or TCP: host: "127.0.0.1", port: 47891
});

// Create a runtime with callbacks
const runtime = await client.createRuntime({
  memoryLimitMB: 128,
  console: {
    onEntry: (entry) => console.log("[isolate]", entry),
  },
  fetch: async (request) => fetch(request),
});

// Execute code (always ES module mode)
await runtime.eval(`console.log("Hello from isolate!")`);

// Set up HTTP handler and dispatch requests
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
console.log(await response.json()); // { message: "Hello!" }

// Timers fire automatically with real time
// Clear all pending timers if needed
await runtime.timers.clearAll();

// Console state access
const counters = await runtime.console.getCounters();

// Cleanup
await runtime.dispose();
await client.close();
```

## Module Loader

Register a custom module loader to handle dynamic `import()` calls:

```typescript
const runtime = await client.createRuntime({
  moduleLoader: async (moduleName: string) => {
    if (moduleName === "@/db") {
      return `
        export async function getUser(id) {
          const response = await fetch("/api/users/" + id);
          return response.json();
        }
      `;
    }
    if (moduleName === "@/config") {
      return `export const API_KEY = "sk-xxx";`;
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
});

await runtime.eval(`
  import { getUser } from "@/db";
  import { API_KEY } from "@/config";

  const user = await getUser("123");
  console.log("User:", user, "API Key:", API_KEY);
`);
```

## Custom Functions

Register custom functions callable from isolate code. Each function must specify its `type`:

- `'sync'` - Synchronous function, returns value directly
- `'async'` - Asynchronous function, returns a Promise
- `'asyncIterator'` - Async generator, yields values via `for await...of`

```typescript
import bcrypt from "bcrypt";

const runtime = await client.createRuntime({
  customFunctions: {
    // Async function
    hashPassword: {
      fn: async (password: string) => {
        return bcrypt.hash(password, 10);
      },
      type: 'async',
    },
    // Sync function
    getConfig: {
      fn: () => ({ environment: "production" }),
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
  const hash = await hashPassword("secret123");
  const config = getConfig();  // sync function, no await needed
  console.log(hash, config.environment);

  // Consume async iterator
  for await (const data of streamData(5)) {
    console.log(data.chunk);  // 0, 1, 2, 3, 4
  }
`);
```

### Supported Data Types

Custom function arguments and return values support:

- **Primitives**: `string`, `number`, `boolean`, `null`, `undefined`, `bigint`
- **Web APIs**: `Request`, `Response`, `File`, `Blob`, `FormData`, `Headers`, `URL`
- **Binary**: `Uint8Array`, `ArrayBuffer`
- **Containers**: Arrays, plain objects (nested)
- **Advanced**: `Date`, `RegExp`, `Promise` (nested), `AsyncIterator` (nested), `Function` (returned)

**Unsupported**: Custom class instances, `Symbol`, circular references

See the [full documentation](#custom-functions) for advanced usage examples including nested promises and returned functions.

## File System Callbacks

```typescript
const runtime = await client.createRuntime({
  fs: {
    readFile: async (path) => Bun.file(path).arrayBuffer(),
    writeFile: async (path, data) => Bun.write(path, data),
    stat: async (path) => {
      const stat = await Bun.file(path).stat();
      return { isFile: true, isDirectory: false, size: stat.size };
    },
    readdir: async (path) => {
      const entries = [];
      for await (const entry of new Bun.Glob("*").scan({ cwd: path })) {
        entries.push(entry);
      }
      return entries;
    },
  },
});
```

## Test Environment

Enable test environment to run tests inside the sandbox:

```typescript
const runtime = await client.createRuntime({
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
if (await runtime.testEnvironment.hasTests()) {
  console.log(`Found ${await runtime.testEnvironment.getTestCount()} tests`);
}

const results = await runtime.testEnvironment.runTests();
console.log(`${results.passed}/${results.total} passed, ${results.todo} todo`);

// Reset for new tests
await runtime.testEnvironment.reset();
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

Run browser automation with untrusted code. **The client owns the browser** - you provide the Playwright page object:

### Script Mode (No Tests)

```typescript
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await client.createRuntime({
  playwright: {
    page,
    baseUrl: "https://example.com",
    onEvent: (event) => {
      // Unified event handler for all playwright events
      if (event.type === "browserConsoleLog") {
        console.log(`[browser:${event.level}]`, ...event.args);
      } else if (event.type === "networkRequest") {
        console.log(`[request] ${event.method} ${event.url}`);
      } else if (event.type === "networkResponse") {
        console.log(`[response] ${event.status} ${event.url}`);
      }
    },
  },
});

// Run automation script - no test framework needed
await runtime.eval(`
  await page.goto("/");
  const title = await page.title();
  console.log("Page title:", title);
`);

// Get collected data
const data = await runtime.playwright.getCollectedData();
console.log("Network requests:", data.networkRequests);

await runtime.dispose();
await browser.close();
```

### Test Mode (With Test Framework)

Combine `testEnvironment` and `playwright` for browser testing. Playwright extends `expect` with locator matchers:

```typescript
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await client.createRuntime({
  // Unified console handler for both sandbox and browser logs
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") {
        console.log(`[sandbox:${entry.level}]`, ...entry.args);
      } else if (entry.type === "browserOutput") {
        console.log(`[browser:${entry.level}]`, ...entry.args);
      }
    },
  },
  testEnvironment: true, // Provides describe, it, expect
  playwright: {
    page,
    baseUrl: "https://example.com",
    console: true, // Routes browser logs through the console handler above
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
const data = await runtime.playwright.getCollectedData();
console.log("Browser logs:", data.browserConsoleLogs);

await runtime.dispose();
await browser.close();
```

## Runtime Interface

```typescript
interface RemoteRuntime {
  readonly id: string;
  eval(code: string, filename?: string): Promise<void>;
  dispose(): Promise<void>;

  // Module handles
  readonly fetch: RemoteFetchHandle;
  readonly timers: RemoteTimersHandle;
  readonly console: RemoteConsoleHandle;
  readonly testEnvironment: RemoteTestEnvironmentHandle;
  readonly playwright: RemotePlaywrightHandle;
}

interface RemoteFetchHandle {
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  hasServeHandler(): Promise<boolean>;
  hasActiveConnections(): Promise<boolean>;
  getUpgradeRequest(): Promise<UpgradeRequest | null>;
  // WebSocket methods...
}

interface RemoteTimersHandle {
  clearAll(): Promise<void>;
}

interface RemoteConsoleHandle {
  reset(): Promise<void>;
  getTimers(): Promise<Map<string, number>>;
  getCounters(): Promise<Map<string, number>>;
  getGroupDepth(): Promise<number>;
}

interface RemoteTestEnvironmentHandle {
  runTests(timeout?: number): Promise<RunResults>;
  hasTests(): Promise<boolean>;
  getTestCount(): Promise<number>;
  reset(): Promise<void>;
}

interface RemotePlaywrightHandle {
  getCollectedData(): Promise<CollectedData>;
  clearCollectedData(): Promise<void>;
}
```

## License

MIT
