#!/usr/bin/env node

process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "ExperimentalWarning" &&
    warning.message.includes("stripTypeScriptTypes")
  ) {
    return;
  }
  console.warn(warning);
});

import { startDaemon, type DaemonOptions } from "./internal/daemon/index.ts";

function parseArgs(args: string[]): Partial<DaemonOptions> {
  const options: Partial<DaemonOptions> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--socket":
        index += 1;
        if (args[index]) {
          options.socketPath = args[index];
        }
        break;
      case "--host":
        index += 1;
        if (args[index]) {
          options.host = args[index];
          options.socketPath = undefined;
        }
        break;
      case "--port":
        index += 1;
        if (args[index]) {
          options.port = Number.parseInt(args[index]!, 10);
          options.socketPath = undefined;
        }
        break;
      case "--max-isolates":
        index += 1;
        if (args[index]) {
          options.maxIsolates = Number.parseInt(args[index]!, 10);
        }
        break;
      case "--memory-limit":
        index += 1;
        if (args[index]) {
          options.defaultMemoryLimitMB = Number.parseInt(args[index]!, 10);
        }
        break;
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
        if (arg?.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return options;
}

async function main() {
  const daemon = await startDaemon(parseArgs(process.argv.slice(2)));
  const shutdown = async () => {
    console.log("\nShutting down...");
    await daemon.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start daemon:", error);
  process.exit(1);
});
