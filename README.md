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
- **Test Environment** - `describe()`, `it()`, `expect()` for running tests in sandboxed V8 with customizable result handlers

## Installation

```bash
npm add @ricsam/isolate-runtime isolated-vm
```

Or install individual packages:

```bash
npm add @ricsam/isolate-core             # Streams, Blob, File, URL
npm add @ricsam/isolate-fetch            # Fetch API, HTTP server
npm add @ricsam/isolate-fs               # File System API
npm add @ricsam/isolate-console          # Console API
npm add @ricsam/isolate-crypto           # Web Crypto API
npm add @ricsam/isolate-encoding         # Base64 encoding (atob, btoa)
npm add @ricsam/isolate-path             # Path utilities
npm add @ricsam/isolate-timers           # Timer APIs
npm add @ricsam/isolate-test-environment # Test primitives (describe, it, expect)
npm add @ricsam/isolate-test-utils       # Testing utilities and type checking
```

## Quick Start

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  memoryLimit: 128, // 128 MB limit
  console: {
    onLog: (level, ...args) => console.log(`[sandbox ${level}]`, ...args),
  },
  fetch: {
    onFetch: async (request) => fetch(request), // Proxy to host
  },
  fs: {
    // Return a FileSystemHandler for the given directory path
    getDirectory: async (path) => createNodeFileSystemHandler(`./data${path}`),
  },
});

// Run sandboxed code
await runtime.context.eval(`
  serve({
    async fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/api/files") {
        const root = await getDirectory("/data");
        const entries = [];
        for await (const [name] of root.entries()) {
          entries.push(name);
        }
        return Response.json(entries);
      }

      return new Response("Hello from V8 sandbox!");
    }
  });
`, { promise: true });

// Process any pending timers
await runtime.tick();

// Cleanup
runtime.dispose();
```

## Packages

<!-- BEGIN:core -->
### @ricsam/isolate-core

Core utilities and Web Streams API.

```typescript
import { setupCore } from "@ricsam/isolate-core";

const handle = await setupCore(context);
```

**Injected Globals:**
- `ReadableStream`, `WritableStream`, `TransformStream`
- `ReadableStreamDefaultReader`, `WritableStreamDefaultWriter`
- `Blob`, `File`
- `URL`, `URLSearchParams`
- `DOMException`
- `TextEncoder`, `TextDecoder`

**Usage in Isolate:**

```javascript
// Streams
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue("chunk1");
    controller.enqueue("chunk2");
    controller.close();
  }
});

const reader = stream.getReader();
const { value, done } = await reader.read();

// Blob
const blob = new Blob(["hello", " ", "world"], { type: "text/plain" });
const text = await blob.text(); // "hello world"

// File
const file = new File(["content"], "file.txt", { type: "text/plain" });
console.log(file.name); // "file.txt"
```
<!-- END:core -->

---

<!-- BEGIN:console -->
### @ricsam/isolate-console

Console API with logging, timing, counting, and grouping.

```typescript
import { setupConsole } from "@ricsam/isolate-console";

const handle = await setupConsole(context, {
  onLog: (level, ...args) => {
    console.log(`[${level}]`, ...args);
  },
  onTime: (label, duration) => {
    console.log(`${label}: ${duration}ms`);
  },
  onCount: (label, count) => {
    console.log(`${label}: ${count}`);
  },
});
```

**Injected Globals:**
- `console.log`, `console.warn`, `console.error`, `console.debug`, `console.info`
- `console.trace`, `console.dir`, `console.table`
- `console.time`, `console.timeEnd`, `console.timeLog`
- `console.count`, `console.countReset`
- `console.group`, `console.groupCollapsed`, `console.groupEnd`
- `console.assert`, `console.clear`

**Usage in Isolate:**

```javascript
// Basic logging
console.log("Hello", { name: "World" });
console.warn("Warning message");
console.error("Error occurred");

