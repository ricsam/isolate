/**
 * Streaming tests for the isolate client.
 * Tests SSE events and POST request streaming responses.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-streaming-test.sock";

describe("isolate-client streaming", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  // ============================================================================
  // 1. Basic Streaming Tests
  // ============================================================================

  describe("basic streaming", () => {
    it("should stream sync chunks from start() controller", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode("chunk1"));
                  controller.enqueue(encoder.encode("chunk2"));
                  controller.enqueue(encoder.encode("chunk3"));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/stream")
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get("Content-Type"), "text/plain");

        const text = await response.text();
        assert.strictEqual(text, "chunk1chunk2chunk3");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle pull-based streaming", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  count++;
                  if (count <= 3) {
                    controller.enqueue(encoder.encode("pull" + count));
                  } else {
                    controller.close();
                  }
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/pull-stream")
        );

        const text = await response.text();
        assert.strictEqual(text, "pull1pull2pull3");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle empty stream", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const stream = new ReadableStream({
                start(controller) {
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/empty")
        );

        const text = await response.text();
        assert.strictEqual(text, "");
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve response headers with streaming body", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode("data"));
                  controller.close();
                }
              });

              return new Response(stream, {
                status: 201,
                statusText: "Created",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Custom-Header": "custom-value",
                  "Cache-Control": "no-cache"
                }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/headers")
        );

        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.headers.get("Content-Type"), "application/octet-stream");
        assert.strictEqual(response.headers.get("X-Custom-Header"), "custom-value");
        assert.strictEqual(response.headers.get("Cache-Control"), "no-cache");
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 2. SSE Streaming Tests
  // ============================================================================

  describe("SSE streaming", () => {
    it("should stream SSE format response", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  const events = [
                    { count: 1, message: "first" },
                    { count: 2, message: "second" },
                    { count: 3, message: "third" }
                  ];

                  for (const data of events) {
                    const event = "event: message\\ndata: " + JSON.stringify(data) + "\\n\\n";
                    controller.enqueue(encoder.encode(event));
                  }
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/events")
        );

        assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");

        const text = await response.text();
        const events = text.split("\n\n").filter(e => e.trim());

        assert.strictEqual(events.length, 3);
        assert.ok(events[0]!.includes("event: message"));
        assert.ok(events[0]!.includes('"count":1'));
      } finally {
        await runtime.dispose();
      }
    });

    it("should stream SSE events with setInterval delays", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
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
                  }, 50);
                },
                cancel() {
                  if (intervalId) clearInterval(intervalId);
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/events")
        );

        const text = await response.text();
        const events = text.split("\n\n").filter(e => e.trim());

        assert.strictEqual(events.length, 3);

        // Parse and verify timestamps are increasing
        const timestamps: number[] = [];
        for (const event of events) {
          const dataLine = event.split("\n").find(l => l.startsWith("data: "));
          if (dataLine) {
            const data = JSON.parse(dataLine.slice(6));
            timestamps.push(data.timestamp);
          }
        }

        assert.strictEqual(timestamps.length, 3);
        // Timestamps should be increasing (allowing for timing variations)
        assert.ok(timestamps[1]! >= timestamps[0]!);
        assert.ok(timestamps[2]! >= timestamps[1]!);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle multiple SSE event types", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  // Different event types
                  controller.enqueue(encoder.encode("event: start\\ndata: {}\\n\\n"));
                  controller.enqueue(encoder.encode("event: progress\\ndata: {\\"percent\\":50}\\n\\n"));
                  controller.enqueue(encoder.encode("event: complete\\ndata: {\\"status\\":\\"done\\"}\\n\\n"));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/events")
        );

        const text = await response.text();
        const events = text.split("\n\n").filter(e => e.trim());

        assert.strictEqual(events.length, 3);
        assert.ok(events[0]!.includes("event: start"));
        assert.ok(events[1]!.includes("event: progress"));
        assert.ok(events[2]!.includes("event: complete"));
      } finally {
        await runtime.dispose();
      }
    });

    it("should allow partial consumption of SSE stream", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  count++;
                  const event = "event: tick\\ndata: " + count + "\\n\\n";
                  controller.enqueue(encoder.encode(event));
                  if (count >= 10) {
                    controller.close();
                  }
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/events")
        );

        // Read only a few events then cancel
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const events: string[] = [];

        for (let i = 0; i < 3; i++) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(decoder.decode(value));
        }
        await reader.cancel("done early");

        // Verify we got the events we read
        assert.strictEqual(events.length, 3);
        assert.ok(events[0]!.includes("data: 1"));
        assert.ok(events[1]!.includes("data: 2"));
        assert.ok(events[2]!.includes("data: 3"));
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 3. POST Request Streaming Tests
  // ============================================================================

  describe("POST request streaming", () => {
    it("should handle POST with JSON body receiving streaming response", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              const body = await request.json();
              const encoder = new TextEncoder();

              const stream = new ReadableStream({
                start(controller) {
                  // Echo back the request body in chunks
                  controller.enqueue(encoder.encode("received: "));
                  controller.enqueue(encoder.encode(JSON.stringify(body)));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/echo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "hello", count: 42 })
          })
        );

        const text = await response.text();
        assert.strictEqual(text, 'received: {"message":"hello","count":42}');
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle AI-style word-by-word streaming with variable delays", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              const body = await request.json();
              const words = body.prompt.split(" ");
              const encoder = new TextEncoder();
              let wordIndex = 0;
              let timeoutId = null;

              const stream = new ReadableStream({
                start(controller) {
                  const emitWord = () => {
                    if (wordIndex >= words.length) {
                      controller.close();
                      return;
                    }
                    const word = words[wordIndex] + (wordIndex < words.length - 1 ? " " : "");
                    controller.enqueue(encoder.encode(word));
                    wordIndex++;
                    // Variable delay between 10-30ms
                    const delay = 10 + Math.floor(Math.random() * 20);
                    timeoutId = setTimeout(emitWord, delay);
                  };
                  emitWord();
                },
                cancel() {
                  if (timeoutId) clearTimeout(timeoutId);
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ai-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: "Hello world from AI" })
          })
        );

        const text = await response.text();
        assert.strictEqual(text, "Hello world from AI");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle echo streaming (POST body -> streamed chunks)", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: async (request) => {
              const text = await request.text();
              const encoder = new TextEncoder();
              const chunkSize = 5;
              let offset = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  if (offset >= text.length) {
                    controller.close();
                    return;
                  }
                  const chunk = text.slice(offset, offset + chunkSize);
                  controller.enqueue(encoder.encode(chunk));
                  offset += chunkSize;
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const input = "This is a test message for echo streaming";
        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/echo", {
            method: "POST",
            body: input
          })
        );

        const text = await response.text();
        assert.strictEqual(text, input);
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 4. Delayed Streaming Tests
  // ============================================================================

  describe("delayed streaming", () => {
    it("should stream NDJSON with delays", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const maxCount = 5;
              let currentIndex = 0;
              let timerId = null;
              let closed = false;

              const stream = new ReadableStream({
                start(controller) {
                  const emitChunk = () => {
                    if (closed) return;
                    if (currentIndex >= maxCount) {
                      closed = true;
                      controller.close();
                      return;
                    }
                    const data = {
                      index: currentIndex,
                      message: "Streaming chunk " + currentIndex
                    };
                    controller.enqueue(encoder.encode(JSON.stringify(data) + "\\n"));
                    currentIndex++;
                    timerId = setTimeout(emitChunk, 30);
                  };
                  emitChunk();
                },
                cancel() {
                  closed = true;
                  if (timerId !== null) clearTimeout(timerId);
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "application/x-ndjson" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/stream-json")
        );

        assert.strictEqual(response.headers.get("Content-Type"), "application/x-ndjson");

        const text = await response.text();
        const lines = text.trim().split("\n");

        assert.strictEqual(lines.length, 5);

        for (let i = 0; i < lines.length; i++) {
          const data = JSON.parse(lines[i]!);
          assert.strictEqual(data.index, i);
          assert.strictEqual(data.message, `Streaming chunk ${i}`);
        }
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle variable delay streaming (simulating AI tokens)", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const tokens = ["The", " quick", " brown", " fox", " jumps"];
              let index = 0;
              let timerId = null;

              const stream = new ReadableStream({
                start(controller) {
                  const emitToken = () => {
                    if (index >= tokens.length) {
                      controller.close();
                      return;
                    }
                    controller.enqueue(encoder.encode(tokens[index]));
                    index++;
                    // Variable delays: 10, 30, 20, 40, 10 ms
                    const delays = [10, 30, 20, 40, 10];
                    if (index < tokens.length) {
                      timerId = setTimeout(emitToken, delays[index - 1]);
                    } else {
                      controller.close();
                    }
                  };
                  emitToken();
                },
                cancel() {
                  if (timerId) clearTimeout(timerId);
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/tokens")
        );

        const text = await response.text();
        assert.strictEqual(text, "The quick brown fox jumps");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle setTimeout-based chunk emission", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();

              const stream = new ReadableStream({
                async start(controller) {
                  // Use setTimeout with Promise wrapper
                  const delay = (ms) => new Promise(r => setTimeout(r, ms));

                  controller.enqueue(encoder.encode("start,"));
                  await delay(20);
                  controller.enqueue(encoder.encode("middle,"));
                  await delay(20);
                  controller.enqueue(encoder.encode("end"));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/delayed")
        );

        const text = await response.text();
        assert.strictEqual(text, "start,middle,end");
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 5. Reader-based Iteration Tests
  // ============================================================================

  describe("reader-based iteration", () => {
    it("should read chunks via getReader()", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode("A"));
                  controller.enqueue(encoder.encode("B"));
                  controller.enqueue(encoder.encode("C"));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/stream")
        );

        const reader = response.body!.getReader();
        const chunks: string[] = [];
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value));
        }

        assert.deepStrictEqual(chunks, ["A", "B", "C"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle early cancel via reader", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  count++;
                  controller.enqueue(encoder.encode("chunk" + count));
                  // Never close - infinite stream
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/infinite")
        );

        const reader = response.body!.getReader();
        const chunks: string[] = [];
        const decoder = new TextDecoder();

        // Read 3 chunks then cancel
        for (let i = 0; i < 3; i++) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value));
        }
        await reader.cancel("done early");

        assert.strictEqual(chunks.length, 3);
        assert.deepStrictEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate errors via reader", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  count++;
                  if (count <= 2) {
                    controller.enqueue(encoder.encode("chunk" + count));
                  } else {
                    controller.error(new Error("Stream error at chunk 3"));
                  }
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/error-stream")
        );

        const reader = response.body!.getReader();
        const chunks: string[] = [];
        const decoder = new TextDecoder();

        await assert.rejects(async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(decoder.decode(value));
          }
        }, /Stream error at chunk 3/);

        assert.strictEqual(chunks.length, 2);
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 6. Error Handling Tests
  // ============================================================================

  describe("error handling", () => {
    it("should propagate stream errors to consumer", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();

              const stream = new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode("before-error"));
                  controller.error(new Error("Intentional stream error"));
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/error")
        );

        await assert.rejects(async () => {
          await response.text();
        }, /Intentional stream error/);
      } finally {
        await runtime.dispose();
      }
    });

    it("should allow partial read and cancel", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;

              const stream = new ReadableStream({
                pull(controller) {
                  count++;
                  controller.enqueue(encoder.encode("data" + count));
                  // Never close - infinite stream
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/abort-test")
        );

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        // Read one chunk
        const { value } = await reader.read();
        const firstChunk = decoder.decode(value);

        // Cancel the reader
        await reader.cancel("user abort");

        assert.strictEqual(firstChunk, "data1");
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle async error in stream start", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();

              const stream = new ReadableStream({
                async start(controller) {
                  controller.enqueue(encoder.encode("initial"));
                  await new Promise(r => setTimeout(r, 10));
                  throw new Error("Async start error");
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/async-error")
        );

        await assert.rejects(async () => {
          await response.text();
        }, /Async start error/);
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 7. Binary Streaming Tests
  // ============================================================================

  describe("binary streaming", () => {
    it("should stream binary data correctly", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const stream = new ReadableStream({
                start(controller) {
                  // Send raw bytes
                  controller.enqueue(new Uint8Array([0x00, 0x01, 0x02]));
                  controller.enqueue(new Uint8Array([0xFF, 0xFE, 0xFD]));
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/binary")
        );

        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        assert.deepStrictEqual(
          Array.from(bytes),
          [0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 8. Streaming Verification Tests (Timing-based)
  // ============================================================================

  describe("streaming verification", () => {
    it("should deliver chunks incrementally, not buffered", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;
              let timeoutId = null;

              const stream = new ReadableStream({
                start(controller) {
                  const emit = () => {
                    count++;
                    controller.enqueue(encoder.encode("chunk" + count));
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

              return new Response(stream);
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/timed-stream")
        );

        const reader = response.body!.getReader();
        const timestamps: number[] = [];

        while (true) {
          const { done } = await reader.read();
          timestamps.push(Date.now());
          if (done) break;
        }

        // We should have 4 timestamps: 3 chunks + 1 done
        assert.strictEqual(timestamps.length, 4);

        // If truly streaming, gaps should be ~100ms
        // If buffered, all timestamps would be nearly identical
        const gap1 = timestamps[1]! - timestamps[0]!;
        const gap2 = timestamps[2]! - timestamps[1]!;

        // Allow 50ms tolerance for timing variations
        // Gaps should be at least 50ms if streaming works
        assert.ok(gap1 >= 50, `First gap ${gap1}ms should be >= 50ms (streaming not buffered)`);
        assert.ok(gap2 >= 50, `Second gap ${gap2}ms should be >= 50ms (streaming not buffered)`);
      } finally {
        await runtime.dispose();
      }
    });

    it("should have low time-to-first-byte", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();

              const stream = new ReadableStream({
                async start(controller) {
                  // Emit first chunk immediately
                  controller.enqueue(encoder.encode("first"));
                  // Then wait 200ms before next chunks
                  await new Promise(r => setTimeout(r, 200));
                  controller.enqueue(encoder.encode("second"));
                  controller.enqueue(encoder.encode("third"));
                  controller.close();
                }
              });

              return new Response(stream);
            }
          });
        `);

        const startTime = Date.now();
        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/ttfb-test")
        );

        const reader = response.body!.getReader();
        const { value } = await reader.read();
        const ttfb = Date.now() - startTime;
        const decoder = new TextDecoder();

        // First byte should arrive quickly (not waiting for 200ms delay)
        assert.ok(ttfb < 150, `TTFB ${ttfb}ms should be < 150ms`);
        assert.strictEqual(decoder.decode(value), "first");

        // Now read the rest (should take ~200ms from first chunk)
        await reader.read(); // second
        await reader.read(); // third
        const { done } = await reader.read();
        assert.ok(done);
      } finally {
        await runtime.dispose();
      }
    });

    it("should stream with observable delays between chunks", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              const chunks = ["A", "B", "C", "D", "E"];
              let index = 0;
              let timeoutId = null;

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
                      timeoutId = setTimeout(emit, 50);
                    } else {
                      controller.close();
                    }
                  };
                  emit();
                },
                cancel() {
                  if (timeoutId) clearTimeout(timeoutId);
                }
              });

              return new Response(stream);
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/observable-delays")
        );

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const arrivals: { chunk: string; time: number }[] = [];
        const startTime = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          arrivals.push({
            chunk: decoder.decode(value),
            time: Date.now() - startTime
          });
        }

        // Should have 5 chunks
        assert.strictEqual(arrivals.length, 5);
        assert.deepStrictEqual(arrivals.map(a => a.chunk), ["A", "B", "C", "D", "E"]);

        // Total time should be ~200ms (4 gaps * 50ms)
        const totalTime = arrivals[arrivals.length - 1]!.time;
        assert.ok(totalTime >= 150, `Total time ${totalTime}ms should be >= 150ms`);
      } finally {
        await runtime.dispose();
      }
    });
  });

  // ============================================================================
  // 9. Large Stream Tests
  // ============================================================================

  describe("large streams", () => {
    it("should handle many small chunks", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const encoder = new TextEncoder();
              let count = 0;
              const total = 100;

              const stream = new ReadableStream({
                pull(controller) {
                  if (count >= total) {
                    controller.close();
                    return;
                  }
                  controller.enqueue(encoder.encode("x"));
                  count++;
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/plain" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/many-chunks")
        );

        const text = await response.text();
        assert.strictEqual(text.length, 100);
        assert.strictEqual(text, "x".repeat(100));
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle larger chunk sizes", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch: (request) => {
              const stream = new ReadableStream({
                start(controller) {
                  // Create a 10KB chunk
                  const chunk = new Uint8Array(10 * 1024);
                  chunk.fill(65); // 'A'
                  controller.enqueue(chunk);
                  controller.close();
                }
              });

              return new Response(stream, {
                headers: { "Content-Type": "application/octet-stream" }
              });
            }
          });
        `);

        const response = await runtime.fetch.dispatchRequest(
          new Request("http://localhost/large-chunk")
        );

        const buffer = await response.arrayBuffer();
        assert.strictEqual(buffer.byteLength, 10 * 1024);

        const bytes = new Uint8Array(buffer);
        assert.ok(bytes.every(b => b === 65));
      } finally {
        await runtime.dispose();
      }
    });
  });
});
