import { randomUUID } from "node:crypto";
import type { NestedHostBindings, NestedResourceKind } from "../bridge/sandbox-isolate.ts";
import {
  createBrowserSourceFromUnknown,
  isDefaultBrowserDescriptor,
  requireBrowserSource,
  type BrowserSource,
} from "../internal/browser-source.ts";
import { invokeBestEffortEventHandlerNonReentrant } from "../internal/event-callback.ts";
import type {
  AppServer,
  CreateAppServerOptions,
  CreateNamespacedRuntimeOptions,
  CreateRuntimeOptions,
  CreateTestRuntimeOptions,
  HostBindings,
  HostCallContext,
  NamespacedRuntime,
  NestedHostPolicy,
  RequestResult,
  RuntimeResourceDiagnostics,
  ScriptRuntime,
  TestRuntime,
} from "../types.ts";

interface NestedHostFactory {
  createRuntime(
    options: CreateRuntimeOptions,
    context: NestedHostControllerContext,
  ): Promise<ScriptRuntime>;
  createAppServer(
    options: CreateAppServerOptions,
    context: NestedHostControllerContext,
  ): Promise<AppServer>;
  createTestRuntime(
    options: CreateTestRuntimeOptions,
    context: NestedHostControllerContext,
  ): Promise<TestRuntime>;
  getNamespacedRuntime(
    key: string,
    options: CreateNamespacedRuntimeOptions,
    context: NestedHostControllerContext,
  ): Promise<NamespacedRuntime>;
  disposeNamespace(key: string, options?: { reason?: string }): Promise<void>;
  isConnected(): boolean;
}

interface ResolvedNestedHostPolicy {
  fetch: "inherit" | "disabled";
  maxTotalResources: number;
  maxRuntimes: number;
  maxAppServers: number;
  maxMemoryLimitMB: number;
  maxExecutionTimeoutMs: number;
  maxAppServerLifetimeMs?: number;
}

export interface NestedHostResourceGroup {
  id: string;
  namespacePrefix: string;
  policy: ResolvedNestedHostPolicy;
  totalResources: number;
  runtimeResources: number;
  appServerResources: number;
  namespaceKeys: Map<string, string>;
}

export interface NestedHostControllerContext {
  group: NestedHostResourceGroup;
}

interface NestedHostRecord {
  runtimeIds: Set<string>;
  serverIds: Set<string>;
  closed: boolean;
}

interface RuntimeResourceRecord {
  kind: "runtime";
  hostId: string;
  resource: ScriptRuntime;
  subscriptions: Map<string, () => void>;
  releaseQuota: () => void;
}

interface AppServerResourceRecord {
  kind: "appServer";
  hostId: string;
  resource: AppServer;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  releaseQuota: () => void;
}

interface TestRuntimeResourceRecord {
  kind: "testRuntime";
  hostId: string;
  resource: TestRuntime;
  subscriptions: Map<string, () => void>;
  releaseQuota: () => void;
}

interface NamespacedRuntimeResourceRecord {
  kind: "namespacedRuntime";
  hostId: string;
  resource: NamespacedRuntime;
  subscriptions: Map<string, () => void>;
  releaseQuota: () => void;
}

type NestedResourceRecord =
  | RuntimeResourceRecord
  | AppServerResourceRecord
  | TestRuntimeResourceRecord
  | NamespacedRuntimeResourceRecord;

const DEFAULT_NESTED_TOTAL_RESOURCES = 8;
const DEFAULT_NESTED_RUNTIMES = 6;
const DEFAULT_NESTED_APP_SERVERS = 2;
const DEFAULT_NESTED_MEMORY_LIMIT_MB = 128;
const DEFAULT_NESTED_EXECUTION_TIMEOUT_MS = 30_000;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Nested host quota values must be positive numbers.");
  }
  return Math.floor(value);
}

function clampToParentLimit(
  value: number | undefined,
  parentLimit: number | undefined,
  fallback: number,
): number {
  const normalized = normalizePositiveInteger(value, parentLimit ?? fallback);
  return parentLimit === undefined ? normalized : Math.min(normalized, parentLimit);
}

