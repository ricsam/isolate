# 07-fetch.md - @ricsam/isolate-fetch Implementation Plan

## Overview

The fetch package provides the Fetch API for the isolate, including Request, Response, Headers, FormData, and AbortController.

This is the most complex package as it needs to bridge async fetch operations between host and isolate.

## Implementation Steps

### 1. Headers Class
- [ ] Implement Headers constructor (init from object, array, or Headers)
- [ ] append(name, value)
- [ ] delete(name)
- [ ] get(name) - case-insensitive
- [ ] getSetCookie() - returns array
- [ ] has(name)
- [ ] set(name, value)
- [ ] entries(), keys(), values()
- [ ] forEach(callback)
- [ ] Symbol.iterator support

### 2. Request Class
- [ ] Constructor with URL and RequestInit
- [ ] Properties: method, url, headers, body, mode, credentials, cache, redirect, referrer, integrity
- [ ] body methods: text(), json(), arrayBuffer(), formData(), blob()
- [ ] clone() method

### 3. Response Class
- [ ] Constructor with body and ResponseInit
- [ ] Properties: ok, status, statusText, headers, url, type, redirected
- [ ] body methods: text(), json(), arrayBuffer(), formData(), blob()
- [ ] clone() method
- [ ] Static: Response.json(), Response.redirect(), Response.error()

### 4. FormData Class
- [ ] Constructor
- [ ] append(name, value, filename?)
- [ ] delete(name)
- [ ] get(name), getAll(name)
- [ ] has(name)
- [ ] set(name, value, filename?)
- [ ] entries(), keys(), values()
- [ ] Handle File objects

### 5. AbortController & AbortSignal
- [ ] AbortController with signal property
- [ ] AbortController.abort(reason?)
- [ ] AbortSignal.aborted, AbortSignal.reason
- [ ] AbortSignal.throwIfAborted()
- [ ] AbortSignal event handlers

### 6. fetch Function
- [ ] Implement fetch(input, init?)
- [ ] Route requests to host via onFetch callback
- [ ] Marshal Request to host
- [ ] Execute host fetch
- [ ] Unmarshal Response back to isolate
- [ ] Handle abort signals
- [ ] Handle streaming responses

## Implementation Notes

The key challenge is that fetch is async and crosses the isolate boundary. Options:
1. Use `context.evalClosure()` with async callbacks
2. Use `ivm.Callback` with `{ async: true }`
3. Create pending promise in isolate, resolve from host

For streaming responses, need to bridge ReadableStream between host and isolate.

## Test Coverage

- `index.test.ts` - Main API tests
- Additional tests for Headers, Request, Response, FormData, AbortController
- Integration tests with real HTTP server

## Dependencies

- `@ricsam/isolate-core`
- `isolated-vm`
