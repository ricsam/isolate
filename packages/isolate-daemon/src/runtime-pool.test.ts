import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectRuntimePoolSnapshot,
  createDaemonStats,
  formatRuntimeLabel,
  formatRuntimePoolSnapshot,
} from "./runtime-pool.ts";
import type { DaemonState, IsolateInstance } from "./types.ts";

function createInstance(
  isolateId: string,
  overrides: Partial<IsolateInstance> = {}
): IsolateInstance {
  return {
    isolateId,
    runtime: {} as IsolateInstance["runtime"],
    ownerConnection: null,
    callbacks: new Map(),
    createdAt: 0,
    lastActivity: 0,
    isDisposed: false,
    isPoisoned: false,
    ...overrides,
  };
}

function createState(instances: IsolateInstance[]): DaemonState {
  return {
    isolates: new Map(instances.map((instance) => [instance.isolateId, instance])),
    connections: new Map([[{}, {}]]) as DaemonState["connections"],
    stats: {
      activeIsolates: 0,
      pooledIsolates: 0,
      trackedIsolates: 0,
      activeConnections: 0,
      totalIsolatesCreated: 7,
      totalRequestsProcessed: 13,
    },
    options: {
      socketPath: "/tmp/test.sock",
      host: "127.0.0.1",
      port: 47891,
      maxIsolates: 100,
      defaultMemoryLimitMB: 128,
    },
    namespacedRuntimes: new Map(),
    namespacedCreatesInFlight: new Set(),
  };
}

describe("runtime pool stats", () => {
  it("counts active, pooled, and tracked runtimes separately", () => {
    const state = createState([
      createInstance("active-a"),
      createInstance("pooled-a", { isDisposed: true, namespaceId: "tenant-a" }),
      createInstance("active-b", { namespaceId: "tenant-b", isPoisoned: true }),
    ]);

    const snapshot = collectRuntimePoolSnapshot(state);

    assert.deepEqual(snapshot, {
      activeIsolates: 2,
      pooledIsolates: 1,
      trackedIsolates: 3,
      activeConnections: 1,
      maxIsolates: 100,
      namespacedIsolates: 2,
      poisonedIsolates: 1,
    });
    assert.equal(
      formatRuntimePoolSnapshot(snapshot),
      "active=2 pooled=1 tracked=3/100 connections=1 namespaced=2 poisoned=1"
    );
  });

  it("builds daemon stats without losing cumulative counters", () => {
    const state = createState([
      createInstance("pooled-a", { isDisposed: true, namespaceId: "tenant-a" }),
    ]);

    assert.deepEqual(createDaemonStats(state), {
      activeIsolates: 0,
      pooledIsolates: 1,
      trackedIsolates: 1,
      activeConnections: 1,
      totalIsolatesCreated: 7,
      totalRequestsProcessed: 13,
    });
  });

  it("formats runtime labels with namespace context", () => {
    assert.equal(
      formatRuntimeLabel(createInstance("isolate-1", { namespaceId: "tenant-a" })),
      'isolate-1 (namespace="tenant-a")'
    );
    assert.equal(formatRuntimeLabel(createInstance("isolate-2")), "isolate-2");
  });
});
