/**
 * Browser-like SSE Streaming Test
 *
 * This simulates how a browser's EventSource would receive SSE events.
 * Browsers may have different buffering behavior than raw fetch().
 *
 * Run with: bun run streaming-test-browser-sim.ts
 */

import { spawn, type Subprocess } from "bun";
import { connect, type DaemonConnection } from "@ricsam/isolate-client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

interface EventTiming {
  index: number;
  timestamp: number;
  deltaFromPrevious: number;
  deltaFromStart: number;
  eventType: string;
  data: string;
}

// Parse SSE format into events
function parseSSE(
  chunk: string
): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const lines = chunk.split("\n");
  let currentEvent = "message";
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData = line.slice(5).trim();
    } else if (line === "") {
      if (currentData) {
        events.push({ event: currentEvent, data: currentData });
        currentEvent = "message";
        currentData = "";
      }
    }
  }

  return events;
}

async function runBrowserSimTest() {
  let daemon: Subprocess | null = null;
  let connection: DaemonConnection | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    console.log("\n🚀 Starting daemon on port 3101...");
    daemon = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "../packages/isolate-daemon/src/daemon.ts",
        "--port",
        "3101",
      ],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    console.log("📡 Connecting to daemon...");
    connection = await connectWithRetry(3101);
    console.log("✅ Connected!");

    const runtime = await connection.createRuntime();

    // Longer delays to make buffering more obvious
    await runtime.eval(`
      serve({
        fetch(request) {
          const url = new URL(request.url);

          if (url.pathname === "/sse") {
            const encoder = new TextEncoder();
            let count = 0;
            let intervalId = null;

            const stream = new ReadableStream({
              start(controller) {
                // Send initial connection event
                controller.enqueue(encoder.encode("event: connected\\ndata: {}\\n\\n"));

                intervalId = setInterval(() => {
                  count++;
                  const data = {
                    count,
                    serverTimestamp: Date.now(),
                    message: "Event " + count
                  };
                  const event = "event: message\\ndata: " + JSON.stringify(data) + "\\n\\n";
                  controller.enqueue(encoder.encode(event));

                  if (count >= 5) {
                    clearInterval(intervalId);
                    controller.enqueue(encoder.encode("event: done\\ndata: {}\\n\\n"));
                    controller.close();
                  }
                }, 200); // 200ms between events - very observable
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

          // Simulate AI streaming (like OpenAI API)
          if (url.pathname === "/ai") {
            const encoder = new TextEncoder();
            const words = ["Hello", "world", "this", "is", "streaming", "from", "the", "sandbox"];
            let index = 0;
            let timeoutId = null;

            const stream = new ReadableStream({
              start(controller) {
                const emitWord = () => {
                  if (index >= words.length) {
                    controller.enqueue(encoder.encode("data: [DONE]\\n\\n"));
                    controller.close();
                    return;
                  }

                  const chunk = {
                    choices: [{
                      delta: { content: words[index] + " " },
                      index: 0
                    }]
                  };
                  controller.enqueue(encoder.encode("data: " + JSON.stringify(chunk) + "\\n\\n"));
                  index++;

                  // Variable delays 50-150ms
                  const delay = 50 + Math.floor(Math.random() * 100);
                  timeoutId = setTimeout(emitWord, delay);
                };
                emitWord();
              },
              cancel() {
                if (timeoutId) clearTimeout(timeoutId);
              }
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no"
              }
            });
          }

          return new Response("Not Found", { status: 404 });
        }
      });
    `);
    console.log("✅ Handler registered!");

    server = Bun.serve({
      port: 3201,
      async fetch(request) {
        return runtime.fetch.dispatchRequest(request);
      },
    });
    console.log(`✅ Server at http://localhost:${server.port}`);

    // Test 1: SSE with browser-like EventSource behavior simulation
    console.log("\n" + "=".repeat(70));
    console.log("TEST 1: SSE Stream (200ms intervals)");
    console.log("=".repeat(70));
    await testSSEStream(`http://localhost:${server.port}/sse`);

    // Test 2: AI-style streaming
    console.log("\n" + "=".repeat(70));
    console.log("TEST 2: AI-style Streaming (variable delays)");
    console.log("=".repeat(70));
    await testAIStream(`http://localhost:${server.port}/ai`);

    console.log("\n🎉 All tests complete!");
  } finally {
    if (server) server.stop();
    if (connection) await connection.close();
    if (daemon) daemon.kill();
  }
}

