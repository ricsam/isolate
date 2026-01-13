#!/usr/bin/env bun
/**
 * Runs e2e tests with server logs visible.
 *
 * Usage:
 *   bun scripts/e2e-with-logs.ts           # Run all tests with logs
 *   bun scripts/e2e-with-logs.ts --headed  # Run in headed mode
 *   bun scripts/e2e-with-logs.ts api       # Run specific test file
 */

import { $ } from "bun";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";

// Use demo directory as base (parent of scripts/)
const demoDir = join(import.meta.dir, "..");
const logDir = join(demoDir, ".e2e-logs");
const logFile = join(logDir, "server.log");

// Ensure log directory exists
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

console.log("Starting server with logs...");
console.log(`Server logs: ${logFile}`);
console.log("---");

// Start server with output piped to both console and log file
// Use dev:e2e (no hot reload) to avoid restart issues when killed
const serverProc = Bun.spawn(["bun", "run", "dev:e2e"], {
  cwd: demoDir,
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env },
});

// Pipe output to console and file
const logStream = createWriteStream(logFile);

async function pipeStream(
  source: ReadableStream<Uint8Array>,
  dest: typeof process.stdout
) {
  const reader = source.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      dest.write(value);
      logStream.write(value);
    }
  } catch {
    // Stream closed
  }
}

pipeStream(serverProc.stdout, process.stdout);
pipeStream(serverProc.stderr, process.stderr);

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
  await Bun.sleep(500);
}

if (!serverReady) {
  console.error("Server failed to start within 30 seconds");
  serverProc.kill();
  logStream.end();
  process.exit(1);
}

console.log("\n--- Server ready, running Playwright tests ---\n");

// Pass through any additional arguments to playwright
const playwrightArgs = process.argv.slice(2);

try {
  // Run playwright tests from demo directory
  // PLAYWRIGHT_HTML_OPEN=never prevents the HTML report from auto-opening in browser
  $.cwd(demoDir);
  $.env({ ...process.env, PLAYWRIGHT_HTML_OPEN: "never" });
  const result = await $`bunx playwright test ${playwrightArgs}`.nothrow();

  console.log("\n--- Tests complete ---");
  console.log(`Server logs saved to: ${logFile}`);

  // Cleanup
  serverProc.kill();
  logStream.end();

  process.exit(result.exitCode);
} catch (error) {
  serverProc.kill();
  logStream.end();
  throw error;
}
