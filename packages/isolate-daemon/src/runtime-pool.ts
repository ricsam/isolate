import type { DaemonState, DaemonStats, IsolateInstance } from "./types.ts";

export interface RuntimePoolSnapshot {
  activeIsolates: number;
  pooledIsolates: number;
  trackedIsolates: number;
  activeConnections: number;
  maxIsolates: number;
  namespacedIsolates: number;
  poisonedIsolates: number;
}

type RuntimePoolState = Pick<DaemonState, "isolates" | "connections" | "options">;

export function collectRuntimePoolSnapshot(
  state: RuntimePoolState
): RuntimePoolSnapshot {
  let activeIsolates = 0;
  let pooledIsolates = 0;
  let namespacedIsolates = 0;
  let poisonedIsolates = 0;

  for (const instance of state.isolates.values()) {
    if (instance.isDisposed) {
      pooledIsolates += 1;
    } else {
      activeIsolates += 1;
    }

    if (instance.namespaceId != null) {
      namespacedIsolates += 1;
    }

    if (instance.isPoisoned) {
      poisonedIsolates += 1;
    }
  }

  return {
    activeIsolates,
    pooledIsolates,
    trackedIsolates: state.isolates.size,
    activeConnections: state.connections.size,
    maxIsolates: state.options.maxIsolates,
    namespacedIsolates,
    poisonedIsolates,
  };
}

export function createDaemonStats(state: DaemonState): DaemonStats {
  const snapshot = collectRuntimePoolSnapshot(state);

  return {
    activeIsolates: snapshot.activeIsolates,
    pooledIsolates: snapshot.pooledIsolates,
    trackedIsolates: snapshot.trackedIsolates,
    activeConnections: snapshot.activeConnections,
    totalIsolatesCreated: state.stats.totalIsolatesCreated,
    totalRequestsProcessed: state.stats.totalRequestsProcessed,
  };
}

export function formatRuntimePoolSnapshot(snapshot: RuntimePoolSnapshot): string {
  const parts = [
    `active=${snapshot.activeIsolates}`,
    `pooled=${snapshot.pooledIsolates}`,
    `tracked=${snapshot.trackedIsolates}/${snapshot.maxIsolates}`,
    `connections=${snapshot.activeConnections}`,
  ];

  if (snapshot.namespacedIsolates > 0) {
    parts.push(`namespaced=${snapshot.namespacedIsolates}`);
  }

  if (snapshot.poisonedIsolates > 0) {
    parts.push(`poisoned=${snapshot.poisonedIsolates}`);
  }

  return parts.join(" ");
}

export function formatRuntimeLabel(
  instance: Pick<IsolateInstance, "isolateId" | "namespaceId">
): string {
  return instance.namespaceId != null
    ? `${instance.isolateId} (namespace=${JSON.stringify(instance.namespaceId)})`
    : instance.isolateId;
}
