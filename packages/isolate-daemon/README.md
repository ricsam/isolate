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

## Starting the Daemon

```typescript
import { startDaemon } from "@ricsam/isolate-daemon";

const daemon = await startDaemon({
  socketPath: "/tmp/isolate-daemon.sock", // Unix socket
  // Or TCP: host: "127.0.0.1", port: 47891
  maxIsolates: 100,
  defaultMemoryLimit: 128,
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
  defaultMemoryLimit?: number; // Default memory limit (MB)
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

## License

MIT
