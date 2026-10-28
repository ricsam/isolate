/**
 * Lazy, disk-backed files in the daemon-backed arrangement: the isolate runs
 * in the daemon while the disk belongs to the host (client) process.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFileBindings, createModuleResolver } from "../index.ts";
import { connect } from "../internal/client/index.ts";
import { __unstableGetConnectionTrafficForTests } from "../internal/client/connection.ts";
import { createAppServerAdapter } from "./app-server.ts";
import {
  createTestHost,
  createTestId,
  expectResponse,
  withTimeout,
} from "../testing/integration-helpers.ts";
import type { AppServer, FileBindings, IsolateHost } from "../types.ts";

const supportsProcFd = process.platform === "linux" && fs.existsSync("/proc/self/fd");

function patternBytes(size: number, seed = 0): Buffer {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    data[index] = (index * 31 + seed * 7 + 11) & 0xff;
  }
  return data;
}

function openFdCount(): number {
  return fs.readdirSync("/proc/self/fd").length;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${label}`);
    }
    await delay(10);
  }
}

interface FileStats {
  readFileCalls: number;
  streamCalls: Array<{ path: string; start: number; end: number }>;
  openStreams: number;
}

/**
 * File bindings that fail if whole-file reads are used and record every
 * range stream they open.
 */
function createInstrumentedFiles(root: string): { files: FileBindings; stats: FileStats } {
  const base = createFileBindings({ root });
  const stats: FileStats = { readFileCalls: 0, streamCalls: [], openStreams: 0 };

  return {
    stats,
    files: {
      ...base,
      readFile: async () => {
        stats.readFileCalls += 1;
        throw new Error("readFile must not be used for lazy files");
      },
      readFileStream: async (filePath, options, context) => {
        stats.streamCalls.push({ path: filePath, start: options.start, end: options.end });
        const stream = await base.readFileStream!(filePath, options, context);
        stats.openStreams += 1;
        let settled = false;
        const settle = () => {
          if (!settled) {
            settled = true;
            stats.openStreams -= 1;
          }
        };
        const reader = stream.getReader();
        return new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              try {
                const result = await reader.read();
                if (result.done) {
                  settle();
                  controller.close();
                } else {
                  controller.enqueue(result.value);
                }
              } catch (error) {
                settle();
                controller.error(error);
              }
            },
            async cancel(reason) {
              settle();
              await reader.cancel(reason);
            },
          },
          { highWaterMark: 0 },
        );
      },
    },
  };
}

