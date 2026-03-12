import { describe, it } from "node:test";
import assert from "node:assert";
import { serializeResponse, deserializeResponse } from "./serialization.ts";
import type { SerializedResponse } from "./types.ts";

describe("response serialization", () => {
  it("strips body for null-body status codes during serialization", async () => {
    const bodyBytes = new TextEncoder().encode("invalid-body");
    const headers = new Headers({
      "content-type": "text/plain",
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bodyBytes);
        controller.close();
      },
    });

    const nonCompliantResponse = {
      status: 204,
      statusText: "No Content",
      headers,
      body,
      arrayBuffer: async () =>
        bodyBytes.buffer.slice(
          bodyBytes.byteOffset,
          bodyBytes.byteOffset + bodyBytes.byteLength
        ),
    } as unknown as Response;

    const serialized = await serializeResponse(nonCompliantResponse);
    assert.strictEqual(serialized.status, 204);
    assert.strictEqual(serialized.body, null);
  });

  it("ignores serialized body for null-body status codes during deserialization", async () => {
    const serialized: SerializedResponse = {
      status: 204,
      statusText: "No Content",
      headers: [["content-type", "text/plain"]],
      body: new Uint8Array([1, 2, 3]),
    };

    const response = deserializeResponse(serialized);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.body, null);
    assert.strictEqual(await response.text(), "");
  });
});
