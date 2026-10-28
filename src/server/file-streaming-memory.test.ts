/**
 * Bounded-memory acceptance test for disk-backed file responses.
 *
 * Serves a file eight times larger than the isolate heap through a dedicated
 * daemon process, with simultaneous and slow clients, and measures the peak
 * resident memory of every process involved (the test/host process that owns
 * the disk and the daemon that runs the isolate). Peaks are measured precisely
 * with /proc/<pid>/status VmHWM after resetting them via /proc/<pid>/clear_refs,
 * so the test only runs on Linux.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFileBindings, createModuleResolver } from "../index.ts";
import { connect, type DaemonConnection } from "../internal/client/index.ts";
import { __unstableGetConnectionTrafficForTests } from "../internal/client/connection.ts";
import { createAppServerAdapter } from "./app-server.ts";
import { createTestId, expectResponse } from "../testing/integration-helpers.ts";
import type { AppServer } from "../types.ts";

const MiB = 1024 * 1024;
const FILE_SIZE = 256 * MiB;
const ISOLATE_MEMORY_LIMIT_MB = 32;
const PATTERN_PERIOD = 256;

// Peak RSS bounds. Chunk buffers become garbage as soon as they are consumed,
// but V8 collects external memory lazily, so peaks include some uncollected
// garbage (observed: host <= ~40 MiB while serving 4 x 256 MiB at once). Every
// bound stays far below the size of a single file, let alone the data served.
const HOST_PEAK_LIMIT = 96 * MiB;
const DAEMON_PASSTHROUGH_PEAK_LIMIT = 16 * MiB;
const TRANSFORM_PEAK_LIMIT = 64 * MiB;

function canMeasurePeaks(): boolean {
  if (process.platform !== "linux") return false;
  try {
    fs.writeFileSync("/proc/self/clear_refs", "5");
    return /VmHWM:/.test(fs.readFileSync("/proc/self/status", "utf8"));
  } catch {
    return false;
  }
}

const measurable = canMeasurePeaks();

function readStatusKb(pid: number, field: "VmHWM" | "VmRSS"): number {
  const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
  const match = new RegExp(`${field}:\\s+(\\d+) kB`).exec(status);
  assert.ok(match, `${field} missing for ${pid}`);
  return Number(match[1]);
}

/** Reset the peak RSS of the given processes and return their current RSS (bytes). */
function resetPeaks(pids: number[]): Map<number, number> {
  const baseline = new Map<number, number>();
  for (const pid of pids) {
    fs.writeFileSync(`/proc/${pid}/clear_refs`, "5");
    baseline.set(pid, readStatusKb(pid, "VmRSS") * 1024);
  }
  return baseline;
}

/** Peak RSS growth (bytes) since `resetPeaks()`. */
function peakGrowth(baseline: Map<number, number>): Map<number, number> {
  const growth = new Map<number, number>();
  for (const [pid, rss] of baseline) {
    growth.set(pid, readStatusKb(pid, "VmHWM") * 1024 - rss);
  }
  return growth;
}

function patternChunk(length: number, offset = 0): Buffer {
  const chunk = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    chunk[index] = ((offset + index) * 31 + 11) & 0xff;
  }
  return chunk;
}

function expectedSha256(start: number, end: number, transform?: (chunk: Buffer) => Buffer): string {
  const hash = createHash("sha256");
  const block = patternChunk(MiB);
  let position = start;
  while (position < end) {
    const length = Math.min(MiB, end - position);
    const phase = position % PATTERN_PERIOD;
    let chunk: Buffer = Buffer.concat([block.subarray(phase), block.subarray(0, phase)]).subarray(0, length);
    if (transform) chunk = transform(Buffer.from(chunk));
    hash.update(chunk);
    position += length;
  }
  return hash.digest("hex");
}

async function hashBody(response: Response, slow = false): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  let chunks = 0;
  const reader = response.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    bytes += value.byteLength;
    chunks += 1;
    if (slow && chunks <= 400) {
      // A slow client: the server must not buffer ahead of it.
      await delay(1);
    }
  }
  return { sha256: hash.digest("hex"), bytes };
}

