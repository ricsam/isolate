import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_FILE_CHUNK_BYTES,
  assertCapabilityRange,
  createCapabilityBodyStream,
  createFileCapabilityAuthority,
  readStreamExactly,
} from "./file-capabilities.ts";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]!);
    },
  });
}

describe("file capability tokens", () => {
  test("round-trips capabilities minted by the same authority", () => {
    const authority = createFileCapabilityAuthority();
    const token = authority.mint({
      path: "/media/video.mp4",
      size: 1234,
      version: "1:2:1234:3:4",
      lastModified: 42,
    });

    assert.deepEqual(authority.verify(token), {
      path: "/media/video.mp4",
      size: 1234,
      version: "1:2:1234:3:4",
      lastModified: 42,
    });
  });

  test("tokens are unique per mint even for the same file", () => {
    const authority = createFileCapabilityAuthority();
    const capability = { path: "/a", size: 1, lastModified: 0 };
    assert.notEqual(authority.mint(capability), authority.mint(capability));
  });

  test("rejects tokens minted by another runtime's authority", () => {
    const runtimeA = createFileCapabilityAuthority();
    const runtimeB = createFileCapabilityAuthority();
    const token = runtimeA.mint({ path: "/project-a/secret.mp4", size: 10, lastModified: 0 });

    assert.throws(() => runtimeB.verify(token), (error: Error) => error.name === "NotAllowedError");
  });

  test("rejects tampered and forged tokens", () => {
    const authority = createFileCapabilityAuthority();
    const token = authority.mint({ path: "/media/a.mp4", size: 10, lastModified: 0 });
    const [body, mac] = token.split(".");

    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 1, p: "/etc/passwd", s: 10, m: 0, ver: null, n: "x" }),
    ).toString("base64url");

    for (const candidate of [
      `${forgedPayload}.${mac}`,
      `${body}.${Buffer.from("not-a-mac").toString("base64url")}`,
      `${body}x.${mac}`,
      body,
      "",
      "a.b.c",
      42,
      null,
      { token },
    ]) {
      assert.throws(
        () => authority.verify(candidate),
        (error: Error) => error.name === "NotAllowedError",
        `candidate ${JSON.stringify(candidate)}`,
      );
    }
  });

  test("validates ranges against the capability size and chunk limits", () => {
    const capability = { path: "/a", size: 100, lastModified: 0 };
    assert.deepEqual(assertCapabilityRange(capability, 0, 100), { start: 0, end: 100 });
    assert.deepEqual(assertCapabilityRange(capability, 50, 50), { start: 50, end: 50 });
    for (const [start, end] of [[0, 101], [10, 5], [-1, 5], [0.5, 2], ["0", 2]] as const) {
      assert.throws(() => assertCapabilityRange(capability, start, end), RangeError);
    }

    const big = { path: "/big", size: MAX_FILE_CHUNK_BYTES * 2, lastModified: 0 };
    assert.throws(
      () => assertCapabilityRange(big, 0, MAX_FILE_CHUNK_BYTES + 1, MAX_FILE_CHUNK_BYTES),
      RangeError,
    );
  });

  test("readStreamExactly rejects short and long streams", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    assert.deepEqual(
      Array.from(await readStreamExactly(streamOf([bytes.subarray(0, 2), bytes.subarray(2)]), 4, "/a")),
      [1, 2, 3, 4],
    );
    await assert.rejects(
      readStreamExactly(streamOf([bytes.subarray(0, 3)]), 4, "/a"),
      (error: Error) => error.name === "NotReadableError",
    );
    await assert.rejects(
      readStreamExactly(streamOf([bytes, bytes]), 4, "/a"),
      (error: Error) => error.name === "NotReadableError",
    );
  });

  test("capability body streams open lazily and cancel the binding stream", async () => {
    let opened = 0;
    let cancelled = 0;
    const capability = { path: "/a", size: 6, lastModified: 0 };
    const body = createCapabilityBodyStream(
      () => {
        opened += 1;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
          },
          cancel() {
            cancelled += 1;
          },
        });
      },
      capability,
      { start: 0, end: 6 },
      {},
    );

    assert.equal(opened, 0, "nothing is opened before the body is read");
    const reader = body.getReader();
    const first = await reader.read();
    assert.deepEqual(Array.from(first.value!), [1, 2, 3]);
    assert.equal(opened, 1);
    await reader.cancel();
    assert.equal(cancelled, 1);
  });

  test("capability body streams error when the binding returns too many bytes", async () => {
    const body = createCapabilityBodyStream(
      () => streamOf([new Uint8Array(4), new Uint8Array(4)]),
      { path: "/a", size: 6, lastModified: 0 },
      { start: 0, end: 6 },
      {},
    );
    await assert.rejects(new Response(body).arrayBuffer(), (error: Error) => error.name === "NotReadableError");
  });
});
