#!/usr/bin/env npx tsx
/**
 * Runs e2e tests with server logs visible.
 *
 * Usage:
 *   npx tsx scripts/e2e-with-logs.ts           # Run all tests with logs
 *   npx tsx scripts/e2e-with-logs.ts --headed  # Run in headed mode
 *   npx tsx scripts/e2e-with-logs.ts api       # Run specific test file
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use demo directory as base (parent of scripts/)
const demoDir = join(__dirname, "..");
const logDir = join(demoDir, ".e2e-logs");
const logFile = join(logDir, "server.log");

// Ensure log directory exists
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// Create log stream early so we can write everything to it
const logStream = createWriteStream(logFile);

// Helper to write to both console and log file
function log(message: string) {
  console.log(message);
  logStream.write(message + "\n");
}

function logError(message: string) {
  console.error(message);
  logStream.write(message + "\n");
}

log("Starting server with logs...");
log(`Server logs: ${logFile}`);
log("---");

// Start server with output piped to both console and log file
// Use dev:e2e (no hot reload) to avoid restart issues when killed
const serverProc = spawn("npm", ["run", "dev"], {
  cwd: demoDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

serverProc.stdout?.on("data", (data: Buffer) => {
  process.stdout.write(data);
  logStream.write(data);
});

serverProc.stderr?.on("data", (data: Buffer) => {
  process.stderr.write(data);
  logStream.write(data);
});

// Wait for server to be ready
const maxWait = 30000;
const startTime = Date.now();
let serverReady = false;

while (Date.now() - startTime < maxWait) {
  try {
    const res = await fetch("http://localhost:6421", {
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) {
      serverReady = true;
      break;
    }
  } catch {
    // Server not ready yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (!serverReady) {
  logError("Server failed to start within 30 seconds");
  serverProc.kill();
  logStream.end();
  process.exit(1);
}

log("\n--- Server ready, running Playwright tests ---\n");

// Pass through any additional arguments to playwright
const playwrightArgs = process.argv.slice(2);

// Run playwright tests from demo directory
// PLAYWRIGHT_HTML_OPEN=never prevents the HTML report from auto-opening in browser
const playwrightProc = spawn("npx", ["playwright", "test", ...playwrightArgs], {
  cwd: demoDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PLAYWRIGHT_HTML_OPEN: "never" },
});

playwrightProc.stdout?.on("data", (data: Buffer) => {
  process.stdout.write(data);
  logStream.write(data);
});

playwrightProc.stderr?.on("data", (data: Buffer) => {
  process.stderr.write(data);
  logStream.write(data);
});

playwrightProc.on("close", (code) => {
  log("\n--- Tests complete ---");
  log(`Server logs saved to: ${logFile}`);

  // Cleanup
  serverProc.kill();
  logStream.end();

  process.exit(code ?? 1);
});

playwrightProc.on("error", (error) => {
  logError("Failed to run playwright: " + error);
  serverProc.kill();
  logStream.end();
  process.exit(1);
});
