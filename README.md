# @ricsam/isolate-*

A WHATWG-compliant JavaScript sandbox built on [isolated-vm](https://github.com/nicknisi/isolated-vm). Run JavaScript in a secure V8 isolate with web-standard APIs (HTTP, file system, streams) where all external operations are proxied through configurable host callbacks.

## Features

- **Fetch API** - `fetch()`, `Request`, `Response`, `Headers`, `FormData`, `AbortController`
- **HTTP Server** - `serve()` with WebSocket support (Bun-compatible API) - [detailed docs](./packages/fetch/README.md)
- **File System** - OPFS-compatible API with `FileSystemDirectoryHandle`, `FileSystemFileHandle`
- **Streams** - `ReadableStream`, `WritableStream`, `TransformStream`
- **Blob/File** - Full `Blob` and `File` implementations
- **Console** - Full `console` object with logging, timing, counting, and grouping
- **Crypto** - Web Crypto API with `crypto.subtle`, `getRandomValues()`, `randomUUID()`
- **Encoding** - `atob()` and `btoa()` for Base64 encoding/decoding
- **Path** - Node.js-compatible path utilities (`path.join`, `path.resolve`, etc.)
- **Timers** - `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`
- **ES Modules** - Top-level await, dynamic imports with custom module loader
- **Custom Functions** - Call host functions directly from isolate code
- **Test Environment** - `describe()`, `it()`, `expect()` for running tests in sandboxed V8
- **Playwright Bridge** - Run Playwright browser tests with untrusted code in a V8 sandbox

## Installation

```bash
# For direct usage in Node.js
npm add @ricsam/isolate-runtime isolated-vm

# For daemon/client architecture (works with Bun, Deno, Node.js)
npm add @ricsam/isolate-daemon  # Server (Node.js only)
npm add @ricsam/isolate-client  # Client (any runtime)
```

## Quick Start

### Local Runtime (Node.js)

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  memoryLimitMB: 128,
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") {
        console.log(`[sandbox:${entry.level}]`, ...entry.args);
      }
    },
  },
  fetch: async (request) => fetch(request),
});

// Run code as ES module (supports top-level await)
await runtime.eval(`
  const response = await fetch("https://api.example.com/data");
  const data = await response.json();
  console.log("Got data:", data);
`);

// Set up HTTP server handler
await runtime.eval(`
  serve({
    fetch(request) {
      const url = new URL(request.url);
      return Response.json({ path: url.pathname });
    }
  });
`);

// Dispatch requests to the handler
const response = await runtime.fetch.dispatchRequest(
  new Request("http://localhost/api/users")
);
console.log(await response.json()); // { path: "/api/users" }

// Timers fire automatically with real time
// Clear all pending timers if needed
runtime.timers.clearAll();

// Cleanup
await runtime.dispose();
```

### Module Loader

Provide custom ES modules for dependency injection:

```typescript
const runtime = await createRuntime({
  moduleLoader: async (moduleName) => {
    if (moduleName === "@/db") {
      return `
        export async function getUser(id) {
          const response = await fetch("/api/users/" + id);
          return response.json();
        }
      `;
    }
    if (moduleName === "@/config") {
      return `export const API_URL = "https://api.example.com";`;
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") console.log(...entry.args);
    },
  },
  fetch: async (req) => fetch(req),
});

await runtime.eval(`
  import { getUser } from "@/db";
  import { API_URL } from "@/config";

  const user = await getUser("123");
  console.log("User:", user, "from", API_URL);
`);
```

### Custom Functions

Expose host functions to the isolate. Each function must specify its `type`:

- `'sync'` - Synchronous function, returns value directly
- `'async'` - Asynchronous function, returns a Promise
- `'asyncIterator'` - Async generator, yields values via `for await...of`

```typescript
import bcrypt from "bcrypt";
import z from 'zod';

