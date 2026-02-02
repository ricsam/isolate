#!/usr/bin/env node

// Suppress the ExperimentalWarning for stripTypeScriptTypes
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("stripTypeScriptTypes")
  ) {
    return; // Suppress this specific warning
  }
  console.warn(warning);
});

/**
 * CLI entry point for the isolate daemon.
 *
 * Usage:
 *   isolate-daemon [options]
 *
 * Options:
 *   --socket <path>   Unix socket path (default: /tmp/isolate-daemon.sock)
 *   --host <host>     TCP host (default: 127.0.0.1)
 *   --port <port>     TCP port (default: 47891)
 *   --max-isolates <n>  Maximum isolates (default: 100)
 *   --memory-limit <mb> Default memory limit (default: 128)
 */

import { startDaemon, type DaemonOptions } from "./index.ts";

function parseArgs(args: string[]): Partial<DaemonOptions> {
  const options: Partial<DaemonOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--socket":
        i++;
        if (args[i]) {
          options.socketPath = args[i];
        }
        break;
      case "--host":
        i++;
        if (args[i]) {
          options.host = args[i];
          options.socketPath = undefined; // Use TCP instead
        }
        break;
      case "--port": {
        i++;
        const value = args[i];
        if (value !== undefined) {
          options.port = parseInt(value, 10);
          options.socketPath = undefined; // Use TCP instead
        }
        break;
      }
      case "--max-isolates": {
        i++;
        const value = args[i];
        if (value !== undefined) {
          options.maxIsolates = parseInt(value, 10);
        }
        break;
      }
      case "--memory-limit": {
        i++;
        const value = args[i];
        if (value !== undefined) {
          options.defaultMemoryLimitMB = parseInt(value, 10);
        }
        break;
      }
      case "--help":
      case "-h":
        console.log(`
Isolate Daemon - Run isolated-vm runtimes accessible via IPC

Usage:
  isolate-daemon [options]

Options:
  --socket <path>       Unix socket path (default: /tmp/isolate-daemon.sock)
  --host <host>         TCP host (default: 127.0.0.1, disables Unix socket)
  --port <port>         TCP port (default: 47891, disables Unix socket)
  --max-isolates <n>    Maximum isolates (default: 100)
  --memory-limit <mb>   Default memory limit in MB (default: 128)
  --help, -h            Show this help message
`);
        process.exit(0);
      default:
        if (arg !== undefined && arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const daemon = await startDaemon(options);

  // Handle shutdown signals
  const shutdown = async () => {
    console.log("\nShutting down...");
    await daemon.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Log stats periodically
  setInterval(() => {
    const stats = daemon.getStats();
    console.log(
      `[stats] connections: ${stats.activeConnections}, isolates: ${stats.activeIsolates}, total requests: ${stats.totalRequestsProcessed}`
    );
  }, 60000);
}

main().catch((err) => {
  console.error("Failed to start daemon:", err);
  process.exit(1);
});