export function createNestedHostResourceGroup(
  policy: NestedHostPolicy | undefined,
  parentLimits?: { memoryLimitMB?: number; executionTimeout?: number },
): NestedHostResourceGroup {
  const maxMemoryLimitMB = clampToParentLimit(
    policy?.maxMemoryLimitMB,
    parentLimits?.memoryLimitMB,
    DEFAULT_NESTED_MEMORY_LIMIT_MB,
  );
  const maxExecutionTimeoutMs = clampToParentLimit(
    policy?.maxExecutionTimeoutMs,
    parentLimits?.executionTimeout,
    DEFAULT_NESTED_EXECUTION_TIMEOUT_MS,
  );

  return {
    id: randomUUID(),
    namespacePrefix: `nested:${randomUUID()}`,
    policy: {
      fetch: policy?.fetch ?? "disabled",
      maxTotalResources: normalizePositiveInteger(
        policy?.maxTotalResources,
        DEFAULT_NESTED_TOTAL_RESOURCES,
      ),
      maxRuntimes: normalizePositiveInteger(
        policy?.maxRuntimes,
        DEFAULT_NESTED_RUNTIMES,
      ),
      maxAppServers: normalizePositiveInteger(
        policy?.maxAppServers,
        DEFAULT_NESTED_APP_SERVERS,
      ),
      maxMemoryLimitMB,
      maxExecutionTimeoutMs,
      maxAppServerLifetimeMs: policy?.maxAppServerLifetimeMs === undefined
        ? undefined
        : normalizePositiveInteger(policy.maxAppServerLifetimeMs, DEFAULT_NESTED_EXECUTION_TIMEOUT_MS),
    },
    totalResources: 0,
    runtimeResources: 0,
    appServerResources: 0,
    namespaceKeys: new Map(),
  };
}

interface SerializedRequestLike {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: number[] | null;
}

type AbortableNestedOptions = {
  __isolateAbortOperationId?: string;
  signal?: AbortSignal;
};

function createNonReentrantEventHandler<TArgs extends unknown[]>(
  label: string,
  handler: ((...args: TArgs) => unknown) | undefined,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    invokeBestEffortEventHandlerNonReentrant(label, handler, ...args);
  };
}

function toRequest(serialized: SerializedRequestLike): Request {
  return new Request(serialized.url, {
    method: serialized.method ?? "GET",
    headers: serialized.headers,
    body: serialized.body ? new Uint8Array(serialized.body) : null,
  });
}

function normalizeBindings(
  bindings: HostBindings | undefined,
  defaultBrowserSource: BrowserSource | undefined,
  inheritedBindings: HostBindings,
  policy: ResolvedNestedHostPolicy,
): HostBindings {
  const normalized: HostBindings = {
    console: bindings?.console,
    fetch: bindings?.fetch ?? (
      policy.fetch === "inherit" ? inheritedBindings.fetch : undefined
    ),
    files: bindings?.files,
    modules: bindings?.modules,
    tools: bindings?.tools,
  };

  if (!bindings || !("browser" in bindings) || bindings.browser === undefined) {
    return normalized;
  }

  if (isDefaultBrowserDescriptor(bindings.browser)) {
    normalized.browser = requireBrowserSource(
      defaultBrowserSource,
      "Nested browser bindings",
    );
    return normalized;
  }

  const browserSource = createBrowserSourceFromUnknown(bindings.browser);
  if (!browserSource) {
    throw new Error(
      "Nested browser bindings must use the sandbox browser handle, a Playwright handler, or expose createContext()/createPage().",
    );
  }

  normalized.browser = browserSource;
  return normalized;
}

