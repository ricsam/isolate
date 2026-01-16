# Simplify CustomFunctions API: Remove Type Declaration

## Goal

Remove the `type: 'sync' | 'async' | 'asyncIterator'` requirement from customFunctions, making the API simpler:

```typescript
// Before (explicit type required)
customFunctions: {
  hashPassword: {
    fn: async (pw) => bcrypt.hash(pw, 10),
    type: 'async',
  },
  streamData: {
    fn: async function* () { yield 1; yield 2; },
    type: 'asyncIterator',
  },
}

// After (no type needed)
customFunctions: {
  hashPassword: async (pw) => bcrypt.hash(pw, 10),
  streamData: async function* () { yield 1; yield 2; },
}
```

## Approach

Use the existing marshalling system (PromiseRef, AsyncIteratorRef) to handle all return types uniformly:

1. **All functions use a unified "sync" wrapper** on the daemon
2. **Auto-detect async generators** on client side and call them to get the iterator
3. **Return values are marshalled** - Promises become PromiseRef, AsyncIterators become AsyncIteratorRef
4. **Isolate receives real Promise/AsyncIterator objects** via `unmarshalFromHost()`

This eliminates:
- The 4 companion callbacks pattern for asyncIterator (`name:start`, `name:next`, etc.)
- Different wrapper code generation for each type
- The `type` field in both user API and protocol

## Files to Modify

| File | Changes |
|------|---------|
| `packages/isolate-protocol/src/types.ts` | Update CustomFunctionDefinition to allow bare functions |
| `packages/isolate-client/src/connection.ts` | Simplify registerCustomFunctions(), remove companion callbacks |
| `packages/isolate-daemon/src/connection.ts` | Use unified wrapper, remove type-based code generation |
| `README.md` (root) | Update Custom Functions documentation |
| `packages/isolate-client/README.md` | Update Custom Functions documentation |
| `packages/runtime/README.md` | Update Custom Functions documentation |

## Implementation

### Phase 1: Update Type Definitions

**File: `packages/isolate-protocol/src/types.ts`**

```typescript
// Before
export type CustomFunctionType = 'sync' | 'async' | 'asyncIterator';

export interface CustomFunctionDefinition {
  fn: CustomFunction | CustomAsyncGeneratorFunction;
  type: CustomFunctionType;
}

export type CustomFunctions = Record<string, CustomFunctionDefinition>;

// After
export type CustomFunction = (...args: unknown[]) => unknown;

// Support both old and new syntax for backwards compatibility
export type CustomFunctionDefinition =
  | CustomFunction  // New: bare function
  | { fn: CustomFunction; type?: 'sync' | 'async' | 'asyncIterator' };  // Old: object with optional type

export type CustomFunctions = Record<string, CustomFunctionDefinition>;
```

Also update `CallbackRegistration` to make `type` optional or remove it.

### Phase 2: Simplify Client Registration

**File: `packages/isolate-client/src/connection.ts`**

In `registerCustomFunctions()` (~line 1196):

1. **Normalize function definitions:**
```typescript
function normalizeCustomFunction(def: CustomFunctionDefinition): CustomFunction {
  return typeof def === 'function' ? def : def.fn;
}
```

2. **Auto-detect and handle async generators:**
```typescript
function isAsyncGeneratorFunction(fn: Function): boolean {
  return fn.constructor.name === 'AsyncGeneratorFunction';
}

// For async generators, wrap to call and return the iterator
function wrapAsyncGenerator(fn: Function): Function {
  return (...args: unknown[]) => fn(...args);  // Call returns AsyncIterator
}
```

3. **Remove companion callback registration** (lines 1203-1287):
   - Delete the `asyncIterator` branch with 4 companion callbacks
   - All functions use a single callback that marshals return values

