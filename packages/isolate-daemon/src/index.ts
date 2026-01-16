/**
 * @ricsam/isolate-daemon
 *
 * Node.js daemon for running isolated-vm runtimes accessible via IPC.
 */

import { createServer, type Server } from "node:net";
import { unlink } from "node:fs/promises";
import { handleConnection } from "./connection.ts";
import type {
  DaemonOptions,
  DaemonHandle,
  DaemonState,
  DaemonStats,
} from "./types.ts";

export type { DaemonOptions, DaemonHandle, DaemonStats };

const DEFAULT_OPTIONS: Required<DaemonOptions> = {
  socketPath: "/tmp/isolate-daemon.sock",
  host: "127.0.0.1",
  port: 47891,
  maxIsolates: 100,
  defaultMemoryLimitMB: 128,
};

/**
 * Start the isolate daemon.
 *
 * @param options - Daemon configuration options
 * @returns Handle to control the daemon
 */
export async function startDaemon(
  options: DaemonOptions = {}
): Promise<DaemonHandle> {
  const resolvedOptions: Required<DaemonOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const state: DaemonState = {
    isolates: new Map(),
    connections: new Map(),
    stats: {
      activeIsolates: 0,
      activeConnections: 0,
      totalIsolatesCreated: 0,
      totalRequestsProcessed: 0,
    },
    options: resolvedOptions,
  };

  const server = createServer((socket) => {
    handleConnection(socket, state);
    updateStats(state);
  });

  // Try to remove existing socket file
  if (resolvedOptions.socketPath) {
    try {
      await unlink(resolvedOptions.socketPath);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);

    if (resolvedOptions.socketPath) {
      server.listen(resolvedOptions.socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    } else {
      server.listen(resolvedOptions.port, resolvedOptions.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    }
  });

  const address = resolvedOptions.socketPath
    ? resolvedOptions.socketPath
    : `${resolvedOptions.host}:${resolvedOptions.port}`;

  console.log(`Isolate daemon listening on ${address}`);

  return {
    address,
    getStats: () => ({
      ...state.stats,
      activeIsolates: state.isolates.size,
      activeConnections: state.connections.size,
    }),
    close: async () => {
      // Close all connections
      for (const [socket] of state.connections) {
        socket.destroy();
      }

      // Dispose all isolates
      for (const [, instance] of state.isolates) {
        try {
          instance.runtime.dispose();
        } catch {
          // Ignore
        }
      }

      state.isolates.clear();
      state.connections.clear();

      // Close server
      await closeServer(server);

      // Remove socket file
      if (resolvedOptions.socketPath) {
        try {
          await unlink(resolvedOptions.socketPath);
        } catch {
          // Ignore
        }
      }

      console.log("Isolate daemon stopped");
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function updateStats(state: DaemonState): void {
  state.stats.activeIsolates = state.isolates.size;
  state.stats.activeConnections = state.connections.size;
}
