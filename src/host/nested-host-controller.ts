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
  RequestResult,
  ScriptRuntime,
  TestRuntime,
} from "../types.ts";

interface NestedHostFactory {
  createRuntime(options: CreateRuntimeOptions): Promise<ScriptRuntime>;
  createAppServer(options: CreateAppServerOptions): Promise<AppServer>;
  createTestRuntime(options: CreateTestRuntimeOptions): Promise<TestRuntime>;
  getNamespacedRuntime(
    key: string,
    options: CreateNamespacedRuntimeOptions,
  ): Promise<NamespacedRuntime>;
  disposeNamespace(key: string, options?: { reason?: string }): Promise<void>;
  isConnected(): boolean;
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
}

interface AppServerResourceRecord {
  kind: "appServer";
  hostId: string;
  resource: AppServer;
}

interface TestRuntimeResourceRecord {
  kind: "testRuntime";
  hostId: string;
  resource: TestRuntime;
  subscriptions: Map<string, () => void>;
}

interface NamespacedRuntimeResourceRecord {
  kind: "namespacedRuntime";
  hostId: string;
  resource: NamespacedRuntime;
  subscriptions: Map<string, () => void>;
}

type NestedResourceRecord =
  | RuntimeResourceRecord
  | AppServerResourceRecord
  | TestRuntimeResourceRecord
  | NamespacedRuntimeResourceRecord;

interface SerializedRequestLike {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: number[] | null;
}

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
): HostBindings {
  const normalized: HostBindings = {
    console: bindings?.console,
    fetch: bindings?.fetch,
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
): CreateRuntimeOptions {
  return {
    ...options,
    bindings: normalizeBindings(options.bindings, defaultBrowserSource),
  };
}

function normalizeAppServerOptions(
  options: CreateAppServerOptions,
  defaultBrowserSource: BrowserSource | undefined,
): CreateAppServerOptions {
  return {
    ...options,
    bindings: normalizeBindings(options.bindings, defaultBrowserSource),
  };
}

function normalizeNamespacedRuntimeOptions(
  options: CreateNamespacedRuntimeOptions,
  defaultBrowserSource: BrowserSource | undefined,
): CreateNamespacedRuntimeOptions {
  return {
    ...options,
    bindings: normalizeBindings(options.bindings, defaultBrowserSource),
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

export function createNestedHostBindings(
  factory: NestedHostFactory,
  defaultBrowserSource: BrowserSource | undefined,
): NestedHostBindings {
  const hosts = new Map<string, NestedHostRecord>();
  const resources = new Map<string, NestedResourceRecord>();

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
      switch (kind) {
        case "runtime": {
          const options = normalizeRuntimeOptions(
            rawOptions as CreateRuntimeOptions,
            defaultBrowserSource,
          );
          const resource = await factory.createRuntime(options);
          const resourceId = randomUUID();
          resources.set(resourceId, {
            kind,
            hostId,
            resource,
            subscriptions: new Map(),
          });
          host.runtimeIds.add(resourceId);
          return resourceId;
        }

        case "appServer": {
          const options = normalizeAppServerOptions(
            rawOptions as CreateAppServerOptions,
            defaultBrowserSource,
          );
          const resource = await factory.createAppServer(options);
          const resourceId = randomUUID();
          resources.set(resourceId, {
            kind,
            hostId,
            resource,
          });
          host.serverIds.add(resourceId);
          return resourceId;
        }

        case "testRuntime": {
          const options = normalizeRuntimeOptions(
            rawOptions as CreateTestRuntimeOptions,
            defaultBrowserSource,
          );
          const resource = await factory.createTestRuntime(options);
          const resourceId = randomUUID();
          resources.set(resourceId, {
            kind,
            hostId,
            resource,
            subscriptions: new Map(),
          });
          host.runtimeIds.add(resourceId);
          return resourceId;
        }

        case "namespacedRuntime": {
          const namespacedOptions = rawOptions as {
            key: string;
            options: CreateNamespacedRuntimeOptions;
          };
          const resource = await factory.getNamespacedRuntime(
            namespacedOptions.key,
            normalizeNamespacedRuntimeOptions(
              namespacedOptions.options,
              defaultBrowserSource,
            ),
          );
          const resourceId = randomUUID();
          resources.set(resourceId, {
            kind,
            hostId,
            resource,
            subscriptions: new Map(),
          });
          host.runtimeIds.add(resourceId);
          return resourceId;
        }
      }
    },
    async callResource(kind, resourceId, method, args) {
      const record = requireResource(resourceId, kind);

      switch (kind) {
        case "runtime": {
          const runtimeRecord = record as RuntimeResourceRecord;
          switch (method) {
            case "eval":
              await runtimeRecord.resource.eval(
                args[0] as string,
                (args[1] as string | { filename?: string; executionTimeout?: number } | null) ??
                  undefined,
              );
              return undefined;
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
              const result = await server.handle(
                toRequest(args[0] as SerializedRequestLike),
                ((args[1] as {
                  requestId?: string;
                  metadata?: Record<string, string>;
                } | null) ?? undefined),
              );
              return result;
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
            case "run":
              return await runtime.run(
                args[0] as string,
                ((args[1] as {
                  filename?: string;
                  timeoutMs?: number;
                } | null) ?? undefined),
              );
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
            case "eval":
              await runtimeRecord.resource.eval(
                args[0] as string,
                ((args[1] as {
                  filename?: string;
                  executionTimeout?: number;
                } | null) ?? undefined),
              );
              return undefined;
            case "runTests":
              return await runtimeRecord.resource.runTests(
                args[0] as string,
                ((args[1] as {
                  filename?: string;
                  timeoutMs?: number;
                } | null) ?? undefined),
              );
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
      await factory.disposeNamespace(key, options);
    },
  };
}