4. **Single registration path for all functions:**
```typescript
for (const [name, def] of Object.entries(customFunctions)) {
  const fn = normalizeCustomFunction(def);
  const actualFn = isAsyncGeneratorFunction(fn)
    ? (...args) => fn(...args)  // Call generator to get iterator
    : fn;

  const callbackId = state.nextCallbackId++;
  state.callbacks.set(callbackId, async (...args: unknown[]) => {
    const result = await actualFn(...args);
    const marshalled = await marshalValue(result, marshalCtx);
    return addCallbackIdsToRefs(marshalled);
  });

  registrations[name] = { callbackId, name };  // No type field
}
```

### Phase 3: Simplify Daemon Wrapper Generation

**File: `packages/isolate-daemon/src/connection.ts`**

In `setupCustomFunctions()` (~line 1672):

1. **Remove type-based branching** (lines 1854-1963):
   - Delete the `if (registration.type === 'sync')` branch
   - Delete the `else if (registration.type === 'asyncIterator')` branch
   - Delete the `else if (registration.type === 'async')` branch

2. **Remove companion callback skipping** (lines 1848-1852):
```typescript
// DELETE this - no more companion callbacks
if (name.includes(':')) {
  continue;
}
```

3. **Use unified wrapper for all functions:**
```typescript
for (const [name, registration] of Object.entries(customCallbacks)) {
  context.evalSync(`
    globalThis.${name} = function(...args) {
      const argsJson = JSON.stringify(__marshalForHost(args));
      const resultJson = __customFn_invoke.applySyncPromise(
        undefined,
        [${registration.callbackId}, argsJson]
      );
      const result = JSON.parse(resultJson);
      if (result.ok) {
        return __unmarshalFromHost(result.value);
      } else {
        const error = new Error(result.error.message);
        error.name = result.error.name;
        throw error;
      }
    };
  `);
}
```

The magic happens in `unmarshalFromHost()` which already handles:
- `PromiseRef` → creates real `Promise` that resolves via callback
- `AsyncIteratorRef` → creates real async iterable with `[Symbol.asyncIterator]()`
- `CallbackRef` → creates callable function

### Phase 4: Update Documentation

Update the "Custom Functions" and "Supported Data Types" sections in:
- `/README.md`
- `/packages/isolate-client/README.md`
- `/packages/runtime/README.md`

New documentation:

```typescript
// Simple API - just pass functions
const runtime = await createRuntime({
  customFunctions: {
    // Sync function
    getConfig: () => ({ env: "production" }),

    // Async function
    hashPassword: async (pw) => bcrypt.hash(pw, 10),

    // Async generator
    streamData: async function* (count) {
      for (let i = 0; i < count; i++) yield i;
    },
  },
});

await runtime.eval(`
  const config = getConfig();           // Works
  const hash = await hashPassword(pw);  // Works
  for await (const x of streamData(5)) { ... }  // Works
`);
```

## Trade-offs

**Advantages:**
- Much simpler API (no `type` field)
- Less code to maintain
- Leverages existing marshalling infrastructure
- Consistent behavior for all function types

**Disadvantages:**
- Loses async iterator `throw()` support (rarely used)
- Breaking change for existing users (but easy migration)
- Slightly different semantics: async generators are called immediately to get iterator

## Migration Path

For backwards compatibility, support both syntaxes:

```typescript
// Old syntax (still works, type is ignored)
hashPassword: {
  fn: async (pw) => bcrypt.hash(pw, 10),
  type: 'async',  // Ignored but accepted
}

// New syntax (preferred)
hashPassword: async (pw) => bcrypt.hash(pw, 10),
```

## Verification

1. **Run existing tests:**
   ```bash
   npx tsx --test packages/isolate-client/src/marshalling.test.ts
   ```

2. **Test all function types work without `type` field:**
   - Sync functions return values
   - Async functions return Promises that can be awaited
   - Async generators can be used with `for await...of`

3. **Test backwards compatibility:**
   - Old syntax with `{ fn, type }` still works
   - New syntax with bare functions works

4. **Build and typecheck:**
   ```bash
   npm run build
   npm run typecheck
   ```