const runtime = await createRuntime({
  customFunctions: {
    // Async function
    hashPassword: {
      fn: async (password: unknown) => {
        return bcrypt.hash(z.string().parse(password), 10);
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
  const config = getConfig();
  console.log(hash, config.environment);

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
    // Return nested async iterators
    getStreams: {
      fn: () => ({
        numbers: (async function* () { yield 1; yield 2; })(),
        letters: (async function* () { yield 'a'; yield 'b'; })(),
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

  const streams = getStreams();
  for await (const n of streams.numbers) console.log(n);
`);
```

**Unsupported types:**
- Custom class instances (use plain objects instead)
- `Symbol`
- Circular references

## Daemon/Client Architecture

The `isolated-vm` package only works in Node.js. Use the daemon/client architecture to run isolated code from **any JavaScript runtime** (Bun, Deno, etc.).

```
┌─────────────────┐         Unix Socket          ┌─────────────────────┐
│   Bun/Deno      │ ◄──────────────────────────► │   Node.js Daemon    │
│   Client App    │      MessagePack frames      │                     │
│ isolate-client  │                              │  isolate-daemon     │
└─────────────────┘                              └──────────┬──────────┘
                                                            │
                                          ┌─────────────────┼─────────────────┐
                                          ▼                 ▼                 ▼
                                   ┌───────────┐    ┌─────────────┐    ┌───────────┐
                                   │isolated-vm│    │ Playwright  │    │   Test    │
                                   │(V8 Isolate│    │  (Browser)  │    │Environment│
                                   └───────────┘    └─────────────┘    └───────────┘
```

### Step 1: Start the Daemon (Node.js)

```bash
# Via CLI
npx isolate-daemon --socket /tmp/isolate.sock

# Or programmatically
import { startDaemon } from "@ricsam/isolate-daemon";

const daemon = await startDaemon({
  socketPath: "/tmp/isolate.sock",
  maxIsolates: 100,
  defaultMemoryLimit: 128,
});
```

### Step 2: Connect from Any Runtime

```typescript
// Works in Bun, Deno, or Node.js
import { connect } from "@ricsam/isolate-client";

const client = await connect({ socket: "/tmp/isolate.sock" });

const runtime = await client.createRuntime({
  memoryLimitMB: 128,
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") {
        console.log("[isolate]", ...entry.args);
      }
    },
  },
  fetch: async (request) => fetch(request),
  fs: {
    readFile: async (path) => Bun.file(path).arrayBuffer(),
    writeFile: async (path, data) => Bun.write(path, data),
  },
});

// Same unified API as local runtime
await runtime.eval(`
  console.log("Hello from isolate!");
  const response = await fetch("https://api.example.com");
  console.log(await response.json());
`);

// HTTP server
await runtime.eval(`
  serve({
    fetch(request) {
      return Response.json({ message: "Hello!" });
    }
  });
`);

const response = await runtime.fetch.dispatchRequest(
  new Request("http://localhost/api")
);

// Timers fire automatically with real time
await runtime.timers.clearAll();

await runtime.dispose();
await client.close();
```

### Module Loader and Custom Functions (Remote)

```typescript
const runtime = await client.createRuntime({
  moduleLoader: async (moduleName) => {
    if (moduleName === "@/auth") {
      return `
        export async function login(email, password) {
          const hash = await hashPassword(password);
          return { email, hash };
        }
      `;
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
  customFunctions: {
    hashPassword: {
      fn: async (pw) => Bun.password.hash(pw),
      type: 'async',
    },
    queryDatabase: {
      fn: async (sql) => db.query(sql),
      type: 'async',
    },
  },
});

await runtime.eval(`
  import { login } from "@/auth";
  const result = await login("user@example.com", "password");
  console.log(result);
`);
```

### Runtime Caching with Namespaces

For performance-critical applications, use **namespaces** to cache and reuse runtimes. Namespaced runtimes preserve their V8 isolate, context, and compiled module cache across dispose/create cycles:

```typescript
const client = await connect({ socket: "/tmp/isolate.sock" });

// Create a namespace for a tenant/user/session
const namespace = client.createNamespace("tenant-123");

// Create a runtime in this namespace
const runtime = await namespace.createRuntime({
  memoryLimitMB: 128,
  moduleLoader: async (name) => loadModule(name),
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
const runtime2 = await namespace2.createRuntime({ /* same options */ });

console.log(runtime2.reused); // true - reused from pool!
// Module cache preserved - no recompilation needed
await runtime2.eval(`
  import { heavyLibrary } from "@/heavy-module";  // instant!
`);
```

**What's preserved on reuse:**
- V8 Isolate instance
- V8 Context
- Compiled ES module cache
- Global state and imported modules

**What's reset on reuse:**
- Owner connection (new owner)
- Callbacks (re-registered from new client)
- Timers (cleared)
- Console state (counters, timers, groups reset)

**Namespace behavior:**
- Non-namespaced runtimes (`client.createRuntime()`) work as before - true disposal
- Namespaced runtimes are cached on dispose and evicted via LRU when `maxIsolates` limit is reached
- Cross-client reuse is allowed - any connection can reuse a namespace by ID

## Runtime Interface

Both `@ricsam/isolate-runtime` (local) and `@ricsam/isolate-client` (remote) provide the same unified interface:

```typescript
interface Runtime {
  readonly id: string;

  /** True if runtime was reused from namespace pool (remote only) */
  readonly reused?: boolean;

  // Execute code as ES module (supports top-level await)
  eval(code: string, filename?: string): Promise<void>;

  // Release all resources (soft-delete if namespaced, hard delete otherwise)
  dispose(): Promise<void>;

  // Module handles
  readonly fetch: FetchHandle;
  readonly timers: TimersHandle;
  readonly console: ConsoleHandle;
  readonly testEnvironment: TestEnvironmentHandle;
  readonly playwright: PlaywrightHandle;
}

interface FetchHandle {
  /** Dispatch HTTP request to serve() handler */
  dispatchRequest(request: Request, options?: { timeout?: number }): Promise<Response>;
  /** Check if serve() has been called */
  hasServeHandler(): boolean;
  /** Check if there are active WebSocket connections */
  hasActiveConnections(): boolean;

  // WebSocket methods
  /** Check if isolate requested WebSocket upgrade */
  getUpgradeRequest(): UpgradeRequest | null;
  /** Dispatch WebSocket open event to isolate */
  dispatchWebSocketOpen(connectionId: string): void;
  /** Dispatch WebSocket message event to isolate */
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): void;
  /** Dispatch WebSocket close event to isolate */
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): void;
  /** Dispatch WebSocket error event to isolate */
  dispatchWebSocketError(connectionId: string, error: Error): void;
  /** Register callback for WebSocket commands from isolate */
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
}

interface TimersHandle {
  clearAll(): void;
}

interface ConsoleHandle {
  reset(): void;
  getTimers(): Map<string, number>;
  getCounters(): Map<string, number>;
  getGroupDepth(): number;
}

interface TestEnvironmentHandle {
  /** Run all registered tests */
  runTests(timeout?: number): Promise<RunResults>;
  /** Check if any tests have been registered */
  hasTests(): boolean;
  /** Get the number of registered tests */
  getTestCount(): number;
  /** Reset test environment state */
  reset(): void;
}

interface PlaywrightHandle {
  /** Get collected browser console logs and network data */
  getCollectedData(): CollectedData;
  /** Clear collected data */
  clearCollectedData(): void;
}

interface CollectedData {
  /** Browser console logs (from the page, not sandbox) */
  browserConsoleLogs: Array<{ level: string; args: unknown[]; timestamp: number }>;
  networkRequests: Array<{ url: string; method: string; headers: Record<string, string>; timestamp: number }>;
  networkResponses: Array<{ url: string; status: number; headers: Record<string, string>; timestamp: number }>;
}
```

## RuntimeOptions

Configuration options for creating a runtime:

```typescript
interface RuntimeOptions {
  /** Memory limit in megabytes for the V8 isolate heap */
  memoryLimitMB?: number;

  /** Console callback handlers - receive console.* calls from the isolate */
  console?: ConsoleCallbacks;

  /** Fetch callback - handles all fetch() calls from the isolate */
  fetch?: FetchCallback;

  /** File system callbacks - handles OPFS-style file operations */
  fs?: FileSystemCallbacks;

  /** Module loader - resolves dynamic imports to source code */
  moduleLoader?: ModuleLoaderCallback;

  /** Custom functions - expose host functions to the isolate */
  customFunctions?: CustomFunctions;

  /** Current working directory for path.resolve(). Defaults to "/" */
  cwd?: string;

  /** Enable test environment (describe, it, expect, etc.) */
  testEnvironment?: boolean | TestEnvironmentOptions;

  /** Playwright options - user provides page object */
  playwright?: PlaywrightOptions;
}

interface PlaywrightOptions {
  /** Playwright page object */
  page: import("playwright").Page;
  /** Default timeout for operations in ms */
  timeout?: number;
  /** Base URL for navigation */
  baseUrl?: string;
  /** Route browser console logs through console handler (or print to stdout if no handler) */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
}

type PlaywrightEvent =
  | { type: "browserConsoleLog"; level: string; args: unknown[]; timestamp: number }
  | { type: "networkRequest"; url: string; method: string; headers: Record<string, string>; postData?: string; resourceType?: string; timestamp: number }
  | { type: "networkResponse"; url: string; status: number; statusText?: string; headers: Record<string, string>; timestamp: number };
```

### Console Callbacks

Handle console output from the isolate using a single structured callback:

```typescript
interface ConsoleCallbacks {
  onEntry?: (entry: ConsoleEntry) => void;
}

type ConsoleEntry =
  | { type: "output"; level: "log" | "warn" | "error" | "info" | "debug"; args: unknown[]; groupDepth: number }
  | { type: "browserOutput"; level: string; args: unknown[]; timestamp: number } // Browser console (from Playwright page)
  | { type: "dir"; value: unknown; groupDepth: number }
  | { type: "table"; data: unknown; columns?: string[]; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | { type: "timeLog"; label: string; duration: number; args: unknown[]; groupDepth: number }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; args: unknown[]; groupDepth: number }
  | { type: "group"; label: string; collapsed: boolean; groupDepth: number }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; args: unknown[]; stack: string; groupDepth: number };
```

For simple logging, use the `simpleConsoleHandler` helper:

```typescript
import { simpleConsoleHandler } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  console: simpleConsoleHandler({
    log: (...args) => console.log("[sandbox]", ...args),
    error: (...args) => console.error("[sandbox]", ...args),
  }),
});
```

### Fetch Callback

Handle all `fetch()` calls. Without this callback, fetch is unavailable in the isolate:

```typescript
type FetchCallback = (request: Request) => Response | Promise<Response>;
```

### File System Callbacks

Handle file system operations (used by the OPFS-compatible API inside the isolate):

```typescript
interface FileSystemCallbacks {
  readFile?: (path: string) => Promise<ArrayBuffer>;
  writeFile?: (path: string, data: ArrayBuffer) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  readdir?: (path: string) => Promise<string[]>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rmdir?: (path: string) => Promise<void>;
  stat?: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  rename?: (from: string, to: string) => Promise<void>;
}
```

### Module Loader Callback

Resolve dynamic imports to JavaScript source code:

```typescript
type ModuleLoaderCallback = (moduleName: string) => string | Promise<string>;
```

### Custom Functions

Expose host functions that can be called directly from isolate code:

```typescript
type CustomFunctions = Record<string, CustomFunctionDefinition>;

type CustomFunction = (...args: unknown[]) => unknown | Promise<unknown>;
type CustomAsyncGeneratorFunction = (...args: unknown[]) => AsyncGenerator<unknown, unknown, unknown>;
type CustomFunctionType = 'sync' | 'async' | 'asyncIterator';

interface CustomFunctionDefinition {
  /** The function implementation */
  fn: CustomFunction | CustomAsyncGeneratorFunction;
  /** The function type (required) */
  type: CustomFunctionType;
}
```

Example with sync, async, and async iterator functions:

```typescript
const runtime = await createRuntime({
  customFunctions: {
    // Async function (returns Promise)
    hashPassword: {
      fn: async (password) => bcrypt.hash(password, 10),
      type: 'async',
    },
    // Sync function (returns value directly)
    getConfig: {
      fn: () => ({ env: "production" }),
      type: 'sync',
    },
    // Async iterator (yields values)
    streamData: {
      fn: async function* (count: number) {
        for (let i = 0; i < count; i++) yield i;
      },
      type: 'asyncIterator',
    },
  },
});
```

## Type Checking Untrusted Code

The `@ricsam/isolate-types` package provides utilities to typecheck code before running it in the sandbox:

```bash
npm add @ricsam/isolate-types
```

### Basic Usage

```typescript
import { typecheckIsolateCode, formatTypecheckErrors } from "@ricsam/isolate-types";

const userCode = `
  serve({
    fetch(request, server) {
      return new Response("Hello!");
    }
  });
`;

const result = typecheckIsolateCode(userCode, {
  include: ["core", "fetch"],
});

if (!result.success) {
  console.error(formatTypecheckErrors(result));
  // usercode.ts:3:12 (TS2345): Argument of type '...' is not assignable...
}
```

### TypecheckOptions

```typescript
interface TypecheckOptions {
  /**
   * Which isolate global types to include.
   * @default ["core", "fetch", "fs"]
   */
  include?: Array<
    | "core"        // ReadableStream, Blob, File, URL, etc.
    | "fetch"       // fetch(), Request, Response, Headers, serve()
    | "fs"          // getDirectory(), FileSystemDirectoryHandle, etc.
    | "console"     // console.log, console.error, etc.
    | "encoding"    // atob(), btoa()
    | "timers"      // setTimeout, setInterval, etc.
    | "testEnvironment" // describe(), it(), expect()
  >;

  /**
   * Library type definitions to inject for import resolution.
   * Allows typechecking code that imports external modules.
   */
  libraryTypes?: Record<string, LibraryTypes>;

  /**
   * Additional TypeScript compiler options.
   */
  compilerOptions?: Partial<ts.CompilerOptions>;
}
```

### TypecheckResult

```typescript
interface TypecheckResult {
  /** Whether the code passed type checking */
  success: boolean;
  /** Array of type errors found */
  errors: TypecheckError[];
}

interface TypecheckError {
  /** The error message from TypeScript */
  message: string;
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
  /** TypeScript error code */
  code?: number;
}
```

### Using TYPE_DEFINITIONS Directly

For advanced use cases (e.g., custom ts-morph setups), you can access the raw type definition strings:

```typescript
import { TYPE_DEFINITIONS } from "@ricsam/isolate-types";

// Available type definition keys:
// - TYPE_DEFINITIONS.core
// - TYPE_DEFINITIONS.console
// - TYPE_DEFINITIONS.crypto
// - TYPE_DEFINITIONS.encoding
// - TYPE_DEFINITIONS.fetch
// - TYPE_DEFINITIONS.fs
// - TYPE_DEFINITIONS.path
// - TYPE_DEFINITIONS.testEnvironment
// - TYPE_DEFINITIONS.timers

// Use with ts-morph
import { Project } from "ts-morph";

const project = new Project({ useInMemoryFileSystem: true });
project.createSourceFile("isolate-fetch.d.ts", TYPE_DEFINITIONS.fetch);
project.createSourceFile("isolate-core.d.ts", TYPE_DEFINITIONS.core);
project.createSourceFile("usercode.ts", userCode);

const diagnostics = project.getPreEmitDiagnostics();
```

## Test Environment

Run tests inside the sandbox by enabling `testEnvironment` in options:

```typescript
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

    it("handles async", async () => {
      const result = await Promise.resolve(42);
      expect(result).toBe(42);
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

// Reset test environment for new tests
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

interface RunResults {
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  total: number;
  duration: number;
  success: boolean;
  suites: SuiteResult[];
  tests: TestResult[];
}
```

## Playwright Integration

Run browser automation with untrusted code. **The client owns the browser** - you provide the Playwright page object.

### Script Mode (No Tests)

```typescript
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
  playwright: {
    page,
    baseUrl: "https://example.com",
    onEvent: (event) => {
      // Unified event handler for all playwright events
      switch (event.type) {
        case "browserConsoleLog":
          console.log(`[browser:${event.level}]`, ...event.args);
          break;
        case "networkRequest":
          console.log(`[request] ${event.method} ${event.url}`);
          break;
        case "networkResponse":
          console.log(`[response] ${event.status} ${event.url}`);
          break;
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

// Get collected network data
const data = runtime.playwright.getCollectedData();
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

const runtime = await createRuntime({
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

// Get collected browser data
const data = runtime.playwright.getCollectedData();
console.log("Browser logs:", data.browserConsoleLogs);
console.log("Network requests:", data.networkRequests);

// Cleanup
await runtime.dispose();
await browser.close();
```

## Packages

| Package | Description |
|---------|-------------|
| [@ricsam/isolate-runtime](./packages/runtime) | Complete runtime with all APIs (Node.js) |
| [@ricsam/isolate-daemon](./packages/isolate-daemon) | Daemon server for IPC-based isolation |
| [@ricsam/isolate-client](./packages/isolate-client) | Client for any JavaScript runtime |
| [@ricsam/isolate-protocol](./packages/isolate-protocol) | Binary protocol for daemon communication |
| [@ricsam/isolate-core](./packages/core) | Core utilities (Blob, File, streams, URL) |
| [@ricsam/isolate-fetch](./packages/fetch) | Fetch API and HTTP server |
| [@ricsam/isolate-fs](./packages/fs) | File System Access API |
| [@ricsam/isolate-console](./packages/console) | Console API |
| [@ricsam/isolate-crypto](./packages/crypto) | Web Crypto API |
| [@ricsam/isolate-encoding](./packages/encoding) | Base64 encoding (atob, btoa) |
| [@ricsam/isolate-path](./packages/path) | Path utilities |
| [@ricsam/isolate-timers](./packages/timers) | Timer APIs |
| [@ricsam/isolate-test-environment](./packages/test-environment) | Test primitives (describe, it, expect) |
| [@ricsam/isolate-playwright](./packages/playwright) | Playwright browser testing bridge |
| [@ricsam/isolate-types](./packages/isolate-types) | Type definitions and type checking |
| [@ricsam/isolate-test-utils](./packages/test-utils) | Testing utilities |

## Security

- **True V8 Isolation** - Code runs in a separate V8 isolate with its own heap
- **No automatic network access** - `fetch` callback must be explicitly provided
- **File system isolation** - `fs` callbacks control all path access
- **Memory limits** - Configure maximum heap size per isolate
- **No Node.js APIs** - Sandbox has no access to `require`, `process`, `fs`, etc.

## Development

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
