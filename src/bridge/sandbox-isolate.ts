import { ISOLATE_BROWSER_DESCRIPTOR_PROPERTY } from "../internal/browser-source.ts";
import type {
  CreateAppServerOptions,
  CreateNamespacedRuntimeOptions,
  CreateRuntimeOptions,
  CreateTestRuntimeOptions,
  HostCallContext,
} from "../types.ts";

export const SANDBOX_ISOLATE_MODULE_SPECIFIER = "@ricsam/isolate";

export type NestedResourceKind =
  | "runtime"
  | "appServer"
  | "testRuntime"
  | "namespacedRuntime";

export interface NestedHostBindings {
  createHost(context: HostCallContext): Promise<string>;
  closeHost(hostId: string, context: HostCallContext): Promise<void>;
  diagnostics(
    hostId: string,
    context: HostCallContext,
  ): Promise<{ runtimes: number; servers: number; connected: boolean }>;
  createResource(
    hostId: string,
    kind: NestedResourceKind,
    options:
      | CreateRuntimeOptions
      | CreateAppServerOptions
      | CreateTestRuntimeOptions
      | {
          key: string;
          options: CreateNamespacedRuntimeOptions;
        },
    context: HostCallContext,
  ): Promise<string>;
  disposeNamespace(
    hostId: string,
    key: string,
    options: { reason?: string } | undefined,
    context: HostCallContext,
  ): Promise<void>;
  callResource(
    kind: NestedResourceKind,
    resourceId: string,
    method: string,
    args: unknown[],
    context: HostCallContext,
  ): Promise<unknown>;
}

