# Isolate Integration Fixes

This document tracks issues discovered during integration of the `@ricsam/isolate-*` packages with the build-it-now project. These are temporary fixes that need proper implementation in the isolate library.

## Issue 1: Bun importing isolated-vm due to import structure

**Problem:** When importing from `@ricsam/isolate-client` in a Bun project, Bun would try to load `isolated-vm` (a Node.js native module) even though the client package shouldn't need it directly.

**Cause:** The import/export structure in the isolate packages caused Bun's module resolver to follow paths that eventually led to `isolated-vm`.

**Temporary Fix:** Restructured imports in the isolate packages to ensure clean separation between client (Bun-compatible) and daemon (Node.js-only) code.

**Proper Fix Needed:** Review and refactor the package exports to ensure `@ricsam/isolate-client` has no transitive dependencies on Node.js-only modules like `isolated-vm`.

---

## Issue 2: Missing `crypto.subtle` implementation

**Problem:** Better-auth/better-call libraries require `crypto.subtle` for HMAC cookie signing. The isolate's crypto implementation only provided `crypto.randomUUID()` and `crypto.getRandomValues()`.

**Error:**
```
Error: crypto.subtle must be defined
    at getWebcryptoSubtle (@better-auth/utils)
    at getCryptoKey (better-call)
    at makeSignature (better-call)
    at signCookieValue (better-call)
```

**Temporary Fix:** Added `crypto.subtle` implementation to `isolate/packages/crypto/src/index.ts` with:
- `importKey()` - Import raw keys for HMAC operations (stores key material on host side with ID reference)
- `sign()` - HMAC-SHA256 signing
- `verify()` - HMAC-SHA256 verification
- `digest()` - SHA-256 and other hash functions

**Proper Fix Needed:** Implement a complete `crypto.subtle` API in the crypto package with proper CryptoKey handling.

---

## Issue 3: `Request.body` returns stream instead of `null` for bodyless requests

**Problem:** The `Request.body` getter always created a `ReadableStream`, even for GET/HEAD requests with no body. Per Web API spec, `request.body` should return `null` when there's no body.

**Impact:** Libraries like better-call check `if (request.body)` to determine if Content-Type validation is needed. A truthy stream caused 415 "Unsupported Media Type" errors for GET requests.

**Error:**
```json
{"code":"UNSUPPORTED_MEDIA_TYPE","message":"Content-Type is required. Allowed types: application/json"}
```

**Temporary Fix:** Modified `isolate/packages/fetch/src/index.ts` Request class `body` getter to check if there's any buffered body data and return `null` if empty:

```javascript
get body() {
  // ... existing cache checks ...

  // Check if there's any buffered body data
  const buffer = __Request_arrayBuffer(this.#instanceId);
  if (buffer.byteLength === 0) {
    // No body - return null per spec (GET/HEAD requests should have null body)
    return null;
  }

  // ... create stream from buffered body ...
}
```

**Proper Fix Needed:** Ensure `Request.body` follows Web API spec - returns `null` for requests without a body.

---

## Issue 4: Host should not pass body for GET/HEAD requests

**Problem:** When dispatching requests to the isolate, the host was passing `request.body` for all request methods, including GET/HEAD. Even though the body was empty/null, this could cause issues.

**Context:** In `server/local-serve/local-server.ts`, creating a new Request for dispatch:
```typescript
const mappedRequest = new Request(mappedUrl.toString(), {
  method: request.method,
  headers: request.headers,
  body: request.body,  // This passes body even for GET
});
```

**Temporary Fix:** Added check to only pass body for methods that can have one:
```typescript
const canHaveBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
const mappedRequest = new Request(mappedUrl.toString(), {
  method: request.method,
  headers: request.headers,
  body: canHaveBody ? request.body : undefined,
});
```

**Question:** Should this be handled in the isolate library's `dispatchRequest` method instead? The library could automatically strip/ignore body for GET/HEAD requests to be more Web API compliant.

**Proper Fix Needed:** Consider handling this in `FetchHandle.dispatchRequest()` in `isolate/packages/fetch/src/index.ts` to ensure Web API compliance without requiring consumers to handle it.

---

---

## Issue 5: `FileSystemWritableFileStream.getWriter()` not implemented

**Problem:** `FileSystemWritableFileStream` doesn't implement `getWriter()`. Per Web API spec, `FileSystemWritableFileStream` extends `WritableStream` and should inherit the `getWriter()` method.

**Error:**
```
TypeError: writable.getWriter is not a function
    at createResumableStream (./stream-store:8:27)
```

**Code causing issue:**
```javascript
const fileHandle = await streamsDir.getFileHandle(`${streamId}.ndjson`, { create: true });
const writable = await fileHandle.createWritable();
const writer = writable.getWriter();  // ERROR: getWriter is not a function
```

