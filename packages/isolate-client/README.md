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
  memoryLimit: 128,
  console: {
    log: (...args) => console.log("[isolate]", ...args),
    error: (...args) => console.error("[isolate]", ...args),
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

Register custom functions callable from isolate code:

```typescript
import bcrypt from "bcrypt";

const runtime = await client.createRuntime({
  customFunctions: {
    // Async function
    hashPassword: {
      fn: async (password: string) => {
        return bcrypt.hash(password, 10);
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
  const config = getConfig();  // sync function, no await needed
  console.log(hash, config.environment);
`);
```

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

```typescript
await runtime.setupTestEnvironment();

await runtime.eval(`
  describe("math", () => {
    it("adds numbers", () => {
      expect(1 + 1).toBe(2);
    });
  });
`);

const results = await runtime.runTests();
console.log(`${results.passed}/${results.total} passed`);
```

## Playwright Integration

```typescript
await runtime.setupPlaywright({
  browserType: "chromium",
  headless: true,
  onConsoleLog: (log) => console.log("[browser]", log),
});

await runtime.eval(`
  test("homepage loads", async () => {
    await page.goto("https://example.com");
    await expect(page.getByText("Example Domain")).toBeVisible();
  });
`);

const results = await runtime.runPlaywrightTests();
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

  // Test environment
  setupTestEnvironment(): Promise<void>;
  runTests(timeout?: number): Promise<TestResults>;
  setupPlaywright(options?: PlaywrightOptions): Promise<void>;
  runPlaywrightTests(): Promise<PlaywrightResults>;
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
```

## License

MIT