function normalizeRuntimeOptions(
  options: CreateRuntimeOptions,
  defaultBrowserSource: BrowserSource | undefined,
  inheritedBindings: HostBindings,
  group: NestedHostResourceGroup,
): CreateRuntimeOptions {
  const memoryLimitMB = options.memoryLimitMB ?? group.policy.maxMemoryLimitMB;
  const executionTimeout = options.executionTimeout ?? group.policy.maxExecutionTimeoutMs;
  if (memoryLimitMB > group.policy.maxMemoryLimitMB) {
    throw new Error(
      `Nested runtime memoryLimitMB ${memoryLimitMB} exceeds quota ${group.policy.maxMemoryLimitMB}.`,
    );
  }
  if (executionTimeout > group.policy.maxExecutionTimeoutMs) {
    throw new Error(
      `Nested runtime executionTimeout ${executionTimeout} exceeds quota ${group.policy.maxExecutionTimeoutMs}.`,
    );
  }

  return {
    ...options,
    memoryLimitMB,
    executionTimeout,
    nestedHost: options.nestedHost === false ? false : group.policy,
    bindings: normalizeBindings(
      options.bindings,
      defaultBrowserSource,
      inheritedBindings,
      group.policy,
    ),
  };
}

function normalizeAppServerOptions(
  options: CreateAppServerOptions,
  defaultBrowserSource: BrowserSource | undefined,
  inheritedBindings: HostBindings,
  group: NestedHostResourceGroup,
): CreateAppServerOptions {
  return {
    ...normalizeRuntimeOptions(
      options,
      defaultBrowserSource,
      inheritedBindings,
      group,
    ),
    key: options.key,
    entry: options.entry,
    entryFilename: options.entryFilename,
    webSockets: options.webSockets,
  };
}

function normalizeNamespacedRuntimeOptions(
  options: CreateNamespacedRuntimeOptions,
  defaultBrowserSource: BrowserSource | undefined,
  inheritedBindings: HostBindings,
  group: NestedHostResourceGroup,
): CreateNamespacedRuntimeOptions {
  const memoryLimitMB = options.memoryLimitMB ?? group.policy.maxMemoryLimitMB;
  const executionTimeout = options.executionTimeout ?? group.policy.maxExecutionTimeoutMs;
  if (memoryLimitMB > group.policy.maxMemoryLimitMB) {
    throw new Error(
      `Nested runtime memoryLimitMB ${memoryLimitMB} exceeds quota ${group.policy.maxMemoryLimitMB}.`,
    );
  }
  if (executionTimeout > group.policy.maxExecutionTimeoutMs) {
    throw new Error(
      `Nested runtime executionTimeout ${executionTimeout} exceeds quota ${group.policy.maxExecutionTimeoutMs}.`,
    );
  }

  return {
    ...options,
    memoryLimitMB,
    executionTimeout,
    nestedHost: options.nestedHost === false ? false : group.policy,
    bindings: normalizeBindings(
      options.bindings,
      defaultBrowserSource,
      inheritedBindings,
      group.policy,
    ),
  };
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    const error = new Error((value as { message: string }).message);
    if (
      "name" in value &&
      typeof (value as { name?: unknown }).name === "string"
    ) {
      error.name = (value as { name: string }).name;
    }
    return error;
  }

  return new Error(String(value));
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    const error = new Error(reason.message);
    error.name = "AbortError";
    (error as Error & { cause?: unknown }).cause = reason;
    return error;
  }

  const error = new Error(
    typeof reason === "string" && reason.length > 0
      ? reason
      : "The operation was aborted.",
  );
  error.name = "AbortError";
  return error;
}

