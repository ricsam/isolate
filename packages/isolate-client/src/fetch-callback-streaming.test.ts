/**
 * Tests for fetch callback streaming behavior.
 *
 * These tests demonstrate the buffering issue when an isolate makes
 * external fetch() calls through the daemon's fetch callback.
 *
 * Issue: External fetch responses are fully buffered before being
 * returned to the isolate, breaking streaming use cases like LLM APIs.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { connect, type DaemonConnection } from "./index.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";

const TEST_SOCKET = "/tmp/isolate-fetch-callback-test.sock";

describe("Fetch Callback Streaming", () => {
  let daemon: DaemonHandle;
  let connection: DaemonConnection;
  let mockServer: Server;
  let mockServerPort: number;

  beforeEach(async () => {
    // Start a mock streaming server
    mockServer = createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const chunks = ["chunk1", "chunk2", "chunk3", "chunk4", "chunk5"];
      let index = 0;

      const sendChunk = () => {
        if (index >= chunks.length) {
          res.end();
          return;
        }
        res.write(`data: ${chunks[index]}\n\n`);
        index++;
        setTimeout(sendChunk, 100); // 100ms between chunks
      };

      sendChunk();
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        const addr = mockServer.address();
        mockServerPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    // Start daemon
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    connection = await connect({ socket: TEST_SOCKET });
  });

  afterEach(async () => {
    await connection.close();
    await daemon.close();
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  it("should detect that external fetch responses are buffered (not streaming)", async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => {
        // Forward fetch to real network
        return fetch(url, init);
      },
    });

    try {
      // Set up isolate to fetch from mock server and pass through
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);
            const targetUrl = url.searchParams.get("target");

            const externalResponse = await fetch(targetUrl);

            return new Response(externalResponse.body, {
              headers: { "Content-Type": "text/event-stream" }
            });
          }
        });
      `);

      const startTime = Date.now();
      const response = await runtime.fetch.dispatchRequest(
        new Request(`http://test/?target=http://localhost:${mockServerPort}/`)
      );

      const reader = response.body!.getReader();
      const timestamps: number[] = [];

      while (true) {
        const { done } = await reader.read();
        timestamps.push(Date.now() - startTime);
        if (done) break;
      }

      // With 5 chunks at 100ms intervals, streaming should take ~400-500ms
      // and chunks should arrive incrementally

      const totalTime = timestamps[timestamps.length - 1];

      // Calculate gaps between chunk arrivals
      const gaps: number[] = [];
      for (let i = 1; i < timestamps.length - 1; i++) {
        gaps.push(timestamps[i]! - timestamps[i - 1]!);
      }

      // If streaming worked, we'd see gaps of ~100ms between chunks
      // If buffered, all chunks arrive together (gaps near 0)
      const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

      console.log("Timestamps:", timestamps);
      console.log("Gaps between chunks:", gaps);
      console.log("Average gap:", avgGap);
      console.log("Total time:", totalTime);

      // External fetch responses should stream with observable delays (~100ms)
      // Currently FAILS because responses are buffered (all chunks arrive together)
      assert.ok(
        avgGap >= 50,
        `External fetch should stream with ~100ms gaps between chunks, but got ${avgGap.toFixed(1)}ms average gap. ` +
          `This indicates the response is being buffered instead of streamed.`
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("should show timing difference between internal stream (works) and external fetch (buffered)", async () => {
    const runtime = await connection.createRuntime({
      fetch: async (url, init) => {
        return fetch(url, init);
      },
    });

    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            const url = new URL(request.url);

            // Internal stream - created in isolate, should stream properly
            if (url.pathname === "/internal") {
              const encoder = new TextEncoder();
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

            // External fetch - goes through daemon callback, currently buffered
            if (url.pathname === "/external") {
              const targetUrl = url.searchParams.get("target");
              const externalResponse = await fetch(targetUrl);
              return new Response(externalResponse.body, {
                headers: { "Content-Type": "text/event-stream" }
              });
            }

            return new Response("Not Found", { status: 404 });
          }
        });
      `);

      // Test internal stream
      const internalStart = Date.now();
      const internalResponse = await runtime.fetch.dispatchRequest(
        new Request("http://test/internal")
      );
      const internalReader = internalResponse.body!.getReader();
      const internalTimestamps: number[] = [];

      while (true) {
        const { done } = await internalReader.read();
        internalTimestamps.push(Date.now() - internalStart);
        if (done) break;
      }

      // Test external fetch
      const externalStart = Date.now();
      const externalResponse = await runtime.fetch.dispatchRequest(
        new Request(`http://test/external?target=http://localhost:${mockServerPort}/`)
      );
      const externalReader = externalResponse.body!.getReader();
      const externalTimestamps: number[] = [];

      while (true) {
        const { done } = await externalReader.read();
        externalTimestamps.push(Date.now() - externalStart);
        if (done) break;
      }

      // Calculate gaps
      const internalGaps: number[] = [];
      for (let i = 1; i < internalTimestamps.length - 1; i++) {
        internalGaps.push(internalTimestamps[i]! - internalTimestamps[i - 1]!);
      }
      const internalAvgGap =
        internalGaps.length > 0 ? internalGaps.reduce((a, b) => a + b, 0) / internalGaps.length : 0;

      const externalGaps: number[] = [];
      for (let i = 1; i < externalTimestamps.length - 1; i++) {
        externalGaps.push(externalTimestamps[i]! - externalTimestamps[i - 1]!);
      }
      const externalAvgGap =
        externalGaps.length > 0 ? externalGaps.reduce((a, b) => a + b, 0) / externalGaps.length : 0;

      console.log("\nInternal stream (created in isolate):");
      console.log("  Timestamps:", internalTimestamps);
      console.log("  Gaps:", internalGaps);
      console.log("  Avg gap:", internalAvgGap.toFixed(1) + "ms");

      console.log("\nExternal fetch (through daemon callback):");
      console.log("  Timestamps:", externalTimestamps);
      console.log("  Gaps:", externalGaps);
      console.log("  Avg gap:", externalAvgGap.toFixed(1) + "ms");

      // Internal stream should have proper gaps (~100ms) - this works
      assert.ok(
        internalAvgGap >= 50,
        `Internal stream should have ~100ms gaps (got ${internalAvgGap.toFixed(1)}ms)`
      );

      // External fetch should also stream with proper gaps (~100ms)
      // Currently FAILS because external fetch responses are buffered
      assert.ok(
        externalAvgGap >= 50,
        `External fetch should stream like internal streams with ~100ms gaps, ` +
          `but got ${externalAvgGap.toFixed(1)}ms average gap. ` +
          `Internal stream works (${internalAvgGap.toFixed(1)}ms gaps), ` +
          `but external fetch is buffered.`
      );
    } finally {
      await runtime.dispose();
    }
  });
});