const SERVER_CODE = `
  async function openFile(name, dir = "/media") {
    const directory = await getDirectory(dir);
    const handle = await directory.getFileHandle(name);
    return await handle.getFile();
  }

  serve({
    async fetch(request) {
      const url = new URL(request.url);
      const name = url.searchParams.get("name") ?? "video.mp4";

      // Application-level authorization happens in the sandbox for every request.
      if (request.headers.get("x-user") !== "allowed") {
        return new Response("forbidden", { status: 403 });
      }

      try {
        switch (url.pathname) {
          case "/serve":
            return serveFile(request, await openFile(name), {
              headers: { "cache-control": "private, no-store" },
            });
          case "/raw":
            return new Response(await openFile(name));
          case "/slice": {
            const file = await openFile(name);
            return new Response(file.slice(Number(url.searchParams.get("start")), Number(url.searchParams.get("end"))));
          }
          case "/transform": {
            const file = await openFile(name);
            return new Response(file.stream().pipeThrough(new TransformStream({
              transform(chunk, controller) {
                controller.enqueue(chunk.map((byte) => byte ^ 0xff));
              },
            })));
          }
          case "/slice-bytes": {
            const file = await openFile(name);
            const bytes = await file.slice(Number(url.searchParams.get("start")), Number(url.searchParams.get("end"))).bytes();
            return Response.json(Array.from(bytes));
          }
          case "/composed": {
            const file = await openFile(name);
            return new Response(new Blob(["<", file.slice(0, 3), new Uint8Array([33]), ">"]));
          }
          case "/memory-blob":
            return new Response(new Blob(["hello ", "world"], { type: "text/plain" }));
          case "/memory-file":
            return new Response(new File([new Uint8Array([1, 2, 3])], "bytes.bin", { type: "application/x-test" }));
          case "/blob-from-response": {
            const blob = await new Response(await openFile(name)).blob();
            return new Response(blob.slice(10, 20));
          }
          case "/clone": {
            const response = new Response(await openFile(name));
            const copy = response.clone();
            await copy.arrayBuffer();
            return response;
          }
          case "/consumed": {
            const response = new Response(await openFile(name));
            await response.text();
            return response;
          }
          case "/locked": {
            const response = new Response(await openFile(name));
            response.body.getReader();
            return response;
          }
          case "/body-accessed": {
            const response = new Response(await openFile(name));
            void response.body;
            return response;
          }
          case "/partial-read": {
            const response = new Response(await openFile(name));
            const reader = response.body.getReader();
            const first = await reader.read();
            reader.releaseLock();
            await record(first.value.byteLength);
            return response;
          }
          case "/stale": {
            const file = await openFile(name);
            await replaceFile(name);
            return new Response(file);
          }
          case "/stale-read": {
            const file = await openFile(name);
            await replaceFile(name);
            try {
              await file.slice(0, 10).arrayBuffer();
              return new Response("read replaced content");
            } catch (error) {
              return new Response(error.name);
            }
          }
          case "/read-all": {
            const file = await openFile(name);
            await file.text();
            return new Response("read");
          }
          case "/open-readers": {
            const file = await openFile(name);
            const readers = [];
            let failure = null;
            for (let index = 0; index < Number(url.searchParams.get("count")); index += 1) {
              const reader = file.stream().getReader();
              try {
                await reader.read();
                readers.push(reader);
              } catch (error) {
                failure = { name: error.name, message: error.message };
                break;
              }
            }
            for (const reader of readers) {
              await reader.cancel();
            }
            return Response.json({ opened: readers.length, failure });
          }
          case "/share-id": {
            const file = await openFile(name);
            await shareId(file._getInstanceId());
            return new Response("shared");
          }
          case "/use-id": {
            const id = Number(url.searchParams.get("id"));
            const forged = File._createFromInstanceId(id);
            const result = { size: forged.size, name: forged.name };
            try {
              new Response(forged);
              result.response = "created";
            } catch (error) {
              result.response = error.name;
            }
            try {
              await __Blob_read_ref.apply(undefined, [id, false], { result: { promise: true, copy: true } });
              result.read = "read";
            } catch (error) {
              result.read = error.message;
            }
            return Response.json(result);
          }
          case "/forged-header":
            return new Response("plain body", {
              headers: { "x-isolate-file-token": "forged", "content-type": "text/plain" },
            });
          default:
            return new Response("not found", { status: 404 });
        }
      } catch (error) {
        return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
      }
    },
  });
`;

