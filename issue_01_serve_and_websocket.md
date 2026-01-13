# Issue: Implement serve() and WebSocket support in @ricsam/isolate-fetch

## Summary

The `@ricsam/isolate-fetch` package needs a `serve()` function and WebSocket support to allow isolate code to register HTTP request handlers and handle WebSocket connections. The type definitions already exist in `packages/test-utils/src/isolate-types.ts` (see `FETCH_TYPES`), but the implementation is missing.

## Current State

The `@ricsam/isolate-fetch` package currently implements:
- `Headers` class
- `FormData` class
- `Request` class (with host state management)
- `Response` class (with host state management)
- `fetch()` function

## Missing Functionality

### 1. `serve()` function

The isolate code calls `serve()` to register HTTP and WebSocket handlers:

```typescript
serve({
  async fetch(request, server) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      server.upgrade(request, { data: { connectedAt: Date.now() } });
      return new Response(null, { status: 101 });
    }

    // HTTP routes
    if (url.pathname === "/api/hello") {
      return Response.json({ message: "Hello!" });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      ws.send("Welcome!");
    },
    message(ws, message) {
      ws.send("Echo: " + message);
    },
    close(ws, code, reason) {
      console.log("Closed:", code);
    }
  }
});
```

### 2. FetchHandle interface additions

The `FetchHandle` returned by `setupFetch()` needs methods to:

```typescript
interface FetchHandle {
  dispose(): void;

  // NEW: Dispatch an incoming HTTP request to the isolate's serve() handler
  dispatchRequest(request: Request): Promise<Response>;

  // NEW: Check if isolate requested WebSocket upgrade
  getUpgradeRequest(): { requested: boolean; connectionId: string; data: unknown } | null;

  // NEW: Handle outgoing WebSocket commands from isolate
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): void;

  // NEW: Dispatch WebSocket events to isolate
  dispatchWebSocketOpen(connectionId: string): void;
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): void;
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): void;
}

interface WebSocketCommand {
  connectionId: string;
  type: "message" | "close";
  data?: string | ArrayBuffer;
  code?: number;
  reason?: string;
}
```

### 3. Server interface in isolate

When `serve()` is called, the `fetch` handler receives a `server` parameter:

```typescript
interface Server<T> {
  upgrade(request: Request, options?: { data?: T }): boolean;
}
```

The `upgrade()` method:
1. Generates a unique `connectionId`
2. Stores the `data` in an internal registry keyed by `connectionId`
3. Signals to the host that an upgrade was requested
4. Returns `true` (the actual upgrade happens on the host side)

### 4. ServerWebSocket interface in isolate

WebSocket handlers receive a `ServerWebSocket` object:

```typescript
interface ServerWebSocket<T> {
  readonly data: T;
  readonly readyState: number;
  send(message: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}
```

Methods like `send()` and `close()` should emit commands to the host via the `onWebSocketCommand` callback.

## Implementation Approach

### Host Side (in setupFetch)

1. Add state for the registered `serve()` handlers
2. Add `dispatchRequest()` to call the isolate's fetch handler
3. Add WebSocket connection registry (connectionId -> data)
4. Add `onWebSocketCommand` callback registration
5. Add `dispatchWebSocket*` methods to call isolate's websocket handlers

### Isolate Side (injected JS code)

1. Add `serve()` global function that stores handlers
2. Add `Server` class with `upgrade()` method
3. Add `ServerWebSocket` class that proxies to host via callbacks
4. Internal registry mapping connectionId to ServerWebSocket instances

## Type Definitions

The type definitions already exist in `packages/test-utils/src/isolate-types.ts`:
- `FETCH_TYPES` contains `Server`, `ServerWebSocket`, `ServeOptions`, and `serve()` declarations

## Files to Modify

- `packages/fetch/src/index.ts` - Add serve() implementation

## Testing

- Create tests in `packages/fetch/tests/` for serve() functionality
- Ensure demo's e2e tests pass (`demo/e2e/*.e2e.ts`)

## Related

The demo (`demo/src/richie-rpc-handlers.ts`) depends on this functionality to:
- Handle HTTP routes via `serve({ fetch })`
- Handle WebSocket connections for chat/RPC
- Stream responses using ReadableStream
