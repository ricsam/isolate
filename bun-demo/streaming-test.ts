/**
 * Bun Streaming Test Script
 *
 * This script tests streaming behavior through Bun.serve() to identify
 * if buffering occurs at the Bun HTTP layer.
 *
 * Architecture:
 *   Bun.serve() -> runtime.fetch.dispatchRequest() -> isolate stream
 *
 * Run with: bun run streaming-test.ts
 */

import { spawn, type Subprocess } from "bun";
import { connect, type DaemonConnection } from "@ricsam/isolate-client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry connection with exponential backoff
const connectWithRetry = async (
  port: number,
  maxRetries = 10
): Promise<DaemonConnection> => {
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

interface ChunkTiming {
  index: number;
  timestamp: number;
  deltaFromPrevious: number;
  deltaFromStart: number;
  content: string;
}

async function runStreamingTest() {
  let daemon: Subprocess | null = null;
  let connection: DaemonConnection | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    console.log("\n🚀 Starting daemon on port 3100...");
    daemon = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "../packages/isolate-daemon/src/daemon.ts",
        "--port",
        "3100",
      ],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    console.log("📡 Connecting to daemon at localhost:3100...");
    connection = await connectWithRetry(3100);
    console.log("✅ Connected to daemon!");

    const runtime = await connection.createRuntime();
    console.log("✅ Created runtime!");

    // Set up a streaming handler with deliberate delays
    await runtime.eval(`
      serve({
        fetch(request) {
          const url = new URL(request.url);

          if (url.pathname === "/stream") {
            const encoder = new TextEncoder();
            let count = 0;
            let timeoutId = null;

            const stream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  const chunk = JSON.stringify({
                    index: count,
                    timestamp: Date.now(),
                    message: "chunk" + count
                  }) + "\\n";
                  controller.enqueue(encoder.encode(chunk));

                  if (count >= 5) {
                    controller.close();
                  } else {
                    // 100ms delay between chunks
                    timeoutId = setTimeout(emit, 100);
                  }
                };
                emit();
              },
              cancel() {
                if (timeoutId) clearTimeout(timeoutId);
              }
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "application/x-ndjson",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no"
              }
            });
          }

          if (url.pathname === "/sse") {
            const encoder = new TextEncoder();
            let count = 0;
            let intervalId = null;

            const stream = new ReadableStream({
              start(controller) {
                intervalId = setInterval(() => {
                  count++;
                  const data = { count, timestamp: Date.now() };
                  const event = "event: message\\ndata: " + JSON.stringify(data) + "\\n\\n";
                  controller.enqueue(encoder.encode(event));

                  if (count >= 5) {
                    clearInterval(intervalId);
                    controller.close();
                  }
                }, 100);
              },
              cancel() {
                if (intervalId) clearInterval(intervalId);
              }
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive"
              }
            });
          }

          return new Response("Not Found", { status: 404 });
        }
      });
    `);
    console.log("✅ Registered streaming serve handler!");

    // Start Bun.serve() to proxy requests
    server = Bun.serve({
      port: 3200,
      async fetch(request) {
        console.log(`[Bun.serve] Received request: ${request.method} ${request.url}`);
        const response = await runtime.fetch.dispatchRequest(request);
        console.log(`[Bun.serve] Got response, status: ${response.status}`);
        return response;
      },
    });
    console.log(`✅ Bun.serve() running at http://localhost:${server.port}`);

    // Test 1: NDJSON streaming
    console.log("\n" + "=".repeat(60));
    console.log("TEST 1: NDJSON Streaming (/stream)");
    console.log("=".repeat(60));
    await testStreaming(`http://localhost:${server.port}/stream`, "NDJSON");

    // Test 2: SSE streaming
    console.log("\n" + "=".repeat(60));
    console.log("TEST 2: SSE Streaming (/sse)");
    console.log("=".repeat(60));
    await testStreaming(`http://localhost:${server.port}/sse`, "SSE");

    console.log("\n🎉 Tests complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    if (server) {
      console.log("\n🛑 Stopping Bun.serve()...");
      server.stop();
    }
    if (connection) {
      console.log("🛑 Closing connection...");
      await connection.close();
    }
    if (daemon) {
      console.log("🛑 Stopping daemon...");
      daemon.kill();
    }
  }
}

async function testStreaming(url: string, label: string): Promise<void> {
  const startTime = Date.now();
  console.log(`\nFetching ${url}...`);

  const response = await fetch(url);
  console.log(`Response status: ${response.status}`);
  console.log(`Content-Type: ${response.headers.get("Content-Type")}`);
  console.log(`Cache-Control: ${response.headers.get("Cache-Control")}`);
  console.log(`X-Accel-Buffering: ${response.headers.get("X-Accel-Buffering")}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const timings: ChunkTiming[] = [];
  let prevTimestamp = startTime;
  let index = 0;

  console.log("\nReading chunks...\n");

  while (true) {
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) {
      console.log(`[DONE] Total time: ${now - startTime}ms`);
      break;
    }

    const content = decoder.decode(value);
    index++;

    const timing: ChunkTiming = {
      index,
      timestamp: now,
      deltaFromPrevious: now - prevTimestamp,
      deltaFromStart: now - startTime,
      content: content.trim().substring(0, 80) + (content.length > 80 ? "..." : ""),
    };
    timings.push(timing);

    console.log(
      `[Chunk ${index}] +${timing.deltaFromPrevious}ms (total: ${timing.deltaFromStart}ms) - ${timing.content}`
    );

    prevTimestamp = now;
  }

  // Analysis
  console.log("\n" + "-".repeat(60));
  console.log(`${label} ANALYSIS:`);
  console.log("-".repeat(60));

  if (timings.length < 2) {
    console.log("Not enough chunks to analyze timing.");
    return;
  }

  const deltas = timings.slice(1).map((t) => t.deltaFromPrevious);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const minDelta = Math.min(...deltas);
  const maxDelta = Math.max(...deltas);
  const totalTime = timings[timings.length - 1]!.deltaFromStart;

  console.log(`Total chunks received: ${timings.length}`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Average delta between chunks: ${avgDelta.toFixed(1)}ms`);
  console.log(`Min delta: ${minDelta}ms`);
  console.log(`Max delta: ${maxDelta}ms`);

  // Determine if streaming is working
  const expectedMinTime = (timings.length - 1) * 80; // 5 chunks with 100ms delays = ~400ms minimum
  const isBuffered = totalTime < expectedMinTime || minDelta < 50;

  if (isBuffered) {
    console.log(
      `\n⚠️  WARNING: Streaming appears BUFFERED!`
    );
    console.log(
      `   Expected total time >= ${expectedMinTime}ms, got ${totalTime}ms`
    );
    console.log(`   Min delta ${minDelta}ms suggests chunks arrived together`);
  } else {
    console.log(`\n✅ Streaming appears to be working correctly!`);
    console.log(`   Chunks arrived with observable delays (~${avgDelta.toFixed(0)}ms average)`);
  }
}

// Run the test
runStreamingTest();
