import { test, describe, beforeEach, afterEach, it } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import {
  setupFetch,
  clearAllInstanceState,
  type FetchHandle,
} from "./index.ts";
import { setupTimers, type TimersHandle } from "@ricsam/isolate-timers";
import { clearStreamRegistryForContext } from "./stream-state.ts";

describe("Download Streaming Simple", () => {
  it("Test 1: sync start", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();
    clearAllInstanceState();

    const timersHandle = await setupTimers(context);
    const fetchHandle = await setupFetch(context);

    try {
      context.evalSync(`
        serve({
          async fetch(request) {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("chunk1"));
                controller.enqueue(new TextEncoder().encode("chunk2"));
                controller.close();
              }
            });
            return new Response(stream);
          }
        });
      `);

      const response = await fetchHandle.dispatchRequest(
        new Request("http://test/"),
        { tick: () => timersHandle.tick() }
      );

      const text = await response.text();
      assert.strictEqual(text, "chunk1chunk2");
    } finally {
      fetchHandle.dispose();
      timersHandle.dispose();
      clearStreamRegistryForContext(context);
      context.release();
      isolate.dispose();
    }
  });

  it("Test 2: non-streaming", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();
    clearAllInstanceState();

    const timersHandle = await setupTimers(context);
    const fetchHandle = await setupFetch(context);

    try {
      context.evalSync(`
        serve({
          async fetch(request) {
            return new Response("buffered");
          }
        });
      `);

      const response = await fetchHandle.dispatchRequest(
        new Request("http://test/")
      );

      const text = await response.text();
      assert.strictEqual(text, "buffered");
    } finally {
      fetchHandle.dispose();
      timersHandle.dispose();
      clearStreamRegistryForContext(context);
      context.release();
      isolate.dispose();
    }
  });

  it("Test 3: sync start again", async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();
    clearAllInstanceState();

    const timersHandle = await setupTimers(context);
    const fetchHandle = await setupFetch(context);

    try {
      context.evalSync(`
        serve({
          async fetch(request) {
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("test"));
                controller.close();
              }
            });
            return new Response(stream);
          }
        });
      `);

      const response = await fetchHandle.dispatchRequest(
        new Request("http://test/"),
        { tick: () => timersHandle.tick() }
      );

      const text = await response.text();
      assert.strictEqual(text, "test");
    } finally {
      fetchHandle.dispose();
      timersHandle.dispose();
      clearStreamRegistryForContext(context);
      context.release();
      isolate.dispose();
    }
  });

  it("Test 4: pull-based stream", { timeout: 10000 }, async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();
    clearAllInstanceState();

    const timersHandle = await setupTimers(context);
    const fetchHandle = await setupFetch(context);

    try {
      context.evalSync(`
        serve({
          async fetch(request) {
            let count = 0;
            const stream = new ReadableStream({
              pull(controller) {
                if (count < 3) {
                  controller.enqueue(new TextEncoder().encode("chunk" + count));
                  count++;
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
        new Request("http://test/"),
        { tick: () => timersHandle.tick() }
      );

      const text = await response.text();
      assert.strictEqual(text, "chunk0chunk1chunk2");
    } finally {
      fetchHandle.dispose();
      timersHandle.dispose();
      clearStreamRegistryForContext(context);
      context.release();
      isolate.dispose();
    }
  });
});