const SERVER_CODE = `
  serve({
    async fetch(request) {
      const url = new URL(request.url);
      const media = await getDirectory("/media");
      const file = await (await media.getFileHandle("large.bin")).getFile();
      if (url.pathname === "/transform") {
        const end = Number(url.searchParams.get("end"));
        return new Response(file.slice(0, end).stream().pipeThrough(new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk.map((byte) => byte ^ 0x5a));
          },
        })));
      }
      return serveFile(request, file);
    },
  });
`;

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(socketPath)) {
    if (Date.now() > deadline) {
      throw new Error(`Daemon socket ${socketPath} did not appear`);
    }
    await delay(50);
  }
  await delay(100);
}

describe("disk-backed file responses use bounded memory in every process", { skip: !measurable, timeout: 180_000 }, () => {
  let tempRoot: string;
  let socketPath: string;
  let daemon: ChildProcess;
  let connection: DaemonConnection;
  let server: AppServer;

  const request = (pathname: string, headers: Record<string, string> = {}) =>
    new Request(`http://memory.test${pathname}`, { headers });

  before(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-file-memory-"));
    fs.mkdirSync(path.join(tempRoot, "media"));
    const block = patternChunk(MiB);
    const fd = fs.openSync(path.join(tempRoot, "media", "large.bin"), "w");
    for (let written = 0; written < FILE_SIZE; written += MiB) {
      fs.writeSync(fd, block);
    }
    fs.closeSync(fd);

    socketPath = path.join("/tmp", `isolate-file-memory-${process.pid}-${Date.now()}.sock`);
    daemon = spawn(
      process.execPath,
      ["--experimental-strip-types", path.resolve(import.meta.dirname, "../daemon.ts"), "--socket", socketPath],
      {
        cwd: path.resolve(import.meta.dirname, "../.."),
        stdio: ["ignore", "ignore", "inherit"],
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    await waitForSocket(socketPath, 15_000);

    connection = await connect({ socket: socketPath, timeout: 15_000 });
    server = await createAppServerAdapter(async () => connection, {
      key: createTestId("file-memory"),
      entry: "/server.ts",
      memoryLimitMB: ISOLATE_MEMORY_LIMIT_MB,
      bindings: {
        files: createFileBindings({ root: tempRoot }),
        modules: createModuleResolver().virtual("/server.ts", SERVER_CODE),
      },
    });

    // Warm up both processes (module loading, allocator pools, stream code).
    for (let index = 0; index < 3; index += 1) {
      await hashBody(expectResponse(await server.handle(request("/", { range: `bytes=0-${16 * MiB - 1}` }))));
      await hashBody(expectResponse(await server.handle(request(`/transform?end=${4 * MiB}`))));
    }
  });

  after(async () => {
    // Every step is bounded so a failed test cannot keep the run alive.
    const settle = (promise: Promise<unknown> | undefined) =>
      Promise.race([Promise.resolve(promise).catch(() => {}), delay(10_000)]);
    await settle(server?.dispose({ hard: true, reason: "test cleanup" }));
    await settle(connection?.close());
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      const exited = new Promise((resolve) => daemon.once("exit", resolve));
      daemon.kill("SIGTERM");
      await Promise.race([exited, delay(5_000)]);
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
    }
    fs.rmSync(socketPath, { force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("simultaneous and slow full-file responses stream from the host without buffering", async (t) => {
    const pids = [process.pid, daemon.pid!];
    const baseline = resetPeaks(pids);
    const trafficBefore = __unstableGetConnectionTrafficForTests(connection)!;

    const responses = await Promise.all(
      [0, 1, 2, 3].map(async () => expectResponse(await server.handle(request("/")))),
    );
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-length"), String(FILE_SIZE));
    }
    const results = await Promise.all(responses.map((response, index) => hashBody(response, index === 0)));

    const growth = peakGrowth(baseline);
    const trafficAfter = __unstableGetConnectionTrafficForTests(connection)!;
    const ipcBytes =
      trafficAfter.bytesRead - trafficBefore.bytesRead +
      trafficAfter.bytesWritten - trafficBefore.bytesWritten;

    const expected = expectedSha256(0, FILE_SIZE);
    for (const result of results) {
      assert.equal(result.bytes, FILE_SIZE);
      assert.equal(result.sha256, expected);
    }

    const hostGrowth = growth.get(process.pid)!;
    const daemonGrowth = growth.get(daemon.pid!)!;
    t.diagnostic(
      `served ${(4 * FILE_SIZE) / MiB} MiB with a ${ISOLATE_MEMORY_LIMIT_MB} MiB isolate; ` +
        `peak RSS growth host=${(hostGrowth / MiB).toFixed(1)} MiB daemon=${(daemonGrowth / MiB).toFixed(1)} MiB; ` +
        `IPC ${ipcBytes} bytes`,
    );

    // The daemon never touches the bytes, and the host only holds a few chunks per stream.
    assert.ok(daemonGrowth < DAEMON_PASSTHROUGH_PEAK_LIMIT, `daemon peak grew by ${daemonGrowth} bytes`);
    assert.ok(hostGrowth < HOST_PEAK_LIMIT, `host peak grew by ${hostGrowth} bytes`);
    assert.ok(ipcBytes < 64 * 1024, `fast path moved ${ipcBytes} bytes over IPC`);
  });

  test("simultaneous range requests read only their ranges with bounded memory", async (t) => {
    const pids = [process.pid, daemon.pid!];
    const baseline = resetPeaks(pids);

    const ranges: Array<[number, number]> = Array.from({ length: 8 }, (_, index) => {
      const start = index * 31 * MiB + 12345;
      return [start, start + 8 * MiB - 1];
    });
    const results = await Promise.all(ranges.map(async ([start, end]) => {
      const response = expectResponse(await server.handle(request("/", { range: `bytes=${start}-${end}` })));
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${FILE_SIZE}`);
      return { start, end, ...(await hashBody(response)) };
    }));

    for (const { start, end, sha256, bytes } of results) {
      assert.equal(bytes, end - start + 1);
      assert.equal(sha256, expectedSha256(start, end + 1));
    }

    const growth = peakGrowth(baseline);
    t.diagnostic(
      `peak RSS growth host=${(growth.get(process.pid)! / MiB).toFixed(1)} MiB ` +
        `daemon=${(growth.get(daemon.pid!)! / MiB).toFixed(1)} MiB`,
    );
    assert.ok(growth.get(daemon.pid!)! < DAEMON_PASSTHROUGH_PEAK_LIMIT, `daemon peak grew by ${growth.get(daemon.pid!)} bytes`);
    assert.ok(growth.get(process.pid)! < HOST_PEAK_LIMIT, `host peak grew by ${growth.get(process.pid)} bytes`);
  });

  test("a file transformed in JS streams through the isolate in bounded chunks", async (t) => {
    const transformedSize = 96 * MiB;
    const pids = [process.pid, daemon.pid!];
    const baseline = resetPeaks(pids);

    const response = expectResponse(await server.handle(request(`/transform?end=${transformedSize}`)));
    const result = await hashBody(response, true);

    const growth = peakGrowth(baseline);
    assert.equal(result.bytes, transformedSize);
    assert.equal(
      result.sha256,
      expectedSha256(0, transformedSize, (chunk) => {
        for (let index = 0; index < chunk.length; index += 1) chunk[index] = chunk[index]! ^ 0x5a;
        return chunk;
      }),
    );
    t.diagnostic(
      `transformed ${transformedSize / MiB} MiB in a ${ISOLATE_MEMORY_LIMIT_MB} MiB isolate; ` +
        `peak RSS growth host=${(growth.get(process.pid)! / MiB).toFixed(1)} MiB ` +
        `daemon=${(growth.get(daemon.pid!)! / MiB).toFixed(1)} MiB`,
    );
    // The 96 MiB passes through a 32 MiB isolate one chunk at a time.
    assert.ok(growth.get(daemon.pid!)! < TRANSFORM_PEAK_LIMIT, `daemon peak grew by ${growth.get(daemon.pid!)} bytes`);
    assert.ok(growth.get(process.pid)! < TRANSFORM_PEAK_LIMIT, `host peak grew by ${growth.get(process.pid)} bytes`);

    // The isolate survived and keeps serving.
    const small = expectResponse(await server.handle(request("/", { range: "bytes=0-9" })));
    assert.equal(Buffer.compare(Buffer.from(await small.arrayBuffer()), patternChunk(10)), 0);
  });
});
