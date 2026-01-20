/**
 * Agent SDK Simulation Test
 *
 * Simulates how agent-sdk might handle LLM streaming responses.
 * Tests various stream transformation patterns.
 *
 * Run with: bun run agent-sdk-sim-test.ts
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
    console.log("\n🚀 Starting daemon on port 3103...");
    daemon = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "../packages/isolate-daemon/src/daemon.ts",
        "--port",
        "3103",
      ],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    connection = await connectWithRetry(3103);
    console.log("✅ Connected!");

    const runtime = await connection.createRuntime();

    await runtime.eval(`
      serve({
        fetch(request) {
          const url = new URL(request.url);
          const encoder = new TextEncoder();

          // Simulate LLM response chunks
          function createLLMStream() {
            const chunks = [
              'data: {"choices":[{"delta":{"content":"Hello"}}]}\\n\\n',
              'data: {"choices":[{"delta":{"content":" world"}}]}\\n\\n',
              'data: {"choices":[{"delta":{"content":" this"}}]}\\n\\n',
              'data: {"choices":[{"delta":{"content":" is"}}]}\\n\\n',
              'data: {"choices":[{"delta":{"content":" streaming"}}]}\\n\\n',
              'data: [DONE]\\n\\n',
            ];
            let index = 0;

            return new ReadableStream({
              start(controller) {
                const emit = () => {
                  if (index >= chunks.length) {
                    controller.close();
                    return;
                  }
                  controller.enqueue(encoder.encode(chunks[index]));
                  index++;
                  if (index < chunks.length) {
                    // Simulate LLM latency - 80-120ms per token
                    setTimeout(emit, 80 + Math.random() * 40);
                  } else {
                    controller.close();
                  }
                };
                emit();
              }
            });
          }

          // Test 1: Direct passthrough
          if (url.pathname === "/direct") {
            return new Response(createLLMStream(), {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 2: Through TransformStream (identity)
          if (url.pathname === "/transform-identity") {
            const llmStream = createLLMStream();
            const transform = new TransformStream();
            llmStream.pipeTo(transform.writable);

            return new Response(transform.readable, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 3: Through TransformStream with processing
          if (url.pathname === "/transform-process") {
            const llmStream = createLLMStream();
            const decoder = new TextDecoder();

            const transform = new TransformStream({
              transform(chunk, controller) {
                // Just pass through (simulating processing)
                controller.enqueue(chunk);
              }
            });
            llmStream.pipeTo(transform.writable);

            return new Response(transform.readable, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 4: Tee + TransformStream (agent-sdk pattern)
          if (url.pathname === "/tee-transform") {
            const llmStream = createLLMStream();
            const [stream1, stream2] = llmStream.tee();

            // Consume stream2 for logging/accumulating
            (async () => {
              const reader = stream2.getReader();
              let accumulated = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                accumulated += new TextDecoder().decode(value);
              }
              // Logging would happen here
            })();

            // Transform stream1 for output
            const transform = new TransformStream();
            stream1.pipeTo(transform.writable);

            return new Response(transform.readable, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 5: Multiple TransformStreams chained
          if (url.pathname === "/chain-transforms") {
            const llmStream = createLLMStream();

            const t1 = new TransformStream();
            const t2 = new TransformStream();
            const t3 = new TransformStream();

            llmStream.pipeTo(t1.writable);
            t1.readable.pipeTo(t2.writable);
            t2.readable.pipeTo(t3.writable);

            return new Response(t3.readable, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 6: Async generator to ReadableStream (common pattern)
          if (url.pathname === "/async-generator") {
            async function* generateChunks() {
              const chunks = ["Hello", " world", " this", " is", " streaming"];
              for (const chunk of chunks) {
                await new Promise(r => setTimeout(r, 100));
                yield encoder.encode('data: {"content":"' + chunk + '"}\\n\\n');
              }
            }

            const stream = new ReadableStream({
              async start(controller) {
                for await (const chunk of generateChunks()) {
                  controller.enqueue(chunk);
                }
                controller.close();
              }
            });

            return new Response(stream, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          // Test 7: ReadableStream.from() if available (Node 20+)
          if (url.pathname === "/from-async-iterable") {
            async function* generateChunks() {
              const chunks = ["Hello", " world", " this", " is", " streaming"];
              for (const chunk of chunks) {
                await new Promise(r => setTimeout(r, 100));
                yield encoder.encode('data: {"content":"' + chunk + '"}\\n\\n');
              }
            }

            // Check if ReadableStream.from exists
            if (typeof ReadableStream.from === 'function') {
              const stream = ReadableStream.from(generateChunks());
              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream" }
              });
            } else {
              return new Response("ReadableStream.from not available", { status: 500 });
            }
          }

          // Test 8: pipeThrough pattern
          if (url.pathname === "/pipe-through") {
            const llmStream = createLLMStream();

            const processed = llmStream.pipeThrough(new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(chunk);
              }
            }));

            return new Response(processed, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }

          return new Response("Not Found", { status: 404 });
        }
      });
    `);
    console.log("✅ Handlers registered!");

    server = Bun.serve({
      port: 3203,
      async fetch(request) {
        return runtime.fetch.dispatchRequest(request);
      },
    });
    console.log(`✅ Server at http://localhost:${server.port}\n`);

    const tests = [
      { path: "/direct", label: "Direct passthrough" },
      { path: "/transform-identity", label: "TransformStream (identity)" },
      { path: "/transform-process", label: "TransformStream with processing" },
      { path: "/tee-transform", label: "Tee + TransformStream (agent-sdk pattern)" },
      { path: "/chain-transforms", label: "Chained TransformStreams" },
      { path: "/async-generator", label: "Async generator to ReadableStream" },
      { path: "/from-async-iterable", label: "ReadableStream.from()" },
      { path: "/pipe-through", label: "pipeThrough pattern" },
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

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`  ❌ HTTP ${response.status}: ${await response.text()}`);
      return;
    }

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
      timings.push({ delta, content: content.substring(0, 50) });
      console.log(`  +${delta.toString().padStart(4)}ms | ${content.substring(0, 60)}`);
      prevTime = now;
    }

    const totalTime = Date.now() - startTime;
    const deltas = timings.slice(1).map((t) => t.delta);
    const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const minDelta = deltas.length > 0 ? Math.min(...deltas) : 0;

    console.log(`\n  Total: ${totalTime}ms | Avg delta: ${avgDelta.toFixed(0)}ms | Min delta: ${minDelta}ms`);

    if (minDelta < 30 && deltas.filter((d) => d < 30).length >= 2) {
      console.log(`  ⚠️  BUFFERING DETECTED`);
    } else if (totalTime < 300 && timings.length >= 5) {
      console.log(`  ⚠️  POSSIBLE BUFFERING - total time too low`);
    } else {
      console.log(`  ✅ Streaming OK`);
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
  }
}

runTest().catch(console.error);