// Timing
console.time("operation");
// ... do work ...
console.timeLog("operation", "checkpoint");
// ... more work ...
console.timeEnd("operation"); // Logs: "operation: 123ms"

// Counting
console.count("clicks");     // clicks: 1
console.count("clicks");     // clicks: 2
console.countReset("clicks");
console.count("clicks");     // clicks: 1

// Grouping
console.group("User Info");
console.log("Name: John");
console.log("Age: 30");
console.groupEnd();
```

**Event Handlers:**

| Handler | Description |
|---------|-------------|
| `onLog` | Called for log, warn, error, debug, info, trace, dir, table |
| `onTime` | Called when `console.timeEnd` completes a timer |
| `onTimeLog` | Called when `console.timeLog` logs without ending |
| `onCount` | Called when `console.count` increments |
| `onCountReset` | Called when `console.countReset` resets a counter |
| `onGroup` | Called when `console.group` or `groupCollapsed` is invoked |
| `onGroupEnd` | Called when `console.groupEnd` is invoked |
| `onAssert` | Called when `console.assert` fails |
| `onClear` | Called when `console.clear` is invoked |
<!-- END:console -->

---

<!-- BEGIN:crypto -->
### @ricsam/isolate-crypto

Web Crypto API implementation providing cryptographic operations.

```typescript
import { setupCrypto } from "@ricsam/isolate-crypto";

const handle = await setupCrypto(context);
```

**Injected Globals:**
- `crypto.getRandomValues(array)` - Fill a TypedArray with random bytes
- `crypto.randomUUID()` - Generate a random UUID v4
- `crypto.subtle` - SubtleCrypto interface for cryptographic operations

**Usage in Isolate:**

```javascript
// Generate random bytes
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);

// Generate UUID
const uuid = crypto.randomUUID();
console.log(uuid); // "550e8400-e29b-41d4-a716-446655440000"

// Hash data with SHA-256
const data = new TextEncoder().encode("Hello, World!");
const hash = await crypto.subtle.digest("SHA-256", data);

// Generate encryption key
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);

// Encrypt data
const iv = crypto.getRandomValues(new Uint8Array(12));
const encrypted = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  data
);

// Decrypt data
const decrypted = await crypto.subtle.decrypt(
  { name: "AES-GCM", iv },
  key,
  encrypted
);
```

#### SubtleCrypto Methods

| Method | Description |
|--------|-------------|
| `digest` | Generate hash (SHA-256, SHA-384, SHA-512) |
| `generateKey` | Generate symmetric or asymmetric keys |
| `sign` / `verify` | Sign and verify data (HMAC, ECDSA) |
| `encrypt` / `decrypt` | Encrypt and decrypt data (AES-GCM, AES-CBC) |
| `importKey` / `exportKey` | Import/export keys (raw, jwk, pkcs8, spki) |
| `deriveBits` / `deriveKey` | Derive keys (PBKDF2, ECDH) |
| `wrapKey` / `unwrapKey` | Wrap/unwrap keys for secure transport |

**See also:** [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
<!-- END:crypto -->

---

<!-- BEGIN:encoding -->
### @ricsam/isolate-encoding

Base64 encoding and decoding via `atob` and `btoa`.

```typescript
import { setupEncoding } from "@ricsam/isolate-encoding";

const handle = await setupEncoding(context);
```

**Injected Globals:**
- `atob(encodedData)` - Decode a Base64-encoded string
- `btoa(stringToEncode)` - Encode a string to Base64

**Usage in Isolate:**

```javascript
// Encode string to Base64
const encoded = btoa("Hello, World!");
console.log(encoded); // "SGVsbG8sIFdvcmxkIQ=="

// Decode Base64 to string
const decoded = atob("SGVsbG8sIFdvcmxkIQ==");
console.log(decoded); // "Hello, World!"

// Common use case: encoding JSON for transport
const data = { user: "john", token: "abc123" };
const base64Data = btoa(JSON.stringify(data));

