import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { createFileBindings } from "./index.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "isolate-files-"));

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

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
});
