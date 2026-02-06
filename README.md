# @ricsam/isolate-*

A WHATWG-compliant JavaScript sandbox built on [isolated-vm](https://github.com/nicknisi/isolated-vm). Run JavaScript in a secure V8 isolate with web-standard APIs (HTTP, file system, streams) where all external operations are proxied through configurable host callbacks.

## Features

- **Fetch API** - `fetch()`, `Request`, `Response`, `Headers`, `FormData`, `AbortController`
- **HTTP Server** - `serve()` with WebSocket support (Bun-compatible API) - [detailed docs](./packages/fetch/README.md)
- **WebSocket Client** - WHATWG-compliant `WebSocket` class for outbound connections
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
        console.log(`[sandbox:${entry.level}]`, entry.stdout);
      }
    },
  },
  fetch: async (url, init) => fetch(url, init),
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

Provide custom ES modules for dependency injection. The module loader receives the module specifier and importer info, and returns an object with the source code and the `resolveDir` (used to resolve nested relative imports):

```typescript
const runtime = await createRuntime({
  moduleLoader: async (moduleName, importer) => {
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
        code: `export const API_KEY = "https://api.example.com";`,
        resolveDir: "/modules",
      };
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
  console: {
    onEntry: (entry) => {
      if (entry.type === "output") console.log(entry.stdout);
    },
  },
  fetch: async (url, init) => fetch(url, init),
});

await runtime.eval(`
  import { getUser } from "@/db";
  import { API_KEY } from "@/config";

  const user = await getUser("123");
  console.log("User:", user, "from", API_KEY);
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
        console.log("[isolate]", entry.stdout);
      }
    },
  },
  fetch: async (url, init) => fetch(url, init),
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
  moduleLoader: async (moduleName, importer) => {
    if (moduleName === "@/auth") {
      return {
        code: `
          export async function login(email, password) {
            const hash = await hashPassword(password);
            return { email, hash };
          }
        `,
        resolveDir: importer.resolveDir,
      };
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
  dispatchRequest(request: Request, options?: { signal?: AbortSignal }): Promise<Response>;
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
  browserConsoleLogs: Array<{ level: string; stdout: string; timestamp: number }>;
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

  /** WebSocket callback - controls outbound WebSocket connections */
  webSocket?: WebSocketCallback;

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

  /** Playwright options - handler-first public API */
  playwright?: PlaywrightOptions;
}

interface PlaywrightOptions {
  /** Playwright operation handler (required when playwright is enabled) */
  handler: (op: PlaywrightOperation) => Promise<PlaywrightResult>;
  /** Default timeout for operations in ms */
  timeout?: number;
  /** Route browser console logs through console handler (or print to stdout if no handler) */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
}

type PlaywrightEvent =
  | { type: "browserConsoleLog"; level: string; stdout: string; timestamp: number }
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
  | { type: "output"; level: "log" | "warn" | "error" | "info" | "debug"; stdout: string; groupDepth: number }
  | { type: "browserOutput"; level: string; stdout: string; timestamp: number } // Browser console (from Playwright page)
  | { type: "dir"; stdout: string; groupDepth: number }
  | { type: "table"; stdout: string; groupDepth: number }
  | { type: "time"; label: string; duration: number; groupDepth: number }
  | { type: "timeLog"; label: string; duration: number; stdout: string; groupDepth: number }
  | { type: "count"; label: string; count: number; groupDepth: number }
  | { type: "countReset"; label: string; groupDepth: number }
  | { type: "assert"; stdout: string; groupDepth: number }
  | { type: "group"; label: string; collapsed: boolean; groupDepth: number }
  | { type: "groupEnd"; groupDepth: number }
  | { type: "clear" }
  | { type: "trace"; stdout: string; stack: string; groupDepth: number };
```

For simple logging, use the `simpleConsoleHandler` helper:

```typescript
import { simpleConsoleHandler } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  console: simpleConsoleHandler({
    log: (msg) => console.log("[sandbox]", msg),
    error: (msg) => console.error("[sandbox]", msg),
  }),
});
```

### Fetch Callback

Handle all `fetch()` calls. Without this callback, fetch is unavailable in the isolate:

```typescript
interface FetchRequestInit {
  method: string;
  headers: [string, string][];
  /** Raw body bytes - use this if you need direct access to the body data */
  rawBody: Uint8Array | null;
  /** Body ready for use with fetch() - same data as rawBody but typed as BodyInit */
  body: BodyInit | null;
  signal: AbortSignal;
}