// Decode it back
const originalData = JSON.parse(atob(base64Data));
```

**Error Handling:**

```javascript
// btoa throws for characters outside Latin1 range (0-255)
try {
  btoa("Hello 世界"); // Throws DOMException
} catch (e) {
  console.error("Cannot encode non-Latin1 characters");
}

// atob throws for invalid Base64
try {
  atob("not valid base64!!!");
} catch (e) {
  console.error("Invalid Base64 string");
}
```
<!-- END:encoding -->

---

<!-- BEGIN:path -->
### @ricsam/isolate-path

Node.js-compatible path utilities for POSIX paths.

```typescript
import { setupPath } from "@ricsam/isolate-path";

const handle = await setupPath(context, {
  cwd: "/home/user", // Optional: set working directory for resolve()
});
```

**Injected Globals:**
- `path.join(...paths)` - Join path segments
- `path.resolve(...paths)` - Resolve to absolute path
- `path.normalize(path)` - Normalize a path
- `path.basename(path, ext?)` - Get file name
- `path.dirname(path)` - Get directory name
- `path.extname(path)` - Get file extension
- `path.isAbsolute(path)` - Check if path is absolute
- `path.parse(path)` - Parse into components
- `path.format(obj)` - Format from components
- `path.relative(from, to)` - Get relative path
- `path.cwd()` - Get working directory
- `path.sep` - Path separator (`/`)
- `path.delimiter` - Path delimiter (`:`)

**Usage in Isolate:**

```javascript
// Join paths
path.join('/foo', 'bar', 'baz'); // "/foo/bar/baz"
path.join('foo', 'bar', '..', 'baz'); // "foo/baz"

// Resolve to absolute
path.resolve('foo/bar'); // "/home/user/foo/bar" (with cwd)
path.resolve('/foo', 'bar'); // "/foo/bar"

// Parse and format
const parsed = path.parse('/foo/bar/baz.txt');
// { root: "/", dir: "/foo/bar", base: "baz.txt", ext: ".txt", name: "baz" }

path.format({ dir: '/foo/bar', base: 'baz.txt' }); // "/foo/bar/baz.txt"

// Other utilities
path.basename('/foo/bar/baz.txt'); // "baz.txt"
path.dirname('/foo/bar/baz.txt'); // "/foo/bar"
path.extname('file.tar.gz'); // ".gz"
path.isAbsolute('/foo'); // true
```
<!-- END:path -->

---

<!-- BEGIN:timers -->
### @ricsam/isolate-timers

Timer APIs with host-controlled execution.

```typescript
import { setupTimers } from "@ricsam/isolate-timers";

const handle = await setupTimers(context);

// Process pending timers (call this in your event loop)
await handle.tick(100); // Advance 100ms
```

**Injected Globals:**
- `setTimeout(callback, ms, ...args)` - Schedule delayed execution
- `setInterval(callback, ms, ...args)` - Schedule repeated execution
- `clearTimeout(id)` - Cancel a timeout
- `clearInterval(id)` - Cancel an interval

**Usage in Isolate:**

```javascript
// One-shot timer
const timeoutId = setTimeout(() => {
  console.log("Fired after 1 second!");
}, 1000);

// Repeating timer
let count = 0;
const intervalId = setInterval(() => {
  count++;
  console.log("Tick", count);
  if (count >= 5) {
    clearInterval(intervalId);
  }
}, 100);

// Cancel a timer
clearTimeout(timeoutId);
```

**Host Integration:**

Timers don't fire automatically - you must call `handle.tick()` to advance time:

```typescript
// In your event loop
while (hasPendingWork) {
  await handle.tick(16); // ~60fps tick rate
  // ... other work
}
```
<!-- END:timers -->

---

<!-- BEGIN:fetch -->
### @ricsam/isolate-fetch

Fetch API and HTTP server handler.

```typescript
import { setupFetch } from "@ricsam/isolate-fetch";