export const SANDBOX_ISOLATE_MODULE_SOURCE = `
const __isolateBrowserDescriptorProperty = ${JSON.stringify(ISOLATE_BROWSER_DESCRIPTOR_PROPERTY)};

function __normalizeBrowserHandle(value) {
  if (
    value &&
    typeof value === "object" &&
    value[__isolateBrowserDescriptorProperty]
  ) {
    return {
      [__isolateBrowserDescriptorProperty]: value[__isolateBrowserDescriptorProperty],
    };
  }
  return value;
}

function __normalizeBindings(bindings) {
  if (!bindings || typeof bindings !== "object") {
    return {};
  }

  const normalized = { ...bindings };
  if ("browser" in normalized) {
    normalized.browser = __normalizeBrowserHandle(normalized.browser);
  }
  return normalized;
}

function __normalizeRuntimeOptions(options) {
  const normalized = options ? { ...options } : {};
  normalized.bindings = __normalizeBindings(normalized.bindings);
  return normalized;
}

function __normalizeNamespacedRuntimeOptions(key, options) {
  return {
    key,
    options: __normalizeRuntimeOptions(options),
  };
}

async function __serializeRequest(requestLike) {
  const request = requestLike instanceof Request
    ? requestLike
    : new Request(requestLike);
  const headers = [];
  request.headers.forEach((value, key) => {
    headers.push([key, value]);
  });
  let body = null;
  if (request.body) {
    const cloned = request.clone();
    body = Array.from(new Uint8Array(await cloned.arrayBuffer()));
  }
  return {
    url: request.url,
    method: request.method,
    headers,
    body,
  };
}

function __normalizeEvalOptions(options) {
  if (typeof options === "string") {
    return { filename: options };
  }
  return options ?? null;
}

async function __waitForNestedCallbacks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

class NestedScriptRuntime {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async eval(code, options) {
    await __isolateHost_callResource(
      "runtime",
      this.#resourceId,
      "eval",
      [code, __normalizeEvalOptions(options)],
    );
    await __waitForNestedCallbacks();
  }

  async dispose(options) {
    await __isolateHost_callResource(
      "runtime",
      this.#resourceId,
      "dispose",
      [options ?? null],
    );
    await __waitForNestedCallbacks();
  }

  async diagnostics() {
    return await __isolateHost_callResource(
      "runtime",
      this.#resourceId,
      "diagnostics",
      [],
    );
  }

  events = {
    on: (event, handler) => {
      const subscriptionPromise = __isolateHost_callResource(
        "runtime",
        this.#resourceId,
        "events.on",
        [event, handler],
      );
      return () => {
        void subscriptionPromise
          .then((subscriptionId) => __isolateHost_callResource(
            "runtime",
            this.#resourceId,
            "events.off",
            [subscriptionId],
          ))
          .catch(() => {});
      };
    },
    emit: async (event, payload) => {
      await __isolateHost_callResource(
        "runtime",
        this.#resourceId,
        "events.emit",
        [event, payload],
      );
      await __waitForNestedCallbacks();
    },
  };
}

class NestedAppServer {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async handle(request, options) {
    const serializedRequest = await __serializeRequest(request);
    const result = await __isolateHost_callResource(
      "appServer",
      this.#resourceId,
      "handle",
      [
        serializedRequest,
        options
          ? {
              requestId: options.requestId,
              metadata: options.metadata,
            }
          : null,
        ],
    );
    await __waitForNestedCallbacks();
    return result;
  }

  ws = {
    open: async (connectionId) => {
      await __isolateHost_callResource(
        "appServer",
        this.#resourceId,
        "ws.open",
        [connectionId],
      );
      await __waitForNestedCallbacks();
    },
    message: async (connectionId, data) => {
      await __isolateHost_callResource(
        "appServer",
        this.#resourceId,
        "ws.message",
        [connectionId, data],
      );
      await __waitForNestedCallbacks();
    },
    close: async (connectionId, code, reason) => {
      await __isolateHost_callResource(
        "appServer",
        this.#resourceId,
        "ws.close",
        [connectionId, code, reason],
      );
      await __waitForNestedCallbacks();
    },
    error: async (connectionId, error) => {
      await __isolateHost_callResource(
        "appServer",
        this.#resourceId,
        "ws.error",
        [connectionId, error],
      );
      await __waitForNestedCallbacks();
    },
  };

  async reload(reason) {
    await __isolateHost_callResource(
      "appServer",
      this.#resourceId,
      "reload",
      [reason ?? null],
    );
    await __waitForNestedCallbacks();
  }

  async dispose(options) {
    await __isolateHost_callResource(
      "appServer",
      this.#resourceId,
      "dispose",
      [options ?? null],
    );
    await __waitForNestedCallbacks();
  }

  async diagnostics() {
    return await __isolateHost_callResource(
      "appServer",
      this.#resourceId,
      "diagnostics",
      [],
    );
  }
}

class NestedTestRuntime {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async run(code, options) {
    const result = await __isolateHost_callResource(
      "testRuntime",
      this.#resourceId,
      "run",
      [code, options ?? null],
    );
    await __waitForNestedCallbacks();
    return result;
  }

  async diagnostics() {
    return await __isolateHost_callResource(
      "testRuntime",
      this.#resourceId,
      "diagnostics",
      [],
    );
  }

  async dispose(options) {
    await __isolateHost_callResource(
      "testRuntime",
      this.#resourceId,
      "dispose",
      [options ?? null],
    );
    await __waitForNestedCallbacks();
  }
}

class NestedNamespacedRuntime {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async eval(code, options) {
    await __isolateHost_callResource(
      "namespacedRuntime",
      this.#resourceId,
      "eval",
      [code, __normalizeEvalOptions(options)],
    );
    await __waitForNestedCallbacks();
  }

  async runTests(code, options) {
    const result = await __isolateHost_callResource(
      "namespacedRuntime",
      this.#resourceId,
      "runTests",
      [code, options ?? null],
    );
    await __waitForNestedCallbacks();
    return result;
  }

  async diagnostics() {
    return await __isolateHost_callResource(
      "namespacedRuntime",
      this.#resourceId,
      "diagnostics",
      [],
    );
  }

  async dispose(options) {
    await __isolateHost_callResource(
      "namespacedRuntime",
      this.#resourceId,
      "dispose",
      [options ?? null],
    );
    await __waitForNestedCallbacks();
  }

  events = {
    on: (event, handler) => {
      const subscriptionPromise = __isolateHost_callResource(
        "namespacedRuntime",
        this.#resourceId,
        "events.on",
        [event, handler],
      );
      return () => {
        void subscriptionPromise
          .then((subscriptionId) => __isolateHost_callResource(
            "namespacedRuntime",
            this.#resourceId,
            "events.off",
            [subscriptionId],
          ))
          .catch(() => {});
      };
    },
    emit: async (event, payload) => {
      await __isolateHost_callResource(
        "namespacedRuntime",
        this.#resourceId,
        "events.emit",
        [event, payload],
      );
      await __waitForNestedCallbacks();
    },
  };
}

export function createIsolateHost() {
  let hostIdPromise;

  const ensureHostId = async () => {
    if (!hostIdPromise) {
      hostIdPromise = __isolateHost_createHost();
    }
    return await hostIdPromise;
  };

  return {
    async createRuntime(options) {
      const hostId = await ensureHostId();
      const resourceId = await __isolateHost_createResource(
        hostId,
        "runtime",
        __normalizeRuntimeOptions(options),
      );
      return new NestedScriptRuntime(resourceId);
    },
    async createAppServer(options) {
      const hostId = await ensureHostId();
      const resourceId = await __isolateHost_createResource(
        hostId,
        "appServer",
        __normalizeRuntimeOptions(options),
      );
      return new NestedAppServer(resourceId);
    },
    async createTestRuntime(options) {
      const hostId = await ensureHostId();
      const resourceId = await __isolateHost_createResource(
        hostId,
        "testRuntime",
        __normalizeRuntimeOptions(options),
      );
      return new NestedTestRuntime(resourceId);
    },
    async getNamespacedRuntime(key, options) {
      const hostId = await ensureHostId();
      const resourceId = await __isolateHost_createResource(
        hostId,
        "namespacedRuntime",
        __normalizeNamespacedRuntimeOptions(key, options),
      );
      return new NestedNamespacedRuntime(resourceId);
    },
    async disposeNamespace(key, options) {
      const hostId = await ensureHostId();
      await __isolateHost_disposeNamespace(hostId, key, options ?? null);
      await __waitForNestedCallbacks();
    },
    async diagnostics() {
      return await __isolateHost_hostDiagnostics(await ensureHostId());
    },
    async close() {
      const hostId = await ensureHostId();
      await __isolateHost_closeHost(hostId);
      await __waitForNestedCallbacks();
    },
  };
}
`;
