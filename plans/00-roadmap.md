# @ricsam/isolate - Implementation Roadmap

## Project Overview

**@ricsam/isolate** is a WHATWG-compliant JavaScript sandbox built on [isolated-vm](https://github.com/nicknisi/isolated-vm). It provides a secure execution environment for untrusted JavaScript code with full Web API support, where all external operations (network requests, file system access) are proxied through configurable host callbacks.

### Key Features

- **V8-based isolation**: Uses isolated-vm for true V8 isolate separation with memory limits
- **WHATWG APIs**: Full implementation of Fetch, Streams, Blob, File, URL, FormData, etc.
- **Proxied I/O**: All network and file system operations go through host callbacks
- **Node.js native**: Built for Node.js v24+ with native TypeScript execution
- **Modular architecture**: Pick only the APIs you need

### Use Cases

- Running untrusted user code safely
- Serverless function execution
- Plugin systems with sandboxed extensions
- Testing code in isolated environments

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host (Node.js)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    @ricsam/isolate-runtime              │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │
│  │  │  fetch  │ │   fs    │ │ console │ │ timers  │ ...   │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │   │
│  │       │           │           │           │             │   │
│  │  ┌────┴───────────┴───────────┴───────────┴────┐       │   │
│  │  │              @ricsam/isolate-core           │       │   │
│  │  │   marshal/unmarshal, scopes, class builder  │       │   │
│  │  └─────────────────────┬───────────────────────┘       │   │
│  └────────────────────────│────────────────────────────────┘   │
│                           │                                     │
│  ┌────────────────────────┴────────────────────────────────┐   │
│  │                      isolated-vm                         │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │                  V8 Isolate                        │ │   │
│  │  │   Sandboxed JS execution with memory limits        │ │   │
│  │  │   WHATWG APIs available via injected References    │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Package Dependency Graph

```
                                ┌─────────────────┐
                                │     runtime     │
                                │   (aggregator)  │
                                └────────┬────────┘
                                         │
        ┌────────┬────────┬────────┬─────┼─────┬────────┬────────┐
        ▼        ▼        ▼        ▼     │     ▼        ▼        ▼
   ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐
   │console ││encoding││ timers ││  path  ││ crypto ││ fetch  ││   fs   │
   └───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘
       │         │         │         │         │         │         │
       └─────────┴─────────┴─────────┴────┬────┴─────────┴─────────┘
                                          ▼
                                    ┌──────────┐
                                    │   core   │
                                    │(isolated-│
                                    │   vm)    │
                                    └──────────┘
```

## Package Overview

| Package | Description | Complexity |
|---------|-------------|------------|
| **core** | Marshalling, scopes, class/function builders, Blob, File, URL, Streams | High |
| **console** | Console API (log, warn, error, etc.) with host callbacks | Low |
| **encoding** | TextEncoder, TextDecoder | Low |
| **timers** | setTimeout, setInterval, clearTimeout, clearInterval | Medium |
| **path** | Node.js path module (posix/win32) | Low |
| **crypto** | crypto.randomUUID, crypto.getRandomValues | Medium |
| **fetch** | Fetch API, Request, Response, Headers, FormData, AbortController | High |
| **fs** | File System Access API (OPFS-style) | High |
| **runtime** | Aggregator that sets up all APIs in one call | Medium |
| **test-utils** | Helpers for testing isolate code | Low |
| **test-environment** | Jest/Vitest-like test primitives for in-sandbox testing | Medium |
| **demo** | Example HTTP server with Playwright E2E tests | Medium |

## Implementation Order

The packages should be implemented in this order due to dependencies:

### Phase 1: Foundation

| # | Plan File | Package | Description |
|---|-----------|---------|-------------|
| 1 | [01-core.md](./01-core.md) | `@ricsam/isolate-core` | Must be first. Provides all foundational utilities. |

### Phase 2: Simple APIs (can be parallelized)

| # | Plan File | Package | Description |
|---|-----------|---------|-------------|
| 2 | [02-console.md](./02-console.md) | `@ricsam/isolate-console` | Simple callback-based logging |
| 3 | [03-encoding.md](./03-encoding.md) | `@ricsam/isolate-encoding` | TextEncoder/TextDecoder |
| 4 | [04-timers.md](./04-timers.md) | `@ricsam/isolate-timers` | Timer APIs |
| 5 | [05-path.md](./05-path.md) | `@ricsam/isolate-path` | Path utilities |
| 6 | [06-crypto.md](./06-crypto.md) | `@ricsam/isolate-crypto` | Crypto APIs |

### Phase 3: Complex APIs

| # | Plan File | Package | Description |
|---|-----------|---------|-------------|
| 7 | [07-fetch.md](./07-fetch.md) | `@ricsam/isolate-fetch` | Full Fetch API with streaming |
| 8 | [08-fs.md](./08-fs.md) | `@ricsam/isolate-fs` | File System Access API |

### Phase 4: Integration

| # | Plan File | Package | Description |
|---|-----------|---------|-------------|
| 9 | [09-runtime.md](./09-runtime.md) | `@ricsam/isolate-runtime` | Complete runtime aggregator |
| 10 | [10-test-utils.md](./10-test-utils.md) | `@ricsam/isolate-test-utils` | Testing helpers |
| 11 | [11-test-environment.md](./11-test-environment.md) | `@ricsam/isolate-test-environment` | In-sandbox test primitives |

### Phase 5: Demo & E2E

| # | Plan File | Package | Description |
|---|-----------|---------|-------------|
| 12 | [12-demo.md](./12-demo.md) | `@ricsam/isolate-demo` | HTTP server example with Playwright tests |

## Key Concepts

### Marshalling

Converting values between the host and isolate:

```typescript
// Host → Isolate
const ref = marshal(context, { name: "Alice", age: 30 });

// Isolate → Host
const value = unmarshal(context, ref);
```

### Scope Management

Automatic reference cleanup:

```typescript
await withScope(context, async (scope) => {
  const ref = scope.marshal({ data: "test" });
  await context.evalSync(`processData(data)`, { data: ref });
  // ref is automatically released when scope exits
});
```

### Class Builder

Injecting classes into the isolate:

```typescript
defineClass(context, {
  name: "Response",
  constructor: (body, init) => new ResponseState(body, init),
  properties: {
    ok: { get: (state) => state.status >= 200 && state.status < 300 },
    status: { get: (state) => state.status },
  },
  methods: {
    json: { fn: async (state) => JSON.parse(await state.text()) },
  },
});
```

### Async Operations

Bridging async operations across the isolate boundary:

```typescript
defineAsyncFunction(context, "fetch", async (url, init) => {
  const response = await hostFetch(url, init);
  return marshalResponse(context, response);
});
```

## API Mapping: quickjs-emscripten → isolated-vm

| quickjs-emscripten | isolated-vm | Notes |
|-------------------|-------------|-------|
| `QuickJSContext` | `ivm.Context` | Main execution context |
| `QuickJSRuntime` | `ivm.Isolate` | V8 isolate instance |
| `QuickJSHandle` | `ivm.Reference` | Reference to value in isolate |
| `context.evalCode(code)` | `context.evalSync(code)` | Sync code execution |
| `context.evalCode(code, { type: "module" })` | `isolate.compileModuleSync(code)` | Module execution |
| `context.newFunction(name, fn)` | `new ivm.Callback(fn)` | Create callable |
| `context.dump(handle)` | `reference.copySync()` | Extract value |
| `handle.dispose()` | `reference.release()` | Release reference |
| N/A | `new ivm.ExternalCopy(data)` | Efficient large data transfer |
| Manual execution | Automatic microtask queue | V8 handles promises natively |

## Technology Stack

- **Runtime**: Node.js v24+ (native TypeScript execution)
- **Package Manager**: npm v11 with workspaces
- **Test Framework**: Node.js built-in test runner (`node:test`)
- **Sandbox**: isolated-vm v6+
- **E2E Testing**: Playwright

## Development Workflow

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests for a specific package
npm test -w @ricsam/isolate-core

# Type check all packages
npm run typecheck

# Build all packages
npm run build
```

## Progress Tracking

Use the checkboxes in each plan file to track implementation progress. Example from 01-core.md:

```markdown
### 1. Marshal/Unmarshal (Priority: High)
- [ ] Implement `marshal(context, value)`
- [ ] Handle primitives
- [ ] Handle arrays and objects
...
```

## Resources

- [isolated-vm documentation](https://github.com/nicknisi/isolated-vm)
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)
- [WHATWG Streams Standard](https://streams.spec.whatwg.org/)
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [Node.js Test Runner](https://nodejs.org/api/test.html)