describe("lazy disk-backed files (daemon-backed runtime, host-owned disk)", { timeout: 240_000 }, () => {
  let host: IsolateHost;
  let socketPath: string;
  let cleanup: (() => Promise<void>) | undefined;
  let tempRoot: string;
  let rootA: string;
  let rootB: string;
  let video: Buffer;
  let empty: Buffer;
  let server: AppServer;
  let stats: FileStats;
  let sharedId: number | undefined;
  const recorded: unknown[] = [];
  const servers: AppServer[] = [];

  const replaceFile = async (name: string) => {
    const target = path.join(rootA, "media", name);
    await delay(5);
    fs.writeFileSync(`${target}.next`, patternBytes(fs.statSync(target).size, 9));
    fs.renameSync(`${target}.next`, target);
  };

  async function createServer(
    files: FileBindings,
    options: { memoryLimitMB?: number; entry?: string; code?: string } = {},
  ): Promise<AppServer> {
    const created = await host.createAppServer({
      key: createTestId("file-streaming"),
      entry: "/server.ts",
      memoryLimitMB: options.memoryLimitMB ?? 32,
      bindings: {
        files,
        modules: createModuleResolver().virtual("/server.ts", options.code ?? SERVER_CODE),
        tools: {
          replaceFile: async (...args: unknown[]) => {
            await replaceFile(String(args[0]));
          },
          shareId: async (...args: unknown[]) => {
            sharedId = Number(args[0]);
          },
          record: async (...args: unknown[]) => {
            recorded.push(args[0]);
          },
        },
      },
    });
    servers.push(created);
    return created;
  }

  async function get(
    target: AppServer,
    pathname: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("x-user")) {
      headers.set("x-user", "allowed");
    }
    const result = await withTimeout(
      target.handle(new Request(`http://files.test${pathname}`, { ...init, headers })),
      20_000,
      `handle ${pathname}`,
    );
    return expectResponse(result);
  }

  before(async () => {
    const testHost = await createTestHost("file-streaming-integration");
    host = testHost.host;
    socketPath = testHost.socketPath;
    cleanup = testHost.cleanup;

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-file-streaming-"));
    rootA = path.join(tempRoot, "project-a");
    rootB = path.join(tempRoot, "project-b");
    fs.mkdirSync(path.join(rootA, "media"), { recursive: true });
    fs.mkdirSync(path.join(rootB, "media"), { recursive: true });
    video = patternBytes(3 * 1024 * 1024 + 321);
    empty = Buffer.alloc(0);
    fs.writeFileSync(path.join(rootA, "media", "video.mp4"), video);
    fs.writeFileSync(path.join(rootA, "media", "empty.bin"), empty);
    fs.writeFileSync(path.join(rootA, "media", "stale.bin"), patternBytes(512 * 1024, 7));
    fs.writeFileSync(path.join(rootA, "media", "big.bin"), patternBytes(6 * 1024 * 1024, 3));
    fs.writeFileSync(path.join(rootB, "media", "video.mp4"), patternBytes(1024, 5));

    const instrumented = createInstrumentedFiles(rootA);
    stats = instrumented.stats;
    server = await createServer(instrumented.files);
  });

  after(async () => {
    for (const created of servers) {
      await created.dispose({ hard: true, reason: "test cleanup" }).catch(() => {});
    }
    await cleanup?.();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("the sandbox authorizes each request before any file is opened", async () => {
    const before = stats.streamCalls.length;
    const response = await get(server, "/serve", { headers: { "x-user": "someone-else" } });
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "forbidden");
    assert.equal(stats.streamCalls.length, before);
  });

  test("serves a full file from the host without readFile or isolate-side reads", async () => {
    const guardedFiles = createInstrumentedFiles(rootA);
    const guarded = await createServer(guardedFiles.files, {
      code: `
        for (const proto of [Blob.prototype, File.prototype, Response.prototype]) {
          for (const method of ["arrayBuffer", "text", "bytes", "stream", "blob"]) {
            Object.defineProperty(proto, method, {
              configurable: true,
              writable: true,
              value() {
                throw new Error("isolate materialized " + method);
              },
            });
          }
        }
        serve({
          async fetch(request) {
            const media = await getDirectory("/media");
            const file = await (await media.getFileHandle("video.mp4")).getFile();
            return serveFile(request, file);
          },
        });
      `,
    });

    const response = await get(guarded, "/");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(video.length));
    assert.equal(response.headers.get("content-type"), "video/mp4");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(Buffer.compare(body, video), 0);
    assert.equal(guardedFiles.stats.readFileCalls, 0);
    assert.deepEqual(guardedFiles.stats.streamCalls, [
      { path: "/media/video.mp4", start: 0, end: video.length },
    ]);
  });

  test("handles GET, HEAD, 206 and 416 with exact Content-Length and Content-Range", async () => {
    const size = video.length;
    const partial: Array<[string, number, number]> = [
      ["bytes=0-0", 0, 0],
      ["bytes=0-1023", 0, 1023],
      ["bytes=1000-1999", 1000, 1999],
      ["bytes=3000000-", 3000000, size - 1],
      ["bytes=-1", size - 1, size - 1],
      ["bytes=-4096", size - 4096, size - 1],
      [`bytes=-${size + 10}`, 0, size - 1],
      [`bytes=${size - 10}-${size + 1000}`, size - 10, size - 1],
      ["  bytes = 5 - 9 ", 5, 9],
    ];
    for (const [range, start, end] of partial) {
      const callsBefore = stats.streamCalls.length;
      const response = await get(server, "/serve", { headers: { range } });
      assert.equal(response.status, 206, range);
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${size}`, range);
      assert.equal(response.headers.get("content-length"), String(end - start + 1), range);
      assert.equal(response.headers.get("accept-ranges"), "bytes", range);
      assert.equal(response.headers.get("cache-control"), "private, no-store", range);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(Buffer.compare(body, video.subarray(start, end + 1)), 0, range);
      // Only the requested range is read from disk.
      assert.deepEqual(stats.streamCalls.slice(callsBefore), [
        { path: "/media/video.mp4", start, end: end + 1 },
      ], range);
    }

    for (const range of [`bytes=${size}-`, `bytes=${size + 5}-${size + 10}`, "bytes=-0"]) {
      const response = await get(server, "/serve", { headers: { range } });
      assert.equal(response.status, 416, range);
      assert.equal(response.headers.get("content-range"), `bytes */${size}`, range);
      assert.equal((await response.arrayBuffer()).byteLength, 0, range);
    }

    // Invalid, multi-range, other units, and If-Range are served in full.
    const fullContentHeaders: Array<Record<string, string>> = [
      { range: "bytes=10-5" },
      { range: "bytes=0-1,5-6" },
      { range: "items=0-1" },
      { range: "bytes=abc" },
      { range: "bytes=0-10", "if-range": "\"etag\"" },
    ];
    for (const headers of fullContentHeaders) {
      const response = await get(server, "/serve", { headers });
      assert.equal(response.status, 200, JSON.stringify(headers));
      assert.equal(response.headers.get("content-length"), String(size));
      assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), video), 0);
    }

    const callsBeforeHead = stats.streamCalls.length;
    const headRequestHeaders: Array<Record<string, string>> = [{}, { range: "bytes=0-10" }];
    for (const headers of headRequestHeaders) {
      const head = await get(server, "/serve", { method: "HEAD", headers });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-length"), String(size));
      assert.equal(head.headers.get("content-range"), null);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    assert.equal(stats.streamCalls.length, callsBeforeHead, "HEAD never reads the file");

    const emptyResponse = await get(server, "/serve?name=empty.bin");
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.headers.get("content-length"), "0");
    assert.equal((await emptyResponse.arrayBuffer()).byteLength, 0);
    const emptyRange = await get(server, "/serve?name=empty.bin", { headers: { range: "bytes=0-" } });
    assert.equal(emptyRange.status, 416);
    assert.equal(emptyRange.headers.get("content-range"), "bytes */0");
  });

  test("streams slow and simultaneous responses correctly", async () => {
    const size = video.length;
    const ranges: Array<[number, number]> = [
      [0, size],
      [0, 256 * 1024],
      [123_456, 2_000_000],
      [size - 777_777, size],
      [1, 2],
      [0, size],
    ];

    const results = await Promise.all(ranges.map(async ([start, end], index) => {
      const response = await get(server, `/slice?start=${start}&end=${end}`);
      const reader = response.body!.getReader();
      const chunks: Buffer[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        if (index === 0) {
          // A slow client.
          await delay(2);
        }
      }
      return { start, end, body: Buffer.concat(chunks) };
    }));

    for (const { start, end, body } of results) {
      assert.equal(body.length, end - start);
      assert.equal(Buffer.compare(body, video.subarray(start, end)), 0, `${start}-${end}`);
    }
    await waitFor(() => stats.openStreams === 0, "file streams to close");
  });

  test("cancelling a response releases the host file stream and descriptor", async () => {
    await (await get(server, "/serve", { headers: { range: "bytes=0-0" } })).arrayBuffer();
    const fdBaseline = supportsProcFd ? openFdCount() : 0;

    const response = await get(server, "/raw");
    assert.equal(stats.openStreams, 0, "the body is not opened until it is read");
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.equal(stats.openStreams, 1);
    await reader.cancel();
    await waitFor(() => stats.openStreams === 0, "cancelled stream to close");
    if (supportsProcFd) {
      await waitFor(() => openFdCount() <= fdBaseline, "file descriptor to close");
    }

    const unused = await get(server, "/raw");
    await unused.body?.cancel();
    assert.equal(stats.openStreams, 0);
    assert.equal((await server.diagnostics()).runtime.streamCount, 0);
  });

  test("a response that is being served survives a runtime reload", async () => {
    const response = await get(server, "/raw");
    const reader = response.body!.getReader();
    const chunks: Buffer[] = [];
    const first = await reader.read();
    chunks.push(Buffer.from(first.value!));

    await server.reload("reload while streaming");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    assert.equal(Buffer.compare(Buffer.concat(chunks), video), 0);
  });

  test("a body produced by JS fails instead of ending early when the runtime is reloaded", async () => {
    const size = fs.statSync(path.join(rootA, "media", "big.bin")).size;
    const reloadable = await createServer(createInstrumentedFiles(rootA).files);
    const response = await get(reloadable, "/transform?name=big.bin");
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    let received = first.value!.byteLength;

    // The transform runs in the runtime, so it cannot outlive it.
    await reloadable.reload("reload while a JS-produced body is streaming");

    await assert.rejects(async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
      }
    });
    assert.ok(received < size, `received ${received} of ${size} bytes`);
  });

  test("files consumed or transformed in JS are streamed in bounded chunks", async () => {
    const readFileCallsBefore = stats.readFileCalls;
    const callsBefore = stats.streamCalls.length;
    const response = await get(server, "/transform");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, video.length);
    for (const offset of [0, 1, 262143, 262144, 1048577, video.length - 1]) {
      assert.equal(body[offset], video[offset]! ^ 0xff, `offset ${offset}`);
    }
    assert.equal(stats.readFileCalls, readFileCallsBefore);
    const chunkReads = stats.streamCalls.slice(callsBefore);
    assert.ok(chunkReads.length > 1);
    assert.ok(chunkReads.every(({ start, end }) => end - start <= 256 * 1024));

    const slice = await get(server, "/slice-bytes?start=2000000&end=2000016");
    assert.deepEqual(await slice.json(), Array.from(video.subarray(2000000, 2000016)));
  });

  test("used, locked, cloned, and partially read bodies follow defined semantics", async () => {
    await assert.rejects(get(server, "/consumed"), /already been used/);
    await assert.rejects(get(server, "/locked"), /locked/);

    const cloned = await get(server, "/clone");
    assert.equal(Buffer.compare(Buffer.from(await cloned.arrayBuffer()), video), 0);

    const accessed = await get(server, "/body-accessed");
    assert.equal(Buffer.compare(Buffer.from(await accessed.arrayBuffer()), video), 0);

    // A body that JS has partially read is never served from the original file.
    recorded.length = 0;
    const partial = await get(server, "/partial-read");
    const consumed = Number(recorded[0]);
    assert.ok(consumed > 0);
    const remainder = Buffer.from(await partial.arrayBuffer());
    assert.equal(remainder.length, video.length - consumed);
    assert.equal(Buffer.compare(remainder, video.subarray(consumed)), 0);
  });

  test("ordinary in-memory and composed Blob/File responses keep working", async () => {
    const blobResponse = await get(server, "/memory-blob");
    assert.equal(blobResponse.headers.get("content-type"), "text/plain");
    assert.equal(blobResponse.headers.get("content-length"), "11");
    assert.equal(await blobResponse.text(), "hello world");

    const fileResponse = await get(server, "/memory-file");
    assert.equal(fileResponse.headers.get("content-type"), "application/x-test");
    assert.deepEqual(Array.from(new Uint8Array(await fileResponse.arrayBuffer())), [1, 2, 3]);

    const composed = await get(server, "/composed");
    assert.deepEqual(
      Array.from(new Uint8Array(await composed.arrayBuffer())),
      [60, ...video.subarray(0, 3), 33, 62],
    );

    const fromResponse = await get(server, "/blob-from-response");
    assert.equal(Buffer.compare(Buffer.from(await fromResponse.arrayBuffer()), video.subarray(10, 20)), 0);
  });

  test("files replaced after they were opened fail predictably", async () => {
    await assert.rejects(get(server, "/stale?name=stale.bin"), (error: Error) => {
      assert.match(`${error.name} ${error.message}`, /NotReadableError|changed/);
      return true;
    });
    const read = await get(server, "/stale-read?name=stale.bin");
    assert.equal(await read.text(), "NotReadableError");
  });

  test("enforces materialization and open-stream limits", async () => {
    const limited = await createServer(createInstrumentedFiles(rootA).files, { memoryLimitMB: 16 });
    const response = await get(limited, "/read-all?name=big.bin");
    assert.equal(response.status, 500);
    const { error } = await response.json() as { error: { name: string; message: string } };
    assert.equal(error.name, "RangeError");
    assert.match(error.message, /limit/);

    const readers = await get(server, "/open-readers?count=70");
    const result = await readers.json() as { opened: number; failure: { name: string; message: string } | null };
    assert.equal(result.opened, 64);
    assert.equal(result.failure?.name, "RangeError");
    assert.match(result.failure?.message ?? "", /Too many open file streams/);
  });

  test("another runtime cannot use a file opened by this runtime", async () => {
    const otherServer = await createServer(createInstrumentedFiles(rootB).files);
    sharedId = undefined;
    assert.equal(await (await get(server, "/share-id")).text(), "shared");
    assert.equal(typeof sharedId, "number");

    const response = await get(otherServer, `/use-id?id=${sharedId}`);
    const result = await response.json() as { size: number; name: string; response: string; read: string };
    assert.equal(result.size, 0);
    assert.equal(result.name, "");
    assert.equal(result.response, "TypeError");
    assert.match(result.read, /Invalid Blob/);
  });

  test("response headers cannot forge file bodies", async () => {
    const response = await get(server, "/forged-header");
    assert.equal(await response.text(), "plain body");
  });

  test("a namespaced runtime reused with other bindings cannot read files opened earlier", async () => {
    const key = createTestId("file-capability-namespace");
    const reports: unknown[] = [];
    const tools = {
      report: async (...args: unknown[]) => {
        reports.push(args[0]);
      },
    };

    const first = await host.getNamespacedRuntime(key, {
      bindings: { files: createFileBindings({ root: rootA }), tools },
    });
    await first.eval(`
      const media = await getDirectory("/media");
      globalThis.keptFile = await (await media.getFileHandle("video.mp4")).getFile();
      await report(Array.from(await globalThis.keptFile.slice(0, 4).bytes()));
    `);
    await first.dispose();

    const second = await host.getNamespacedRuntime(key, {
      bindings: { files: createFileBindings({ root: rootB }), tools },
    });
    try {
      await second.eval(`
        try {
          await globalThis.keptFile.slice(0, 4).bytes();
          await report("read");
        } catch (error) {
          await report(error.name);
        }
      `);
    } finally {
      await second.dispose({ hard: true });
    }

    assert.deepEqual(reports, [Array.from(video.subarray(0, 4)), "NotAllowedError"]);
  });

  test("direct file responses do not copy the file contents over daemon IPC", async () => {
    const connection = await connect({ socket: socketPath, timeout: 15_000 });
    const instrumented = createInstrumentedFiles(rootA);
    const direct = await createAppServerAdapter(async () => connection, {
      key: createTestId("file-streaming-ipc"),
      entry: "/server.ts",
      memoryLimitMB: 32,
      bindings: {
        files: instrumented.files,
        modules: createModuleResolver().virtual("/server.ts", SERVER_CODE),
      },
    });

    try {
      const request = (pathname: string) => new Request(`http://files.test${pathname}`, {
        headers: { "x-user": "allowed" },
      });
      // Warm up module loading so only request traffic is measured.
      await (expectResponse(await direct.handle(request("/memory-blob")))).text();

      const before = __unstableGetConnectionTrafficForTests(connection)!;
      const response = expectResponse(await direct.handle(request("/serve")));
      const body = Buffer.from(await response.arrayBuffer());
      const afterFastPath = __unstableGetConnectionTrafficForTests(connection)!;
      assert.equal(Buffer.compare(body, video), 0);
      const fastPathBytes =
        afterFastPath.bytesRead - before.bytesRead + afterFastPath.bytesWritten - before.bytesWritten;
      assert.ok(fastPathBytes < 16 * 1024, `fast path moved ${fastPathBytes} bytes over IPC`);

      // Sanity check: a JS-transformed body does travel over IPC.
      const transformed = expectResponse(await direct.handle(request("/transform")));
      await transformed.arrayBuffer();
      const afterTransform = __unstableGetConnectionTrafficForTests(connection)!;
      assert.ok(afterTransform.bytesRead - afterFastPath.bytesRead > video.length);
    } finally {
      await direct.dispose({ hard: true, reason: "test cleanup" });
      await connection.close();
    }
  });
});
