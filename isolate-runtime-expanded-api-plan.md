# Expanded Runtime API Plan

## Summary

Expand the `RemoteRuntime` (isolate-client) and `RuntimeHandle` (isolate-runtime) interfaces to expose module-specific handles instead of flattening methods. Only expose handles that have useful public methods: `fetch`, `timers`, and `console`. Other modules (fs, crypto, encoding, path) only have internal `dispose()` methods with no public utility.

## Current vs Proposed API

### Current (Flat API)
```typescript
const runtime = await createRuntime({ ... });
await runtime.dispatchRequest(request);    // from FetchHandle
await runtime.tick(100);                    // from TimersHandle
await runtime.dispose();
```

### Proposed (Handle-based API)
```typescript
const runtime = await createRuntime({ ... });

// FetchHandle methods
await runtime.fetch.dispatchRequest(request);
runtime.fetch.dispatchWebSocketOpen(connectionId);
runtime.fetch.dispatchWebSocketMessage(connectionId, data);
runtime.fetch.dispatchWebSocketClose(connectionId, code, reason);
runtime.fetch.onWebSocketCommand(callback);
runtime.fetch.hasServeHandler();
runtime.fetch.hasActiveConnections();
runtime.fetch.getUpgradeRequest();

// TimersHandle methods
await runtime.timers.tick(100);
runtime.timers.clearAll();

// ConsoleHandle methods
runtime.console.reset();
runtime.console.getTimers();
runtime.console.getCounters();
runtime.console.getGroupDepth();

// Core methods remain at top level
await runtime.eval(code);
await runtime.dispose();
```

## Handles to Expose

Only three handles have methods worth exposing publicly. Other handles (fs, crypto, encoding, path) only have internal `dispose()` methods which are called automatically by `runtime.dispose()`.

### 1. FetchHandle (runtime.fetch)
```typescript
interface RuntimeFetchHandle {
  dispatchRequest(request: Request, options?: DispatchRequestOptions): Promise<Response>;
  getUpgradeRequest(): UpgradeRequest | null;
  dispatchWebSocketOpen(connectionId: string): void;
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): void;
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): void;
  dispatchWebSocketError(connectionId: string, error: Error): void;
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
  hasServeHandler(): boolean;
  hasActiveConnections(): boolean;
}
```

### 2. TimersHandle (runtime.timers)
```typescript
interface RuntimeTimersHandle {
  tick(ms?: number): Promise<void>;
  clearAll(): void;
}
```

### 3. ConsoleHandle (runtime.console)
```typescript
interface RuntimeConsoleHandle {
  reset(): void;
  getTimers(): Map<string, number>;
  getCounters(): Map<string, number>;
  getGroupDepth(): number;
}
```

## New Runtime Interface

### Local Runtime (isolate-runtime)

```typescript
export interface RuntimeHandle {
  readonly id: string;

  // Core methods (unchanged)
  eval(code: string, filename?: string): Promise<void>;
  dispose(): Promise<void>;

  // Module handles (only those with useful public methods)
  readonly fetch: RuntimeFetchHandle;
  readonly timers: RuntimeTimersHandle;
  readonly console: RuntimeConsoleHandle;

  // Convenience methods (kept for backwards compatibility, delegate to handles)
  /** @deprecated Use runtime.fetch.dispatchRequest() instead */
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  /** @deprecated Use runtime.timers.tick() instead */
  tick(ms?: number): Promise<void>;
}
```

### Remote Runtime (isolate-client)

```typescript
export interface RemoteRuntime {
  readonly id: string;
  readonly isolateId: string; // @deprecated

  // Core methods
  eval(code: string, filename?: string): Promise<void>;
  dispose(): Promise<void>;

  // Module handles (only those with useful public methods)
  readonly fetch: RemoteFetchHandle;
  readonly timers: RemoteTimersHandle;
  readonly console: RemoteConsoleHandle;

  // Test environment
  setupTestEnvironment(): Promise<void>;
  runTests(timeout?: number): Promise<TestResults>;

  // Playwright
  setupPlaywright(options?: PlaywrightSetupOptions): Promise<void>;
  runPlaywrightTests(timeout?: number): Promise<PlaywrightTestResults>;
  resetPlaywrightTests(): Promise<void>;
  getCollectedData(): Promise<CollectedData>;

  // Convenience methods (kept for backwards compatibility)
  /** @deprecated Use runtime.fetch.dispatchRequest() instead */
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  /** @deprecated Use runtime.timers.tick() instead */
  tick(ms?: number): Promise<void>;
}
```

## Remote Handle Interfaces

For the client, we need remote proxies that send messages to the daemon:

```typescript
// Remote FetchHandle - proxies to daemon
interface RemoteFetchHandle {
  dispatchRequest(request: Request, options?: DispatchRequestOptions): Promise<Response>;
  getUpgradeRequest(): Promise<UpgradeRequest | null>;  // async for remote
  dispatchWebSocketOpen(connectionId: string): Promise<void>;
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): Promise<void>;
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): Promise<void>;
  dispatchWebSocketError(connectionId: string, error: Error): Promise<void>;
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
  hasServeHandler(): Promise<boolean>;  // async for remote
  hasActiveConnections(): Promise<boolean>;  // async for remote
}

// Remote TimersHandle
interface RemoteTimersHandle {
  tick(ms?: number): Promise<void>;
  clearAll(): Promise<void>;  // async for remote
}

// Remote ConsoleHandle
interface RemoteConsoleHandle {
  reset(): Promise<void>;  // async for remote
  getTimers(): Promise<Map<string, number>>;  // async for remote
  getCounters(): Promise<Map<string, number>>;  // async for remote
  getGroupDepth(): Promise<number>;  // async for remote
}
```

