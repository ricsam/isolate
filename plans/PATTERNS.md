# @ricsam/isolate - Implementation Patterns

This document captures recurring patterns used when implementing WHATWG APIs in the isolate. Follow these patterns to maintain consistency across all packages.

## Table of Contents

1. [Package Structure](#1-package-structure)
2. [Setup Function Pattern](#2-setup-function-pattern)
3. [Handle Pattern](#3-handle-pattern)
4. [Host-Side State with Instance IDs](#4-host-side-state-with-instance-ids)
5. [WeakMap for Private State in Isolate](#5-weakmap-for-private-state-in-isolate)
6. [Host Callback Naming Convention](#6-host-callback-naming-convention)
7. [Pure JS Injection Pattern](#7-pure-js-injection-pattern)
8. [Error Encoding Across Boundary](#8-error-encoding-across-boundary)
9. [Test Structure Pattern](#9-test-structure-pattern)
10. [Async Method Pattern](#10-async-method-pattern)
11. [Simple Callback-Based API Pattern](#11-simple-callback-based-api-pattern)
12. [DOMException Polyfill Pattern](#12-domexception-polyfill-pattern)
13. [Virtual Time Timer Pattern](#13-virtual-time-timer-pattern)
14. [JSON Serialization for Complex Data Transfer](#14-json-serialization-for-complex-data-transfer)
15. [Hybrid Pure-JS + Host-State Pattern](#15-hybrid-pure-js--host-state-pattern)
16. [Composing Setup Functions](#16-composing-setup-functions)
17. [Handler Interface Pattern](#17-handler-interface-pattern)
18. [Aggregator Runtime Pattern](#18-aggregator-runtime-pattern)
19. [Test Context Factory Pattern](#19-test-context-factory-pattern)
20. [Integration Test Server Pattern](#20-integration-test-server-pattern)

---

## 1. Package Structure

Each package follows this structure:

```
packages/<name>/
├── package.json
└── src/
    ├── index.ts        # Main entry point with setup function
    ├── index.test.ts   # Tests (or <feature>.test.ts)
    └── setup.test.ts   # Integration tests with full context
```

Export pattern in `index.ts`:
```typescript
import type ivm from "isolated-vm";

export interface <Name>Options {
  // Configuration options
}

export interface <Name>Handle {
  dispose(): void;
}

export async function setup<Name>(
  context: ivm.Context,
  options?: <Name>Options
): Promise<<Name>Handle> {
  // Implementation
}
```

---

## 2. Setup Function Pattern

Every package exposes an async `setup*` function that:
- Takes an `ivm.Context` as first parameter
- Takes optional configuration as second parameter
- Returns a handle object for lifecycle management

```typescript
// From packages/console/src/index.ts
export async function setupConsole(
  context: ivm.Context,
  options?: ConsoleOptions
): Promise<ConsoleHandle> {
  // 1. Register host callbacks on context.global
  // 2. Inject JS code into the isolate
  // 3. Return handle for cleanup
}
```

---

## 3. Handle Pattern

Every setup function returns a handle with at least a `dispose()` method:

```typescript
export interface ConsoleHandle {
  dispose(): void;
}

// Extended handles may have additional methods:
export interface TimersHandle {
  tick(ms?: number): Promise<void>;  // Advance virtual time and process due timers
  clearAll(): void;                   // Clear all pending timers
  dispose(): void;                    // Cleanup resources
}

export interface CoreHandle {
  dispose(): void;
}
```

### Extended Handle with State Access

For APIs that track state (like console), expose state accessors on the handle:

```typescript
export interface ConsoleHandle {
  dispose(): void;
  reset(): void;                        // Clear all state
  getTimers(): Map<string, number>;     // Copy of timer state
  getCounters(): Map<string, number>;   // Copy of counter state
  getGroupDepth(): number;              // Current group nesting
}
```

**Key points:**
- `getTimers()` and `getCounters()` return **copies** to prevent external mutation
- `reset()` clears state without disposing the handle
- `dispose()` should also clear state

---

## 4. Host-Side State with Instance IDs

For classes that need host-side state (like Blob, File, Streams), use numeric instance IDs to link isolate objects to host-side state:

```typescript
// Host side (index.ts)
const instanceStateMap = new WeakMap<ivm.Context, Map<number, unknown>>();
let nextInstanceId = 1;

function getInstanceStateMapForContext(context: ivm.Context): Map<number, unknown> {
  let map = instanceStateMap.get(context);
  if (!map) {
    map = new Map();
    instanceStateMap.set(context, map);
  }
  return map;
}

// In setup function:
const stateMap = getInstanceStateMapForContext(context);

global.setSync("__Blob_construct", new ivm.Callback((parts, options) => {
  const instanceId = nextInstanceId++;
  const state: BlobState = { /* ... */ };
  stateMap.set(instanceId, state);
  return instanceId;
}));
```

---

## 5. WeakMap for Private State in Isolate

When private class fields (`#field`) don't work well across the isolate boundary, use a WeakMap pattern inside the isolate:

```typescript
const blobCode = `
(function() {
  // WeakMap stores instance ID keyed by object instance
  const _blobInstanceIds = new WeakMap();

  class Blob {
    constructor(parts = [], options = {}) {
      if (parts === null && options === null) {
        // Internal: creating from existing instance ID
        return;
      }
      const instanceId = __Blob_construct(parts, options);
      _blobInstanceIds.set(this, instanceId);
    }

    static _createFromInstanceId(instanceId) {
      const blob = new Blob(null, null);
      _blobInstanceIds.set(blob, instanceId);
      return blob;
    }

    _getInstanceId() {
      return _blobInstanceIds.get(this);
    }

    get size() {
      return __Blob_get_size(this._getInstanceId());
    }
  }

  globalThis.Blob = Blob;
})();
`;
```

This pattern enables:
- Creating instances from host-provided IDs (for slice, etc.)
- Internal instance creation without calling the host constructor
- Reliable access to instance ID from any method

---

## 6. Host Callback Naming Convention

Register host callbacks on `context.global` with this naming pattern:

```
__<ClassName>_<operation>
```

Examples:
```typescript
// Constructor
global.setSync("__Blob_construct", new ivm.Callback(...));

// Property getter
global.setSync("__Blob_get_size", new ivm.Callback(...));

// Property setter
global.setSync("__Blob_set_value", new ivm.Callback(...));

// Instance method
global.setSync("__Blob_slice", new ivm.Callback(...));
global.setSync("__Blob_text", new ivm.Callback(...));

// Static method
global.setSync("__Blob_static_fromArrayBuffer", new ivm.Callback(...));
```

---

## 7. Pure JS Injection Pattern

For APIs that can be implemented in pure JavaScript without host callbacks (like TextEncoder, TextDecoder, URL, URLSearchParams, path), inject them as a self-executing function:

```typescript
async function injectTextEncoding(context: ivm.Context): Promise<void> {
  const code = `
(function() {
  class TextEncoder {
    get encoding() { return 'utf-8'; }

    encode(input = '') {
      // Pure JS implementation
    }
  }

  class TextDecoder {
    // Pure JS implementation
  }

  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
})();
`;

  context.evalSync(code);
}
```

Benefits:
- No host callbacks overhead
- Simpler implementation
- Better performance for frequently called methods

---

## 8. Error Encoding Across Boundary

Errors thrown across the isolate boundary lose their type. Encode the error type in the message:

```typescript
// Host side: encode error type
const encodeError = (err: Error): Error => {
  const errorType = getErrorConstructor(err.name);
  return new Error(`[${errorType}]${err.message}`);
};

// In callback:
try {
  return methodDef.fn(state, ...args);
} catch (err) {
  if (err instanceof Error) {
    throw encodeError(err);
  }
  throw err;
}
```

```javascript
// Isolate side: decode error type
function __decodeError(err) {
  const match = err.message.match(/^\[(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|Error)\](.*)$/);
  if (match) {
    const ErrorType = globalThis[match[1]] || Error;
    return new ErrorType(match[2]);
  }
  return err;
}

// In method:
try {
  return __ClassName_method(this.#instanceId, ...args);
} catch (err) {
  throw __decodeError(err);
}
```

---

## 9. Test Structure Pattern

Tests use Node.js built-in test runner with fresh isolate/context per test:

```typescript
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("ClassName", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    await setupCore(context);
    clearAllInstanceState();  // Reset instance ID counter
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  describe("constructor", () => {
    test("creates instance with default values", async () => {
      const result = await context.eval(`
        const instance = new ClassName();
        JSON.stringify({ prop: instance.prop })
      `);
      const data = JSON.parse(result as string);
      assert.strictEqual(data.prop, expectedValue);
    });
  });

  describe("methodName", () => {
    test("async method returns expected value", async () => {
      const result = await context.eval(`
        (async () => {
          const instance = new ClassName();
          return await instance.asyncMethod();
        })()
      `, { promise: true });
      assert.strictEqual(result, expectedValue);
    });
  });
});
```

---

## 10. Async Method Pattern

For async methods that need to call host async functions, use `ivm.Reference` with `applySyncPromise`. This is required because `ivm.Callback` with `{ async: true }` returns a Promise that cannot be cloned across the isolate boundary.

### Using `defineAsyncFunction` (Recommended)

```typescript
import { defineAsyncFunction } from "@ricsam/isolate-core";

// Host side: define async function
defineAsyncFunction(context, "fetchData", async (url: string) => {
  const response = await fetch(url);
  return await response.text();
});
```

```javascript
// Isolate side: call directly (blocks until resolved)
const data = fetchData("https://example.com");
// Note: No await needed - applySyncPromise blocks and returns the value directly
```

### Using `defineClass` with Async Methods

```typescript
import { defineClass } from "@ricsam/isolate-core";

defineClass(context, {
  name: "AsyncClass",
  construct: () => ({ value: 42 }),
  methods: {
    fetchValue: {
      fn: async (state) => {
        await new Promise(r => setTimeout(r, 100));
        return state.value;
      },
      async: true,  // Marks this method as async
    },
  },
});
```

```javascript
// Isolate side: call directly (blocks until resolved)
const instance = new AsyncClass();
const value = instance.fetchValue();  // Returns 42 after blocking
```

### Manual Pattern (Low-Level)

If not using `defineAsyncFunction` or `defineClass`, use `ivm.Reference` with `applySyncPromise`:

```typescript
// Host side: use ivm.Reference (NOT ivm.Callback)
const asyncRef = new ivm.Reference(async (instanceId: number) => {
  const state = stateMap.get(instanceId) as BlobState;
  if (!state) return "";
  return new TextDecoder().decode(combined);
});

global.setSync("__Blob_text_ref", asyncRef);

// Inject wrapper that calls applySyncPromise
context.evalSync(`
  globalThis.__Blob_text = function(instanceId) {
    return __Blob_text_ref.applySyncPromise(undefined, [instanceId]);
  };
`);
```

```javascript
// Isolate side: call the wrapper (blocks until resolved)
class Blob {
  text() {
    return __Blob_text(this._getInstanceId());
  }
}
```

### Key Points

- **`applySyncPromise` blocks the isolate** until the host async function resolves
- The return value is the **resolved value directly**, not a Promise
- Methods are **not marked as `async`** in the isolate since they block synchronously
- Use `ivm.Reference` for async operations, `ivm.Callback` for sync operations
- Error encoding/decoding still applies (see Pattern #8)

### When to Use Sync Callbacks Instead

For methods that appear async in the API but can be implemented synchronously (like `Blob.text()` when data is already in memory), you can use sync callbacks:

```typescript
// Host side: sync callback (no { async: true } needed)
global.setSync(
  "__Blob_text",
  new ivm.Callback((instanceId: number) => {
    const state = stateMap.get(instanceId) as BlobState;
    return new TextDecoder().decode(state.data);  // Sync return
  })
);
```

```javascript
// Isolate side: can still be marked async for API compatibility
class Blob {
  async text() {
    return __Blob_text(this._getInstanceId());  // Works with await
  }
}
```

---

## 11. Simple Callback-Based API Pattern

For APIs that don't need classes or complex state (like `console`, `crypto`), use a simpler pattern with direct `ivm.Callback` registration:

```typescript
export async function setupConsole(
  context: ivm.Context,
  options?: ConsoleOptions
): Promise<ConsoleHandle> {
  const opts = options ?? {};

  // Local state (not instance-based)
  const timers = new Map<string, number>();
  const counters = new Map<string, number>();
  let groupDepth = 0;

  const global = context.global;

  // Register callbacks directly for each method
  const logLevels = ["log", "warn", "error", "debug", "info", "trace", "dir", "table"];

  for (const level of logLevels) {
    global.setSync(
      `__console_${level}`,
      new ivm.Callback((...args: unknown[]) => {
        opts.onLog?.(level, ...args);
      })
    );
  }

  // Inject the API object
  context.evalSync(`
    globalThis.console = {
      log: __console_log,
      warn: __console_warn,
      error: __console_error,
      // ... etc
    };
  `);

  return {
    dispose() { timers.clear(); counters.clear(); groupDepth = 0; },
    reset() { timers.clear(); counters.clear(); groupDepth = 0; },
    getTimers() { return new Map(timers); },
    getCounters() { return new Map(counters); },
    getGroupDepth() { return groupDepth; },
  };
}
```

**When to use this pattern:**
- API is a single global object (like `console`, `crypto`)
- No class instances to track
- Methods are simple proxies to host callbacks
- State is per-setup, not per-instance

**Benefits:**
- Simpler than `defineClass` pattern
- Direct callback registration without instance ID mapping
- State lives in closure, accessible from handle

---

## 12. DOMException Polyfill Pattern

The isolated-vm context doesn't have `DOMException` available. For APIs that need to throw DOM-style errors (like `InvalidCharacterError`, `NotFoundError`, etc.), inject a polyfill:

```javascript
// At the start of injected code
if (typeof DOMException === 'undefined') {
  globalThis.DOMException = class DOMException extends Error {
    constructor(message, name) {
      super(message);
      this.name = name || 'DOMException';
    }
  };
}

// Usage
throw new DOMException(
  "The string to be encoded contains characters outside of the Latin1 range.",
  "InvalidCharacterError"
);
```

**Common DOMException names:**
- `InvalidCharacterError` - Invalid characters in input (btoa/atob)
- `QuotaExceededError` - Resource limits exceeded (crypto.getRandomValues > 65536 bytes)
- `NotFoundError` - Resource not found (fs operations)
- `TypeMismatchError` - Wrong type (e.g., file when expecting directory)
- `InvalidModificationError` - Invalid modification (e.g., removing non-empty directory without recursive)
- `InvalidStateError` - Invalid state (e.g., writing to closed stream)
- `AbortError` - Operation was aborted
- `NetworkError` - Network request failed
- `SecurityError` - Security violation
- `NotAllowedError` - Operation not allowed

**Note:** The polyfill sets `error.name` to the specific error type (e.g., `InvalidCharacterError`), not `DOMException`. This matches browser behavior where `error.name` reflects the specific error type.

---

## Checklist for New WHATWG APIs

When implementing a new WHATWG API, verify:

**Package Structure:**
- [ ] Package follows standard structure
- [ ] `setup*` function takes context and optional options
- [ ] Returns handle with `dispose()` method
- [ ] Dependencies setup first (e.g., `await setupCore(context)`)

**Host Callbacks:**
- [ ] Host callbacks use `__ClassName_operation` naming
- [ ] Instance state stored in context-specific Map
- [ ] WeakMap used for private state in isolate if needed

**Data Transfer:**
- [ ] Complex data (arrays, objects) JSON-serialized for `applySyncPromise`
- [ ] Return primitives or instance IDs from async references
- [ ] Errors encoded/decoded across boundary

**Async Operations:**
- [ ] Async methods use `ivm.Reference` with `applySyncPromise` (NOT `ivm.Callback` with `{ async: true }`)
- [ ] Or use `defineAsyncFunction` / `defineClass` with `async: true` for automatic handling

**Testing:**
- [ ] Tests create fresh isolate/context per test
- [ ] Cleanup called in `afterEach`
- [ ] `clearAllInstanceState()` called in `beforeEach`

**Architecture Decision:**
- [ ] Consider hybrid pattern: pure JS for simple classes, host state for binary data
- [ ] Pure JS classes: Headers, FormData, URLSearchParams
- [ ] Host state classes: Request, Response, Blob, File, FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemWritableFileStream

---

## 13. Virtual Time Timer Pattern

For APIs like `setTimeout`/`setInterval` where callbacks must stay in the isolate (since functions can't be passed to the host), use a split architecture:

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    Host (Node.js)                        │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Timer Metadata Only                 │    │
│  │  Map<id, {delay, scheduledTime, type}>          │    │
│  │  currentTime: number (virtual)                   │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                                │
│              tick(ms) calls __timers_execute(id)         │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │              V8 Isolate                          │    │
│  │  __timers_callbacks: Map<id, {callback, args}>  │    │
│  │  Stores actual JS function references            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Host side:**
```typescript
interface TimerEntry {
  id: number;
  delay: number;
  scheduledTime: number;
  type: "timeout" | "interval";
}

let nextTimerId = 1;
const pendingTimers = new Map<number, TimerEntry>();
let currentTime = 0;

// Register timer metadata, return ID
global.setSync(
  "__timers_register",
  new ivm.Callback((type: string, delay: number) => {
    const id = nextTimerId++;
    pendingTimers.set(id, {
      id,
      delay: Math.max(0, delay || 0),
      scheduledTime: currentTime + Math.max(0, delay || 0),
      type: type as "timeout" | "interval",
    });
    return id;
  })
);
```

**Isolate side:**
```javascript
(function() {
  const __timers_callbacks = new Map();

  globalThis.setTimeout = function(callback, delay, ...args) {
    const id = __timers_register('timeout', delay || 0);
    __timers_callbacks.set(id, { callback, args });
    return id;
  };

  // Called by host tick() to execute a timer
  globalThis.__timers_execute = function(id) {
    const entry = __timers_callbacks.get(id);
    if (entry) {
      entry.callback(...entry.args);
    }
  };
})();
```

**tick() implementation:**
```typescript
async tick(ms: number = 0) {
  currentTime += ms;

  while (true) {
    const dueTimers = [...pendingTimers.values()]
      .filter((t) => t.scheduledTime <= currentTime)
      .sort((a, b) => a.scheduledTime - b.scheduledTime);

    const timer = dueTimers[0];
    if (!timer) break;

    // Execute callback in isolate
    context.evalSync(`__timers_execute(${timer.id})`);

    if (timer.type === "timeout") {
      pendingTimers.delete(timer.id);
      context.evalSync(`__timers_removeCallback(${timer.id})`);
    } else {
      // Reschedule interval
      timer.scheduledTime = currentTime + timer.delay;
    }
  }
}
```

**Key points:**
- Callbacks **stay in the isolate** - functions cannot cross the boundary
- Host only tracks **metadata** (id, delay, scheduledTime, type)
- `tick(ms)` advances virtual time and triggers execution
- Process timers **one at a time** to handle nested timer creation
- Sort by `scheduledTime` for correct execution order
- Intervals reschedule themselves after each execution

**Benefits:**
- Deterministic execution for testing
- No real timers - full control over time
- Supports nested timers (setTimeout inside setTimeout)
- Clean separation between metadata and callbacks

**When to use:**
- Timer APIs (setTimeout, setInterval)
- Any API where isolate callbacks need deferred execution
- Testing scenarios requiring time control

---

## 14. JSON Serialization for Complex Data Transfer

When passing complex data (arrays, objects with nested structures) to `ivm.Reference` with `applySyncPromise`, use JSON serialization to avoid "non-transferable value" errors:

**Problem:**
```typescript
// This fails with "A non-transferable value was passed"
const ref = new ivm.Reference(async (headers: [string, string][], body: number[]) => {
  // ...
});

// Isolate side - fails
const result = __ref.applySyncPromise(undefined, [
  Array.from(headers.entries()),  // ❌ Array not transferable
  bodyBytes                        // ❌ Array not transferable
]);
```

**Solution:**
```typescript
// Host side: expect JSON strings
const ref = new ivm.Reference(async (headersJson: string, bodyJson: string | null) => {
  const headers = JSON.parse(headersJson) as [string, string][];
  const body = bodyJson ? JSON.parse(bodyJson) as number[] : null;
  // ...
  return simpleValue;  // Return primitive or simple value
});
```

```javascript
// Isolate side: serialize before passing
const headersJson = JSON.stringify(Array.from(headers.entries()));
const bodyJson = bodyBytes ? JSON.stringify(bodyBytes) : null;

const result = __ref.applySyncPromise(undefined, [headersJson, bodyJson]);
```

**Key points:**
- Only **primitives** (string, number, boolean, null) transfer reliably across the boundary
- Arrays and objects must be JSON-serialized
- Return values from `applySyncPromise` should also be primitives
- For complex return data, store on host side and return an instance ID

**When to use:**
- Passing arrays or objects to `applySyncPromise`
- Any complex data that needs to cross the isolate boundary
- fetch API implementation (headers, body bytes)

---

## 15. Hybrid Pure-JS + Host-State Pattern

For complex APIs like Fetch, use a hybrid approach where some classes are pure JS and others use host state:

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                      Fetch Package                           │
├─────────────────────────────────────────────────────────────┤
│  Pure JS (no host callbacks):        Host State (instance IDs): │
│  ┌─────────────┐ ┌─────────────┐    ┌─────────────┐ ┌─────────┐ │
│  │   Headers   │ │  FormData   │    │   Request   │ │Response │ │
│  │  (Map-based)│ │(array-based)│    │  (body      │ │ (body   │ │
│  │             │ │             │    │   storage)  │ │ storage)│ │
│  └─────────────┘ └─────────────┘    └─────────────┘ └─────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**When to use Pure JS:**
- Class has no binary data that needs host storage
- All methods can be implemented without host callbacks
- Examples: Headers, FormData, URLSearchParams

**When to use Host State:**
- Class stores binary data (body, file contents)
- Methods need to call host APIs (file system, network)
- Examples: Request, Response, Blob, File

**Implementation pattern:**
```typescript
// Pure JS classes - inject as string
const headersCode = `
(function() {
  class Headers {
    #headers = new Map();
    // ... pure JS implementation
  }
  globalThis.Headers = Headers;
})();
`;

// Host state classes - use callbacks + injected wrapper
function setupResponse(context: ivm.Context, stateMap: Map<number, unknown>) {
  // Register host callbacks
  global.setSync("__Response_construct", new ivm.Callback(...));
  global.setSync("__Response_text", new ivm.Callback(...));

  // Inject class that uses callbacks
  const responseCode = `
  (function() {
    class Response {
      #instanceId;
      constructor(body, init) {
        this.#instanceId = __Response_construct(...);
      }
      async text() {
        return __Response_text(this.#instanceId);
      }
    }
    globalThis.Response = Response;
  })();
  `;
  context.evalSync(responseCode);
}
```

**Benefits:**
- Pure JS classes have no callback overhead
- Host state classes can store large binary data efficiently
- Clear separation of concerns

---

## 16. Composing Setup Functions

When a package depends on APIs from another package, call the dependency's setup function first:

```typescript
import { setupCore } from "@ricsam/isolate-core";

export async function setupFetch(
  context: ivm.Context,
  options?: FetchOptions
): Promise<FetchHandle> {
  // Setup dependencies first
  await setupCore(context);  // Provides Blob, File, AbortController, etc.

  // Now setup fetch-specific APIs
  context.evalSync(headersCode);
  context.evalSync(formDataCode);
  setupResponse(context, stateMap);
  setupRequest(context, stateMap);
  setupFetchFunction(context, stateMap, options);

  return { dispose() { /* ... */ } };
}
```

**Key points:**
- Call dependency setup functions at the start
- Setup functions should be idempotent (safe to call multiple times)
- Document dependencies in package.json and plan files
- The core package provides: Blob, File, ReadableStream, AbortController, TextEncoder/Decoder, URL, DOMException

**Dependency graph:**
```
runtime (aggregator)
    │
    ├── console
    ├── encoding
    ├── timers
    ├── path
    ├── crypto
    ├── fetch ──────► core
    └── fs ─────────► core
```

**When to use:**
- Package needs Blob, File, or stream support (depend on core)
- Package builds on another package's APIs
- Creating an aggregator package that combines multiple packages

---

## 17. Handler Interface Pattern

For APIs that need full control over external operations (like file system access), expose a handler interface that the user implements:

**Interface Definition:**
```typescript
export interface FileSystemHandler {
  getFileHandle(path: string, options?: { create?: boolean }): Promise<void>;
  getDirectoryHandle(path: string, options?: { create?: boolean }): Promise<void>;
  removeEntry(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDirectory(path: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
  readFile(path: string): Promise<{ data: Uint8Array; size: number; lastModified: number; type: string }>;
  writeFile(path: string, data: Uint8Array, position?: number): Promise<void>;
  truncateFile(path: string, size: number): Promise<void>;
  getFileMetadata(path: string): Promise<{ size: number; lastModified: number; type: string }>;
}

export interface FsOptions {
  handler: FileSystemHandler;
}
```

**Usage:**
```typescript
// User provides implementation
const mockFs: FileSystemHandler = {
  async getFileHandle(path, options) {
    if (!exists(path) && !options?.create) {
      throw new Error('[NotFoundError]File not found');
    }
    // ... implementation
  },
  // ... other methods
};

await setupFs(context, { handler: mockFs });
```

**Host-Side Integration:**
```typescript
function setupFileSystemDirectoryHandle(
  context: ivm.Context,
  stateMap: Map<number, unknown>,
  handler: FileSystemHandler  // Handler passed to each setup function
): void {
  const getFileHandleRef = new ivm.Reference(
    async (instanceId: number, name: string, optionsJson: string) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState;
      const options = JSON.parse(optionsJson);
      const childPath = state.path === "/" ? `/${name}` : `${state.path}/${name}`;

      // Delegate to user-provided handler
      await handler.getFileHandle(childPath, options);

      // Create and return instance ID for new handle
      const fileInstanceId = nextInstanceId++;
      stateMap.set(fileInstanceId, { path: childPath, name });
      return JSON.stringify({ instanceId: fileInstanceId });
    }
  );
  global.setSync("__FileSystemDirectoryHandle_getFileHandle_ref", getFileHandleRef);
}
```

**Key points:**
- Handler methods use **full paths** (e.g., `/dir/file.txt`) to simplify implementation
- Error messages follow the **encoded error pattern** (e.g., `[NotFoundError]message`)
- Handler returns **data and metadata** separately from handle management
- State management (instance IDs, paths) stays in the package
- User only implements the actual I/O operations

**Comparison with Simple Callback Pattern (fetch):**
```typescript
// Simple callback (fetch) - single function
interface FetchOptions {
  onFetch?: (request: Request) => Promise<Response>;
}

// Handler interface (fs) - multiple related methods
interface FsOptions {
  handler: FileSystemHandler;  // Interface with 8+ methods
}
```

**When to use Handler Interface vs Simple Callback:**
- **Handler Interface**: When API has multiple related operations that share context (fs operations on same storage)
- **Simple Callback**: When API has a single primary operation (fetch request → response)

**Benefits:**
- User has full control over I/O implementation
- Supports multiple backends (in-memory, real FS, cloud storage)
- Clean separation between API shape and storage implementation
- Easy to create mock implementations for testing

---

## 18. Aggregator Runtime Pattern

For creating a complete runtime that combines all packages into a single entry point:

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                    createRuntime(options)                    │
├─────────────────────────────────────────────────────────────┤
│  1. Create Isolate (with optional memory limit)              │
│  2. Create Context                                           │
│  3. Call setup functions in dependency order:                │
│     setupCore → setupConsole → setupEncoding → setupTimers  │
│     → setupPath → setupCrypto → setupFetch → setupFs        │
│  4. Store handles for cleanup                                │
│  5. Return RuntimeHandle                                     │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```typescript
import ivm from "isolated-vm";
import { setupCore } from "@ricsam/isolate-core";
import { setupConsole } from "@ricsam/isolate-console";
// ... other imports

export interface RuntimeOptions {
  memoryLimit?: number;
  console?: ConsoleOptions;
  fetch?: FetchOptions;
  fs?: FsOptions;
}

export interface RuntimeHandle {
  readonly isolate: ivm.Isolate;
  readonly context: ivm.Context;
  tick(ms?: number): Promise<void>;
  dispose(): void;
}

export async function createRuntime(
  options?: RuntimeOptions
): Promise<RuntimeHandle> {
  const opts = options ?? {};

  // Create isolate with optional memory limit
  const isolate = new ivm.Isolate({
    memoryLimit: opts.memoryLimit,
  });
  const context = await isolate.createContext();

  // Store all handles for disposal
  const handles: Record<string, { dispose(): void }> = {};

  // Setup all APIs in dependency order
  handles.core = await setupCore(context);
  handles.console = await setupConsole(context, opts.console);
  handles.encoding = await setupEncoding(context);
  handles.timers = await setupTimers(context);
  handles.path = await setupPath(context);
  handles.crypto = await setupCrypto(context);
  handles.fetch = await setupFetch(context, opts.fetch);

  // Optional APIs
  if (opts.fs) {
    handles.fs = await setupFs(context, opts.fs);
  }

  return {
    isolate,
    context,
    async tick(ms?: number) {
      await (handles.timers as TimersHandle).tick(ms);
    },
    dispose() {
      // Dispose in reverse order
      Object.values(handles).reverse().forEach(h => h?.dispose());
      context.release();
      isolate.dispose();
    },
  };
}
```

**Key points:**
- Create isolate and context at the top level
- Call setup functions in dependency order (core first, as other packages depend on it)
- Store all handles to enable proper cleanup
- Expose `tick()` method that delegates to timers handle
- `dispose()` cleans up in reverse order: handles → context → isolate
- Optional features (like fs) only set up when options provided

**Usage:**
```typescript
const runtime = await createRuntime({
  memoryLimit: 128,
  console: { onLog: (level, ...args) => console.log(`[${level}]`, ...args) },
  fetch: { onFetch: async (req) => fetch(req) },
});

await runtime.context.eval(`
  console.log("Hello from sandbox!");
  const response = await fetch("https://example.com");
`);

// Process any pending timers
await runtime.tick(100);

// Clean up everything
runtime.dispose();
```

**Re-exports:**
The aggregator package should re-export all setup functions and types for users who need fine-grained control:

```typescript
// Re-export all package types and functions
export { setupCore } from "@ricsam/isolate-core";
export type { CoreHandle, SetupCoreOptions } from "@ricsam/isolate-core";

export { setupConsole } from "@ricsam/isolate-console";
export type { ConsoleHandle, ConsoleOptions } from "@ricsam/isolate-console";
// ... etc
```

**When to use:**
- Creating the main entry point for users
- Providing a "batteries included" experience
- Simplifying common use cases while allowing escape hatches

---

## 19. Test Context Factory Pattern

For testing isolate code, create context factory functions that handle setup and teardown:

**Basic Pattern:**
```typescript
export interface TestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  dispose(): void;
}

export async function createTestContext(): Promise<TestContext> {
  const ivm = await import("isolated-vm");
  const isolate = new ivm.default.Isolate();
  const context = await isolate.createContext();

  return {
    isolate,
    context,
    dispose() {
      context.release();
      isolate.dispose();
    },
  };
}
```

**Extended Context with APIs:**
```typescript
export interface FsTestContext extends TestContext {
  mockFs: MockFileSystem;
}

export async function createFsTestContext(): Promise<FsTestContext> {
  const ivm = await import("isolated-vm");
  const { setupCore, clearAllInstanceState } = await import("@ricsam/isolate-core");
  const { setupFs } = await import("@ricsam/isolate-fs");

  const isolate = new ivm.default.Isolate();
  const context = await isolate.createContext();

  clearAllInstanceState();

  const mockFs = new MockFileSystem();
  const coreHandle = await setupCore(context);
  const fsHandle = await setupFs(context, { handler: mockFs });

  return {
    isolate,
    context,
    mockFs,
    dispose() {
      fsHandle.dispose();
      coreHandle.dispose();
      context.release();
      isolate.dispose();
    },
  };
}
```

**Full Runtime Context with Mocking:**
```typescript
export interface RuntimeTestContext extends TestContext {
  tick(ms?: number): Promise<void>;
  logs: Array<{ level: string; args: unknown[] }>;
  fetchCalls: Array<{ url: string; method: string; headers: [string, string][] }>;
  setMockResponse(response: MockResponse): void;
  mockFs: MockFileSystem;
}

export async function createRuntimeTestContext(
  options?: { fs?: boolean }
): Promise<RuntimeTestContext> {
  const { createRuntime } = await import("@ricsam/isolate-runtime");
  const { clearAllInstanceState } = await import("@ricsam/isolate-core");

  clearAllInstanceState();

  const logs: Array<{ level: string; args: unknown[] }> = [];
  const fetchCalls: Array<{ url: string; method: string; headers: [string, string][] }> = [];
  let mockResponse: MockResponse = { status: 200, body: "" };
  const mockFs = new MockFileSystem();

  const runtime = await createRuntime({
    console: {
      onLog: (level, ...args) => logs.push({ level, args }),
    },
    fetch: {
      onFetch: async (request) => {
        fetchCalls.push({
          url: request.url,
          method: request.method,
          headers: [...request.headers.entries()],
        });
        return new Response(mockResponse.body ?? "", {
          status: mockResponse.status ?? 200,
          headers: mockResponse.headers,
        });
      },
    },
    fs: options?.fs ? { handler: mockFs } : undefined,
  });

  return {
    isolate: runtime.isolate,
    context: runtime.context,
    tick: runtime.tick.bind(runtime),
    dispose: runtime.dispose.bind(runtime),
    logs,
    fetchCalls,
    setMockResponse(response) { mockResponse = response; },
    mockFs,
  };
}
```

**Code Evaluation Helpers:**
```typescript
// Sync evaluation
export function evalCode<T>(context: ivm.Context, code: string): T {
  return context.evalSync(code) as T;
}

// Async evaluation
export async function evalCodeAsync<T>(context: ivm.Context, code: string): Promise<T> {
  return (await context.eval(code, { promise: true })) as T;
}

// JSON result extraction
export function evalCodeJson<T>(context: ivm.Context, code: string): T {
  return JSON.parse(context.evalSync(code) as string) as T;
}
```

**Usage in tests:**
```typescript
describe("my feature", () => {
  let ctx: RuntimeTestContext;

  afterEach(() => {
    ctx?.dispose();
  });

  test("captures console logs", async () => {
    ctx = await createRuntimeTestContext();
    ctx.context.evalSync('console.log("hello")');
    assert.strictEqual(ctx.logs[0].args[0], "hello");
  });

  test("mocks fetch responses", async () => {
    ctx = await createRuntimeTestContext();
    ctx.setMockResponse({ status: 200, body: '{"data": "test"}' });

    const result = await ctx.context.eval(`
      (async () => {
        const response = await fetch("https://example.com");
        return await response.text();
      })()
    `, { promise: true });

    assert.strictEqual(result, '{"data": "test"}');
    assert.strictEqual(ctx.fetchCalls[0].url, "https://example.com");
  });
});
```

**Key points:**
- Each context factory returns a `dispose()` method for cleanup
- `clearAllInstanceState()` should be called before creating new contexts to reset instance ID counters
- Handles are disposed in reverse order of creation
- Mutable state (logs, fetchCalls) is captured by closures and exposed on the context
- Mock setters allow dynamic response configuration during tests

**When to use:**
- Writing tests for isolate code
- Creating reusable test setup utilities
- Mocking external dependencies (fetch, fs) in tests

---

## 20. Integration Test Server Pattern

For integration testing fetch operations against a real HTTP server:

```typescript
export interface IntegrationServer {
  url: string;
  port: number;
  close(): Promise<void>;
  setResponse(path: string, response: MockServerResponse): void;
  setDefaultResponse(response: MockServerResponse): void;
  getRequests(): RecordedRequest[];
  clearRequests(): void;
}

export async function startIntegrationServer(port?: number): Promise<IntegrationServer> {
  const responses = new Map<string, MockServerResponse>();
  const requests: RecordedRequest[] = [];
  let defaultResponse: MockServerResponse = { status: 404, body: "Not Found" };

  const server = createServer(async (req, res) => {
    const path = req.url ?? "/";

    // Record request
    requests.push({
      method: req.method ?? "GET",
      path,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v ?? ""])
      ),
      body: await readBody(req),
    });

    // Send response
    const mockResponse = responses.get(path) ?? defaultResponse;
    res.statusCode = mockResponse.status ?? 200;
    if (mockResponse.headers) {
      Object.entries(mockResponse.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    res.end(mockResponse.body ?? "");
  });

  const actualPort = await new Promise<number>((resolve) => {
    server.listen(port ?? 0, () => {
      const address = server.address();
      resolve(typeof address === "object" ? address!.port : 0);
    });
  });

  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,
    close: () => new Promise((r) => server.close(r)),
    setResponse: (path, response) => responses.set(path, response),
    setDefaultResponse: (response) => { defaultResponse = response; },
    getRequests: () => [...requests],
    clearRequests: () => { requests.length = 0; },
  };
}
```

**Usage:**
```typescript
test("fetch integration", async () => {
  const server = await startIntegrationServer();
  server.setResponse("/api/data", {
    status: 200,
    body: JSON.stringify({ message: "hello" }),
    headers: { "Content-Type": "application/json" },
  });

  const response = await fetch(`${server.url}/api/data`);
  const data = await response.json();

  assert.deepStrictEqual(data, { message: "hello" });
  assert.strictEqual(server.getRequests()[0].path, "/api/data");

  await server.close();
});
```

**Key points:**
- Server listens on port 0 to get an automatically assigned available port
- Records all incoming requests for assertion
- Supports path-specific responses and a default fallback
- Must be closed after use to free the port
