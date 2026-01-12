# 07-fetch.md - @ricsam/isolate-fetch Implementation Plan

## Overview

The fetch package provides the Fetch API for the isolate, including Request, Response, Headers, FormData, and AbortController.

This is the most complex package as it needs to bridge async fetch operations between host and isolate.

## Implementation Steps

### 1. Headers Class
- [x] Implement Headers constructor (init from object, array, or Headers)
- [x] append(name, value)
- [x] delete(name)
- [x] get(name) - case-insensitive
- [x] getSetCookie() - returns array
- [x] has(name)
- [x] set(name, value)
- [x] entries(), keys(), values()
- [x] forEach(callback)
- [x] Symbol.iterator support

### 2. Request Class
- [x] Constructor with URL and RequestInit
- [x] Properties: method, url, headers, body, mode, credentials, cache, redirect, referrer, integrity
- [x] body methods: text(), json(), arrayBuffer(), formData(), blob()
- [x] clone() method

### 3. Response Class
- [x] Constructor with body and ResponseInit
- [x] Properties: ok, status, statusText, headers, url, type, redirected
- [x] body methods: text(), json(), arrayBuffer(), formData(), blob()
- [x] clone() method
- [x] Static: Response.json(), Response.redirect(), Response.error()

### 4. FormData Class
- [x] Constructor
- [x] append(name, value, filename?)
- [x] delete(name)
- [x] get(name), getAll(name)
- [x] has(name)
- [x] set(name, value, filename?)
- [x] entries(), keys(), values()
- [x] Handle File objects

### 5. AbortController & AbortSignal
- [x] AbortController with signal property (provided by @ricsam/isolate-core)
- [x] AbortController.abort(reason?)
- [x] AbortSignal.aborted, AbortSignal.reason
- [x] AbortSignal.throwIfAborted()
- [x] AbortSignal event handlers

### 6. fetch Function
- [x] Implement fetch(input, init?)
- [x] Route requests to host via onFetch callback
- [x] Marshal Request to host
- [x] Execute host fetch
- [x] Unmarshal Response back to isolate
- [x] Handle abort signals
- [ ] Handle streaming responses (bodies are buffered, not streamed)

## Implementation Notes

The implementation uses `ivm.Reference` with `applySyncPromise` to bridge async fetch operations.

**Key design decisions:**
- Bodies are stored as `Uint8Array` on the host side
- Headers and body are JSON-serialized when passed to the host
- Response state is stored on host, only instance ID is passed back
- AbortController/AbortSignal is provided by @ricsam/isolate-core

## Test Coverage

- `index.test.ts` - 29 tests, all passing

### Test Results

- **Headers** (5 tests): ✅ All passing
- **Request** (7 tests): ✅ All passing
- **Response** (8 tests): ✅ All passing
- **FormData** (3 tests): ✅ All passing
- **AbortController** (3 tests): ✅ All passing
- **fetch function** (3 tests): ✅ All passing

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
