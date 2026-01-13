import { test, describe } from "node:test";
import assert from "node:assert";
import {
  createStreamStateRegistry,
  HIGH_WATER_MARK,
  MAX_QUEUE_CHUNKS,
} from "./stream-state.ts";

describe("StreamStateRegistry", () => {
  test("create returns unique IDs", () => {
    const registry = createStreamStateRegistry();
    const id1 = registry.create();
    const id2 = registry.create();
    expect(id1).not.toBe(id2);
  });

  test("create starts from 1", () => {
    const registry = createStreamStateRegistry();
    const id = registry.create();
    assert.strictEqual(id, 1);
  });

  test("get returns stream state after create", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();
    const state = registry.get(streamId);

    assert.notStrictEqual(state, undefined);
    assert.deepStrictEqual(state?.queue, []);
    assert.strictEqual(state?.queueSize, 0);
    assert.strictEqual(state?.closed, false);
    assert.strictEqual(state?.errored, false);
    assert.strictEqual(state?.pullWaiting, false);
  });

  test("get returns undefined for non-existent stream", () => {
    const registry = createStreamStateRegistry();
    const state = registry.get(999);
    assert.strictEqual(state, undefined);
  });

  test("push and pull work synchronously when data available", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array([1, 2, 3]));
    const result = await registry.pull(streamId);

    assert.strictEqual(result.done, false);
    if (!result.done) {
      assert.deepStrictEqual(result.value, new Uint8Array([1, 2, 3]));
    }
  });

  test("push returns true on success", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const result = registry.push(streamId, new Uint8Array([1, 2, 3]));
    assert.strictEqual(result, true);
  });

  test("push returns false for non-existent stream", () => {
    const registry = createStreamStateRegistry();
    const result = registry.push(999, new Uint8Array([1, 2, 3]));
    assert.strictEqual(result, false);
  });

  test("push returns false for closed stream", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.close(streamId);
    const result = registry.push(streamId, new Uint8Array([1, 2, 3]));
    assert.strictEqual(result, false);
  });

  test("push returns false for errored stream", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.error(streamId, new Error("test error"));
    const result = registry.push(streamId, new Uint8Array([1, 2, 3]));
    assert.strictEqual(result, false);
  });

  test("pull waits for data when queue empty", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    // Start pull (will wait)
    const pullPromise = registry.pull(streamId);

    // Push after delay
    setTimeout(() => {
      registry.push(streamId, new Uint8Array([4, 5, 6]));
    }, 10);

    const result = await pullPromise;
    assert.strictEqual(result.done, false);
    if (!result.done) {
      assert.deepStrictEqual(result.value, new Uint8Array([4, 5, 6]));
    }
  });

  test("push delivers directly to waiting pull", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    // Start pull (will wait)
    const pullPromise = registry.pull(streamId);

    // Verify pull is waiting
    const state = registry.get(streamId);
    assert.strictEqual(state?.pullWaiting, true);

    // Push should deliver directly
    registry.push(streamId, new Uint8Array([7, 8, 9]));

    // Queue should still be empty (delivered directly)
    assert.strictEqual(state?.queue.length, 0);
    assert.strictEqual(state?.pullWaiting, false);

    const result = await pullPromise;
    assert.strictEqual(result.done, false);
    if (!result.done) {
      assert.deepStrictEqual(result.value, new Uint8Array([7, 8, 9]));
    }
  });

  test("multiple chunks can be queued and pulled in order", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array([1]));
    registry.push(streamId, new Uint8Array([2]));
    registry.push(streamId, new Uint8Array([3]));

    const result1 = await registry.pull(streamId);
    const result2 = await registry.pull(streamId);
    const result3 = await registry.pull(streamId);

    assert.strictEqual(result1.done, false);
    assert.strictEqual(result2.done, false);
    assert.strictEqual(result3.done, false);

    if (!result1.done && !result2.done && !result3.done) {
      assert.deepStrictEqual(result1.value, new Uint8Array([1]));
      assert.deepStrictEqual(result2.value, new Uint8Array([2]));
      assert.deepStrictEqual(result3.value, new Uint8Array([3]));
    }
  });

  test("close resolves waiting pull with done", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const pullPromise = registry.pull(streamId);
    registry.close(streamId);

    const result = await pullPromise;
    assert.strictEqual(result.done, true);
  });

  test("pull returns done after close when queue empty", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.close(streamId);

    const result = await registry.pull(streamId);
    assert.strictEqual(result.done, true);
  });

  test("pull returns queued data before done after close", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array([1, 2, 3]));
    registry.close(streamId);

    // First pull gets the data
    const result1 = await registry.pull(streamId);
    assert.strictEqual(result1.done, false);
    if (!result1.done) {
      assert.deepStrictEqual(result1.value, new Uint8Array([1, 2, 3]));
    }

    // Second pull gets done
    const result2 = await registry.pull(streamId);
    assert.strictEqual(result2.done, true);
  });

  test("error rejects waiting pull", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const pullPromise = registry.pull(streamId);
    registry.error(streamId, new Error("test error"));

    await assert.rejects(pullPromise, { message: "test error" });
  });

  test("pull throws for errored stream", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.error(streamId, new Error("test error"));

    await assert.rejects(registry.pull(streamId), { message: "test error" });
  });

  test("pull returns done for non-existent stream", async () => {
    const registry = createStreamStateRegistry();
    const result = await registry.pull(999);
    assert.strictEqual(result.done, true);
  });

  test("isQueueFull returns false initially", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    assert.strictEqual(registry.isQueueFull(streamId), false);
  });

  test("isQueueFull returns true for non-existent stream", () => {
    const registry = createStreamStateRegistry();
    assert.strictEqual(registry.isQueueFull(999), true);
  });

  test("isQueueFull respects high water mark", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    assert.strictEqual(registry.isQueueFull(streamId), false);

    // Push chunk at high water mark
    registry.push(streamId, new Uint8Array(HIGH_WATER_MARK));
    assert.strictEqual(registry.isQueueFull(streamId), true);
  });

  test("isQueueFull respects max queue chunks", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    // Push small chunks up to MAX_QUEUE_CHUNKS
    for (let i = 0; i < MAX_QUEUE_CHUNKS; i++) {
      registry.push(streamId, new Uint8Array([i]));
    }

    assert.strictEqual(registry.isQueueFull(streamId), true);
  });

  test("queueSize tracks total bytes correctly", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array(100));
    registry.push(streamId, new Uint8Array(200));

    const state = registry.get(streamId);
    assert.strictEqual(state?.queueSize, 300);
  });

  test("queueSize decreases on pull", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.push(streamId, new Uint8Array(100));
    registry.push(streamId, new Uint8Array(200));

    await registry.pull(streamId);

    const state = registry.get(streamId);
    assert.strictEqual(state?.queueSize, 200);
  });

  test("delete removes stream state", () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    registry.delete(streamId);

    const state = registry.get(streamId);
    assert.strictEqual(state, undefined);
  });

  test("delete rejects waiting pull", async () => {
    const registry = createStreamStateRegistry();
    const streamId = registry.create();

    const pullPromise = registry.pull(streamId);
    registry.delete(streamId);

    await assert.rejects(pullPromise, { message: "Stream deleted" });
  });

  test("clear removes all streams", () => {
    const registry = createStreamStateRegistry();
    const id1 = registry.create();
    const id2 = registry.create();
    const id3 = registry.create();

    registry.clear();

    assert.strictEqual(registry.get(id1), undefined);
    assert.strictEqual(registry.get(id2), undefined);
    assert.strictEqual(registry.get(id3), undefined);
  });

  test("clear rejects all waiting pulls", async () => {
    const registry = createStreamStateRegistry();
    const id1 = registry.create();
    const id2 = registry.create();

    const pull1 = registry.pull(id1);
    const pull2 = registry.pull(id2);

    registry.clear();

    await assert.rejects(pull1, { message: "Stream deleted" });
    await assert.rejects(pull2, { message: "Stream deleted" });
  });
});

// Test that we correctly use assert.notStrictEqual to fix the first test
function expect(value: unknown) {
  return {
    not: {
      toBe(other: unknown) {
        assert.notStrictEqual(value, other);
      },
    },
    toBe(other: unknown) {
      assert.strictEqual(value, other);
    },
  };
}
