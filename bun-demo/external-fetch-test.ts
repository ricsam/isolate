/**
 * External Fetch Streaming Test
 *
 * Tests streaming when the isolate makes an external fetch() call
 * and pipes the response back. This mimics agent-sdk calling an LLM API.
 *
 * Run with: bun run external-fetch-test.ts
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
  let mockLLMServer: ReturnType<typeof Bun.serve> | null = null;
  let proxyServer: ReturnType<typeof Bun.serve> | null = null;

  try {
    // First, start a mock LLM server that streams responses
    mockLLMServer = Bun.serve({
      port: 3300,
      fetch(request) {
        const url = new URL(request.url);
        const encoder = new TextEncoder();

        if (url.pathname === "/v1/chat/completions") {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" from"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" the"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" mock"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" LLM"}}]}\n\n',
            'data: [DONE]\n\n',
          ];
          let index = 0;

          const stream = new ReadableStream({
            start(controller) {
              const emit = () => {
                if (index >= chunks.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(chunks[index]));
                index++;
                if (index < chunks.length) {
                  setTimeout(emit, 100);
                } else {
                  controller.close();
                }
              };
              emit();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });
    console.log(`✅ Mock LLM server at http://localhost:${mockLLMServer.port}`);

    // Start daemon
    console.log("\n🚀 Starting daemon on port 3104...");
    daemon = spawn({
      cmd: [
        "node",
        "--experimental-strip-types",
        "../packages/isolate-daemon/src/daemon.ts",
        "--port",
        "3104",
      ],
      cwd: import.meta.dir,
      stdout: "inherit",
      stderr: "inherit",
    });

    connection = await connectWithRetry(3104);
    console.log("✅ Connected to daemon!");

    // Pass fetch callback to enable external fetch from within isolate
    const runtime = await connection.createRuntime({
      fetch: async (request) => {
        // Forward fetch requests from isolate to the real network
        return fetch(request);
      },
    });

    // The isolate will fetch from the mock LLM and pipe the response
    await runtime.eval(`
      serve({
        async fetch(request) {
          const url = new URL(request.url);

          // Test 1: Direct passthrough of external fetch
          if (url.pathname === "/passthrough") {
            const llmResponse = await fetch("http://localhost:3300/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hello" })
            });

            // Just return the response directly
            return new Response(llmResponse.body, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache"
              }
            });
          }

          // Test 2: Tee the external fetch stream
          if (url.pathname === "/tee-external") {
            const llmResponse = await fetch("http://localhost:3300/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hello" })
            });

            const [stream1, stream2] = llmResponse.body.tee();

            // Consume stream2 for logging
            (async () => {
              const reader = stream2.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();

            return new Response(stream1, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache"
              }
            });
          }

          // Test 3: TransformStream on external fetch
          if (url.pathname === "/transform-external") {
            const llmResponse = await fetch("http://localhost:3300/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hello" })
            });

            const transform = new TransformStream();
            llmResponse.body.pipeTo(transform.writable);

            return new Response(transform.readable, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache"
              }
            });
          }

          // Test 4: Tee + Transform on external fetch
          if (url.pathname === "/tee-transform-external") {
            const llmResponse = await fetch("http://localhost:3300/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hello" })
            });

            const [stream1, stream2] = llmResponse.body.tee();

            // Consume stream2
            (async () => {
              const reader = stream2.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            })();

            // Transform stream1
            const transform = new TransformStream();
            stream1.pipeTo(transform.writable);

            return new Response(transform.readable, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache"
              }
            });
          }

          // Test 5: pipeThrough on external fetch
          if (url.pathname === "/pipe-through-external") {
            const llmResponse = await fetch("http://localhost:3300/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "Hello" })
            });

            const processed = llmResponse.body.pipeThrough(new TransformStream());

            return new Response(processed, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache"
              }
            });
          }

          return new Response("Not Found", { status: 404 });
        }
      });
    `);
    console.log("✅ Handlers registered!");

    proxyServer = Bun.serve({
      port: 3204,
      async fetch(request) {
        return runtime.fetch.dispatchRequest(request);
      },
    });
    console.log(`✅ Proxy server at http://localhost:${proxyServer.port}\n`);

    const tests = [
      { path: "/passthrough", label: "Direct passthrough of external fetch" },
      { path: "/tee-external", label: "Tee external fetch stream" },
      { path: "/transform-external", label: "TransformStream on external fetch" },
      { path: "/tee-transform-external", label: "Tee + Transform external fetch" },
      { path: "/pipe-through-external", label: "pipeThrough external fetch" },
    ];

    for (const test of tests) {
      console.log("=".repeat(70));
      console.log(`TEST: ${test.label}`);
      console.log("=".repeat(70));
      await runStreamTest(`http://localhost:${proxyServer.port}${test.path}`, test.label);
      console.log("");
    }

    console.log("\n🎉 All tests complete!");
  } finally {
    if (proxyServer) proxyServer.stop();
    if (mockLLMServer) mockLLMServer.stop();
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
    } else if (totalTime < 400 && timings.length >= 5) {
      console.log(`  ⚠️  POSSIBLE BUFFERING - total time too low`);
    } else {
      console.log(`  ✅ Streaming OK`);
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error}`);
  }
}

runTest().catch(console.error);
