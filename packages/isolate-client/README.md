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
- **Namespace-based runtime caching** for performance optimization

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
  fetch: async (url, init) => fetch(url, init),
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

## Namespace-Based Runtime Caching

For performance-critical applications, use **namespaces** to cache and reuse runtimes. Namespaced runtimes preserve their V8 isolate, context, and compiled module cache across dispose/create cycles:

```typescript
import { connect } from "@ricsam/isolate-client";

const client = await connect({ socket: "/tmp/isolate.sock" });

// Create a namespace for a tenant/user/session
const namespace = client.createNamespace("tenant-123");

// Create a runtime in this namespace
const runtime = await namespace.createRuntime({
  memoryLimitMB: 128,
  moduleLoader: async (name, importer) => {
    const code = loadModule(name);
    return { code, resolveDir: importer.resolveDir };
  },
});

console.log(runtime.reused); // false - first time

// Import heavy modules (gets compiled and cached)
await runtime.eval(`
  import { heavyLibrary } from "@/heavy-module";
  console.log("Module loaded!");
`);

// Dispose returns runtime to pool (soft-delete)
await runtime.dispose();

// Later: reuse the same namespace (same or different connection!)
const client2 = await connect({ socket: "/tmp/isolate.sock" });
const namespace2 = client2.createNamespace("tenant-123");
const runtime2 = await namespace2.createRuntime({ /* options */ });

console.log(runtime2.reused); // true - reused from pool!
// Module cache preserved - no recompilation needed
await runtime2.eval(`
  import { heavyLibrary } from "@/heavy-module";  // instant!
`);
```

### Namespace Interface

```typescript
interface Namespace {
  /** The namespace ID */
  readonly id: string;
  /** Create a runtime in this namespace (cacheable on dispose) */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
}
```

### What's Preserved vs Reset

**Preserved on reuse (performance benefit):**
- V8 Isolate instance
- V8 Context
- Compiled ES module cache
- Global state and imported modules

**Reset on reuse:**
- Owner connection (new owner)
- Callbacks (re-registered from new client)
- Timers (cleared)
- Console state (counters, timers, groups reset)

### Behavior Notes

- Non-namespaced runtimes (`client.createRuntime()`) work as before - true disposal
- Namespaced runtimes are cached on dispose and evicted via LRU when `maxIsolates` limit is reached
- Cross-client reuse is allowed - any connection can reuse a namespace by ID
- A namespace can only have one active runtime at a time; creating a second runtime with the same namespace ID while one is active will fail
- Concurrent createRuntime calls for the same namespace are rejected with `Namespace "<id>" creation already in progress`

## Module Loader

Register a custom module loader to handle dynamic `import()` calls. The loader receives the module specifier and importer info, and returns an object with the source code and `resolveDir` (used to resolve nested relative imports):

```typescript
const runtime = await client.createRuntime({
  moduleLoader: async (moduleName: string, importer) => {
    // importer.path = resolved path of importing module
    // importer.resolveDir = directory for relative resolution
    if (moduleName === "@/db") {
      return {
        code: `
          export async function getUser(id) {
            const response = await fetch("/api/users/" + id);
            return response.json();
          }
        `,
        resolveDir: "/modules",
      };
    }
    if (moduleName === "@/config") {
      return {
        code: `export const API_KEY = "sk-xxx";`,
        resolveDir: "/modules",
      };
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

## WebSocket Client Callback

Control outbound WebSocket connections from isolate code. The callback lets you allow, block, or proxy WebSocket connections:

```typescript
const runtime = await client.createRuntime({
  webSocket: async (url: string, protocols: string[]) => {
    // Block connections to certain hosts
    if (url.includes("blocked.com")) {
      return null; // Connection blocked
    }

    // Proxy to a different server
    if (url.includes("internal")) {
      return new WebSocket("wss://proxy.example.com" + new URL(url).pathname);
    }

    // Allow connection normally
    return new WebSocket(url, protocols.length > 0 ? protocols : undefined);
  },
});

// Isolate code can now use WHATWG WebSocket API
await runtime.eval(`
  const ws = new WebSocket("wss://api.example.com/stream");

  ws.onopen = () => {
    console.log("Connected!");
    ws.send("Hello server");
  };

  ws.onmessage = (event) => {
    console.log("Received:", event.data);
  };

  ws.onclose = (event) => {
    console.log("Closed:", event.code, event.reason);
  };
`);
```

### WebSocket Callback Behavior

| Return Value | Behavior |
|--------------|----------|
| `WebSocket` instance | Use this WebSocket for the connection |
| `null` | Block the connection (isolate receives error + close events) |
| `Promise<WebSocket>` | Async - wait for WebSocket |
| `Promise<null>` | Async - block the connection |
| Throws/rejects | Block the connection with error |

### What "Blocked" Looks Like in the Isolate

When a connection is blocked, the isolate sees it as a failed connection (similar to server unreachable):

```javascript
const ws = new WebSocket("wss://blocked.com");

ws.onerror = (event) => {
  // Fires first
  console.log("Connection failed");
};

