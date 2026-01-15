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
    log: (...args) => console.log("[sandbox]", ...args),
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

## Included APIs

- Core (Blob, File, streams, URL, TextEncoder/Decoder)
- Console
- Encoding (atob/btoa)
- Timers (setTimeout, setInterval)
- Path utilities
- Crypto (randomUUID, getRandomValues, subtle)
- Fetch API
- File System (if handler provided)

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
