import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { connect } from "./index.ts";
import { __unstableGetNamespacedRuntimeDescriptorForTests } from "./connection.ts";
import { createTestHost, createTestId, withTimeout } from "../../testing/integration-helpers.ts";
import type { IsolateHost } from "../../types.ts";

function collectOutput(entries: Array<{ type: string; stdout?: string }>): string[] {
  return entries.flatMap((entry) => (
    entry.type === "output" && typeof entry.stdout === "string"
      ? [entry.stdout]
      : []
  ));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeWebSocket {
  private readonly payload: Uint8Array;
  readyState = 0;
  protocol = "";
  extensions = "";
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(payload: Uint8Array) {
    this.payload = payload;

    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});

      const buffer = this.payload.buffer.slice(
        this.payload.byteOffset,
        this.payload.byteOffset + this.payload.byteLength,
      ) as ArrayBuffer;

      setTimeout(() => {
        this.onmessage?.({ data: buffer });
      }, 10);
    }, 10);
  }

  send(_data: unknown): void {}

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) {
      return;
    }

    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: true });
  }
}

describe("outbound WebSocket client integration", () => {
  let host: IsolateHost;
  let socketPath: string;
  let cleanup: (() => Promise<void>) | undefined;

  before(async () => {
    const testHost = await createTestHost("client-websocket-integration");
    host = testHost.host;
    socketPath = testHost.socketPath;
    cleanup = testHost.cleanup;

    const warmupRuntime = await host.createRuntime({
      bindings: {},
    });
    await warmupRuntime.dispose();
  });

  after(async () => {
    await cleanup?.();
  });

  test("preserves non-ASCII bytes when dispatching binary frames into the isolate", async () => {
    const connection = await connect({
      socket: socketPath,
      timeout: 15_000,
    });

    const entries: Array<{ type: string; stdout?: string }> = [];
    const payload = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const runtime = await connection.createRuntime({
      console: {
        onEntry(entry) {
          entries.push(entry);
        },
      },
      webSocket() {
        return new FakeWebSocket(payload) as unknown as WebSocket;
      },
    });

    try {
      await withTimeout(
        runtime.eval(`
          await new Promise((resolve, reject) => {
            const ws = new WebSocket("ws://binary.example.test");
            ws.binaryType = "arraybuffer";
            ws.onerror = () => reject(new Error("socket error"));
            ws.onmessage = (event) => {
              console.log(JSON.stringify({
                isArrayBuffer: event.data instanceof ArrayBuffer,
                bytes: Array.from(new Uint8Array(event.data)),
              }));
              ws.close(1000, "done");
              resolve();
            };
          });
        `),
        5_000,
        "outbound websocket binary round-trip",
      );
    } finally {
      await runtime.dispose({ hard: true, reason: "test cleanup" });
      await connection.close();
    }

    const outputs = collectOutput(entries);
    assert.equal(outputs.length, 1);

    const result = JSON.parse(outputs[0] ?? "{}") as {
      isArrayBuffer?: boolean;
      bytes?: number[];
    };

    assert.equal(result.isArrayBuffer, true);
    assert.deepEqual(result.bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  });

  test("does not let pending test event callbacks block later evals", async () => {
    const connection = await connect({
      socket: socketPath,
      timeout: 15_000,
    });
    const firstEvent = createDeferred<void>();
    const release = createDeferred<void>();
    const runtime = await connection.createRuntime({
      testEnvironment: {
        onEvent(event) {
          if ((event as { type?: string }).type === "testStart") {
            firstEvent.resolve();
          }
          return release.promise as unknown as void;
        },
        testTimeout: 5_000,
      } as { onEvent(event: unknown): void; testTimeout: number },
    });

    try {
      await runtime.eval(`
        test("still runs", () => {
          expect(1 + 1).toBe(2);
        });
      `, { filename: "/tests/non-blocking-events.test.ts" });

      const runPromise = runtime.testEnvironment.runTests(5_000);
      await withTimeout(firstEvent.promise, 5_000, "test event callback invocation");
      const results = await withTimeout(runPromise, 5_000, "test execution");
      assert.equal(results.success, true);

      await withTimeout(
        runtime.eval(`
          globalThis.__afterTests = "ok";
        `, { filename: "/tests/post-run-eval.ts" }),
        5_000,
        "post-test eval",
      );
    } finally {
      release.resolve();
      await runtime.dispose({ hard: true, reason: "test cleanup" });
      await connection.close();
    }
  });

  test("rebound namespaced handles target the replacement isolate id", async () => {
    const connection = await connect({
      socket: socketPath,
      timeout: 15_000,
    });
    const admin = await connect({
      socket: socketPath,
      timeout: 15_000,
    });
    const key = createTestId("client-namespaced-rebind");

    const runtime = await connection.createNamespace(key).createRuntime({});
    const descriptor = __unstableGetNamespacedRuntimeDescriptorForTests(connection, key);
    assert.ok(descriptor, "expected namespaced runtime descriptor");
    if (!descriptor) {
      throw new Error("expected namespaced runtime descriptor");
    }
    const reboundDescriptor = descriptor;
    const firstIsolateId = runtime.id;

    let replacement:
      | Awaited<ReturnType<ReturnType<typeof connection.createNamespace>["createRuntime"]>>
      | undefined;
    let reacquired:
      | Awaited<ReturnType<ReturnType<typeof connection.createNamespace>["createRuntime"]>>
      | undefined;

    try {
      await runtime.eval("globalThis.__beforeRebind = 1;");

      await admin.disposeNamespace(key, {
        reason: "simulate reconnect replacement",
      });

      replacement = await connection.createNamespace(key).createRuntime({});
      assert.notEqual(replacement.id, firstIsolateId);

      reboundDescriptor.syncIsolateId(replacement.id);
      assert.equal(runtime.id, replacement.id);

      await runtime.eval("globalThis.__afterRebind = 2;");
      await runtime.dispose();

      reacquired = await connection.createNamespace(key).createRuntime({});
      await reacquired.eval("globalThis.__afterDispose = 3;");
    } finally {
      await reacquired?.dispose({ hard: true, reason: "test cleanup" }).catch(() => {});
      await replacement?.dispose({ hard: true, reason: "test cleanup" }).catch(() => {});
      await admin.close();
      await connection.close();
    }
  });
});
