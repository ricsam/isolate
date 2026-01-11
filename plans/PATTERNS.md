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
  tick(): Promise<void>;   // Process pending timers
  clearAll(): void;        // Clear all pending timers
  dispose(): void;         // Cleanup resources
}

export interface CoreHandle {
  dispose(): void;
}
```

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

For APIs that can be implemented in pure JavaScript without host callbacks (like TextEncoder, TextDecoder, URL, URLSearchParams), inject them as a self-executing function:

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

## Checklist for New WHATWG APIs

When implementing a new WHATWG API, verify:

- [ ] Package follows standard structure
- [ ] `setup*` function takes context and optional options
- [ ] Returns handle with `dispose()` method
- [ ] Host callbacks use `__ClassName_operation` naming
- [ ] Instance state stored in context-specific Map
- [ ] WeakMap used for private state in isolate if needed
- [ ] Errors encoded/decoded across boundary
- [ ] Tests create fresh isolate/context per test
- [ ] Cleanup called in `afterEach`
- [ ] Async methods use `ivm.Reference` with `applySyncPromise` (NOT `ivm.Callback` with `{ async: true }`)
- [ ] Or use `defineAsyncFunction` / `defineClass` with `async: true` for automatic handling