const handle = await setupFetch(context, {
  onFetch: async (request) => {
    // Handle outbound fetch() calls from the isolate
    console.log(`Fetching: ${request.url}`);
    return fetch(request);
  },
});
```

**Injected Globals:**
- `fetch`, `Request`, `Response`, `Headers`
- `FormData`, `AbortController`, `AbortSignal`
- `serve` (HTTP server handler)

**Usage in Isolate:**

```javascript
// Outbound fetch
const response = await fetch("https://api.example.com/data");
const data = await response.json();

// Request/Response
const request = new Request("https://example.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "test" }),
});

const response = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

// Static methods
Response.json({ message: "hello" });
Response.redirect("https://example.com", 302);

// AbortController
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await fetch(url, { signal: controller.signal });

// FormData
const formData = new FormData();
formData.append("name", "John");
formData.append("file", new File(["content"], "file.txt"));
```

#### HTTP Server

Register a server handler in the isolate and dispatch requests from the host:

```typescript
// In isolate
await context.eval(`
  serve({
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(request, { data: { userId: "123" } })) {
          return new Response(null, { status: 101 });
        }
      }

      return Response.json({ path: url.pathname });
    },
    websocket: {
      open(ws) {
        console.log("Connected:", ws.data.userId);
      },
      message(ws, message) {
        ws.send("Echo: " + message);
      },
      close(ws, code, reason) {
        console.log("Closed:", code, reason);
      }
    }
  });
`, { promise: true });

// From host - dispatch HTTP request
const response = await handle.dispatchRequest(
  new Request("http://localhost/api/users")
);
```
<!-- END:fetch -->

---

<!-- BEGIN:fs -->
### @ricsam/isolate-fs

File System Access API (OPFS-compatible).

```typescript
import { setupFs } from "@ricsam/isolate-fs";

const handle = await setupFs(context, {
  // Return a FileSystemHandler for the given directory path
  getDirectory: async (path) => {
    // Validate path access
    if (!path.startsWith("/allowed")) {
      throw new Error("Access denied");
    }
    return createNodeFileSystemHandler(`./sandbox${path}`);
  },
});
```

**Injected Globals:**
- `getDirectory(path)` - Entry point for file system access
- `FileSystemDirectoryHandle`, `FileSystemFileHandle`
- `FileSystemWritableFileStream`

**Usage in Isolate:**

```javascript
// Get directory handle
const root = await getDirectory("/data");

// Read a file
const fileHandle = await root.getFileHandle("config.json");
const file = await fileHandle.getFile();
const text = await file.text();
const config = JSON.parse(text);

// Write a file
const outputHandle = await root.getFileHandle("output.txt", { create: true });
const writable = await outputHandle.createWritable();
await writable.write("Hello, World!");
await writable.close();

// Directory operations
const subDir = await root.getDirectoryHandle("subdir", { create: true });
await root.removeEntry("old-file.txt");
await root.removeEntry("old-dir", { recursive: true });

// Iterate directory
for await (const [name, handle] of root.entries()) {
  console.log(name, handle.kind); // "file" or "directory"
}
```
<!-- END:fs -->

---

<!-- BEGIN:runtime -->
### @ricsam/isolate-runtime

Umbrella package that combines all APIs.

```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  // Memory limit in MB
  memoryLimit: 128,
  // Console API
  console: {
    onLog: (level, ...args) => console.log(`[${level}]`, ...args),
  },
  // Fetch API
  fetch: {
    onFetch: async (req) => fetch(req),
  },
  // File System API (optional)
  fs: {
    getDirectory: async (path) => createNodeFileSystemHandler(`./data${path}`),
  },
});

// The runtime includes:
// - runtime.isolate: The V8 isolate
// - runtime.context: The execution context
// - runtime.tick(): Process pending timers
// - runtime.dispose(): Clean up all resources

// Run code
await runtime.context.eval(`
  console.log("Hello from sandbox!");
`, { promise: true });

// Process timers
await runtime.tick(100);

