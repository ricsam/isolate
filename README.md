# @ricsam/isolate-*

A WHATWG-compliant JavaScript sandbox built on [isolated-vm](https://github.com/nicknisi/isolated-vm). Run JavaScript in a secure V8 isolate with web-standard APIs (HTTP, file system, streams) where all external operations are proxied through configurable host callbacks.

## Features

- **Fetch API** - `fetch()`, `Request`, `Response`, `Headers`, `FormData`, `AbortController`
- **HTTP Server** - `serve()` with WebSocket support (Bun-compatible API)
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
  memoryLimit: 128,
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

Expose host functions to the isolate:

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
      async: true,
    },
    // Sync function
    getConfig: {
      fn: () => ({ environment: "production" }),
      async: false,
    },
  },
});

await runtime.eval(`
  const hash = await hashPassword("secret123");
  const config = getConfig();
  console.log(hash, config.environment);
`);
```

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
  memoryLimit: 128,
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
      async: true,
    },
    queryDatabase: {
      fn: async (sql) => db.query(sql),
      async: true,
    },
  },
});

await runtime.eval(`
  import { login } from "@/auth";
  const result = await login("user@example.com", "password");
  console.log(result);
`);
```

## Runtime Interface

Both `@ricsam/isolate-runtime` (local) and `@ricsam/isolate-client` (remote) provide the same unified interface:

```typescript
interface Runtime {
  readonly id: string;

  // Execute code as ES module (supports top-level await)
  eval(code: string, filename?: string): Promise<void>;

  // Release all resources
  dispose(): Promise<void>;

  // Module handles
  readonly fetch: FetchHandle;
  readonly timers: TimersHandle;
  readonly console: ConsoleHandle;
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

interface UpgradeRequest {
  requested: true;
  connectionId: string;
}

interface WebSocketCommand {
  type: "message" | "close";
  connectionId: string;
  data?: string | ArrayBuffer;
  code?: number;
  reason?: string;
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
```

## RuntimeOptions

Configuration options for creating a runtime:

```typescript
interface RuntimeOptions {
  /** Memory limit in MB for the V8 isolate heap */
  memoryLimit?: number;

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
}
```

### Console Callbacks

Handle console output from the isolate using a single structured callback:

```typescript
interface ConsoleCallbacks {
  onEntry?: (entry: ConsoleEntry) => void;
}

type ConsoleEntry =
  | { type: "output"; level: "log" | "warn" | "error" | "info" | "debug"; args: unknown[]; groupDepth: number }
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
type CustomFunctions = Record<string, CustomFunction | CustomFunctionDefinition>;

type CustomFunction = (...args: unknown[]) => unknown | Promise<unknown>;

interface CustomFunctionDefinition {
  /** The function implementation */
  fn: CustomFunction;
  /** Whether the function is async (defaults to true for safety) */
  async?: boolean;
}
```

Example with both sync and async functions:

```typescript
const runtime = await createRuntime({
  customFunctions: {
    // Async function (returns Promise)
    hashPassword: {
      fn: async (password) => bcrypt.hash(password, 10),
      async: true,
    },
    // Sync function (returns value directly)
    getConfig: {
      fn: () => ({ env: "production" }),
      async: false,
    },
    // Shorthand: function directly (treated as async)
    queryDb: async (sql) => db.query(sql),
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

Run tests inside the sandbox:

```typescript
await runtime.setupTestEnvironment();

await runtime.eval(`
  describe("math", () => {
    it("adds numbers", () => {
      expect(1 + 1).toBe(2);
    });

    it("handles async", async () => {
      const result = await Promise.resolve(42);
      expect(result).toBe(42);
    });
  });
`);

const results = await runtime.runTests();
console.log(`${results.passed}/${results.total} passed`);
```

## Playwright Integration

Run browser tests with untrusted code:

```typescript
await runtime.setupPlaywright({
  browserType: "chromium",
  headless: true,
});

await runtime.eval(`
  test("homepage loads", async () => {
    await page.goto("https://example.com");
    await expect(page.getByText("Example Domain")).toBeVisible();
  });
`);

const results = await runtime.runPlaywrightTests();
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
