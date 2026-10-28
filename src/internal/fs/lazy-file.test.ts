/**
 * Lazy, disk-backed files in the local (in-process) runtime arrangement: the
 * isolate and the disk-owning FileSystemHandler live in the same process.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createRuntime, type RuntimeHandle } from "../runtime/index.ts";
import { createNodeFileSystemHandler } from "./index.ts";

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

async function waitForFdCount(expected: number): Promise<number> {
  const deadline = Date.now() + 3_000;
  let count = openFdCount();
  while (count > expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    count = openFdCount();
  }
  return count;
}

const SERVER_CODE = `
  const results = new Map();

  async function openMedia(name) {
    const media = await getDirectory("/media");
    const handle = await media.getFileHandle(name);
    return await handle.getFile();
  }

  serve({
    async fetch(request) {
      const url = new URL(request.url);
      const name = url.searchParams.get("name") ?? "video.mp4";
      try {
        switch (url.pathname) {
          case "/serve":
            return serveFile(request, await openMedia(name));
          case "/serve-etag":
            return serveFile(request, await openMedia(name), {
              headers: { etag: url.searchParams.get("etag") ?? '"v1"' },
            });
          case "/raw":
            return new Response(await openMedia(name));
          case "/meta": {
            const file = await openMedia(name);
            return Response.json({
              name: file.name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified,
              isFile: file instanceof File,
              isBlob: file instanceof Blob,
            });
          }
          case "/slice-text": {
            const file = await openMedia(name);
            const start = Number(url.searchParams.get("start"));
            const end = Number(url.searchParams.get("end"));
            const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
            return Response.json({ bytes: Array.from(bytes) });
          }
          case "/transform": {
            const file = await openMedia(name);
            return new Response(
              file.stream().pipeThrough(new TransformStream({
                transform(chunk, controller) {
                  controller.enqueue(chunk.map((byte) => byte ^ 0xff));
                },
              })),
            );
          }
          case "/read-all": {
            const file = await openMedia(name);
            await file.text();
            return new Response("read");
          }
          case "/hold-reader": {
            const file = await openMedia(name);
            const reader = file.stream().getReader();
            await reader.read();
            results.set("held", reader);
            return new Response("holding");
          }
          case "/open-readers": {
            const file = await openMedia(name);
            const count = Number(url.searchParams.get("count"));
            const readers = [];
            let failure = null;
            for (let index = 0; index < count; index += 1) {
              const reader = file.stream().getReader();
              try {
                await reader.read();
                readers.push(reader);
              } catch (error) {
                failure = { name: error.name, message: error.message, index };
                break;
              }
            }
            for (const reader of readers) {
              await reader.cancel();
            }
            // After cancelling, streams can be opened again.
            const again = file.stream().getReader();
            await again.read();
            await again.cancel();
            return Response.json({ opened: readers.length, failure });
          }
          case "/upload": {
            const file = await openMedia(name);
            const response = await fetch("https://uploads.test/put", {
              method: "POST",
              body: file.slice(0, 4096),
            });
            return new Response(await response.text());
          }
          default:
            return new Response("not found", { status: 404 });
        }
      } catch (error) {
        return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
      }
    },
  });
`;

describe("lazy disk-backed files (local runtime)", () => {
  let tempRoot: string;
  let root: string;
  let outside: string;
  let runtime: RuntimeHandle;
  let video: Buffer;
  const uploads: Uint8Array[] = [];

  before(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-lazy-local-"));
    root = path.join(tempRoot, "root");
    outside = path.join(tempRoot, "outside");
    fs.mkdirSync(path.join(root, "media"), { recursive: true });
    fs.mkdirSync(outside);
    // 48 MiB file in a 16 MiB isolate: any whole-file copy into V8 fails.
    video = patternBytes(48 * 1024 * 1024 + 17);
    fs.writeFileSync(path.join(root, "media", "video.mp4"), video);
    fs.writeFileSync(path.join(root, "media", "small.txt"), "hello lazy world");
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    if (process.platform !== "win32") {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "media", "escape.txt"));
    }

    runtime = await createRuntime({
      memoryLimitMB: 16,
      fs: {
        getDirectory: async (dirPath) => createNodeFileSystemHandler(path.join(root, dirPath)),
      },
      fetch: async (_url, init) => {
        uploads.push(init.rawBody ?? new Uint8Array(0));
        return new Response(`received ${init.rawBody?.byteLength ?? 0}`);
      },
    });
    await runtime.eval(SERVER_CODE);
  });

  after(async () => {
    await runtime?.dispose();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const dispatch = (pathname: string, init?: RequestInit) =>
    runtime.fetch.dispatchRequest(new Request(`http://local.test${pathname}`, init));

  test("getFile() returns lazy File metadata without reading contents", async () => {
    const response = await dispatch("/meta");
    assert.deepEqual(await response.json(), {
      name: "video.mp4",
      size: video.length,
      type: "video/mp4",
      lastModified: Math.trunc(fs.statSync(path.join(root, "media", "video.mp4")).mtimeMs),
      isFile: true,
      isBlob: true,
    });
  });

  test("serves a file 3x larger than the isolate heap with exact bytes", async () => {
    const response = await dispatch("/serve");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(video.length));
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, video.length);
    assert.equal(Buffer.compare(body, video), 0);
  });

  test("serves byte ranges, HEAD, and unsatisfiable ranges", async () => {
    const size = video.length;
    const cases: Array<[string, number, number]> = [
      ["bytes=0-99", 0, 99],
      ["bytes=1048576-", 1048576, size - 1],
      ["bytes=-512", size - 512, size - 1],
      [`bytes=${size - 5}-${size + 100}`, size - 5, size - 1],
    ];
    for (const [range, start, end] of cases) {
      const response = await dispatch("/serve", { headers: { range } });
      assert.equal(response.status, 206, range);
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${size}`, range);
      assert.equal(response.headers.get("content-length"), String(end - start + 1), range);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(Buffer.compare(body, video.subarray(start, end + 1)), 0, range);
    }

    const unsatisfiable = await dispatch("/serve", { headers: { range: `bytes=${size}-` } });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${size}`);
    assert.equal((await unsatisfiable.arrayBuffer()).byteLength, 0);

    const head = await dispatch("/serve", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(size));
    assert.equal(head.body, null);
  });

  test("If-Range honors the range only for the strong ETag supplied by the app", async () => {
    const size = video.length;
    const matching = await dispatch("/serve-etag", { headers: { range: "bytes=10-19", "if-range": '"v1"' } });
    assert.equal(matching.status, 206);
    assert.equal(matching.headers.get("etag"), '"v1"');
    assert.equal(matching.headers.get("content-range"), `bytes 10-19/${size}`);
    assert.equal(Buffer.compare(Buffer.from(await matching.arrayBuffer()), video.subarray(10, 20)), 0);

    const mismatches: Array<[string, string]> = [
      ["/serve-etag", '"v2"'],
      ["/serve-etag", 'W/"v1"'],
      ["/serve-etag", "Wed, 21 Oct 2015 07:28:00 GMT"],
      [`/serve-etag?etag=${encodeURIComponent('W/"v1"')}`, 'W/"v1"'],
      ["/serve", '"v1"'],
    ];
    for (const [pathname, ifRange] of mismatches) {
      const response = await dispatch(pathname, { headers: { range: "bytes=10-19", "if-range": ifRange } });
      assert.equal(response.status, 200, `${pathname} ${ifRange}`);
      assert.equal(response.headers.get("content-length"), String(size), `${pathname} ${ifRange}`);
      await response.body?.cancel();
    }
  });

  test("streams consumed and transformed in JS stay chunked and correct", async () => {
    const response = await dispatch("/transform");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, video.length);
    for (const offset of [0, 1, 65535, 65536, 1048577, video.length - 1]) {
      assert.equal(body[offset], video[offset]! ^ 0xff, `offset ${offset}`);
    }
  });

  test("slices are read without materializing the whole file", async () => {
    const response = await dispatch("/slice-text?start=1000000&end=1000010");
    const { bytes } = await response.json() as { bytes: number[] };
    assert.deepEqual(bytes, Array.from(video.subarray(1000000, 1000010)));
  });

  test("materializing a file larger than the limit fails predictably", async () => {
    const response = await dispatch("/read-all");
    assert.equal(response.status, 500);
    const { error } = await response.json() as { error: { name: string; message: string } };
    assert.equal(error.name, "RangeError");
    assert.match(error.message, /limit/);

    // The runtime is still usable.
    const small = await dispatch("/raw?name=small.txt");
    assert.equal(await small.text(), "hello lazy world");
  });

  test("request bodies built from disk-backed files are materialized for fetch()", async () => {
    uploads.length = 0;
    const response = await dispatch("/upload");
    assert.equal(await response.text(), "received 4096");
    assert.equal(Buffer.compare(Buffer.from(uploads[0]!), video.subarray(0, 4096)), 0);
  });

  test("files replaced after getFile() fail with NotReadableError instead of serving new content", async () => {
    fs.writeFileSync(path.join(root, "media", "swap.bin"), patternBytes(300_000, 1));
    await runtime.eval(`
      globalThis.__swapFile = await (await (await getDirectory("/media")).getFileHandle("swap.bin")).getFile();
    `);
    await new Promise((resolve) => setTimeout(resolve, 5));
    fs.writeFileSync(path.join(root, "media", "swap.next"), patternBytes(300_000, 2));
    fs.renameSync(path.join(root, "media", "swap.next"), path.join(root, "media", "swap.bin"));

    try {
      await runtime.eval(`
        serve({
          async fetch(request) {
            if (new URL(request.url).pathname === "/swap-read") {
              try {
                await globalThis.__swapFile.slice(0, 10).arrayBuffer();
                return new Response("read replaced content");
              } catch (error) {
                return new Response(error.name);
              }
            }
            return new Response(globalThis.__swapFile);
          },
        });
      `);
      assert.equal(await (await dispatch("/swap-read")).text(), "NotReadableError");
      const response = await dispatch("/");
      await assert.rejects(response.arrayBuffer(), (error: Error) => error.name === "NotReadableError");
    } finally {
      await runtime.eval(SERVER_CODE);
    }
  });

  test("symlinks that escape the root are refused", { skip: process.platform === "win32" }, async () => {
    const response = await dispatch("/raw?name=escape.txt");
    assert.equal(response.status, 500);
    const { error } = await response.json() as { error: { name: string } };
    assert.equal(error.name, "NotAllowedError");
  });

  test("limits concurrently open file streams per runtime", async () => {
    const response = await dispatch("/open-readers?count=70");
    const result = await response.json() as {
      opened: number;
      failure: { name: string; message: string; index: number } | null;
    };
    assert.equal(result.opened, 64);
    assert.equal(result.failure?.name, "RangeError");
    assert.match(result.failure?.message ?? "", /Too many open file streams/);
  });

  test("open file streams are released when the runtime is disposed", { skip: !supportsProcFd }, async () => {
    const isolated = await createRuntime({
      memoryLimitMB: 16,
      fs: {
        getDirectory: async (dirPath) => createNodeFileSystemHandler(path.join(root, dirPath)),
      },
    });
    try {
      await isolated.eval(SERVER_CODE);
      // Warm up so lazily created runtime resources do not skew the count.
      await (await isolated.fetch.dispatchRequest(new Request("http://local.test/meta"))).json();
      const baseline = openFdCount();
      const response = await isolated.fetch.dispatchRequest(new Request("http://local.test/hold-reader"));
      assert.equal(await response.text(), "holding");
      assert.equal(openFdCount(), baseline + 1, "the held stream owns one descriptor");
      await isolated.dispose();
      assert.equal(await waitForFdCount(baseline), baseline);
    } finally {
      await isolated.dispose();
    }
  });

  test("unconsumed and cancelled responses hold no descriptors", { skip: !supportsProcFd }, async () => {
    await (await dispatch("/meta")).json();
    const baseline = openFdCount();

    const unused = await dispatch("/raw");
    assert.equal(openFdCount(), baseline, "nothing is opened until the body is read");
    await unused.body?.cancel();

    const partial = await dispatch("/raw");
    const reader = partial.body!.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(await waitForFdCount(baseline), baseline);
  });
});
