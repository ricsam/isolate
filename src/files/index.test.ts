import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { createFileBindings } from "./index.ts";
import type { FileBindings, HostCallContext } from "../types.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-files-"));
const supportsProcFd = process.platform === "linux" && fs.existsSync("/proc/self/fd");
const supportsSymlinks = process.platform !== "win32";

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function createContext(signal: AbortSignal = new AbortController().signal): HostCallContext {
  return {
    signal,
    runtimeId: "test-runtime",
    resourceId: "files-test",
    metadata: {},
  };
}

function createSandbox(label: string): { root: string; outside: string } {
  const base = fs.mkdtempSync(path.join(tempRoot, `${label}-`));
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  return { root, outside };
}

function patternBytes(size: number, seed = 0): Buffer {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    data[index] = (index * 31 + seed * 7 + 11) & 0xff;
  }
  return data;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function openFdCount(): number {
  return fs.readdirSync("/proc/self/fd").length;
}

async function waitForFdCount(expected: number): Promise<number> {
  const deadline = Date.now() + 2_000;
  let count = openFdCount();
  while (count > expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    count = openFdCount();
  }
  return count;
}

async function streamRange(
  bindings: FileBindings,
  filePath: string,
  start: number,
  end: number,
  version?: string,
): Promise<Buffer> {
  const stream = await bindings.readFileStream!(filePath, { start, end, version }, createContext());
  return await readAll(stream);
}

async function openStream(
  bindings: FileBindings,
  filePath: string,
  options: { start: number; end: number; version?: string },
  context: HostCallContext,
): Promise<ReadableStream<Uint8Array>> {
  return await bindings.readFileStream!(filePath, options, context);
}

