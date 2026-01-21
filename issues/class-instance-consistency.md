# Issue: Ensure Class Instance Consistency Across All Origins

## Summary

All Web API "standard library" class instances should behave identically regardless of where they originate or which serialization path they take. This includes not just fetch-related classes (Request, Response, Headers, Blob, File, FormData) but the full standard library: streams, URLs, abort controllers, encoding utilities, typed arrays, and more.

Currently, instances from different sources (custom functions, fetch callback, serve handler, direct instantiation) may have different methods available or behave differently. Any API that produces a class instance should yield identical behavior—whether via `fetch()` callback, `customFunctions` return values, `serve()` handler, or direct instantiation. We need architectural guardrails (tests) to ensure consistent behavior across all origins and all serialization paths.

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

### Fetch-Related Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **Request** | `body`, `body.tee()`, `body.pipeThrough()`, `body.getReader()`, `clone()`, `bodyUsed` |
| **Response** | `body`, `body.tee()`, `body.pipeThrough()`, `body.getReader()`, `clone()`, `bodyUsed` |
| **Headers** | `forEach()`, `entries()`, `keys()`, `values()`, `[Symbol.iterator]` |
| **Blob** | `stream()`, `slice()`, `arrayBuffer()`, `text()` |
| **File** | All Blob methods + `name`, `lastModified`, `webkitRelativePath` |
| **FormData** | `entries()`, `keys()`, `values()`, `[Symbol.iterator]`, File handling |

### Stream Classes (High Priority)

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **ReadableStream** | `tee()`, `pipeThrough()`, `pipeTo()`, `getReader()`, `locked`, `cancel()`, `[Symbol.asyncIterator]` |
| **WritableStream** | `getWriter()`, `abort()`, `close()`, `locked` |
| **TransformStream** | `readable`, `writable` |
| **ReadableStreamDefaultReader** | `read()`, `releaseLock()`, `cancel()`, `closed` |
| **WritableStreamDefaultWriter** | `write()`, `close()`, `abort()`, `releaseLock()`, `closed`, `ready`, `desiredSize` |
| **TextEncoderStream** | `readable`, `writable`, `encoding` |
| **TextDecoderStream** | `readable`, `writable`, `encoding`, `fatal`, `ignoreBOM` |
| **ByteLengthQueuingStrategy** | `size()`, `highWaterMark` |
| **CountQueuingStrategy** | `size()`, `highWaterMark` |

### URL Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **URL** | `href`, `origin`, `protocol`, `host`, `hostname`, `port`, `pathname`, `search`, `hash`, `searchParams`, `toString()`, `toJSON()` |
| **URLSearchParams** | `append()`, `delete()`, `get()`, `getAll()`, `has()`, `set()`, `sort()`, `entries()`, `keys()`, `values()`, `forEach()`, `[Symbol.iterator]` |

### Abort Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **AbortController** | `signal`, `abort()` |
| **AbortSignal** | `aborted`, `reason`, `throwIfAborted()`, `addEventListener()`, `removeEventListener()`, `onabort` |

### Encoding Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **TextEncoder** | `encode()`, `encodeInto()`, `encoding` |
| **TextDecoder** | `decode()`, `encoding`, `fatal`, `ignoreBOM` |

### Crypto Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **CryptoKey** | `type`, `extractable`, `algorithm`, `usages` |

### Exception Classes

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **DOMException** | `name`, `message`, `code` |

### WebSocket Classes (serve() context)

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **ServerWebSocket** | `send()`, `close()`, `readyState`, `data`, `remoteAddress` |

### Typed Arrays & Buffers

| Class | Properties/Methods That May Vary |
|-------|----------------------------------|
| **Uint8Array** | `buffer`, `byteOffset`, `byteLength`, `length`, `slice()`, `subarray()`, `set()`, iteration |
| **Int8Array** | Same as Uint8Array |
| **Uint16Array** | Same as Uint8Array |
| **Int16Array** | Same as Uint8Array |
| **Uint32Array** | Same as Uint8Array |
| **Int32Array** | Same as Uint8Array |
| **Float32Array** | Same as Uint8Array |
| **Float64Array** | Same as Uint8Array |
| **BigInt64Array** | Same as Uint8Array |
| **BigUint64Array** | Same as Uint8Array |
| **ArrayBuffer** | `byteLength`, `slice()`, `transfer()` |
| **DataView** | `buffer`, `byteOffset`, `byteLength`, getters/setters for all types |

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