function composeAbortSignals(
  signals: Array<AbortSignal | undefined>,
): { signal?: AbortSignal; cleanup: () => void } {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );

  if (activeSignals.length === 0) {
    return { cleanup() {} };
  }

  const aborted = activeSignals.find((signal) => signal.aborted);
  if (aborted) {
    return {
      signal: AbortSignal.abort(aborted.reason ?? createAbortError()),
      cleanup() {},
    };
  }

  if (activeSignals.length === 1) {
    return {
      signal: activeSignals[0],
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const cleanup = () => {
    for (const signal of activeSignals) {
      signal.removeEventListener("abort", onAbort);
    }
  };
  const onAbort = (event: Event) => {
    cleanup();
    const signal = event.target as AbortSignal | null;
    controller.abort(signal?.reason ?? createAbortError());
  };

  for (const signal of activeSignals) {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  controller.signal.addEventListener("abort", cleanup, { once: true });

  return {
    signal: controller.signal,
    cleanup,
  };
}

const NESTED_RUNTIME_FLUSH_CODE = `
  for (let index = 0; index < 3; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
`;

function hasPendingNestedRuntimeWork(
  diagnostics: RuntimeResourceDiagnostics,
): boolean {
  return diagnostics.runtime.activeResources > 0 ||
    diagnostics.runtime.pendingFiles > 0 ||
    diagnostics.runtime.pendingFetches > 0 ||
    diagnostics.runtime.pendingModules > 0 ||
    diagnostics.runtime.pendingTools > 0;
}

async function flushNestedRuntime(
  runtime: ScriptRuntime | NamespacedRuntime,
): Promise<void> {
  let diagnostics = await runtime.diagnostics();

  for (let index = 0; index < 3; index += 1) {
    if (!hasPendingNestedRuntimeWork(diagnostics)) {
      return;
    }

    await runtime.eval(
      NESTED_RUNTIME_FLUSH_CODE,
      { filename: "/__isolate_internal_nested_flush__.mjs" },
    );
    diagnostics = await runtime.diagnostics();
  }
}

function countsAsRuntime(kind: NestedResourceKind): boolean {
  return kind !== "appServer";
}

function reserveNestedResource(
  group: NestedHostResourceGroup,
  kind: NestedResourceKind,
): () => void {
  const nextTotal = group.totalResources + 1;
  if (nextTotal > group.policy.maxTotalResources) {
    throw new Error(
      `Nested host resource quota exceeded: ${nextTotal}/${group.policy.maxTotalResources}.`,
    );
  }

  if (countsAsRuntime(kind)) {
    const nextRuntimes = group.runtimeResources + 1;
    if (nextRuntimes > group.policy.maxRuntimes) {
      throw new Error(
        `Nested runtime quota exceeded: ${nextRuntimes}/${group.policy.maxRuntimes}.`,
      );
    }
    group.runtimeResources = nextRuntimes;
  } else {
    const nextServers = group.appServerResources + 1;
    if (nextServers > group.policy.maxAppServers) {
      throw new Error(
        `Nested app server quota exceeded: ${nextServers}/${group.policy.maxAppServers}.`,
      );
    }
    group.appServerResources = nextServers;
  }

  group.totalResources = nextTotal;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    group.totalResources = Math.max(0, group.totalResources - 1);
    if (countsAsRuntime(kind)) {
      group.runtimeResources = Math.max(0, group.runtimeResources - 1);
    } else {
      group.appServerResources = Math.max(0, group.appServerResources - 1);
    }
  };
}

function getScopedNamespaceKey(
  group: NestedHostResourceGroup,
  hostId: string,
  key: string,
): string {
  const mapKey = `${hostId}\0${key}`;
  const existing = group.namespaceKeys.get(mapKey);
  if (existing) {
    return existing;
  }

  const encodedKey = Buffer.from(key, "utf8").toString("base64url");
  const scopedKey = `${group.namespacePrefix}:${randomUUID()}:${encodedKey}`;
  group.namespaceKeys.set(mapKey, scopedKey);
  return scopedKey;
}

export function createNestedHostBindings(
  factory: NestedHostFactory,
  defaultBrowserSource: BrowserSource | undefined,
  inheritedBindings: HostBindings,
  group: NestedHostResourceGroup,
): NestedHostBindings {
  const hosts = new Map<string, NestedHostRecord>();
  const resources = new Map<string, NestedResourceRecord>();
  const operationAbortControllers = new Map<string, AbortController>();
  const earlyAbortedOperations = new Map<string, string | undefined>();

  const requireHost = (hostId: string): NestedHostRecord => {
    const host = hosts.get(hostId);
    if (!host || host.closed) {
      throw new Error(`Nested host ${hostId} is not available.`);
    }
    return host;
  };

  const requireResource = (
    resourceId: string,
    expectedKind: NestedResourceKind,
  ): NestedResourceRecord => {
    const resource = resources.get(resourceId);
    if (!resource || resource.kind !== expectedKind) {
      throw new Error(
        `Nested resource ${resourceId} is not available for ${expectedKind}.`,
      );
    }
    return resource;
  };

  const unregisterResource = (resourceId: string): void => {
    const record = resources.get(resourceId);
    if (!record) {
      return;
    }

    const host = hosts.get(record.hostId);
    if (host) {
      if (record.kind === "appServer") {
        host.serverIds.delete(resourceId);
      } else {
        host.runtimeIds.delete(resourceId);
      }
    }

    if (
      record.kind === "runtime" ||
      record.kind === "testRuntime" ||
      record.kind === "namespacedRuntime"
    ) {
      for (const unsubscribe of record.subscriptions.values()) {
        unsubscribe();
      }
      record.subscriptions.clear();
    }

    if (record.kind === "appServer" && record.lifetimeTimer) {
      clearTimeout(record.lifetimeTimer);
    }
    record.releaseQuota();
    resources.delete(resourceId);
  };

  const disposeResource = async (
    resourceId: string,
    options: { hard?: boolean; reason?: string },
  ): Promise<void> => {
    const record = resources.get(resourceId);
    if (!record) {
      return;
    }

    try {
      await record.resource.dispose(options);
    } finally {
      unregisterResource(resourceId);
    }
  };

  const createOperationSignal = (
    options: AbortableNestedOptions | null | undefined,
    context: HostCallContext,
  ): { signal?: AbortSignal; cleanup: () => void } => {
    const operationId = options?.__isolateAbortOperationId;
    let operationController: AbortController | undefined;

    if (operationId) {
      operationController = new AbortController();
      operationAbortControllers.set(operationId, operationController);
      if (earlyAbortedOperations.has(operationId)) {
        operationController.abort(
          createAbortError(earlyAbortedOperations.get(operationId)),
        );
        earlyAbortedOperations.delete(operationId);
      }
    }

    const composed = composeAbortSignals([
      context.signal,
      operationController?.signal,
    ]);

    return {
      signal: composed.signal,
      cleanup() {
        composed.cleanup();
        if (operationId) {
          operationAbortControllers.delete(operationId);
          earlyAbortedOperations.delete(operationId);
        }
      },
    };
  };

  const stripAbortOperation = <T extends object>(
    options: (T & AbortableNestedOptions) | null | undefined,
  ): T | undefined => {
    if (!options) {
      return undefined;
    }
    const normalized = { ...options };
    delete (normalized as AbortableNestedOptions).__isolateAbortOperationId;
    delete (normalized as AbortableNestedOptions).signal;
    return Object.keys(normalized).length > 0 ? normalized as T : undefined;
  };

  return {
    async createHost() {
      const hostId = randomUUID();
      hosts.set(hostId, {
        runtimeIds: new Set(),
        serverIds: new Set(),
        closed: false,
      });
      return hostId;
    },
    async closeHost(hostId) {
      const host = requireHost(hostId);
      host.closed = true;
      const resourceIds = [
        ...host.serverIds,
        ...host.runtimeIds,
      ];
      await Promise.allSettled(
        resourceIds.map(async (resourceId) => {
          await disposeResource(resourceId, {
            hard: true,
            reason: "Nested isolate host closed",
          });
        }),
      );
      hosts.delete(hostId);
    },
    async diagnostics(hostId) {
      const host = requireHost(hostId);
      return {
        runtimes: host.runtimeIds.size,
        servers: host.serverIds.size,
        connected: factory.isConnected(),
      };
    },
    async createResource(hostId, kind, rawOptions) {
      const host = requireHost(hostId);
      const controllerContext: NestedHostControllerContext = { group };
      const releaseQuota = reserveNestedResource(group, kind);
      switch (kind) {
        case "runtime": {
          try {
            const options = normalizeRuntimeOptions(
              rawOptions as CreateRuntimeOptions,
              defaultBrowserSource,
              inheritedBindings,
              group,
            );
            const resource = await factory.createRuntime(options, controllerContext);
            const resourceId = randomUUID();
            resources.set(resourceId, {
              kind,
              hostId,
              resource,
              subscriptions: new Map(),
              releaseQuota,
            });
            host.runtimeIds.add(resourceId);
            return resourceId;
          } catch (error) {
            releaseQuota();
            throw error;
          }
        }

        case "appServer": {
          try {
            const options = normalizeAppServerOptions(
              rawOptions as CreateAppServerOptions,
              defaultBrowserSource,
              inheritedBindings,
              group,
            );
            const resource = await factory.createAppServer(options, controllerContext);
            const resourceId = randomUUID();
            const record: AppServerResourceRecord = {
              kind,
              hostId,
              resource,
              releaseQuota,
            };
            if (group.policy.maxAppServerLifetimeMs !== undefined) {
              record.lifetimeTimer = setTimeout(() => {
                void disposeResource(resourceId, {
                  hard: true,
                  reason: "Nested app server lifetime exceeded",
                });
              }, group.policy.maxAppServerLifetimeMs);
            }
            resources.set(resourceId, record);
            host.serverIds.add(resourceId);
            return resourceId;
          } catch (error) {
            releaseQuota();
            throw error;
          }
        }

        case "testRuntime": {
          try {
            const options = normalizeRuntimeOptions(
              rawOptions as CreateTestRuntimeOptions,
              defaultBrowserSource,
              inheritedBindings,
              group,
            );
            const resource = await factory.createTestRuntime(options, controllerContext);
            const resourceId = randomUUID();
            resources.set(resourceId, {
              kind,
              hostId,
              resource,
              subscriptions: new Map(),
              releaseQuota,
            });
            host.runtimeIds.add(resourceId);
            return resourceId;
          } catch (error) {
            releaseQuota();
            throw error;
          }
        }

        case "namespacedRuntime": {
          try {
            const namespacedOptions = rawOptions as {
              key: string;
              options: CreateNamespacedRuntimeOptions;
            };
            const resource = await factory.getNamespacedRuntime(
              getScopedNamespaceKey(group, hostId, namespacedOptions.key),
              normalizeNamespacedRuntimeOptions(
                namespacedOptions.options,
                defaultBrowserSource,
                inheritedBindings,
                group,
              ),
              controllerContext,
            );
            const resourceId = randomUUID();
            resources.set(resourceId, {
              kind,
              hostId,
              resource,
              subscriptions: new Map(),
              releaseQuota,
            });
            host.runtimeIds.add(resourceId);
            return resourceId;
          } catch (error) {
            releaseQuota();
            throw error;
          }
        }
      }
    },
    async callResource(kind, resourceId, method, args, context) {
      const record = requireResource(resourceId, kind);

      switch (kind) {
        case "runtime": {
          const runtimeRecord = record as RuntimeResourceRecord;
          switch (method) {
            case "eval": {
              const rawOptions =
                (args[1] as ({
                  filename?: string;
                  executionTimeout?: number;
                } & AbortableNestedOptions) | null) ?? undefined;
              const operation = createOperationSignal(rawOptions, context);
              const evalOptions = {
                ...(stripAbortOperation<{
                  filename?: string;
                  executionTimeout?: number;
                }>(rawOptions) ?? {}),
                signal: operation.signal,
              };
              try {
                await runtimeRecord.resource.eval(
                  args[0] as string,
                  Object.keys(evalOptions).length > 0 ? evalOptions : undefined,
                );
                await flushNestedRuntime(runtimeRecord.resource);
              } finally {
                operation.cleanup();
              }
              return undefined;
            }
            case "dispose":
              await disposeResource(resourceId, (args[0] as { hard?: boolean; reason?: string } | null) ?? {});
              return undefined;
            case "diagnostics":
              return await runtimeRecord.resource.diagnostics();
            case "events.on": {
              const subscriptionId = randomUUID();
              const unsubscribe = runtimeRecord.resource.events.on(
                args[0] as string,
                createNonReentrantEventHandler(
                  "nestedHost.runtime.events.on",
                  args[1] as (payload: unknown) => void,
                ),
              );
              runtimeRecord.subscriptions.set(subscriptionId, unsubscribe);
              return subscriptionId;
            }
            case "events.off": {
              const subscriptionId = args[0] as string;
              const unsubscribe = runtimeRecord.subscriptions.get(subscriptionId);
              if (unsubscribe) {
                unsubscribe();
                runtimeRecord.subscriptions.delete(subscriptionId);
              }
              return undefined;
            }
            case "events.emit":
              await runtimeRecord.resource.events.emit(
                args[0] as string,
                args[1],
              );
              return undefined;
            default:
              throw new Error(`Unsupported nested runtime method: ${method}`);
          }
        }

        case "appServer": {
          const server = (record as AppServerResourceRecord).resource;
          switch (method) {
            case "handle": {
              const rawOptions =
                (args[1] as ({
                  requestId?: string;
                  metadata?: Record<string, string>;
                } & AbortableNestedOptions) | null) ?? undefined;
              const operation = createOperationSignal(rawOptions, context);
              const handleOptions = {
                ...(stripAbortOperation<{
                  requestId?: string;
                  metadata?: Record<string, string>;
                }>(rawOptions) ?? {}),
                signal: operation.signal,
              };
              try {
                return await server.handle(
                  toRequest(args[0] as SerializedRequestLike),
                  Object.keys(handleOptions).length > 0 ? handleOptions : undefined,
                );
              } finally {
                operation.cleanup();
              }
            }
            case "ws.open":
              await server.ws.open(args[0] as string);
              return undefined;
            case "ws.message":
              await server.ws.message(
                args[0] as string,
                args[1] as string | ArrayBuffer,
              );
              return undefined;
            case "ws.close":
              await server.ws.close(
                args[0] as string,
                args[1] as number,
                args[2] as string,
              );
              return undefined;
            case "ws.error":
              await server.ws.error(
                args[0] as string,
                toError(args[1]),
              );
              return undefined;
            case "reload":
              await server.reload((args[0] as string | null) ?? undefined);
              return undefined;
            case "dispose":
              await disposeResource(
                resourceId,
                ((args[0] as { hard?: boolean; reason?: string } | null) ?? {}),
              );
              return undefined;
            case "diagnostics":
              return await server.diagnostics();
            default:
              throw new Error(`Unsupported nested app server method: ${method}`);
          }
        }

        case "testRuntime": {
          const runtimeRecord = record as TestRuntimeResourceRecord;
          const runtime = runtimeRecord.resource;
          switch (method) {
            case "run": {
              const rawOptions =
                (args[1] as ({
                  filename?: string;
                  timeoutMs?: number;
                } & AbortableNestedOptions) | null) ?? undefined;
              const operation = createOperationSignal(rawOptions, context);
              const runOptions = {
                ...(stripAbortOperation<{
                  filename?: string;
                  timeoutMs?: number;
                }>(rawOptions) ?? {}),
                signal: operation.signal,
              };
              try {
                return await runtime.run(
                  args[0] as string,
                  Object.keys(runOptions).length > 0 ? runOptions : undefined,
                );
              } finally {
                operation.cleanup();
              }
            }
            case "dispose":
              await disposeResource(
                resourceId,
                ((args[0] as { hard?: boolean; reason?: string } | null) ?? {}),
              );
              return undefined;
            case "diagnostics":
              return await runtime.diagnostics();
            case "test.on": {
              const subscriptionId = randomUUID();
              const unsubscribe = runtime.test.onEvent(
                createNonReentrantEventHandler(
                  "nestedHost.testRuntime.test.on",
                  args[0] as (payload: unknown) => void,
                ),
              );
              runtimeRecord.subscriptions.set(subscriptionId, unsubscribe);
              return subscriptionId;
            }
            case "test.off": {
              const subscriptionId = args[0] as string;
              const unsubscribe = runtimeRecord.subscriptions.get(subscriptionId);
              if (unsubscribe) {
                unsubscribe();
                runtimeRecord.subscriptions.delete(subscriptionId);
              }
              return undefined;
            }
            default:
              throw new Error(
                `Unsupported nested test runtime method: ${method}`,
              );
          }
        }

        case "namespacedRuntime": {
          const runtimeRecord = record as NamespacedRuntimeResourceRecord;
          switch (method) {
            case "eval": {
              const rawOptions =
                (args[1] as ({
                  filename?: string;
                  executionTimeout?: number;
                } & AbortableNestedOptions) | null) ?? undefined;
              const operation = createOperationSignal(rawOptions, context);
              const evalOptions = {
                ...(stripAbortOperation<{
                  filename?: string;
                  executionTimeout?: number;
                }>(rawOptions) ?? {}),
                signal: operation.signal,
              };
              try {
                await runtimeRecord.resource.eval(
                  args[0] as string,
                  Object.keys(evalOptions).length > 0 ? evalOptions : undefined,
                );
                await flushNestedRuntime(runtimeRecord.resource);
              } finally {
                operation.cleanup();
              }
              return undefined;
            }
            case "runTests": {
              const rawOptions =
                (args[1] as ({
                  filename?: string;
                  timeoutMs?: number;
                } & AbortableNestedOptions) | null) ?? undefined;
              const operation = createOperationSignal(rawOptions, context);
              const runOptions = {
                ...(stripAbortOperation<{
                  filename?: string;
                  timeoutMs?: number;
                }>(rawOptions) ?? {}),
                signal: operation.signal,
              };
              try {
                return await runtimeRecord.resource.runTests(
                  args[0] as string,
                  Object.keys(runOptions).length > 0 ? runOptions : undefined,
                );
              } finally {
                operation.cleanup();
              }
            }
            case "dispose":
              await disposeResource(
                resourceId,
                ((args[0] as { hard?: boolean; reason?: string } | null) ?? {}),
              );
              return undefined;
            case "diagnostics":
              return await runtimeRecord.resource.diagnostics();
            case "test.on": {
              const subscriptionId = randomUUID();
              const unsubscribe = runtimeRecord.resource.test.onEvent(
                createNonReentrantEventHandler(
                  "nestedHost.namespacedRuntime.test.on",
                  args[0] as (payload: unknown) => void,
                ),
              );
              runtimeRecord.subscriptions.set(subscriptionId, unsubscribe);
              return subscriptionId;
            }
            case "test.off": {
              const subscriptionId = args[0] as string;
              const unsubscribe =
                runtimeRecord.subscriptions.get(subscriptionId);
              if (unsubscribe) {
                unsubscribe();
                runtimeRecord.subscriptions.delete(subscriptionId);
              }
              return undefined;
            }
            case "events.on": {
              const subscriptionId = randomUUID();
              const unsubscribe = runtimeRecord.resource.events.on(
                args[0] as string,
                createNonReentrantEventHandler(
                  "nestedHost.namespacedRuntime.events.on",
                  args[1] as (payload: unknown) => void,
                ),
              );
              runtimeRecord.subscriptions.set(subscriptionId, unsubscribe);
              return subscriptionId;
            }
            case "events.off": {
              const subscriptionId = args[0] as string;
              const unsubscribe =
                runtimeRecord.subscriptions.get(subscriptionId);
              if (unsubscribe) {
                unsubscribe();
                runtimeRecord.subscriptions.delete(subscriptionId);
              }
              return undefined;
            }
            case "events.emit":
              await runtimeRecord.resource.events.emit(
                args[0] as string,
                args[1],
              );
              return undefined;
            default:
              throw new Error(
                `Unsupported nested namespaced runtime method: ${method}`,
              );
          }
        }
      }
    },
    async disposeNamespace(hostId, key, options) {
      requireHost(hostId);
      const scopedKey = group.namespaceKeys.get(`${hostId}\0${key}`);
      if (!scopedKey) {
        return;
      }
      await factory.disposeNamespace(scopedKey, options);
    },
    async abortResourceCall(operationId, reason) {
      const controller = operationAbortControllers.get(operationId);
      if (controller) {
        if (!controller.signal.aborted) {
          controller.abort(createAbortError(reason));
        }
        return;
      }

      earlyAbortedOperations.set(operationId, reason);
    },
    async disposeAll(reason) {
      const resourceIds = [...resources.keys()];
      await Promise.allSettled(
        resourceIds.map(async (resourceId) => {
          await disposeResource(resourceId, {
            hard: true,
            reason: reason ?? "Nested isolate parent disposed",
          });
        }),
      );
      hosts.clear();
      operationAbortControllers.clear();
      earlyAbortedOperations.clear();
    },
  };
}
