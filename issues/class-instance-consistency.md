# Issue: Ensure Class Instance Consistency Across All Origins

## Summary

Request, Response, Headers, Blob, File, and FormData instances should behave identically regardless of where they originate. Currently, instances from different sources (custom functions, fetch callback, serve handler, direct instantiation) may have different methods available or behave differently. We need architectural guardrails (tests) to ensure consistent behavior.

## The Problem

When working with web API classes in the isolate sandbox, instances can originate from multiple sources:

| # | Origin | Direction | Example |
|---|--------|-----------|---------|
| 1 | Custom function return value | Host → Sandbox | `customFunctions: { getRequest: () => new Request(...) }` |
| 2 | Direct instantiation in sandbox | Sandbox only | `new Request(...)` in isolate code |
| 3 | `serve()` handler receives Request | Host → Sandbox | `serve({ fetch(request) { ... } })` |
| 4 | `fetch()` callback returns Response | Host → Sandbox | `const response = await fetch(url)` |
| 5 | Direct instantiation in sandbox | Sandbox only | `new Response(...)` in isolate code |
| 6 | Custom function return value | Host → Sandbox | `customFunctions: { getResponse: () => new Response(...) }` |
| 7 | `runtime.fetch.dispatchRequest` | Sandbox → Host | Host receives Response from isolate's serve() |

**The expectation:** A user should be able to use any Request/Response/Headers/etc. instance identically, regardless of how it was obtained.

**The reality:** Depending on the serialization path taken, certain methods may be missing or behave differently:

- `response.body.tee()` throws `TypeError: not a function` when Response comes from fetch callback (body is `Uint8Array`, not `ReadableStream`)
- `response.body.pipeThrough()` may not be available
- `response.clone()` behavior may differ
- Streaming methods availability varies
- Internal properties like `bodyUsed` may not track correctly

## Affected Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **Request** | `body`, `body.tee()`, `body.pipeThrough()`, `body.getReader()`, `clone()`, `bodyUsed` |
| **Response** | `body`, `body.tee()`, `body.pipeThrough()`, `body.getReader()`, `clone()`, `bodyUsed` |
| **Headers** | `forEach()`, `entries()`, `keys()`, `values()`, `[Symbol.iterator]` |
| **Blob** | `stream()`, `slice()`, `arrayBuffer()`, `text()` |
| **File** | All Blob methods + `name`, `lastModified`, `webkitRelativePath` |
| **FormData** | `entries()`, `keys()`, `values()`, `[Symbol.iterator]`, File handling |

## Root Cause

Different serialization paths use different mechanisms:

### Path A: Custom Functions (marshalValue)
```
Host object → marshalValue() → RequestRef/ResponseRef (JSON) → unmarshalValue() → Sandbox object
```
- Body eagerly read via `clone().arrayBuffer()`
- Stored as `number[]` in JSON
- Reconstructed as `new Request(url, { body: Uint8Array })`

### Path B: Fetch Callback
```
Host Response → serializeResponse() → { body: Uint8Array } → deserializeResponse() → new Response(body)
```
- Body eagerly read via `response.arrayBuffer()`
- `response.body` becomes the Uint8Array, not a ReadableStream
- No streaming methods available

### Path C: serve() Handler Request
```
Host Request → serializeRequestWithStreaming() → may use bodyStreamId → daemon deserializes → Sandbox Request
```
- Large bodies streamed with `bodyStreamId`
- Small bodies still buffered as Uint8Array

### Path D: Direct Instantiation
```
new Response(stream) → full streaming support
```
- Native behavior, all methods available

## Proposed Solution: Consistency Test Suite

Create a comprehensive test suite that validates identical behavior across all origins. The tests should be structured as a matrix:

### Test Matrix Structure

```typescript
type Origin =
  | 'direct'              // new Request/Response in sandbox
  | 'customFunction'      // returned from host custom function
  | 'fetchCallback'       // Response from fetch() callback
  | 'serveRequest'        // Request received in serve() handler
  | 'dispatchResponse';   // Response from dispatchRequest (host-side)

type Assertion = {
  property: string;
  method: string;
  args?: unknown[];
  expected: (instance: unknown) => unknown;
};

// Test all assertions against all origins
```

### Test Categories

#### 1. Property Existence Tests
Verify that all expected properties exist on instances from each origin:

```typescript
const requestProperties = [
  'method', 'url', 'headers', 'body', 'bodyUsed',
  'mode', 'credentials', 'cache', 'redirect', 'referrer',
  'referrerPolicy', 'integrity', 'signal'
];

const responseProperties = [
  'status', 'statusText', 'ok', 'headers', 'body',
  'bodyUsed', 'type', 'url', 'redirected'
];

for (const origin of ALL_ORIGINS) {
  for (const prop of requestProperties) {
    test(`Request.${prop} exists when from ${origin}`, ...);
  }
}
```

#### 2. Method Existence Tests
Verify that all expected methods exist:

```typescript
const bodyMethods = ['text', 'json', 'arrayBuffer', 'blob', 'formData'];
const streamMethods = ['getReader', 'tee', 'pipeThrough', 'pipeTo'];

for (const origin of ALL_ORIGINS) {
  for (const method of bodyMethods) {
    test(`Request.${method}() exists when from ${origin}`, ...);
  }
  test(`Request.body has ReadableStream methods when from ${origin}`, ...);
}
```

#### 3. Method Behavior Equivalence Tests
Verify methods return equivalent results:

```typescript
test('Response.text() returns same content across all origins', async () => {
  const body = 'Hello World';

  const responses = {
    direct: new Response(body),
    customFunction: await getResponseFromCustomFunction(body),
    fetchCallback: await getResponseFromFetchCallback(body),
    // ... etc
  };

  for (const [origin, response] of Object.entries(responses)) {
    expect(await response.text()).toBe(body);
  }
});
```

#### 4. Streaming Behavior Tests
Verify streaming works consistently:

```typescript
test('Response.body.tee() works across all origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const response = await getStreamingResponse(origin);

    // This is the critical assertion that currently FAILS for fetchCallback
    expect(typeof response.body.tee).toBe('function');

    const [s1, s2] = response.body.tee();
    expect(s1).toBeInstanceOf(ReadableStream);
    expect(s2).toBeInstanceOf(ReadableStream);
  }
});

test('Response.body can be read as stream across all origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const response = await getStreamingResponse(origin);
    const reader = response.body.getReader();

    expect(typeof reader.read).toBe('function');
    expect(typeof reader.cancel).toBe('function');
    expect(typeof reader.releaseLock).toBe('function');
  }
});
```

#### 5. instanceof Consistency Tests
Verify instanceof checks work:

```typescript
test('Response instanceof Response across all origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const response = await getResponse(origin);
    expect(response instanceof Response).toBe(true);
  }
});

test('Headers instanceof Headers across all origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const response = await getResponse(origin);
    expect(response.headers instanceof Headers).toBe(true);
  }
});
```

#### 6. Clone Behavior Tests
Verify clone creates independent copies:

```typescript
test('Response.clone() works across all origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const response = await getResponse(origin, 'test body');

    // clone() should exist and work
    expect(typeof response.clone).toBe('function');
    const cloned = response.clone();

    // Both should be readable independently
    expect(await response.text()).toBe('test body');
    expect(await cloned.text()).toBe('test body');
  }
});
```

### Proposed File Structure

```
packages/fetch/src/
├── consistency/
│   ├── origins.ts              # Setup helpers for each origin
│   ├── request-consistency.test.ts
│   ├── response-consistency.test.ts
│   ├── headers-consistency.test.ts
│   ├── blob-consistency.test.ts
│   ├── file-consistency.test.ts
│   └── formdata-consistency.test.ts
```

### Test Helpers

```typescript
// packages/fetch/src/consistency/origins.ts

export async function createRequestFromOrigin(
  origin: Origin,
  init: { url: string; method?: string; headers?: HeadersInit; body?: BodyInit }
): Promise<Request> {
  switch (origin) {
    case 'direct':
      return isolate.eval(`new Request("${init.url}", ${JSON.stringify(init)})`);

    case 'customFunction':
      // Setup custom function that returns Request
      // Call it from isolate
      break;

    case 'serveRequest':
      // Setup serve() handler
      // Dispatch request and capture the request object
      break;

    // ... etc
  }
}

export async function createResponseFromOrigin(
  origin: Origin,
  body: BodyInit,
  init?: ResponseInit
): Promise<Response> {
  // Similar pattern for Response
}
```

## Implementation Priority

### Phase 1: Document Current State (Tests Expected to Fail)
Write tests that document current behavior, even where inconsistent. Mark expected failures clearly:

```typescript
test.failing('Response.body.tee() works for fetchCallback origin', async () => {
  // Currently fails - body is Uint8Array not ReadableStream
});
```

### Phase 2: Fix Critical Inconsistencies
1. Fix fetch callback Response to have proper ReadableStream body (related to streaming-fetch-callback-buffering issue)
2. Ensure all body consumption methods work consistently

### Phase 3: Comprehensive Coverage
1. Add all property/method existence tests
2. Add all behavioral equivalence tests
3. Add iteration/enumeration tests
4. Add edge case tests

## Acceptance Criteria

- [ ] Test suite covers all 7 origins listed above
- [ ] Test suite covers Request, Response, Headers, Blob, File, FormData
- [ ] All property existence tests pass
- [ ] All method existence tests pass
- [ ] All behavioral equivalence tests pass
- [ ] All instanceof tests pass
- [ ] Streaming methods (`tee()`, `pipeThrough()`, `getReader()`) work across all origins
- [ ] Tests run in CI and block merges that break consistency

## Related Issues

- [streaming-fetch-callback-buffering.md](./streaming-fetch-callback-buffering.md) - Root cause of missing stream methods on fetch callback responses

## Impact

- **Prevents regression** - Any change to serialization that breaks consistency will be caught
- **Documents behavior** - Developers can see expected behavior in tests
- **Enables confident refactoring** - Can optimize serialization knowing tests catch regressions
- **Improves DX** - Users don't encounter surprising "method not found" errors

## Notes

The existing test suite has good coverage of individual class behavior and some bidirectional conversion tests, but lacks systematic cross-origin consistency validation. Key existing test files:

- `packages/fetch/src/request.test.ts` - Request class tests including native conversion
- `packages/fetch/src/response.test.ts` - Response class tests including native conversion
- `packages/fetch/src/headers.test.ts` - Headers class tests including native conversion
- `packages/fetch/src/serve.test.ts` - serve() handler tests
- `packages/fetch/src/integration.test.ts` - Integration tests with some cross-origin scenarios

The proposed consistency test suite would complement these by providing a systematic matrix-based validation approach.