## Consistency Boundaries

Classes must behave identically regardless of which path they take:

### Path 1: Host → Sandbox (in-process mode)
- Direct marshal/unmarshal via `packages/isolate-protocol/src/marshalValue.ts`
- Examples: customFunctions return values, direct isolate API

### Path 2: Host → Client → Daemon → Sandbox (daemon mode)
- Serialization through daemon protocol
- `packages/isolate-client/src/connection.ts` for client-side serialization
- Daemon deserializes and passes to sandbox

**Key principle:** Any API that produces a class instance should yield identical behavior:
- `fetch()` callback returning Response
- `customFunctions` returning Request/Response/Headers/etc.
- `serve()` handler receiving Request
- Direct instantiation in sandbox code
- Any other API returning standard library objects

## Known Issues

### HostBackedReadableStream Missing Methods

**Location:** `packages/fetch/src/index.ts:518-595`

The `HostBackedReadableStream` class is missing methods that a standard ReadableStream would have:

| Method | Status |
|--------|--------|
| `tee()` | Not implemented |
| `pipeThrough()` | Not implemented |
| `pipeTo()` | Not implemented |
| `locked` | Always returns `false`, doesn't track actual lock state |

This is a concrete example of the consistency problem: depending on how a ReadableStream is obtained, it may or may not have these methods available. Code that works with a direct `new ReadableStream()` may fail when given a `HostBackedReadableStream`.

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

#### 7. Stream Class Tests
Verify ReadableStream, WritableStream, and TransformStream behave consistently:

```typescript
test('ReadableStream has all expected methods across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const stream = await getReadableStream(origin);

    expect(typeof stream.getReader).toBe('function');
    expect(typeof stream.tee).toBe('function');
    expect(typeof stream.pipeThrough).toBe('function');
    expect(typeof stream.pipeTo).toBe('function');
    expect(typeof stream.cancel).toBe('function');
    expect('locked' in stream).toBe(true);
  }
});

test('TransformStream produces correct readable/writable pair', async () => {
  for (const origin of ALL_ORIGINS) {
    const transform = await getTransformStream(origin);

    expect(transform.readable).toBeInstanceOf(ReadableStream);
    expect(transform.writable).toBeInstanceOf(WritableStream);
  }
});
```

#### 8. URL Class Tests
Verify URL and URLSearchParams work consistently:

```typescript
test('URL has all expected properties across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const url = await getURL(origin, 'https://example.com:8080/path?query=value#hash');

    expect(url.href).toBe('https://example.com:8080/path?query=value#hash');
    expect(url.origin).toBe('https://example.com:8080');
    expect(url.protocol).toBe('https:');
    expect(url.host).toBe('example.com:8080');
    expect(url.pathname).toBe('/path');
    expect(url.search).toBe('?query=value');
    expect(url.hash).toBe('#hash');
    expect(url.searchParams).toBeInstanceOf(URLSearchParams);
  }
});

test('URLSearchParams iteration works across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const params = await getURLSearchParams(origin, 'a=1&b=2');

    expect(typeof params.entries).toBe('function');
    expect(typeof params.keys).toBe('function');
    expect(typeof params.values).toBe('function');
    expect(typeof params[Symbol.iterator]).toBe('function');
  }
});
```

#### 9. Abort Class Tests
Verify AbortController and AbortSignal work consistently:

```typescript
test('AbortController creates valid AbortSignal across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const controller = await getAbortController(origin);

    expect(controller.signal).toBeInstanceOf(AbortSignal);
    expect(controller.signal.aborted).toBe(false);
    expect(typeof controller.abort).toBe('function');

    controller.abort('test reason');
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe('test reason');
  }
});

test('AbortSignal event handling works across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const controller = await getAbortController(origin);
    let abortCalled = false;

    controller.signal.addEventListener('abort', () => { abortCalled = true; });
    controller.abort();

    expect(abortCalled).toBe(true);
  }
});
```

#### 10. Encoding Class Tests
Verify TextEncoder and TextDecoder work consistently:

```typescript
test('TextEncoder/TextDecoder roundtrip works across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const encoder = await getTextEncoder(origin);
    const decoder = await getTextDecoder(origin);

    const original = 'Hello, 世界!';
    const encoded = encoder.encode(original);
    const decoded = decoder.decode(encoded);

    expect(decoded).toBe(original);
    expect(encoder.encoding).toBe('utf-8');
    expect(decoder.encoding).toBe('utf-8');
  }
});
```