type FetchCallback = (url: string, init: FetchRequestInit) => Response | Promise<Response>;
```

The callback receives the raw URL string as passed by the isolate code (before any normalization) and an init object with the request details. Use `init.body` directly with `fetch()`, or `init.rawBody` if you need to inspect/modify the raw bytes.

### WebSocket Callback

Control outbound WebSocket connections from isolate code:

```typescript
type WebSocketCallback = (
  url: string,
  protocols: string[]
) => WebSocket | Promise<WebSocket | null> | null;
```

Return values:
- `WebSocket` instance: Use this WebSocket for the connection
- `null`: Block the connection (isolate sees it as a failed connection with `onerror` then `onclose` with code 1006)
- `Promise<WebSocket>`: Async - wait for WebSocket
- `Promise<null>`: Async - block the connection

Example:

```typescript
const runtime = await createRuntime({
  webSocket: async (url, protocols) => {
    // Block certain hosts
    if (url.includes("blocked.com")) {
      return null;
    }
    // Proxy to different server
    if (url.includes("internal")) {
      return new WebSocket("wss://proxy.example.com" + new URL(url).pathname);
    }
    // Allow normally
    return new WebSocket(url, protocols.length > 0 ? protocols : undefined);
  },
});
```

If no callback is provided, all WebSocket connections are auto-allowed.

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

Resolve dynamic imports to JavaScript source code. Returns an object with the code and `resolveDir` (directory path used to resolve nested relative imports from this module):

```typescript
type ModuleLoaderCallback = (
  moduleName: string,
  importer: { path: string; resolveDir: string }
) => { code: string; resolveDir: string } | Promise<{ code: string; resolveDir: string }>;
```

- `importer.path` - The resolved absolute path of the importing module
- `importer.resolveDir` - The directory to resolve relative imports from
- `resolveDir` (return) - Directory path for resolving nested imports from the loaded module

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

## TypeScript Support

Write TypeScript directly in `eval()` calls and module loaders. TypeScript is automatically transformed at runtime using Node.js's native `stripTypeScriptTypes` from `node:module`.

**Requirements:** Node.js >= v24

### Basic Usage

TypeScript works automatically in `eval()`:

```typescript
await runtime.eval(`
  interface User {
    id: number;
    name: string;
  }

  const user: User = { id: 1, name: "Alice" };
  console.log(user.name);
`);
```

### Modules with TypeScript

The module loader also supports TypeScript:

```typescript
const runtime = await createRuntime({
  moduleLoader: async (moduleName, importer) => {
    if (moduleName === "@/types") {
      return {
        code: `
          export interface Config {
            apiUrl: string;
            timeout: number;
          }

          export function createConfig(url: string): Config {
            return { apiUrl: url, timeout: 5000 };
          }
        `,
        resolveDir: "/modules",
      };
    }
    throw new Error(`Unknown module: ${moduleName}`);
  },
});

await runtime.eval(`
  import { createConfig, type Config } from "@/types";

  const config: Config = createConfig("https://api.example.com");
  console.log(config.apiUrl);
`);
```

### What Gets Transformed

The runtime transformation handles:

- **Type annotations** - `const x: number = 1` becomes `const x = 1`
- **Interfaces and type aliases** - Removed entirely
- **Type-only imports** - `import type { Foo }` and `import { type Foo }` are removed
- **Generics** - `Array<string>` becomes `Array`

The transformation uses "strip" mode which preserves line/column positions by replacing types with whitespace, ensuring accurate error stack traces.

### Validations

The following are not allowed in entry code (passed to `eval()`):

- `require()` - Use ES module imports instead
- Dynamic `import()` - Use static import statements
- Top-level `return` - Code runs as a module

### Source Map Support

Error stack traces are automatically mapped back to the original TypeScript source:

```typescript
await runtime.eval(`
  interface Data {
    value: number;
  }

  function process(data: Data): void {
    throw new Error("Something went wrong");
  }

  process({ value: 42 });
`);
// Error stack will reference correct line numbers in your TypeScript code
```

### Runtime vs Type Checking

The runtime transformation only strips types - it does **not** perform type checking. For type safety, use `@ricsam/isolate-types` to typecheck code before execution:

```typescript
import { typecheckIsolateCode } from "@ricsam/isolate-types";

const code = `
  const x: string = 123; // Type error!
`;

// Check types first
const result = typecheckIsolateCode(code);
if (!result.success) {
  console.error("Type errors:", result.errors);
} else {
  // Safe to run
  await runtime.eval(code);
}
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
    | "playwright"      // page, context, browser, Locator matchers
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
// - TYPE_DEFINITIONS.playwright
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

Run browser automation with untrusted code. Public API is handler-first: provide `playwright.handler`.

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

const runtime = await createRuntime({
  playwright: {
    handler: defaultPlaywrightHandler(page),
    onEvent: (event) => {
      // Unified event handler for all playwright events
      switch (event.type) {
        case "browserConsoleLog":
          console.log(`[browser:${event.level}]`, event.stdout);
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
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const runtime = await createRuntime({
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
| [@ricsam/isolate-transform](./packages/transform) | TypeScript transformation (requires Node.js >= v24) |
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
