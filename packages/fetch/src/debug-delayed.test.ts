import { test, describe, beforeEach, afterEach, it } from "node:test";
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

describe("Debug Delayed Streaming", () => {
  it("delayed streaming response with setTimeout", { timeout: 10000 }, async () => {
    const isolate = new ivm.Isolate();
    const context = await isolate.createContext();
    clearAllInstanceState();

    const logs: string[] = [];
    await setupConsole(context, {
      onLog: (level, ...args) => {
        logs.push(`[${level}] ${args.join(' ')}`);
        console.log(`[ISOLATE] ${args.join(' ')}`);
      }
    });

    const timersHandle = await setupTimers(context);
    const fetchHandle = await setupFetch(context);

    try {
      context.evalSync(`
        console.log('Setting up serve');
        serve({
          async fetch(request) {
            console.log('Fetch handler called');
            let count = 0;
            const stream = new ReadableStream({
              async pull(controller) {
                console.log('pull() called, count =', count);
                if (count < 3) {
                  console.log('Starting setTimeout');
                  await new Promise(r => setTimeout(r, 10));
                  console.log('setTimeout resolved');
                  const data = "delayed" + count;
                  console.log('Enqueuing:', data);
                  controller.enqueue(new TextEncoder().encode(data));
                  count++;
                  console.log('Enqueued, returning');
                } else {
                  console.log('Closing stream');
                  controller.close();
                }
              }
            });
            console.log('Creating Response');
            const response = new Response(stream);
            console.log('Response created, returning');
            return response;
          }
        });
        console.log('Serve registered');
      `);

      console.log('Calling dispatchRequest');
      const response = await fetchHandle.dispatchRequest(
        new Request("http://test/"),
        {
          tick: async () => {
            // Advance virtual time by 50ms each tick to process timers
            await timersHandle.tick(50);
          }
        }
      );

      console.log('Got response, status:', response.status);
      console.log('Calling response.text()');

      const text = await response.text();
      console.log('Got text:', text);
      assert.strictEqual(text, "delayed0delayed1delayed2");
    } finally {
      fetchHandle.dispose();
      timersHandle.dispose();
      clearStreamRegistryForContext(context);
      context.release();
      isolate.dispose();
    }
  });
});
