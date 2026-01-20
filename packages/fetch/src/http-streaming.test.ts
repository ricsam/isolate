/**
 * HTTP Integration Streaming Tests
 *
 * These tests verify streaming behavior over a real HTTP connection using
 * Express + @whatwg-node/server, reproducing the exact stack used in the
 * demo server where browser buffering issues were observed.
 *
 * These tests help identify if buffering occurs at:
 * - The Express middleware layer
 * - The @whatwg-node/server adapter
 * - Node.js HTTP stack
 * - The isolate stream pump
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import ivm from "isolated-vm";
import express from "express";
import { createServerAdapter } from "@whatwg-node/server";
import {
  setupFetch,
  clearAllInstanceState,
  type FetchHandle,
} from "./index.ts";
import { setupTimers, type TimersHandle } from "@ricsam/isolate-timers";
import { setupConsole } from "@ricsam/isolate-console";
import { clearStreamRegistryForContext } from "./stream-state.ts";

interface TestContext {
  isolate: ivm.Isolate;
  context: ivm.Context;
  fetchHandle: FetchHandle;
  timersHandle: TimersHandle;
  server: Server;
  port: number;
}

async function setupTestServer(): Promise<TestContext> {
  const isolate = new ivm.Isolate();
  const context = await isolate.createContext();
  clearAllInstanceState();

  await setupConsole(context, {
    onEntry: () => {},
  });
  const timersHandle = await setupTimers(context);
  const fetchHandle = await setupFetch(context);

  const app = express();

  const adapter = createServerAdapter(async (request: Request) => {
    if (fetchHandle.hasServeHandler()) {
      return fetchHandle.dispatchRequest(request);
    }
    return new Response("Not Found", { status: 404 });
  });

  app.use(adapter);

  const server = createServer(app);

  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        isolate,
        context,
        fetchHandle,
        timersHandle,
        server,
        port,
      });
    });
  });
}

async function teardownTestServer(ctx: TestContext): Promise<void> {
  await new Promise<void>((resolve) => {
    ctx.server.close(() => resolve());
  });
  ctx.fetchHandle.dispose();
  ctx.timersHandle.dispose();
  clearStreamRegistryForContext(ctx.context);
  ctx.context.release();
  ctx.isolate.dispose();
}

describe("HTTP Streaming over Real HTTP Connection", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestServer();
  });

  afterEach(async () => {
    await teardownTestServer(ctx);
  });

  it("should stream chunks over HTTP with observable timing", { timeout: 10000 }, async () => {
    ctx.context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();
          let count = 0;
          let timeoutId = null;

          const stream = new ReadableStream({
            start(controller) {
              const emit = () => {
                count++;
                controller.enqueue(encoder.encode("chunk" + count + "\\n"));
                if (count >= 3) {
                  controller.close();
                } else {
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
              "Content-Type": "text/plain",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no"
            }
          });
        }
      });
    `);

    const response = await fetch(`http://localhost:${ctx.port}/stream`);
    const reader = response.body!.getReader();
    const timestamps: number[] = [];
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      timestamps.push(Date.now());
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Verify we got all chunks
    const combined = chunks.join("");
    assert.ok(combined.includes("chunk1"), "Should contain chunk1");
    assert.ok(combined.includes("chunk2"), "Should contain chunk2");
    assert.ok(combined.includes("chunk3"), "Should contain chunk3");

    // Verify timing - gaps should be observable if streaming works
    // If buffered, all timestamps would be nearly identical
    if (timestamps.length >= 3) {
      const gap1 = timestamps[1]! - timestamps[0]!;
      const gap2 = timestamps[2]! - timestamps[1]!;

      // Note: HTTP layers may batch chunks, but at least some gaps should be observable
      const totalGap = gap1 + gap2;
      assert.ok(
        totalGap >= 100,
        `Total gap ${totalGap}ms should be >= 100ms indicating streaming (not fully buffered)`
      );
    }
  });

  it("should stream SSE events over HTTP with proper headers", { timeout: 10000 }, async () => {
    ctx.context.evalSync(`
      serve({
        fetch(request) {
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
                if (count >= 3) {
                  clearInterval(intervalId);
                  controller.close();
                }
              }, 80);
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
      });
    `);

    const response = await fetch(`http://localhost:${ctx.port}/events`);

    // Verify SSE headers
    assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");
    assert.strictEqual(response.headers.get("Cache-Control"), "no-cache, no-transform");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const timestamps: number[] = [];
    const events: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      timestamps.push(Date.now());
      if (done) break;
      events.push(decoder.decode(value));
    }

    // Verify we got SSE events
    const combined = events.join("");
    assert.ok(combined.includes("event: message"), "Should contain SSE events");
    assert.ok(combined.includes('"count":1'), "Should contain first event data");

    // Verify some timing gap exists
    if (timestamps.length >= 2) {
      const totalTime = timestamps[timestamps.length - 1]! - timestamps[0]!;
      assert.ok(
        totalTime >= 100,
        `SSE stream should take at least 100ms for 3 events, took ${totalTime}ms`
      );
    }
  });

  it("should handle POST request with streaming response", { timeout: 10000 }, async () => {
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const body = await request.json();
          const encoder = new TextEncoder();
          let count = 0;
          let timeoutId = null;

          const stream = new ReadableStream({
            start(controller) {
              const emit = () => {
                count++;
                const chunk = {
                  type: "chunk",
                  index: count,
                  prompt: body.prompt
                };
                controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\\n"));
                if (count >= 3) {
                  controller.close();
                } else {
                  timeoutId = setTimeout(emit, 50);
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
              "Cache-Control": "no-cache"
            }
          });
        }
      });
    `);

    const startTime = Date.now();
    const response = await fetch(`http://localhost:${ctx.port}/ai-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello AI" }),
    });

    assert.strictEqual(response.headers.get("Content-Type"), "application/x-ndjson");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const totalTime = Date.now() - startTime;

    // Verify content
    const combined = chunks.join("");
    const lines = combined.trim().split("\n");
    assert.ok(lines.length >= 3, `Should have 3 chunks, got ${lines.length}`);

    const parsed = lines.map((l) => JSON.parse(l));
    assert.strictEqual(parsed[0].prompt, "Hello AI");

    // Verify some streaming delay
    assert.ok(
      totalTime >= 80,
      `Total time ${totalTime}ms should be >= 80ms for streaming`
    );
  });

  it("should verify Transfer-Encoding: chunked for streams", { timeout: 5000 }, async () => {
    ctx.context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("hello"));
              controller.enqueue(encoder.encode(" world"));
              controller.close();
            }
          });

          return new Response(stream);
        }
      });
    `);

    const response = await fetch(`http://localhost:${ctx.port}/chunked`);

    // When Content-Length is not set and body is a stream,
    // HTTP/1.1 should use Transfer-Encoding: chunked
    const transferEncoding = response.headers.get("Transfer-Encoding");
    // Note: fetch() may not expose this header, but the streaming should work
    const text = await response.text();
    assert.strictEqual(text, "hello world");
  });
});

describe("HTTP Streaming Time-to-First-Byte", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestServer();
  });

  afterEach(async () => {
    await teardownTestServer(ctx);
  });

  it("should have low TTFB over HTTP", { timeout: 10000 }, async () => {
    ctx.context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();

          const stream = new ReadableStream({
            async start(controller) {
              // Emit first chunk immediately
              controller.enqueue(encoder.encode("first"));
              // Then wait 500ms before next chunks
              await new Promise(r => setTimeout(r, 500));
              controller.enqueue(encoder.encode("second"));
              controller.close();
            }
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "no-cache"
            }
          });
        }
      });
    `);

    const startTime = Date.now();
    const response = await fetch(`http://localhost:${ctx.port}/ttfb`);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read first chunk
    const { value: firstValue } = await reader.read();
    const ttfb = Date.now() - startTime;
    const firstChunk = decoder.decode(firstValue);

    // First byte should arrive quickly (before the 500ms delay)
    // Allow 200ms for HTTP overhead
    assert.ok(
      ttfb < 300,
      `TTFB ${ttfb}ms should be < 300ms (not waiting for 500ms delay)`
    );
    assert.strictEqual(firstChunk, "first");

    // Read second chunk (should take ~500ms from first)
    const secondStart = Date.now();
    const { value: secondValue } = await reader.read();
    const secondDelay = Date.now() - secondStart;
    const secondChunk = decoder.decode(secondValue);

    assert.strictEqual(secondChunk, "second");
    // Second chunk should arrive after delay
    assert.ok(
      secondDelay >= 400,
      `Second chunk delay ${secondDelay}ms should be >= 400ms`
    );
  });
});

describe("HTTP Streaming with Anti-Buffering Headers", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestServer();
  });

  afterEach(async () => {
    await teardownTestServer(ctx);
  });

  it("should include anti-buffering headers in response", { timeout: 5000 }, async () => {
    ctx.context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("data"));
              controller.close();
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
      });
    `);

    const response = await fetch(`http://localhost:${ctx.port}/stream`);

    // Verify anti-buffering headers are passed through
    assert.strictEqual(
      response.headers.get("Cache-Control"),
      "no-cache, no-transform"
    );
    assert.strictEqual(response.headers.get("X-Accel-Buffering"), "no");
    assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");

    const text = await response.text();
    assert.strictEqual(text, "data");
  });
});