**Temporary Fix:** Add `getWriter()` method to `FileSystemWritableFileStream` class in `isolate/packages/fs/src/index.ts`:

```javascript
getWriter() {
  const stream = this;
  let released = false;

  return {
    get closed() {
      return new Promise((resolve) => {
        // Resolve when stream is closed
        if (stream.locked === false) resolve(undefined);
      });
    },

    get desiredSize() {
      return 1; // Always ready to write
    },

    get ready() {
      return Promise.resolve();
    },

    write(chunk) {
      if (released) throw new TypeError('Writer has been released');
      return stream.write(chunk);
    },

    close() {
      if (released) throw new TypeError('Writer has been released');
      return stream.close();
    },

    abort(reason) {
      if (released) throw new TypeError('Writer has been released');
      return stream.abort(reason);
    },

    releaseLock() {
      released = true;
    }
  };
}
```

**Proper Fix Needed:** Make `FileSystemWritableFileStream` properly extend `WritableStream` and inherit all its methods including `getWriter()`, `pipeTo()`, `pipeThrough()`, etc.

---

## Issue 6: TransformStream/WritableStream writer release in streaming responses

**Problem:** When using the AI SDK's streaming response methods (`toTextStreamResponse()`, `toUIMessageStreamResponse()`), the response fails with "Writer was released" error. These methods internally use TransformStream to pipe data from the AI provider's ReadableStream to the Response body.

**Error:**
```json
{"error":"Writer was released"}
```

**Source:** The error comes from `isolate/packages/core/src/index.ts:2544` in `WritableStreamDefaultWriter.releaseLock()`:
```javascript
releaseLock() {
  if (!this.#stream) return;
  this.#stream._setWriter(null);
  this.#stream = null;
  this.#closedReject?.(new TypeError('Writer was released'));
}
```

**Analysis:** The AI SDK's streaming methods create a TransformStream to transform the AI response stream into the appropriate format. The issue appears to be:
1. A TransformStream is created internally
2. A writer is obtained from the writable side
3. Data starts being written
4. Something causes `releaseLock()` to be called prematurely
5. The `closed` promise is rejected with "Writer was released"

**Affected Code:**
```javascript
// This works:
const result = streamText({ model, messages });
// ✅ streamText() itself succeeds

// This fails:
return result.toTextStreamResponse();
// ❌ "Writer was released" error
```

**Investigation Needed:**
1. Why is `releaseLock()` being called prematurely?
2. Is there an issue with how the isolate's TransformStream handles async operations?
3. Is the writer being released before all data is piped through?
4. Could there be a race condition in the stream pipeline?

**Workaround (Temporary):** Use non-streaming responses by collecting all text first:
```javascript
const result = await generateText({ model, messages });
return new Response(JSON.stringify({ text: result.text }));
```

**Proper Fix Needed:** Debug and fix the WritableStream/TransformStream implementation in `isolate/packages/core/src/index.ts` to properly handle streaming responses without premature writer release.

---

## Issue 7: System parameter serialization (Needs Investigation)

**Problem:** When calling the Claude API through the custom functions, the `system` parameter may not be serialized correctly, leading to validation errors from the API.

**Error:**
```json
{"error":"400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"system: Input should be a valid list\"},\"request_id\":\"...\"}"}`
```

**Context:** The AI SDK provider virtual module extracts the system message from the prompt:
```javascript
function extractSystem(prompt) {
  for (const msg of prompt) {
    if (msg.role === "system") {
      return msg.content;  // Should be a string
    }
  }
  return undefined;
}
```

**Potential Causes:**
1. System message content might not be a string in newer AI SDK versions
2. IPC serialization might be transforming the value unexpectedly
3. The Claude API might have changed to require array format for system

**Temporary Fix:** In `server/isolate/custom-functions.ts`, only include `system` parameter if it's truthy:
```typescript
...(genOptions.system ? { system: genOptions.system } : {}),
```

**Proper Fix Needed:**
1. Investigate what value is actually being passed as `system`
2. Ensure proper serialization through IPC
3. Verify compatibility with Claude API system parameter format

---

## Testing Notes

These issues were discovered while integrating with:
- `better-auth` - Authentication library
- `better-call` - HTTP framework used by better-auth
- `@noble/ciphers` - Cryptography (requires crypto.subtle for some operations)
- `ai` (Vercel AI SDK) - Streaming AI responses (requires TransformStream/WritableStream)

The test application is an AI chatbot template with:
- User authentication via username (no password, auto-create)
- Session management with signed cookies
- Chat functionality with streaming responses