// Cleanup
runtime.dispose();
```

**What's Included:**
- Core (Blob, File, streams, URL, TextEncoder/Decoder)
- Console
- Encoding (atob/btoa)
- Timers (setTimeout, setInterval)
- Path utilities
- Crypto (randomUUID, getRandomValues, subtle)
- Fetch API
- File System (if handler provided)
<!-- END:runtime -->

---

<!-- BEGIN:test-environment -->
### @ricsam/isolate-test-environment

Test primitives for running tests in sandboxed V8. Provides a Jest/Vitest-compatible API with handler-based result streaming.

```typescript
import { setupTestEnvironment } from "@ricsam/isolate-test-environment";

const handle = await setupTestEnvironment(context, {
  onTestPass: (test) => console.log(`✓ ${test.fullName}`),
  onTestFail: (test) => console.log(`✗ ${test.fullName}: ${test.error?.message}`),
  onRunComplete: (results) => {
    console.log(`\n${results.passed}/${results.total} tests passed`);
  },
});
```

**Injected Globals:**
- `describe`, `it`, `test` (with `.skip`, `.only`, `.todo` modifiers)
- `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
- `expect` with matchers (`toBe`, `toEqual`, `toThrow`, etc.) and modifiers (`.not`, `.resolves`, `.rejects`)

**Usage in Isolate:**

```javascript
describe("Math operations", () => {
  beforeEach(() => {
    // setup before each test
  });

  it("should add numbers", () => {
    expect(1 + 1).toBe(2);
  });

  it("should multiply numbers", async () => {
    await Promise.resolve();
    expect(2 * 3).toEqual(6);
  });

  describe("edge cases", () => {
    it.skip("should handle infinity", () => {
      expect(1 / 0).toBe(Infinity);
    });
  });
});
```

**Running tests from host:**

```typescript
// Load untrusted test code
await context.eval(userProvidedTestCode, { promise: true });

// Check test count
console.log(`Found ${handle.getTestCount()} tests`);

// Run all registered tests
const results = await handle.run();
console.log(`${results.passed}/${results.total} passed`);

// Reset for re-running (optional)
handle.reset();

handle.dispose();
```

**Event Handlers:**

| Handler | Description |
|---------|-------------|
| `onSuiteStart` | Called when a describe block begins |
| `onSuiteEnd` | Called when a describe block completes |
| `onTestStart` | Called before each test runs |
| `onTestPass` | Called when a test passes |
| `onTestFail` | Called when a test fails |
| `onRunComplete` | Called after all tests complete |
<!-- END:test-environment -->

---

<!-- BEGIN:test-utils -->
### @ricsam/isolate-test-utils

Testing utilities including type checking for isolate user code.

```bash
npm add @ricsam/isolate-test-utils
```

#### Type Checking Isolate Code

Validate TypeScript/JavaScript code that will run inside the isolate before execution using `ts-morph`:

```typescript
import { typecheckIsolateCode } from "@ricsam/isolate-test-utils";

const result = typecheckIsolateCode(`
  serve({
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/ws") {
        server.upgrade(request, { data: { userId: 123 } });
        return new Response(null, { status: 101 });
      }

      return Response.json({ message: "Hello!" });
    },
    websocket: {
      message(ws, message) {
        ws.send("Echo: " + message);
      }
    }
  });
`, { include: ["core", "fetch"] });

if (!result.success) {
  console.error("Type errors found:");
  for (const error of result.errors) {
    console.error(`  Line ${error.line}: ${error.message}`);
  }
}
```

**Options:**

| Option | Description |
|--------|-------------|
| `include` | Which package types to include: `"core"`, `"fetch"`, `"fs"`, `"console"`, `"encoding"`, `"timers"`, `"testEnvironment"` (default: `["core", "fetch", "fs"]`) |
| `compilerOptions` | Additional TypeScript compiler options |
| `libraryTypes` | External library type definitions for import resolution |

**Using with tests:**

