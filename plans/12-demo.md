# 12-demo.md - @ricsam/isolate-demo Implementation Plan

## Overview

The demo package provides an example HTTP server that runs request handlers in isolated-vm sandboxes.

## Implementation Steps

### 1. HTTP Server
- [ ] Create basic HTTP server with Node.js http module
- [ ] Parse incoming requests
- [ ] Route to isolated handler

### 2. Sandbox Integration
- [ ] Create runtime for each request (or pool)
- [ ] Convert Node.js Request to Web Request
- [ ] Execute handler in sandbox
- [ ] Convert Web Response to Node.js response

### 3. Handler Examples
- [ ] Hello world handler
- [ ] JSON API handler
- [ ] FormData handling
- [ ] File upload handling
- [ ] Streaming response

### 4. E2E Tests
- [ ] Playwright tests for HTTP endpoints
- [ ] Test async operations
- [ ] Test error handling
- [ ] Test FormData and file uploads

## Example Handler

```typescript
// Runs inside the sandbox
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/hello") {
    return Response.json({ message: "Hello from sandbox!" });
  }

  if (url.pathname === "/api/echo" && request.method === "POST") {
    const data = await request.json();
    return Response.json(data);
  }

  return new Response("Not Found", { status: 404 });
}
```

## Test Coverage

- `tests/async-handler.test.ts` - Handler tests

## Dependencies

- `@ricsam/isolate-runtime`
- `@playwright/test` (dev)
- `isolated-vm`
