/**
 * Test that @ricsam/isolate-client can be imported from Bun
 * without loading isolated-vm (which doesn't work in Bun).
 *
 * This test verifies Issue 1 fix: splitting playwright package exports
 * so that the client can import from @ricsam/isolate-playwright/client
 * instead of the main entry which imports isolated-vm.
 */

import { spawn, type Subprocess } from "bun";
import { connect } from "@ricsam/isolate-client";
import { simpleConsoleHandler } from "@ricsam/isolate-console/utils";

console.log("✅ Successfully imported @ricsam/isolate-client from Bun!");
console.log("   connect function:", typeof connect);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry connection with exponential backoff
const connectWithRetry = async (port: number, maxRetries = 10): Promise<Awaited<ReturnType<typeof connect>>> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await connect({ port });
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.min(100 * Math.pow(2, i), 2000);
      await sleep(delay);
    }
  }
  throw new Error("Failed to connect after retries");
};

// Start daemon as child process and test connection
const testWithDaemon = async () => {
  let daemon: Subprocess | null = null;

  try {
    console.log("\n🚀 Starting daemon on port 3100...");
    daemon = spawn({
      cmd: ["node", "../packages/isolate-daemon/bin/daemon.js", "--port", "3100"],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    console.log("📡 Connecting to daemon at localhost:3100...");
    const connection = await connectWithRetry(3100);

    console.log("✅ Connected to daemon!");

    const runtime = await connection.createRuntime();
    console.log("✅ Created runtime!");

    // Set up the fetch handler using eval
    await runtime.eval(`
      serve({
        fetch: () => new Response("Hello from isolate!")
      });
    `);
    console.log("✅ Registered serve handler!");

    // Test dispatching a request
    const response = await runtime.fetch.dispatchRequest(new Request("http://localhost/"));
    const text = await response.text();
    console.log("✅ Got response:", text);

    await connection.close();
    console.log("✅ Connection closed!");

    console.log("\n🎉 All tests passed! Bun can use @ricsam/isolate-client.");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    if (daemon) {
      console.log("\n🛑 Stopping daemon...");
      daemon.kill();
    }
  }
};

testWithDaemon();