ws.onclose = (event) => {
  // Then fires with:
  console.log(event.code);      // 1006 (Abnormal Closure)
  console.log(event.reason);    // "Connection blocked"
  console.log(event.wasClean);  // false
};

// ws.onopen never fires
```

### Default Behavior

If no `webSocket` callback is provided, connections are allowed automatically:

```typescript
// No callback - all WebSocket connections are auto-allowed
const runtime = await client.createRuntime({});

await runtime.eval(`
  // This will connect directly
  const ws = new WebSocket("wss://echo.websocket.org");
`);
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

Run browser automation with untrusted code. Public API is handler-first:

```typescript
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

playwright: { handler: defaultPlaywrightHandler(page) }
```

### Script Mode (No Tests)

```typescript
import { chromium } from "playwright";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await client.createRuntime({
  playwright: {
    handler: defaultPlaywrightHandler(page),
    timeout: 30000, // Default timeout for operations
    onEvent: (event) => {
      // Unified event handler for all playwright events
      if (event.type === "browserConsoleLog") {
        console.log(`[browser:${event.level}]`, event.stdout);
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
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await client.createRuntime({
  // Unified console handler for both sandbox and browser logs
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") {
        console.log(`[sandbox:${entry.level}]`, entry.stdout);
      } else if (entry.type === "browserOutput") {
        console.log(`[browser:${entry.level}]`, entry.stdout);
      }
    },
  },
  testEnvironment: true, // Provides describe, it, expect
  playwright: {
    handler: defaultPlaywrightHandler(page),
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

### File Operations (Screenshots, PDFs, File Uploads)

For security, file system access requires explicit callbacks. Without these callbacks, operations with file paths will throw errors:

```typescript
import { chromium } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await client.createRuntime({
  testEnvironment: true,
  playwright: {
    handler: defaultPlaywrightHandler(page, {
      // Callback for writing screenshots and PDFs to disk
      writeFile: async (filePath: string, data: Buffer) => {
        // Validate path, then write
        if (!filePath.startsWith("/allowed/output/")) {
          throw new Error("Write not allowed to this path");
        }
        await fs.writeFile(filePath, data);
      },
      // Callback for reading files for setInputFiles()
      readFile: async (filePath: string) => {
        // Validate path, then read
        if (!filePath.startsWith("/allowed/uploads/")) {
          throw new Error("Read not allowed from this path");
        }
        const buffer = await fs.readFile(filePath);
        return {
          name: path.basename(filePath),
          mimeType: "application/octet-stream", // Determine from extension
          buffer,
        };
      },
    }),
  },
});

await runtime.eval(`
  test('file operations', async () => {
    await page.goto('data:text/html,<input type="file" id="upload" />');

    // Screenshot with path - calls writeFile callback
    const base64 = await page.screenshot({ path: '/allowed/output/screenshot.png' });
    // base64 is always returned, writeFile is called additionally

    // PDF with path - calls writeFile callback
    await page.pdf({ path: '/allowed/output/document.pdf' });

    // File upload with path - calls readFile callback
    await page.locator('#upload').setInputFiles('/allowed/uploads/test.txt');

    // File upload with buffer data - no callback needed
    await page.locator('#upload').setInputFiles([{
      name: 'inline.txt',
      mimeType: 'text/plain',
      buffer: new TextEncoder().encode('Hello, World!'),
    }]);
  });
`);
```

**Behavior without callbacks:**
- `screenshot()` / `pdf()` without path: Returns base64 string (works without callback)
- `screenshot({ path })` / `pdf({ path })` without `writeFile`: Throws error
- `setInputFiles('/path')` without `readFile`: Throws error
- `setInputFiles([{ name, mimeType, buffer }])`: Works without callback (inline data)

### Multi-Page Testing

For tests that need multiple pages or browser contexts, provide `createPage` and/or `createContext` callbacks:

```typescript
import { chromium } from "playwright";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const browserContext = await browser.newContext();
const page = await browserContext.newPage();

const runtime = await client.createRuntime({
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
```

**Behavior without lifecycle callbacks:**
- `context.newPage()` without `createPage`: Throws error
- `browser.newContext()` without `createContext`: Throws error
- `context.cookies()`, `context.addCookies()`, `context.clearCookies()`: Work without callbacks

## Runtime Interface

```typescript
interface RemoteRuntime {
  readonly id: string;
  /** True if runtime was reused from namespace pool */
  readonly reused?: boolean;

  eval(code: string, filename?: string): Promise<void>;
  /** Dispose runtime (soft-delete if namespaced, hard delete otherwise) */
  dispose(): Promise<void>;

  // Module handles
  readonly fetch: RemoteFetchHandle;
  readonly timers: RemoteTimersHandle;
  readonly console: RemoteConsoleHandle;
  readonly testEnvironment: RemoteTestEnvironmentHandle;
  readonly playwright: RemotePlaywrightHandle;
}

interface DaemonConnection {
  /** Create a new runtime in the daemon */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
  /** Create a namespace for runtime pooling/reuse */
  createNamespace(id: string): Namespace;
  /** Close the connection */
  close(): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
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
  getCollectedData(): CollectedData;
  clearCollectedData(): void;
}
```

## License

MIT
