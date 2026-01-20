/**
 * In-Process Streaming Tests
 *
 * These tests verify streaming behavior at the dispatchRequest level,
 * testing the in-process runtime code path that the demo server uses.
 * This is different from the client-daemon tests which test a different
 * code path.
 *
 * These tests verify:
 * - Timing between chunks (to detect buffering issues)
 * - Time-to-first-byte (TTFB)
 * - Backpressure and late consumer patterns
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import {
  setupFetch,
  clearAllInstanceState,
  type FetchHandle,
} from "./index.ts";
import { setupTimers, type TimersHandle } from "@ricsam/isolate-timers";
import { setupConsole } from "@ricsam/isolate-console";
import { clearStreamRegistryForContext } from "./stream-state.ts";

describe("In-Process Streaming Timing", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;
  let timersHandle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();

    await setupConsole(context, {
      onEntry: () => {},
    });
    timersHandle = await setupTimers(context);
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  it("should deliver chunks with observable delays (not buffered)", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
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

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
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
  });

  it("should have low time-to-first-byte (TTFB)", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
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
    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/ttfb")
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
  });

  it("should stream with observable delays between chunks", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
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

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/observable-delays")
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
        time: Date.now() - startTime,
      });
    }

    // Should have 5 chunks
    assert.strictEqual(arrivals.length, 5);
    assert.deepStrictEqual(
      arrivals.map((a) => a.chunk),
      ["A", "B", "C", "D", "E"]
    );

    // Total time should be ~200ms (4 gaps * 50ms)
    const totalTime = arrivals[arrivals.length - 1]!.time;
    assert.ok(totalTime >= 150, `Total time ${totalTime}ms should be >= 150ms`);
  });

  it("should handle late consumer (delay before reading)", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
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
                  timeoutId = setTimeout(emit, 30);
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

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    // Delay before starting to read (simulating slow consumer)
    await new Promise((r) => setTimeout(r, 200));

    const text = await response.text();
    assert.strictEqual(text, "chunk1chunk2chunk3");
  });

  it("should verify SSE streaming with timing", { timeout: 5000 }, async () => {
    context.evalSync(`
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
            headers: { "Content-Type": "text/event-stream" }
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/events")
    );

    assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const timestamps: number[] = [];
    const events: string[] = [];

    while (true) {
      const startRead = Date.now();
      const { done, value } = await reader.read();
      if (done) break;
      timestamps.push(Date.now());
      events.push(decoder.decode(value));
    }

    // Should have 3 events
    assert.strictEqual(events.length, 3);

    // Verify gaps between events are observable (~80ms)
    if (timestamps.length >= 2) {
      const gap = timestamps[1]! - timestamps[0]!;
      assert.ok(gap >= 40, `Gap between SSE events ${gap}ms should be >= 40ms`);
    }
  });
});

describe("In-Process Streaming Backpressure", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;
  let timersHandle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();

    await setupConsole(context, {
      onEntry: () => {},
    });
    timersHandle = await setupTimers(context);
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  it("should handle slow consumer with backpressure", { timeout: 10000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();
          let count = 0;

          const stream = new ReadableStream({
            pull(controller) {
              count++;
              if (count <= 5) {
                controller.enqueue(encoder.encode("data" + count));
              } else {
                controller.close();
              }
            }
          });

          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
      // Simulate slow consumer
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.deepStrictEqual(chunks, ["data1", "data2", "data3", "data4", "data5"]);
  });

  it("should handle early stream cancellation", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const encoder = new TextEncoder();
          let count = 0;

          const stream = new ReadableStream({
            pull(controller) {
              count++;
              controller.enqueue(encoder.encode("chunk" + count));
              // Never close - infinite stream
            }
          });

          return new Response(stream);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/")
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    // Read only 3 chunks
    for (let i = 0; i < 3; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }
    await reader.cancel("done early");

    assert.strictEqual(chunks.length, 3);
    assert.deepStrictEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
  });
});

describe("In-Process POST Request Streaming", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;
  let timersHandle: TimersHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();

    await setupConsole(context, {
      onEntry: () => {},
    });
    timersHandle = await setupTimers(context);
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    timersHandle.dispose();
    clearStreamRegistryForContext(context);
    context.release();
    isolate.dispose();
  });

  it("should stream response to POST request with JSON body", { timeout: 5000 }, async () => {
    context.evalSync(`
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
                  echo: body.prompt
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
            headers: { "Content-Type": "application/x-ndjson" }
          });
        }
      });
    `);

    const startTime = Date.now();
    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello AI" }),
      })
    );

    assert.strictEqual(response.headers.get("Content-Type"), "application/x-ndjson");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const timestamps: number[] = [];
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      timestamps.push(Date.now());
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    // Verify timing - should take ~100ms for 2 delays
    const totalTime = timestamps[timestamps.length - 1]! - startTime;
    assert.ok(totalTime >= 80, `Total time ${totalTime}ms should be >= 80ms`);

    // Verify content
    assert.strictEqual(chunks.length, 3);
    const parsed = chunks.map((c) => JSON.parse(c.trim()));
    assert.strictEqual(parsed[0].echo, "Hello AI");
    assert.strictEqual(parsed[1].index, 2);
  });

  it("should stream word-by-word AI-style response", { timeout: 5000 }, async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
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
                // Variable delay between 20-40ms
                const delay = 20 + Math.floor(Math.random() * 20);
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

    const response = await fetchHandle.dispatchRequest(
      new Request("http://test/ai-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello world from AI" }),
      })
    );

    const text = await response.text();
    assert.strictEqual(text, "Hello world from AI");
  });
});