#### 11. Typed Array Tests
Verify typed arrays behave consistently:

```typescript
const typedArrayClasses = [
  Uint8Array, Int8Array, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array,
  BigInt64Array, BigUint64Array
];

for (const TypedArrayClass of typedArrayClasses) {
  test(`${TypedArrayClass.name} has all expected properties across origins`, async () => {
    for (const origin of ALL_ORIGINS) {
      const arr = await getTypedArray(origin, TypedArrayClass);

      expect('buffer' in arr).toBe(true);
      expect('byteOffset' in arr).toBe(true);
      expect('byteLength' in arr).toBe(true);
      expect('length' in arr).toBe(true);
      expect(typeof arr.slice).toBe('function');
      expect(typeof arr.subarray).toBe('function');
      expect(typeof arr.set).toBe('function');
      expect(typeof arr[Symbol.iterator]).toBe('function');
    }
  });
}

test('ArrayBuffer has expected methods across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const buffer = await getArrayBuffer(origin, 16);

    expect(buffer.byteLength).toBe(16);
    expect(typeof buffer.slice).toBe('function');
  }
});

test('DataView has expected methods across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const view = await getDataView(origin);

    expect('buffer' in view).toBe(true);
    expect('byteOffset' in view).toBe(true);
    expect('byteLength' in view).toBe(true);
    expect(typeof view.getInt8).toBe('function');
    expect(typeof view.setInt8).toBe('function');
    expect(typeof view.getUint32).toBe('function');
    expect(typeof view.setFloat64).toBe('function');
  }
});
```

#### 12. Exception Class Tests
Verify DOMException behaves consistently:

```typescript
test('DOMException has expected properties across origins', async () => {
  for (const origin of ALL_ORIGINS) {
    const error = await getDOMException(origin, 'Test error', 'AbortError');

    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('Test error');
    expect(typeof error.code).toBe('number');
  }
});
```

### Proposed File Structure

```
packages/fetch/src/
├── consistency/
│   ├── origins.ts                    # Setup helpers for each origin
│   ├── request-consistency.test.ts
│   ├── response-consistency.test.ts
│   ├── headers-consistency.test.ts
│   ├── blob-consistency.test.ts
│   ├── file-consistency.test.ts
│   ├── formdata-consistency.test.ts
│   ├── stream-consistency.test.ts    # ReadableStream, WritableStream, TransformStream
│   ├── url-consistency.test.ts       # URL, URLSearchParams
│   ├── abort-consistency.test.ts     # AbortController, AbortSignal
│   ├── encoding-consistency.test.ts  # TextEncoder, TextDecoder
│   ├── typed-array-consistency.test.ts  # All typed arrays, ArrayBuffer, DataView
│   └── exception-consistency.test.ts # DOMException
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
1. Fix fetch callback Response to have proper ReadableStream body
2. Ensure all body consumption methods work consistently

### Phase 3: Comprehensive Coverage
1. Add all property/method existence tests
2. Add all behavioral equivalence tests
3. Add iteration/enumeration tests
4. Add edge case tests

## Acceptance Criteria

### Core Classes
- [x] Test suite covers all 7 origins listed above
- [x] Test suite covers Request, Response, Headers, Blob, File, FormData
- [x] All property existence tests pass
- [x] All method existence tests pass
- [x] All behavioral equivalence tests pass
- [x] All instanceof tests pass

### Stream Classes
- [x] ReadableStream methods (`tee()`, `pipeThrough()`, `pipeTo()`, `getReader()`) work across all origins
- [x] WritableStream methods work across all origins
- [x] TransformStream produces correct readable/writable pairs
- [x] Stream readers and writers behave consistently

### URL Classes
- [x] URL properties and methods work across all origins
- [x] URLSearchParams iteration and mutation methods work consistently

### Abort Classes
- [x] AbortController creates valid signals across all origins
- [x] AbortSignal event handling works consistently

### Encoding Classes
- [ ] TextEncoder/TextDecoder roundtrip works across all origins
- [ ] Encoding options (fatal, ignoreBOM) behave consistently

### Typed Arrays & Buffers
- [ ] All 10 typed array classes behave consistently
- [ ] ArrayBuffer methods work across all origins
- [ ] DataView getters/setters work consistently

### Exception Classes
- [ ] DOMException properties (name, message, code) work consistently

### CI/CD
- [ ] Tests run in CI and block merges that break consistency


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