describe("createFileBindings", () => {
  test("reads and writes files inside the configured root", async () => {
    const bindings = createFileBindings({ root: tempRoot, allowWrite: true });
    const buffer = Buffer.from("hello from isolate");

    await bindings.writeFile!("nested/message.txt", buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), {
      signal: AbortSignal.abort(),
      runtimeId: "test-runtime",
      resourceId: "write",
      metadata: {},
    });

    const readBuffer = await bindings.readFile!("nested/message.txt", {
      signal: AbortSignal.abort(),
      runtimeId: "test-runtime",
      resourceId: "read",
      metadata: {},
    });

    assert.equal(Buffer.from(readBuffer).toString("utf-8"), "hello from isolate");
  });

  test("rejects writes that escape the configured root", async () => {
    const bindings = createFileBindings({ root: tempRoot, allowWrite: true });

    await assert.rejects(
      bindings.writeFile!(
        "../escape.txt",
        new Uint8Array([1, 2, 3]).buffer,
        {
          signal: AbortSignal.abort(),
          runtimeId: "test-runtime",
          resourceId: "write",
          metadata: {},
        },
      ),
      /Access denied/,
    );
  });

  test("stat reports size, modification time, and a snapshot version for files", async () => {
    const { root } = createSandbox("stat");
    fs.writeFileSync(path.join(root, "data.bin"), patternBytes(1234));
    fs.mkdirSync(path.join(root, "dir"));
    const bindings = createFileBindings({ root });

    const fileStat = await bindings.stat!("/data.bin", createContext());
    assert.equal(fileStat.isFile, true);
    assert.equal(fileStat.isDirectory, false);
    assert.equal(fileStat.size, 1234);
    assert.equal(typeof fileStat.lastModified, "number");
    assert.equal(Math.trunc(fileStat.lastModified!), Math.trunc(fs.statSync(path.join(root, "data.bin")).mtimeMs));
    assert.match(fileStat.version ?? "", /^\d+:\d+:1234:\d+:\d+$/);

    const dirStat = await bindings.stat!("/dir", createContext());
    assert.equal(dirStat.isDirectory, true);
    assert.equal(dirStat.isFile, false);
    assert.equal(dirStat.version, undefined);
  });

  test("readFileStream returns exact byte ranges", async () => {
    const { root } = createSandbox("ranges");
    const size = 700 * 1024 + 13;
    const data = patternBytes(size);
    fs.writeFileSync(path.join(root, "big.bin"), data);
    const bindings = createFileBindings({ root });
    const { version } = await bindings.stat!("/big.bin", createContext());

    for (const [start, end] of [
      [0, size],
      [0, 1],
      [size - 1, size],
      [100, 100],
      [256 * 1024 - 3, 256 * 1024 + 5],
      [12345, 600 * 1024],
    ] as const) {
      const bytes = await streamRange(bindings, "/big.bin", start, end, version);
      assert.equal(bytes.length, end - start, `length for ${start}-${end}`);
      assert.equal(Buffer.compare(bytes, data.subarray(start, end)), 0, `bytes for ${start}-${end}`);
    }
  });

  test("readFileStream rejects invalid ranges", async () => {
    const { root } = createSandbox("invalid-ranges");
    fs.writeFileSync(path.join(root, "small.bin"), patternBytes(10));
    const bindings = createFileBindings({ root });

    for (const [start, end] of [[0, 11], [5, 4], [-1, 3], [0.5, 3]] as const) {
      await assert.rejects(
        openStream(bindings, "/small.bin", { start, end }, createContext()),
        (error: Error) => error.name === "RangeError",
        `range ${start}-${end}`,
      );
    }
  });

  test("lazy snapshots fail predictably when the file is replaced, truncated, appended, edited, or deleted", async () => {
    const { root } = createSandbox("versions");
    const bindings = createFileBindings({ root });
    const filePath = path.join(root, "media.bin");

    const mutations: Array<[string, () => void]> = [
      ["replaced", () => {
        fs.writeFileSync(path.join(root, "replacement.bin"), patternBytes(4096, 1));
        fs.renameSync(path.join(root, "replacement.bin"), filePath);
      }],
      ["truncated", () => fs.truncateSync(filePath, 100)],
      ["appended", () => fs.appendFileSync(filePath, "more")],
      ["edited in place", () => {
        const fd = fs.openSync(filePath, "r+");
        fs.writeSync(fd, Buffer.from([1, 2, 3]), 0, 3, 10);
        fs.closeSync(fd);
      }],
      ["deleted", () => fs.unlinkSync(filePath)],
    ];

    for (const [label, mutate] of mutations) {
      fs.writeFileSync(filePath, patternBytes(4096));
      const snapshot = await bindings.stat!("/media.bin", createContext());
      // Make sure the mutation lands on a different timestamp tick.
      await new Promise((resolve) => setTimeout(resolve, 5));
      mutate();

      await assert.rejects(
        openStream(bindings, 
          "/media.bin",
          { start: 0, end: snapshot.size, version: snapshot.version },
          createContext(),
        ),
        (error: Error) => error.name === "NotReadableError" || error.name === "NotFoundError",
        label,
      );
    }
  });

  test("a file modified while it is streamed errors instead of mixing contents", async () => {
    const { root } = createSandbox("mid-stream");
    const size = 1024 * 1024;
    fs.writeFileSync(path.join(root, "media.bin"), patternBytes(size));
    const bindings = createFileBindings({ root });
    const snapshot = await bindings.stat!("/media.bin", createContext());

    const stream = await bindings.readFileStream!(
      "/media.bin",
      { start: 0, end: size, version: snapshot.version },
      createContext(),
    );
    const reader = stream.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const fd = fs.openSync(path.join(root, "media.bin"), "r+");
    fs.writeSync(fd, Buffer.from([9, 9, 9]), 0, 3, size - 10);
    fs.closeSync(fd);

    await assert.rejects(
      (async () => {
        while (!(await reader.read()).done) {
          // Keep reading until the version check fails.
        }
      })(),
      (error: Error) => error.name === "NotReadableError",
    );
  });

  test("rejects lexical traversal for every operation", async () => {
    const { root } = createSandbox("traversal");
    const bindings = createFileBindings({ root, allowWrite: true });
    const context = createContext();

    await assert.rejects(bindings.stat!("../outside", context), /Access denied/);
    await assert.rejects(bindings.readFile!("/../../etc/passwd", context), /Access denied/);
    await assert.rejects(
      openStream(bindings, "../../etc/passwd", { start: 0, end: 1 }, context),
      /Access denied/,
    );
    await assert.rejects(bindings.readdir!("/..", context), /Access denied/);
    await assert.rejects(bindings.mkdir!("../made", undefined, context), /Access denied/);
    await assert.rejects(bindings.unlink!("../x", context), /Access denied/);
  });

  test("rejects symlink escapes and allows symlinks that stay inside the root", { skip: !supportsSymlinks }, async () => {
    const { root, outside } = createSandbox("symlinks");
    fs.writeFileSync(path.join(outside, "secret.txt"), "top secret");
    fs.mkdirSync(path.join(outside, "dir"));
    fs.writeFileSync(path.join(outside, "dir", "inner.txt"), "inner secret");
    fs.writeFileSync(path.join(root, "public.txt"), "public");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "secret-link.txt"));
    fs.symlinkSync(path.join(outside, "dir"), path.join(root, "dir-link"));
    fs.symlinkSync(path.join(root, "public.txt"), path.join(root, "inside-link.txt"));

    const bindings = createFileBindings({ root, allowWrite: true });
    const context = createContext();

    await assert.rejects(bindings.stat!("/secret-link.txt", context), /Access denied/);
    await assert.rejects(bindings.readFile!("/secret-link.txt", context), /Access denied/);
    await assert.rejects(
      openStream(bindings, "/secret-link.txt", { start: 0, end: 3 }, context),
      /Access denied/,
    );
    await assert.rejects(bindings.readFile!("/dir-link/inner.txt", context), /Access denied/);
    await assert.rejects(bindings.readdir!("/dir-link", context), /Access denied/);
    await assert.rejects(
      bindings.writeFile!("/dir-link/new.txt", new Uint8Array([1]).buffer, context),
      /Access denied/,
    );
    await assert.rejects(bindings.mkdir!("/dir-link/sub", { recursive: true }, context), /Access denied/);
    assert.equal(fs.existsSync(path.join(outside, "dir", "new.txt")), false);
    assert.equal(fs.existsSync(path.join(outside, "dir", "sub")), false);

    // Writing through a symlinked final component is refused, even inside the root.
    await assert.rejects(
      bindings.writeFile!("/secret-link.txt", new Uint8Array([1]).buffer, context),
      /Access denied/,
    );
    assert.equal(fs.readFileSync(path.join(outside, "secret.txt"), "utf8"), "top secret");

    // Reads through symlinks that resolve inside the root are allowed.
    const inside = await bindings.stat!("/inside-link.txt", context);
    assert.equal(inside.isFile, true);
    assert.equal(Buffer.from(await bindings.readFile!("/inside-link.txt", context)).toString(), "public");
  });

  test("a symlink swapped in after a file was opened is not followed", { skip: !supportsSymlinks }, async () => {
    const { root, outside } = createSandbox("swap");
    const content = patternBytes(2048);
    fs.writeFileSync(path.join(root, "media.bin"), content);
    fs.writeFileSync(path.join(outside, "media.bin"), content);
    const bindings = createFileBindings({ root });
    const snapshot = await bindings.stat!("/media.bin", createContext());

    fs.unlinkSync(path.join(root, "media.bin"));
    fs.symlinkSync(path.join(outside, "media.bin"), path.join(root, "media.bin"));

    await assert.rejects(
      openStream(bindings, 
        "/media.bin",
        { start: 0, end: snapshot.size, version: snapshot.version },
        createContext(),
      ),
      (error: Error) => error.name === "NotAllowedError" || error.name === "NotReadableError",
    );
  });

  test("special files are not opened as regular files", { skip: process.platform !== "linux" }, async () => {
    const { root } = createSandbox("fifo");
    execFileSync("mkfifo", [path.join(root, "pipe")]);
    const bindings = createFileBindings({ root });

    const stat = await bindings.stat!("/pipe", createContext());
    assert.equal(stat.isFile, false);
    assert.equal(stat.version, undefined);
    await assert.rejects(
      openStream(bindings, "/pipe", { start: 0, end: 0 }, createContext()),
      (error: Error) => error.name === "TypeMismatchError",
    );
    await assert.rejects(bindings.readFile!("/pipe", createContext()), (error: Error) => error.name === "TypeMismatchError");
  });

  test("error messages do not expose host paths", async () => {
    const { root } = createSandbox("messages");
    const bindings = createFileBindings({ root });

    await assert.rejects(bindings.readFile!("/missing.txt", createContext()), (error: Error) => {
      assert.equal(error.name, "NotFoundError");
      assert.equal(error.message.includes(root), false);
      assert.match(error.message, /\/missing\.txt/);
      return true;
    });
  });

  test("file streams release their descriptors on completion, cancellation, and abort", { skip: !supportsProcFd }, async () => {
    const { root } = createSandbox("fds");
    const size = 2 * 1024 * 1024;
    fs.writeFileSync(path.join(root, "media.bin"), patternBytes(size));
    const bindings = createFileBindings({ root });
    const snapshot = await bindings.stat!("/media.bin", createContext());
    const baseline = openFdCount();

    // Completed stream
    await streamRange(bindings, "/media.bin", 0, size, snapshot.version);
    assert.equal(await waitForFdCount(baseline), baseline);

    // Cancelled after one chunk
    const cancelled = await bindings.readFileStream!(
      "/media.bin",
      { start: 0, end: size, version: snapshot.version },
      createContext(),
    );
    const cancelledReader = cancelled.getReader();
    await cancelledReader.read();
    assert.equal(openFdCount(), baseline + 1);
    await cancelledReader.cancel();
    assert.equal(await waitForFdCount(baseline), baseline);

    // Aborted through the host call context signal
    const controller = new AbortController();
    const aborted = await bindings.readFileStream!(
      "/media.bin",
      { start: 0, end: size, version: snapshot.version },
      createContext(controller.signal),
    );
    const abortedReader = aborted.getReader();
    await abortedReader.read();
    controller.abort();
    await assert.rejects(abortedReader.read());
    assert.equal(await waitForFdCount(baseline), baseline);

    // Opened streams that are never read still own exactly one descriptor
    // until they are cancelled.
    const unused = await bindings.readFileStream!(
      "/media.bin",
      { start: 0, end: size, version: snapshot.version },
      createContext(),
    );
    await unused.cancel();
    assert.equal(await waitForFdCount(baseline), baseline);

    // stat() and readFile() never leave descriptors open
    await bindings.stat!("/media.bin", createContext());
    await bindings.readFile!("/media.bin", createContext());
    assert.equal(await waitForFdCount(baseline), baseline);
  });
});