async function testSSEStream(url: string): Promise<void> {
  const startTime = Date.now();
  console.log(`\nFetching ${url}...`);

  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const timings: EventTiming[] = [];
  let prevTime = startTime;
  let eventIndex = 0;

  console.log("\nEvents received:\n");

  while (true) {
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) break;

    const text = decoder.decode(value);
    const events = parseSSE(text);

    for (const evt of events) {
      eventIndex++;
      const timing: EventTiming = {
        index: eventIndex,
        timestamp: now,
        deltaFromPrevious: now - prevTime,
        deltaFromStart: now - startTime,
        eventType: evt.event,
        data: evt.data.substring(0, 60),
      };
      timings.push(timing);

      console.log(
        `[Event ${eventIndex}] +${timing.deltaFromPrevious.toString().padStart(4)}ms | ${evt.event.padEnd(10)} | ${evt.data.substring(0, 50)}`
      );
      prevTime = now;
    }
  }

  analyzeTimings(timings, "SSE", 200);
}

async function testAIStream(url: string): Promise<void> {
  const startTime = Date.now();
  console.log(`\nFetching ${url}...`);

  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const timings: EventTiming[] = [];
  let prevTime = startTime;
  let eventIndex = 0;

  console.log("\nTokens received:\n");
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));

    for (const line of lines) {
      const data = line.slice(5).trim();
      eventIndex++;

      if (data === "[DONE]") {
        console.log(`\n[DONE] Total time: ${now - startTime}ms`);
        break;
      }

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content || "";
        fullText += content;

        const timing: EventTiming = {
          index: eventIndex,
          timestamp: now,
          deltaFromPrevious: now - prevTime,
          deltaFromStart: now - startTime,
          eventType: "token",
          data: content,
        };
        timings.push(timing);

        process.stdout.write(
          `[${eventIndex}] +${timing.deltaFromPrevious.toString().padStart(3)}ms "${content}" `
        );
        prevTime = now;
      } catch {
        // ignore parse errors
      }
    }
  }

  console.log(`\n\nFull text: "${fullText.trim()}"`);
  analyzeTimings(timings, "AI Stream", 100);
}

function analyzeTimings(
  timings: EventTiming[],
  label: string,
  expectedDelay: number
): void {
  console.log("\n" + "-".repeat(70));
  console.log(`${label} TIMING ANALYSIS:`);
  console.log("-".repeat(70));

  if (timings.length < 2) {
    console.log("Not enough events to analyze.");
    return;
  }

  const deltas = timings.slice(1).map((t) => t.deltaFromPrevious);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const minDelta = Math.min(...deltas);
  const maxDelta = Math.max(...deltas);
  const totalTime = timings[timings.length - 1].deltaFromStart;

  console.log(`Total events: ${timings.length}`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Expected delay per event: ~${expectedDelay}ms`);
  console.log(`Actual average delay: ${avgDelta.toFixed(1)}ms`);
  console.log(`Min delay: ${minDelta}ms`);
  console.log(`Max delay: ${maxDelta}ms`);

  // Check for buffering
  const expectedMinTotal = (timings.length - 1) * (expectedDelay * 0.5);
  const bufferedThreshold = expectedDelay * 0.3; // If min delta is less than 30% of expected

  if (minDelta < bufferedThreshold && deltas.filter((d) => d < bufferedThreshold).length > 2) {
    console.log(`\n⚠️  BUFFERING DETECTED!`);
    console.log(`   Multiple events arrived with < ${bufferedThreshold}ms gap`);
    console.log(`   Events may be batched together`);
  } else if (totalTime < expectedMinTotal) {
    console.log(`\n⚠️  POSSIBLE BUFFERING!`);
    console.log(`   Total time ${totalTime}ms < expected minimum ${expectedMinTotal}ms`);
  } else {
    console.log(`\n✅ Streaming working correctly!`);
    console.log(`   Events arrived with proper delays`);
  }
}

runBrowserSimTest().catch(console.error);