## Protocol Messages

New message types needed for handle operations:

```typescript
// Add to isolate-protocol/src/types.ts

// FetchHandle operations
interface GetUpgradeRequestMessage {
  type: "fetch:getUpgradeRequest";
  isolateId: string;
}

interface WebSocketOpenMessage {
  type: "fetch:wsOpen";
  isolateId: string;
  connectionId: string;
}

interface WebSocketMessageMessage {
  type: "fetch:wsMessage";
  isolateId: string;
  connectionId: string;
  data: string | ArrayBuffer;
}

interface WebSocketCloseMessage {
  type: "fetch:wsClose";
  isolateId: string;
  connectionId: string;
  code: number;
  reason: string;
}

interface HasServeHandlerMessage {
  type: "fetch:hasServeHandler";
  isolateId: string;
}

interface HasActiveConnectionsMessage {
  type: "fetch:hasActiveConnections";
  isolateId: string;
}

// TimersHandle operations
interface ClearAllTimersMessage {
  type: "timers:clearAll";
  isolateId: string;
}

// ConsoleHandle operations
interface ConsoleResetMessage {
  type: "console:reset";
  isolateId: string;
}

interface GetTimersMessage {
  type: "console:getTimers";
  isolateId: string;
}

interface GetCountersMessage {
  type: "console:getCounters";
  isolateId: string;
}

interface GetGroupDepthMessage {
  type: "console:getGroupDepth";
  isolateId: string;
}
```

## Files to Modify

### 1. `/packages/isolate-protocol/src/types.ts`
- Add new message types for handle operations (fetch, timers, console only)
- Export `RuntimeFetchHandle`, `RuntimeTimersHandle`, `RuntimeConsoleHandle` types

### 2. `/packages/runtime/src/index.ts`
- Modify `RuntimeHandle` interface to include `fetch`, `timers`, `console` handles
- Modify `createRuntime()` to expose handles (wrapping internal handles)
- Keep deprecated convenience methods for backwards compatibility

### 3. `/packages/isolate-client/src/types.ts`
- Add `RemoteFetchHandle`, `RemoteTimersHandle`, `RemoteConsoleHandle` interfaces
- Modify `RemoteRuntime` to include `fetch`, `timers`, `console` handles
- Keep deprecated convenience methods

### 4. `/packages/isolate-client/src/connection.ts`
- Implement remote handle proxies
- Create handle instances in `createRuntime()`
- Add message handlers for new protocol messages

### 5. `/packages/isolate-daemon/src/connection.ts`
- Add handlers for new message types:
  - `fetch:getUpgradeRequest`, `fetch:wsOpen`, `fetch:wsMessage`, `fetch:wsClose`
  - `fetch:hasServeHandler`, `fetch:hasActiveConnections`
  - `timers:clearAll`
  - `console:reset`, `console:getTimers`, `console:getCounters`, `console:getGroupDepth`

## Implementation Order

1. **Protocol types** - Add new message types to `isolate-protocol`
2. **Local runtime** - Update `isolate-runtime` to expose handles
3. **Daemon handlers** - Add message handlers in `isolate-daemon`
4. **Client handles** - Implement remote handle proxies in `isolate-client`
5. **Tests** - Update integration tests to use new API
6. **Documentation** - Update README files

## Breaking Changes

None - all existing methods are kept as deprecated aliases. The new API is additive.

## Example Usage

### Local Runtime
```typescript
import { createRuntime } from "@ricsam/isolate-runtime";

const runtime = await createRuntime({
  console: { log: console.log },
  fetch: (req) => fetch(req),
});

// Set up WebSocket handler
await runtime.eval(`
  serve({
    fetch(request) {
      const upgrade = request.headers.get("upgrade");
      if (upgrade === "websocket") {
        return server.upgrade(request);
      }
      return Response.json({ hello: "world" });
    }
  });
`);

// Use handle API
const response = await runtime.fetch.dispatchRequest(new Request("http://localhost/"));
console.log(await response.json());

// WebSocket operations
runtime.fetch.onWebSocketCommand((cmd) => {
  if (cmd.type === "message") {
    console.log("WS message:", cmd.data);
  }
});

const upgrade = runtime.fetch.getUpgradeRequest();
if (upgrade) {
  runtime.fetch.dispatchWebSocketOpen(upgrade.connectionId);
  runtime.fetch.dispatchWebSocketMessage(upgrade.connectionId, "Hello!");
  runtime.fetch.dispatchWebSocketClose(upgrade.connectionId, 1000, "Done");
}

// Timer operations
await runtime.timers.tick(1000);
runtime.timers.clearAll();

// Console operations
const counters = runtime.console.getCounters();
const timers = runtime.console.getTimers();
runtime.console.reset();

await runtime.dispose();
```

### Remote Runtime
```typescript
import { connect } from "@ricsam/isolate-client";

const client = await connect({ socket: "/tmp/isolate.sock" });
const runtime = await client.createRuntime({ ... });

// Same API as local, but methods are async
const response = await runtime.fetch.dispatchRequest(new Request("http://localhost/"));
const hasHandler = await runtime.fetch.hasServeHandler();

await runtime.timers.tick(100);
await runtime.timers.clearAll();

const counters = await runtime.console.getCounters();
await runtime.console.reset();

await runtime.dispose();
await client.close();
```

## Notes

- All remote handle methods return Promises since they require IPC
- Local handles can use sync methods where the underlying implementation is sync
- WebSocket command callbacks work via existing event streaming in the protocol
- Individual handle `dispose()` methods are not exposed - cleanup is handled by `runtime.dispose()` which calls all internal dispose methods automatically
