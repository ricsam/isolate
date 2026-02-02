# Fetch Response Issues: `mod.evaluate()` vs Async `Reference.apply()`

## Root Problem

`isolated-vm`'s `Module.evaluate()` does **not** wait for `Reference.apply()` with `{ result: { promise: true, copy: true } }` to resolve. This means top-level `await` in modules does not work with async host-to-isolate calls.

```js
// This does NOT work - __result is undefined
const mod = await isolate.compileModule(
  'const x = await __ref.apply(undefined, [], { result: { promise: true, copy: true } }); globalThis.__result = x;'
);
await mod.evaluate({ promise: true });
// globalThis.__result === undefined

// But this DOES work
await context.eval(
  '(async () => { const x = await __ref.apply(...); globalThis.__result = x; })()',
  { promise: true }
);
// globalThis.__result === 42
```

Meanwhile, `applySyncPromise` (the old approach) works with `mod.evaluate()` but blocks the isolate thread, preventing timers and AbortController from working during fetch.

## Impact

The plan's Fix 1 (making `fetch()` async via `Reference.apply()`) broke all code paths that go through `runtime.eval()` → `mod.evaluate()`:

- **20 test failures** across `packages/runtime`, `packages/fetch/src/consistency`, `packages/test-utils`
- Any user code that does `await fetch(...)` inside `runtime.eval()` silently fails (the await completes immediately with undefined)

The `dispatchRequest` path works because it uses `context.eval(..., { promise: true })`.

## Affected Test Categories

1. **`packages/runtime/src/index.test.ts`** - `fetch calls handler` (1 test)
2. **`packages/fetch/src/consistency/`** - All `serveRequest` origin tests and abort tests (~15 tests)
3. **`packages/test-utils/src/index.test.ts`** - `captures and mocks fetch calls` (1 test)
4. **`packages/fetch/src/index.test.ts`** - Unhandled abort rejection leaking (1 test file)
5. **`packages/fetch/src/form-data.test.ts`** - FormData url-encoded (1 test)

## Architectural Options

### Option A: Change `runtime.eval()` to use `context.eval()` instead of `mod.evaluate()`

Wrap user code in an async IIFE and use `context.eval(..., { promise: true })`:
```js
await context.eval(`(async () => { ${code} })()`, { promise: true });
```

**Problem:** This loses ES module semantics - no `import`/`export`, no module-scoped variables.

### Option B: Dual fetch implementation (sync default, async in serve)

Keep `applySyncPromise` for `fetch()` when called from `runtime.eval()` (module context). Use `Reference.apply()` only when called from `dispatchRequest` (which uses `context.eval` with `{ promise: true }`).

**Problem:** Complex, two code paths to maintain. Timers and AbortController still won't work during fetch in the module eval path.

### Option C: Wrap-and-call module evaluation (DOES NOT WORK)

Dynamic `import()` from `context.eval` returns "Not supported" in isolated-vm. This option is dead.

### Option D: Keep `applySyncPromise` for fetch, add separate async mechanism for AbortController/timers

Use `applySyncPromise` for the core fetch call (blocking, works with modules). For abort support, use a separate mechanism:
- Host-side timeout that races with the fetch
- Pass abort info as a parameter rather than relying on isolate timers

**Problem:** Doesn't solve the general problem of async operations in modules. Limits what users can do in isolate code.

### Option E: Split imports from body, wrap body in async export (RECOMMENDED)

Parse user code to separate `import` statements from the rest of the body. Keep imports at module top level, wrap the body in `export default async function() { ... }`. Then:

1. Compile and instantiate the module (import resolution works)
2. `mod.evaluate()` runs fast (just defines the function + resolves imports)
3. Get the default export via `mod.namespace.get('default', { reference: true })`
4. Call it with `{ result: { promise: true } }` which properly awaits async Reference.apply operations

```js
// User code:
//   import { value } from "@/dep";
//   const y = await fetch("...");
//   console.log(y, value);

// Transformed to:
//   import { value } from "@/dep";
//   export default async function() {
//     const y = await fetch("...");
//     console.log(y, value);
//   }
```

**Verified working** - imports are accessible inside the function because it closes over module scope:

```js
// Prototype test:
const depMod = await isolate.compileModule('export const value = 123;', { filename: '/dep.js' });
await depMod.instantiate(context, () => { throw new Error(); });
await depMod.evaluate();

const wrappedCode = `
  import { value } from "/dep.js";
  export default async function() {
    const y = await __asyncRef.apply(undefined, [], { result: { promise: true, copy: true } });
    globalThis.__result = y + value;
  }
`;
const mod = await isolate.compileModule(wrappedCode, { filename: '/test.js' });
await mod.instantiate(context, resolver);
await mod.evaluate();

const ns = mod.namespace;
const defaultExport = await ns.get('default', { reference: true });
await defaultExport.apply(undefined, [], { result: { promise: true } });
defaultExport.release();

// globalThis.__result === 165 (42 + 123) ✓
```

**Trade-offs:**
- Variables declared in user code become function-scoped (not module-scoped). This means `export` from user code won't work. For `runtime.eval()` use cases this is acceptable since eval'd code doesn't export values.
- Requires parsing import statements from user code (can be done with regex for simple cases, or a proper parser for robustness).
- Top-level `return` statements would be valid (inside function), which is a minor semantic change.

**Implementation location:** `packages/runtime/src/index.ts` lines 1016-1046 (`eval()` method)

## Recommended Approach

**Option E** is the recommended fix. It:
- Preserves module import resolution
- Makes all async operations (fetch, stream pull, timers) work correctly in `runtime.eval()`
- Is a single, contained change in `runtime.eval()` implementation
- Doesn't require changes to the fetch implementation or dual code paths

## Additional Issues Found

### Unhandled AbortError rejection leak

The abort signal mechanism creates a `Promise.race` with an abort promise that is never settled when the fetch completes normally. This causes unhandled rejection warnings:

```
Error: A resource generated asynchronous activity after the test ended.
This activity created the error "Error: [AbortError]The operation was aborted."
```

Fix: use an `AbortController` for the abort promise itself, and abort it when the fetch completes normally to prevent the dangling listener/promise.

### FormData test contradiction

`packages/fetch/src/form-data.test.ts` "Request with string-only FormData uses url-encoded" conflicts with the consistency test that expects multipart. WHATWG spec says FormData is always multipart/form-data. The form-data test is wrong and should be updated.

### Response(blob/file) tests

3 tests in `packages/fetch/src/index.test.ts` for `new Response(blob)`, `new Response(file)`, `new Response(file.slice())` fail because blob streaming uses `async` operations (blob → arrayBuffer → stream push) that don't complete during `mod.evaluate()`. These will also be fixed by Option E.
