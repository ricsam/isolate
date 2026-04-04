import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { IsolateServer } from "./index.ts";
import type { DaemonConnection, RemoteRuntime, UpgradeRequest, DispatchOptions } from "../client/index.ts";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeRuntime implements Partial<RemoteRuntime> {
  readonly id: string;
  disposed = false;
  dispatchCalls = 0;
  disposeCalls: Array<{ hard?: boolean; reason?: string } | undefined> = [];
  private readonly responseText: string;
  private readonly dispatchGate?: ReturnType<typeof createDeferred<void>>;

  constructor(
    id: string,
    options: {
      responseText: string;
      dispatchGate?: ReturnType<typeof createDeferred<void>>;
    },
  ) {
    this.id = id;
    this.responseText = options.responseText;
    this.dispatchGate = options.dispatchGate;
  }

  readonly fetch = {
    dispatchRequest: async (_request: Request, _options?: DispatchOptions): Promise<Response> => {
      this.dispatchCalls += 1;
      await this.dispatchGate?.promise;
      if (this.disposed) {
        throw new Error("Isolated is disposed");
      }
      return new Response(this.responseText);
    },
    getUpgradeRequest: async (): Promise<UpgradeRequest | null> => null,
    dispatchWebSocketOpen: async (): Promise<void> => {},
    dispatchWebSocketMessage: async (): Promise<void> => {},
    dispatchWebSocketClose: async (): Promise<void> => {},
    dispatchWebSocketError: async (): Promise<void> => {},
    onWebSocketCommand: (): (() => void) => () => {},
    hasServeHandler: async (): Promise<boolean> => true,
    hasActiveConnections: async (): Promise<boolean> => false,
  };

  readonly timers = {
    clearAll: async (): Promise<void> => {},
  };

  readonly console = {
    reset: async (): Promise<void> => {},
    getTimers: async (): Promise<Map<string, number>> => new Map(),
    getCounters: async (): Promise<Map<string, number>> => new Map(),
    getGroupDepth: async (): Promise<number> => 0,
  };

  readonly testEnvironment = {
    runTests: async (): Promise<never> => {
      throw new Error("Not implemented");
    },
    hasTests: async (): Promise<boolean> => false,
    getTestCount: async (): Promise<number> => 0,
    reset: async (): Promise<void> => {},
  };

  readonly playwright = {
    getCollectedData: () => ({
      browserConsoleLogs: [],
      networkRequests: [],
      networkResponses: [],
      pageErrors: [],
      requestFailures: [],
    }),
    getTrackedResources: () => ({
      contexts: [],
      pages: [],
    }),
    clearCollectedData: (): void => {},
  };

  async eval(): Promise<void> {}

  on(): () => void {
    return () => {};
  }

  emit(): void {}

  async dispose(options?: { hard?: boolean; reason?: string }): Promise<void> {
    this.disposeCalls.push(options);
    this.disposed = true;
  }
}

function createConnection(runtimes: FakeRuntime[]): DaemonConnection {
  return {
    createRuntime: async () => {
      throw new Error("Unexpected non-namespaced runtime creation");
    },
    createNamespace: (id: string) => ({
      id,
      createRuntime: async () => {
        const runtime = runtimes.shift();
        if (!runtime) {
          throw new Error("No runtime prepared for test");
        }
        return runtime as unknown as RemoteRuntime;
      },
    }),
    disposeNamespace: async () => {},
    close: async () => {},
    isConnected: () => true,
  };
}

describe("IsolateServer", () => {
  test("retries a request against the replacement runtime after concurrent reload disposal", async () => {
    const firstDispatchGate = createDeferred<void>();
    const firstRuntime = new FakeRuntime("runtime-1", {
      responseText: "stale",
      dispatchGate: firstDispatchGate,
    });
    const replacementRuntime = new FakeRuntime("runtime-2", {
      responseText: "fresh",
    });
    const connection = createConnection([firstRuntime, replacementRuntime]);

    const server = new IsolateServer({
      namespaceId: "project/main/preview/dev",
      getConnection: async () => connection,
    });

    await server.start({
      entry: "/server.ts",
      runtimeOptions: {},
    });

    const requestPromise = server.fetch.dispatchRequest(new Request("http://localhost/test"));
    await Promise.resolve();

    const reloadReason = "file-change:modify:/backend/functions.yml";
    const reloadPromise = server.reload(reloadReason);
    await Promise.resolve();

    firstDispatchGate.resolve();
    await reloadPromise;

    const response = await requestPromise;
    assert.equal(await response.text(), "fresh");
    assert.equal(firstRuntime.dispatchCalls, 1);
    assert.equal(replacementRuntime.dispatchCalls, 1);
    assert.deepEqual(firstRuntime.disposeCalls, [
      {
        hard: true,
        reason: `IsolateServer.reload(${reloadReason})`,
      },
    ]);
  });
});
