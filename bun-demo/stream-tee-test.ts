/**
 * Stream.tee() Test
 *
 * Tests if stream.tee() causes buffering issues through the daemon.
 * The agent-sdk uses stream.tee() internally which may be causing
 * the buffering problem.
 *
 * Run with: bun run stream-tee-test.ts
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

async function runTest() {
  let daemon: Subprocess | null = null;
  let connection: DaemonConnection | null = null;
  let server: ReturnType<typeof Bun.serve> | null = null;

  try {
    console.log("\n🚀 Starting daemon on port 3102...");
    daemon = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "../packages/isolate-daemon/src/daemon.ts",
        "--port",
        "3102",
      ],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    connection = await connectWithRetry(3102);
    console.log("✅ Connected!");

    const runtime = await connection.createRuntime();

    // Test handlers with various stream.tee() scenarios
    await runtime.eval(`
      serve({
        fetch(request) {
          const url = new URL(request.url);
          const encoder = new TextEncoder();

          // Test 1: Simple stream WITHOUT tee (baseline)
          if (url.pathname === "/no-tee") {
            let count = 0;
            const stream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 2: Stream WITH tee - return one branch
          if (url.pathname === "/tee-return-first") {
            let count = 0;
            const originalStream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            // Tee the stream
            const [stream1, stream2] = originalStream.tee();

            // Consume stream2 in background (like agent-sdk might do for logging)
            (async () => {
              const reader = stream2.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();

            // Return stream1
            return new Response(stream1, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 3: Stream WITH tee - return second branch
          if (url.pathname === "/tee-return-second") {
            let count = 0;
            const originalStream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            const [stream1, stream2] = originalStream.tee();

            // Consume stream1 in background
            (async () => {
              const reader = stream1.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();

            // Return stream2
            return new Response(stream2, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 4: Stream WITH tee - slow consumer on other branch
          if (url.pathname === "/tee-slow-consumer") {
            let count = 0;
            const originalStream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            const [stream1, stream2] = originalStream.tee();

            // SLOW consumer on stream2 - this might cause backpressure
            (async () => {
              const reader = stream2.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
                // Slow consumption
                await new Promise(r => setTimeout(r, 200));
              }
            })();

            return new Response(stream1, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 5: Stream WITH tee - no consumer on other branch
          if (url.pathname === "/tee-no-consumer") {
            let count = 0;
            const originalStream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            const [stream1, stream2] = originalStream.tee();

            // DON'T consume stream2 at all - this might cause issues
            // stream2 is just left dangling

            return new Response(stream1, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 6: Double tee (like agent-sdk might do)
          if (url.pathname === "/double-tee") {
            let count = 0;
            const originalStream = new ReadableStream({
              start(controller) {
                const emit = () => {
                  count++;
                  controller.enqueue(encoder.encode("data: chunk" + count + "\\n\\n"));
                  if (count >= 5) {
                    controller.close();
                  } else {
                    setTimeout(emit, 100);
                  }
                };
                emit();
              }
            });

            // First tee
            const [s1, s2] = originalStream.tee();

            // Second tee on s1
            const [s1a, s1b] = s1.tee();

            // Consume s2 and s1b
            (async () => {
              const reader = s2.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();
            (async () => {
              const reader = s1b.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();

            return new Response(s1a, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          return new Response("Not Found", { status: 404 });
        }
      });
    `);
    console.log("✅ Handlers registered!");

    server = Bun.serve({
      port: 3202,
      async fetch(request) {
        return runtime.fetch.dispatchRequest(request);
      },
    });
    console.log(`✅ Server at http://localhost:${server.port}\n`);

    // Run all tests
    const tests = [
      { path: "/no-tee", label: "No tee (baseline)" },
      { path: "/tee-return-first", label: "Tee, return first branch" },
      { path: "/tee-return-second", label: "Tee, return second branch" },
      { path: "/tee-slow-consumer", label: "Tee with slow consumer" },
      { path: "/tee-no-consumer", label: "Tee with NO consumer on other branch" },
      { path: "/double-tee", label: "Double tee" },
    ];

    for (const test of tests) {
      console.log("=".repeat(70));
      console.log(`TEST: ${test.label}`);
      console.log("=".repeat(70));
      await runStreamTest(`http://localhost:${server.port}${test.path}`, test.label);
      console.log("");
    }

    console.log("\n🎉 All tests complete!");
  } finally {
    if (server) server.stop();
    if (connection) await connection.close();
    if (daemon) daemon.kill();
  }
}

async function runStreamTest(url: string, label: string): Promise<void> {
  const startTime = Date.now();
  console.log(`Fetching ${url}...`);

  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const timings: { delta: number; content: string }[] = [];
  let prevTime = startTime;

  while (true) {
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) break;

    const content = decoder.decode(value).trim();
    const delta = now - prevTime;
    timings.push({ delta, content: content.substring(0, 40) });
    console.log(`  +${delta.toString().padStart(4)}ms | ${content.substring(0, 50)}`);
    prevTime = now;
  }

  const totalTime = Date.now() - startTime;
  const deltas = timings.slice(1).map((t) => t.delta);
  const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const minDelta = deltas.length > 0 ? Math.min(...deltas) : 0;

  console.log(`\n  Total: ${totalTime}ms | Avg delta: ${avgDelta.toFixed(0)}ms | Min delta: ${minDelta}ms`);

  // Check for buffering
  if (minDelta < 30 && deltas.filter((d) => d < 30).length >= 2) {
    console.log(`  ⚠️  BUFFERING DETECTED - multiple chunks arrived together`);
  } else if (avgDelta < 50) {
    console.log(`  ⚠️  POSSIBLE BUFFERING - average delta too low`);
  } else {
    console.log(`  ✅ Streaming OK`);
  }
}

runTest().catch(console.error);
