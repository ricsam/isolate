/**
 * Backpressure and error propagation of the isolate's WHATWG streams:
 * piping through a TransformStream must only read as fast as the consumer,
 * so large (for example disk-backed) sources stream with bounded memory.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import ivm from "@ricsam/isolated-vm";
import { setupCore, type CoreHandle } from "./index.ts";

describe("isolate streams", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let core: CoreHandle;

  before(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    core = await setupCore(context);
  });

  after(() => {
    core.dispose();
    context.release();
    isolate.dispose();
  });

  async function run<T>(body: string): Promise<T> {
    const json = await context.eval(
      `(async () => JSON.stringify(await (async () => { ${body} })()))()`,
      { promise: true },
    );
    return JSON.parse(json as string) as T;
  }

  test("pipeThrough reads the source only as fast as the consumer reads", async () => {
    const result = await run<{ values: number[]; pullsAfterRead: number[] }>(`
      let pulls = 0;
      const source = new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls > 100) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array([pulls]));
        },
      });
      const reader = source
        .pipeThrough(new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk.map((byte) => byte * 2));
          },
        }))
        .getReader();

      const values = [];
      const pullsAfterRead = [];
      for (let index = 0; index < 5; index += 1) {
        const { value } = await reader.read();
        values.push(value[0]);
        // Give the pipe every chance to run ahead of this slow consumer.
        for (let turn = 0; turn < 100; turn += 1) await null;
        pullsAfterRead.push(pulls);
      }
      await reader.cancel();
      return { values, pullsAfterRead };
    `);

    assert.deepEqual(result.values, [2, 4, 6, 8, 10]);
    result.pullsAfterRead.forEach((pulls, index) => {
      assert.ok(pulls <= index + 3, `source pulled ${pulls} times after ${index + 1} reads`);
    });
  });

  test("filtering and splitting transforms do not stall the pipe", async () => {
    const result = await run<number[]>(`
      const output = [];
      const stream = ReadableStream.from([1, 2, 3, 4, 5, 6]).pipeThrough(new TransformStream({
        transform(value, controller) {
          if (value % 2 === 0) {
            controller.enqueue(value);
            controller.enqueue(value * 10);
          }
        },
      }));
      for await (const value of stream) output.push(value);
      return output;
    `);
    assert.deepEqual(result, [2, 20, 4, 40, 6, 60]);
  });

  test("cancelling the transformed stream cancels the source", async () => {
    const result = await run<{ cancelReason: string | null; pulls: number }>(`
      let pulls = 0;
      let cancelReason = null;
      const source = new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(pulls);
        },
        cancel(reason) {
          cancelReason = String(reason);
        },
      });
      const reader = source.pipeThrough(new TransformStream()).getReader();
      await reader.read();
      await reader.cancel("consumer went away");
      for (let turn = 0; turn < 100; turn += 1) await null;
      return { cancelReason, pulls };
    `);
    assert.equal(result.cancelReason, "consumer went away");
    assert.ok(result.pulls <= 3, `source pulled ${result.pulls} times`);
  });

  test("a failing source errors the transformed stream", async () => {
    const result = await run<string>(`
      const source = new ReadableStream({
        pull(controller) {
          controller.error(new TypeError("source failed"));
        },
      });
      try {
        await source.pipeThrough(new TransformStream()).getReader().read();
        return "no error";
      } catch (error) {
        return error.name + ": " + error.message;
      }
    `);
    assert.equal(result, "TypeError: source failed");
  });

  test("WritableStream sinks process one write at a time and close after them", async () => {
    const result = await run<{ events: string[]; maxActive: number }>(`
      const events = [];
      let active = 0;
      let maxActive = 0;
      const writer = new WritableStream({
        async write(chunk) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          events.push("start " + chunk);
          for (let turn = 0; turn < 5; turn += 1) await null;
          events.push("end " + chunk);
          active -= 1;
        },
        close() {
          events.push("close");
        },
      }).getWriter();
      await Promise.all([writer.write(1), writer.write(2), writer.write(3), writer.close()]);
      return { events, maxActive };
    `);
    assert.equal(result.maxActive, 1);
    assert.deepEqual(result.events, [
      "start 1", "end 1", "start 2", "end 2", "start 3", "end 3", "close",
    ]);
  });

  test("a failed sink write errors the WritableStream", async () => {
    const result = await run<string[]>(`
      const writer = new WritableStream({
        write(chunk) {
          if (chunk === 2) throw new Error("bad chunk");
        },
      }).getWriter();
      const outcome = (promise) => promise.then(() => "ok", (error) => error.message);
      return [
        await outcome(writer.write(1)),
        await outcome(writer.write(2)),
        await outcome(writer.write(3)),
      ];
    `);
    assert.deepEqual(result, ["ok", "bad chunk", "bad chunk"]);
  });

  test("a write to a TransformStream completes once its output is read", async () => {
    const result = await run<{ writtenBeforeRead: boolean; writtenAfterRead: boolean; value: string }>(`
      const transform = new TransformStream();
      const writer = transform.writable.getWriter();
      let written = false;
      const write = writer.write("a").then(() => {
        written = true;
      });
      for (let turn = 0; turn < 50; turn += 1) await null;
      const writtenBeforeRead = written;
      const { value } = await transform.readable.getReader().read();
      await write;
      return { writtenBeforeRead, writtenAfterRead: written, value };
    `);
    assert.deepEqual(result, { writtenBeforeRead: false, writtenAfterRead: true, value: "a" });
  });

  test("text encoder and decoder streams still pipe correctly", async () => {
    const result = await run<string>(`
      let text = "";
      const stream = ReadableStream.from(["h\u00e9", "llo ", "w\u00f6rld"])
        .pipeThrough(new TextEncoderStream())
        .pipeThrough(new TextDecoderStream());
      for await (const chunk of stream) text += chunk;
      return text;
    `);
    assert.equal(result, "h\u00e9llo w\u00f6rld");
  });
});
