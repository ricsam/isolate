# @ricsam/isolate-daemon

Node.js daemon server that manages isolated-vm runtimes via Unix socket or TCP. Allows non-Node.js runtimes (Bun, Deno, etc.) to use isolated-vm through IPC.

## Installation

```bash
npm add @ricsam/isolate-daemon
```

## Features

- Unix domain socket and TCP transport
- Multiple concurrent connections
- Runtime lifecycle management (create, dispose)
- Bidirectional callback bridging (console, fetch, fs)
- Test environment support (enabled via `testEnvironment: true`)
- Playwright integration (client owns the browser, daemon invokes callbacks)
- Connection-scoped resource cleanup
- **Namespace-based runtime pooling** with LRU eviction for performance optimization

## Starting the Daemon

```typescript
import { startDaemon } from "@ricsam/isolate-daemon";

const daemon = await startDaemon({
  socketPath: "/tmp/isolate-daemon.sock", // Unix socket
  // Or TCP: host: "127.0.0.1", port: 47891
  maxIsolates: 100,
  defaultMemoryLimitMB: 128,
});

console.log(`Daemon listening on ${daemon.address}`);

// Get stats
const stats = daemon.getStats();
console.log(`Active isolates: ${stats.activeIsolates}`);

// Graceful shutdown
await daemon.close();
```

## CLI Usage

```bash
# Start daemon on default socket
npx isolate-daemon

# Custom socket path
npx isolate-daemon --socket /var/run/isolate.sock

# TCP mode
npx isolate-daemon --host 127.0.0.1 --port 47891
```

## Options

```typescript
interface DaemonOptions {
  socketPath?: string;      // Unix socket path
  host?: string;            // TCP host
  port?: number;            // TCP port
  maxIsolates?: number;     // Maximum concurrent isolates
  defaultMemoryLimitMB?: number; // Default memory limit in megabytes
}
```

## Statistics

```typescript
interface DaemonStats {
  activeIsolates: number;
  activeConnections: number;
  totalIsolatesCreated: number;
  totalRequestsProcessed: number;
}
```

## Runtime Pooling with Namespaces

The daemon supports **namespace-based runtime pooling** for improved performance. When a client creates a runtime with a namespace ID, the runtime is cached on dispose (soft-delete) rather than destroyed. Future requests with the same namespace ID reuse the cached runtime, preserving:

- V8 Isolate instance
- V8 Context
- Compiled ES module cache
- Global state and imported modules

### How It Works

1. Client creates a namespace: `client.createNamespace("tenant-123")`
2. Client creates a runtime in that namespace: `namespace.createRuntime(options)`
3. On dispose, runtime is soft-deleted (cached in pool)
4. Any client can later request the same namespace and reuse the cached runtime
5. When `maxIsolates` limit is reached, oldest disposed runtimes are evicted (LRU)

### Pooling Behavior

- **Non-namespaced runtimes** (`client.createRuntime()`) work as before - true disposal on dispose
- **Namespaced runtimes** are cached and reusable across connections
- **LRU eviction** removes oldest disposed runtimes when at capacity
- **Connection close** soft-deletes namespaced runtimes (keeps them in pool)

The `maxIsolates` limit includes both active and pooled (disposed) runtimes. This ensures predictable memory usage while allowing runtime reuse.

## License

MIT
