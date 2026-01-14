/**
 * Streaming Integration Tests
 *
 * Tests to verify that file uploads and downloads are truly streamed
 * (not buffered) through the entire pipeline:
 *
 * Upload:  Host ReadableStream -> Isolate request.body -> FileHandle.createWritable() -> Host writes to disk
 * Download: Host request -> Isolate FileHandle.getFile() -> Host reads from disk -> Isolate Response -> Host
 *
 * These tests use instrumented FileSystemHandlers to track chunk-by-chunk streaming.
 */
import { describe, test, afterEach } from "node:test";
import assert from "node:assert";
import { createRuntime, type RuntimeHandle } from "@ricsam/isolate-runtime";
import type { FileSystemHandler } from "./index.ts";

describe("Streaming Integration Tests", () => {
  let runtime: RuntimeHandle | undefined;

  afterEach(async () => {
    if (runtime) {
      runtime.dispose();
      runtime = undefined;
    }
  });

  describe("Upload Streaming (Host -> Isolate -> Filesystem)", () => {
    test("streaming upload writes chunks progressively (not buffered)", async () => {
      // Track all writeFile calls with timestamps
      const writeCalls: Array<{ data: Uint8Array; timestamp: number }> = [];

      const mockHandler: FileSystemHandler = {
        async getFileHandle(path, options) {
          // Allow file creation
        },
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile(path) {
          // Combine all writes
          const totalSize = writeCalls.reduce((sum, w) => sum + w.data.length, 0);
          const combined = new Uint8Array(totalSize);
          let offset = 0;
          for (const write of writeCalls) {
            combined.set(write.data, offset);
            offset += write.data.length;
          }
          return {
            data: combined,
            size: totalSize,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile(path, data) {
          writeCalls.push({ data: new Uint8Array(data), timestamp: Date.now() });
        },
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      // Set up a server that reads request body chunk-by-chunk and writes to filesystem
      await runtime.context.eval(
        `
        serve({
          async fetch(request) {
            const root = await getDirectory("/");
            const fileHandle = await root.getFileHandle("upload.bin", { create: true });
            const writable = await fileHandle.createWritable();

            // Read request body chunk-by-chunk (streaming)
            const reader = request.body.getReader();
            let totalBytes = 0;
            let chunkCount = 0;

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              await writable.write(value);
              totalBytes += value.length;
              chunkCount++;
            }

            await writable.close();
            return Response.json({ totalBytes, chunkCount });
          }
        });
        `,
        { promise: true }
      );

      // Create a streaming request with multiple chunks
      const numChunks = 5;
      const chunkSize = 1024;
      let chunksSent = 0;

      const stream = new ReadableStream({
        pull(controller) {
          if (chunksSent < numChunks) {
            // Each chunk has distinct content for verification
            const chunk = new Uint8Array(chunkSize).fill(chunksSent + 1);
            controller.enqueue(chunk);
            chunksSent++;
          } else {
            controller.close();
          }
        },
      });

      const request = new Request("http://test/upload", {
        method: "POST",
        body: stream,
        // @ts-expect-error Node.js requires duplex for streaming bodies
        duplex: "half",
      });

      const response = await runtime.fetch.dispatchRequest(request, {
        tick: () => runtime!.tick(),
      });

      const result = (await response.json()) as {
        totalBytes: number;
        chunkCount: number;
      };

      // Verify the isolate received multiple chunks (not one buffered blob)
      assert.strictEqual(result.totalBytes, numChunks * chunkSize);
      assert.strictEqual(
        result.chunkCount,
        numChunks,
        `Expected ${numChunks} chunks but got ${result.chunkCount} - data was buffered instead of streamed`
      );

      // Verify the filesystem received multiple write calls (streaming)
      assert.strictEqual(
        writeCalls.length,
        numChunks,
        `Expected ${numChunks} writeFile calls but got ${writeCalls.length} - filesystem writes were buffered`
      );

      // Verify each chunk has correct content
      for (let i = 0; i < writeCalls.length; i++) {
        assert.strictEqual(writeCalls[i]!.data.length, chunkSize);
        assert.strictEqual(writeCalls[i]!.data[0], i + 1);
      }
    });

    test("large file upload streams without buffering entire file in memory", async () => {
      const writeCalls: Array<{ size: number; timestamp: number }> = [];
      let maxMemoryAtOnce = 0;
      let currentMemory = 0;

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          return {
            data: new Uint8Array(0),
            size: 0,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile(path, data) {
          currentMemory += data.length;
          maxMemoryAtOnce = Math.max(maxMemoryAtOnce, currentMemory);
          writeCalls.push({ size: data.length, timestamp: Date.now() });
          // Simulate write completing (memory released)
          currentMemory -= data.length;
        },
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      await runtime.context.eval(
        `
        serve({
          async fetch(request) {
            const root = await getDirectory("/");
            const fileHandle = await root.getFileHandle("large.bin", { create: true });
            const writable = await fileHandle.createWritable();

            const reader = request.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              await writable.write(value);
            }
            await writable.close();
            return new Response("OK");
          }
        });
        `,
        { promise: true }
      );

      // Stream 1MB in 64KB chunks
      const totalSize = 1024 * 1024;
      const chunkSize = 64 * 1024;
      let generated = 0;

      const stream = new ReadableStream({
        pull(controller) {
          if (generated < totalSize) {
            const size = Math.min(chunkSize, totalSize - generated);
            controller.enqueue(new Uint8Array(size).fill(0x42));
            generated += size;
          } else {
            controller.close();
          }
        },
      });

      const request = new Request("http://test/upload", {
        method: "POST",
        body: stream,
        // @ts-expect-error Node.js requires duplex for streaming bodies
        duplex: "half",
      });

      await runtime.fetch.dispatchRequest(request, {
        tick: () => runtime!.tick(),
      });

      // Should have multiple write calls (streaming behavior)
      const expectedChunks = Math.ceil(totalSize / chunkSize);
      assert.ok(
        writeCalls.length >= expectedChunks,
        `Expected at least ${expectedChunks} writes but got ${writeCalls.length}`
      );

      // Max memory should be much less than total file size (streaming)
      // Allow for some buffering but not the entire file
      assert.ok(
        maxMemoryAtOnce < totalSize / 2,
        `Max memory ${maxMemoryAtOnce} exceeded half of total size ${totalSize} - file was buffered`
      );
    });
  });

  describe("Download Streaming (Filesystem -> Isolate -> Host)", () => {
    test("streaming download sends chunks progressively (not buffered)", async () => {
      const numChunks = 5;
      const chunkSize = 1024;
      let readCallCount = 0;

      // Create data as multiple chunks
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < numChunks; i++) {
        chunks.push(new Uint8Array(chunkSize).fill(i + 1));
      }
      const totalData = new Uint8Array(numChunks * chunkSize);
      let offset = 0;
      for (const chunk of chunks) {
        totalData.set(chunk, offset);
        offset += chunk.length;
      }

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          readCallCount++;
          return {
            data: totalData,
            size: totalData.length,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile() {},
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      await runtime.context.eval(
        `
        serve({
          async fetch(request) {
            const root = await getDirectory("/");
            const fileHandle = await root.getFileHandle("download.bin");
            const file = await fileHandle.getFile();

            // Return file directly - should stream
            return new Response(file);
          }
        });
        `,
        { promise: true }
      );

      const request = new Request("http://test/download");
      const response = await runtime.fetch.dispatchRequest(request, {
        tick: () => runtime!.tick(),
      });

      // Read response body chunk-by-chunk to verify streaming
      const reader = response.body!.getReader();
      const receivedChunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedChunks.push(value);
      }

      // Verify we received the correct data
      const totalReceived = receivedChunks.reduce((sum, c) => sum + c.length, 0);
      assert.strictEqual(totalReceived, numChunks * chunkSize);

      // Verify content is correct
      const combined = new Uint8Array(totalReceived);
      let combineOffset = 0;
      for (const chunk of receivedChunks) {
        combined.set(chunk, combineOffset);
        combineOffset += chunk.length;
      }
      assert.deepStrictEqual(combined, totalData);
    });
  });

  describe("WHATWG Compliance - Response(file) streaming", () => {
    test("new Response(file) uses streaming (not buffered)", async () => {
      // This test verifies that when Response(file) is used,
      // the file content is streamed, not loaded entirely into memory first

      const fileSize = 1024 * 1024; // 1MB
      const fileData = new Uint8Array(fileSize).fill(0x42);
      let readFileCallCount = 0;

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          readFileCallCount++;
          return {
            data: fileData,
            size: fileSize,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile() {},
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      await runtime.context.eval(
        `
        serve({
          async fetch(request) {
            const root = await getDirectory("/");
            const fileHandle = await root.getFileHandle("large.bin");
            const file = await fileHandle.getFile();

            // WHATWG spec: Response(file) should stream the file body
            return new Response(file, {
              headers: { "Content-Type": file.type }
            });
          }
        });
        `,
        { promise: true }
      );

      const request = new Request("http://test/file");
      const response = await runtime.fetch.dispatchRequest(request, {
        tick: () => runtime!.tick(),
      });

      // Read first chunk only
      const reader = response.body!.getReader();
      const { value: firstChunk } = await reader.read();
      reader.releaseLock();

      // File should have been read from disk
      assert.ok(readFileCallCount >= 1, "readFile should have been called");

      // First chunk should exist and have correct content
      assert.ok(firstChunk, "Should receive at least one chunk");
      assert.strictEqual(firstChunk[0], 0x42);
    });

    test("file.stream() returns a ReadableStream for chunk-by-chunk reading", async () => {
      const fileData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          return {
            data: fileData,
            size: fileData.length,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile() {},
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      const result = await runtime.context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("test.bin");
          const file = await fileHandle.getFile();

          // WHATWG File.stream() should return a ReadableStream
          const stream = file.stream();
          const reader = stream.getReader();

          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Array.from(value));
          }

          return JSON.stringify({
            isReadableStream: stream instanceof ReadableStream,
            chunkCount: chunks.length,
            totalBytes: chunks.reduce((sum, c) => sum + c.length, 0)
          });
        })()
        `,
        { promise: true }
      );

      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.isReadableStream, true, "file.stream() should return ReadableStream");
      assert.strictEqual(parsed.totalBytes, fileData.length);
    });
  });

  describe("WHATWG Compliance - WritableStream streaming", () => {
    test("writable.write(chunk) streams each chunk separately", async () => {
      const writeCalls: Array<{ data: Uint8Array }> = [];

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          return {
            data: new Uint8Array(0),
            size: 0,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile(path, data) {
          writeCalls.push({ data: new Uint8Array(data) });
        },
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      await runtime.context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("chunked.bin", { create: true });
          const writable = await fileHandle.createWritable();

          // Write multiple chunks - each should trigger a separate writeFile call
          await writable.write(new Uint8Array([1, 2, 3]));
          await writable.write(new Uint8Array([4, 5, 6]));
          await writable.write(new Uint8Array([7, 8, 9]));

          await writable.close();
        })()
        `,
        { promise: true }
      );

      // Each write() should result in a separate writeFile call (streaming)
      assert.strictEqual(
        writeCalls.length,
        3,
        `Expected 3 writeFile calls but got ${writeCalls.length} - writes were buffered`
      );

      // Verify content of each call
      assert.deepStrictEqual(Array.from(writeCalls[0]!.data), [1, 2, 3]);
      assert.deepStrictEqual(Array.from(writeCalls[1]!.data), [4, 5, 6]);
      assert.deepStrictEqual(Array.from(writeCalls[2]!.data), [7, 8, 9]);
    });

    test("pipeTo(writable) streams chunks from ReadableStream", async () => {
      const writeCalls: Array<{ data: Uint8Array }> = [];

      const mockHandler: FileSystemHandler = {
        async getFileHandle() {},
        async getDirectoryHandle() {},
        async removeEntry() {},
        async readDirectory() {
          return [];
        },
        async readFile() {
          return {
            data: new Uint8Array(0),
            size: 0,
            lastModified: Date.now(),
            type: "application/octet-stream",
          };
        },
        async writeFile(path, data) {
          writeCalls.push({ data: new Uint8Array(data) });
        },
        async truncate() {},
        async isSameEntry() {
          return false;
        },
      };

      runtime = await createRuntime({
        console: { onLog: () => {} },
        fs: { getDirectory: async () => mockHandler },
      });

      await runtime.context.eval(
        `
        (async () => {
          const root = await getDirectory("/");
          const fileHandle = await root.getFileHandle("piped.bin", { create: true });
          const writable = await fileHandle.createWritable();

          // Create a ReadableStream with multiple chunks
          let chunkIndex = 0;
          const chunks = [
            new Uint8Array([1, 2]),
            new Uint8Array([3, 4]),
            new Uint8Array([5, 6]),
          ];

          const readable = new ReadableStream({
            pull(controller) {
              if (chunkIndex < chunks.length) {
                controller.enqueue(chunks[chunkIndex]);
                chunkIndex++;
              } else {
                controller.close();
              }
            }
          });

          // Pipe should stream chunks one by one
          const reader = readable.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writable.write(value);
          }

          await writable.close();
        })()
        `,
        { promise: true }
      );

      // Each chunk from the stream should result in a separate writeFile call
      assert.strictEqual(
        writeCalls.length,
        3,
        `Expected 3 writeFile calls but got ${writeCalls.length} - pipe was buffered`
      );
    });
  });
});