```typescript
import { describe, expect, test } from "node:test";
import { typecheckIsolateCode } from "@ricsam/isolate-test-utils";

describe("Isolate code validation", () => {
  test("server code is type-safe", () => {
    const result = typecheckIsolateCode(userProvidedCode, {
      include: ["fetch"]
    });
    expect(result.success).toBe(true);
  });
});
```

#### Type Definition Strings

The type definitions are also exported as strings for custom use cases:

```typescript
import {
  CORE_TYPES,   // ReadableStream, Blob, File, URL, etc.
  FETCH_TYPES,  // fetch, Request, Response, serve, etc.
  FS_TYPES,     // getDirectory, FileSystemHandle, etc.
  CRYPTO_TYPES, // crypto.subtle, CryptoKey, etc.
  TYPE_DEFINITIONS  // All types as { core, fetch, fs, crypto, ... }
} from "@ricsam/isolate-test-utils";

// Use with your own ts-morph project
project.createSourceFile("isolate-globals.d.ts", FETCH_TYPES);
```

#### Type Definition Files

Each package also exports `.d.ts` files for use with `tsconfig.json`:

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"]
  },
  "include": ["isolate-code/**/*.ts"],
  "references": [
    { "path": "./node_modules/@ricsam/isolate-core/dist/types/isolate.d.ts" },
    { "path": "./node_modules/@ricsam/isolate-fetch/dist/types/isolate.d.ts" },
    { "path": "./node_modules/@ricsam/isolate-fs/dist/types/isolate.d.ts" }
  ]
}
```
<!-- END:test-utils -->

## Architecture

### Package Dependency Graph

```
@ricsam/isolate-runtime
├── @ricsam/isolate-fetch
│   └── @ricsam/isolate-core
├── @ricsam/isolate-fs
│   └── @ricsam/isolate-core
├── @ricsam/isolate-console
│   └── @ricsam/isolate-core
├── @ricsam/isolate-crypto
│   └── @ricsam/isolate-core
├── @ricsam/isolate-encoding
│   └── @ricsam/isolate-core
├── @ricsam/isolate-path
│   └── @ricsam/isolate-core
├── @ricsam/isolate-timers
│   └── @ricsam/isolate-core
└── @ricsam/isolate-core

@ricsam/isolate-test-environment
└── @ricsam/isolate-core
```

### Design Principles

1. **V8-based Isolation** - True process-level isolation using V8 isolates with memory limits
2. **WHATWG APIs** - Mirror browser/Deno/Bun APIs where possible
3. **Host-Controlled** - The host environment controls all I/O; sandbox code cannot escape
4. **Handler-Based** - Customizable behavior via handler callbacks for maximum flexibility
5. **Minimal Surface** - Each package does one thing well
6. **Composable** - Packages can be used independently or together
7. **Type-Safe** - Full TypeScript support with strict types

### Handle Lifecycle

All handles must be properly disposed to prevent resource leaks:

```typescript
const runtime = await createRuntime(options);

try {
  // Use the runtime...
  await runtime.context.eval(script, { promise: true });
} finally {
  runtime.dispose();
}
```

### Async Operations

V8 isolates support native promises. Use `{ promise: true }` for async code:

```typescript
// Async code execution
await runtime.context.eval(`
  (async () => {
    const response = await fetch("https://api.example.com");
    return response.json();
  })()
`, { promise: true });

// Don't forget to tick timers if using setTimeout/setInterval
await runtime.tick(100);
```

## Security

- **True V8 Isolation** - Code runs in a separate V8 isolate with its own heap
- **No automatic network access** - `onFetch` must be explicitly provided
- **File system isolation** - `getDirectory` handler controls all path access
- **Memory limits** - Configure maximum heap size per isolate
- **No Node.js APIs** - Sandbox has no access to `require`, `process`, `fs`, etc.

```typescript
const runtime = await createRuntime({
  memoryLimit: 128, // 128 MB limit - isolate is killed if exceeded
});
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck
```

## License

MIT
