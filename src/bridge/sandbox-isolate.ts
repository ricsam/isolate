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
  abortResourceCall(
    operationId: string,
    reason: string | undefined,
    context: HostCallContext,
  ): Promise<void>;
  disposeAll?(reason?: string): Promise<void>;
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

function __moduleNormalizePathSeparators(input) {
  return String(input ?? "").split("\\\\").join("/");
}

function __moduleTrimTrailingSlashes(input) {
  const trimmed = String(input).replace(/\\/+$/g, "");
  return trimmed === "" && String(input).startsWith("/") ? "/" : trimmed;
}

function __moduleNormalizePath(input) {
  const normalized = __moduleNormalizePathSeparators(input);
  const absolute = normalized.startsWith("/");
  const parts = [];

  for (const part of normalized.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }

    parts.push(part);
  }

  const joined = parts.join("/");
  if (absolute) {
    return joined ? "/" + joined : "/";
  }
  return joined || ".";
}

function __moduleBasename(input) {
  const normalized = __moduleTrimTrailingSlashes(__moduleNormalizePathSeparators(input));
  if (!normalized || normalized === "/") {
    return "";
  }
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function __moduleDirname(input) {
  const normalized = __moduleTrimTrailingSlashes(__moduleNormalizePathSeparators(input));
  if (!normalized || normalized === "/") {
    return "/";
  }
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return ".";
  }
  if (index === 0) {
    return "/";
  }
  return normalized.slice(0, index);
}

function __moduleResolveSpecifier(specifier, importer) {
  const normalizedSpecifier = __moduleNormalizePathSeparators(specifier);
  if (!normalizedSpecifier.startsWith(".")) {
    return normalizedSpecifier;
  }
  const base = importer?.resolveDir ?? "/";
  return __moduleNormalizePath(
    __moduleTrimTrailingSlashes(base) + "/" + normalizedSpecifier,
  );
}

function __moduleMatchSourceTreePath(prefix, specifier) {
  const normalizedPrefix = __moduleTrimTrailingSlashes(
    __moduleNormalizePathSeparators(prefix),
  );
  const normalizedSpecifier = __moduleNormalizePathSeparators(specifier);

  let rawRelativePath = null;
  if (normalizedPrefix === "/") {
    if (normalizedSpecifier.startsWith("/")) {
      rawRelativePath = normalizedSpecifier.slice(1);
    }
  } else if (normalizedSpecifier === normalizedPrefix) {
    rawRelativePath = "";
  } else if (normalizedSpecifier.startsWith(normalizedPrefix + "/")) {
    rawRelativePath = normalizedSpecifier.slice(normalizedPrefix.length + 1);
  }

  if (rawRelativePath == null) {
    return null;
  }

  if (rawRelativePath === "") {
    return "";
  }

  const relativePath = __moduleNormalizePath(rawRelativePath);
  if (relativePath === "." || relativePath === "") {
    return "";
  }
  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("/")
  ) {
    throw new Error(
      'Access denied: module specifier escapes source tree "' +
        prefix +
        '": ' +
        specifier,
    );
  }
  return relativePath;
}

async function __normalizeModuleResolveResult(specifier, result, fallbackResolveDir) {
  const resolved = await result;
  if (resolved == null) {
    return null;
  }

  if (typeof resolved === "string") {
    return {
      code: resolved,
      filename: __moduleBasename(specifier) || "__virtual_module__.js",
      resolveDir: String(specifier).startsWith("/")
        ? __moduleDirname(specifier)
        : fallbackResolveDir ?? "/",
    };
  }

  return {
    static: resolved.static,
    filename: resolved.filename,
    resolveDir: resolved.resolveDir,
    code: resolved.code,
  };
}

async function __normalizeVirtualModuleResult(specifier, source, options, fallbackResolveDir) {
  const raw = typeof source === "function" ? await source() : await source;
  const normalized = await __normalizeModuleResolveResult(
    specifier,
    raw,
    fallbackResolveDir,
  );
  if (!normalized) {
    return null;
  }
  return options ? { ...normalized, ...options } : normalized;
}

function __createNestedModuleResolverBuilder() {
  const virtualEntries = new Map();
  const sourceTrees = [];
  let fallbackLoader;

  const resolver = {
    virtual(specifier, source, options) {
      virtualEntries.set(specifier, { source, options });
      return resolver;
    },

    sourceTree(prefix, loader) {
      sourceTrees.push({ prefix, loader });
      return resolver;
    },

    fallback(loader) {
      fallbackLoader = loader;
      return resolver;
    },

    async resolve(specifier, importer) {
      const resolvedSpecifier = __moduleResolveSpecifier(specifier, importer);
      const explicit = virtualEntries.get(resolvedSpecifier);
      if (explicit) {
        const normalized = await __normalizeVirtualModuleResult(
          resolvedSpecifier,
          explicit.source,
          explicit.options,
          importer?.resolveDir,
        );
        if (!normalized) {
          throw new Error("Virtual module " + resolvedSpecifier + " returned no source.");
        }
        return normalized;
      }

      for (const sourceTree of sourceTrees) {
        const relativePath = __moduleMatchSourceTreePath(
          sourceTree.prefix,
          resolvedSpecifier,
        );
        if (relativePath == null) {
          continue;
        }
        const normalized = await __normalizeModuleResolveResult(
          resolvedSpecifier,
          sourceTree.loader(relativePath, importer),
          importer?.resolveDir,
        );
        if (normalized) {
          return normalized;
        }
      }

      if (fallbackLoader) {
        const normalized = await __normalizeModuleResolveResult(
          resolvedSpecifier,
          fallbackLoader(resolvedSpecifier, importer),
          importer?.resolveDir,
        );
        if (normalized) {
          return normalized;
        }
      }

      throw new Error("Unable to resolve module: " + specifier);
    },
  };

  return resolver;
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

let __abortOperationIndex = 0;

function __createAbortError(reason) {
  if (reason instanceof Error) {
    const error = new Error(reason.message);
    error.name = "AbortError";
    error.cause = reason;
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

function __abortReasonMessage(reason) {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : undefined;
}

function __prepareAbortableOptions(options, fallbackSignal) {
  const normalized = options ? { ...options } : {};
  const signal = normalized.signal ?? fallbackSignal;
  delete normalized.signal;

  if (!signal) {
    return {
      options: Object.keys(normalized).length > 0 ? normalized : null,
      cleanup() {},
    };
  }

  if (signal.aborted) {
    throw __createAbortError(signal.reason);
  }

  const operationId = "nested-abort:" + (++__abortOperationIndex) + ":" + Math.random().toString(36).slice(2);
  normalized.__isolateAbortOperationId = operationId;

  const onAbort = () => {
    void __isolateHost_abortResourceCall(
      operationId,
      __abortReasonMessage(signal.reason),
    ).catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });

  return {
    options: normalized,
    cleanup() {
      signal.removeEventListener("abort", onAbort);
    },
  };
}

function __requestSignal(requestLike) {
  return requestLike instanceof Request ? requestLike.signal : undefined;
}

async function __waitForCallbackTurn() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function __waitForNestedCallbacks() {
  const settleTurns = 3;

  if (typeof __isolateHost_drainCallbacks === "function") {
    await __isolateHost_drainCallbacks(settleTurns);
    return;
  }

  for (let index = 0; index < settleTurns; index += 1) {
    await __waitForCallbackTurn();
  }
}

class NestedScriptRuntime {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async eval(code, options) {
    const abortable = __prepareAbortableOptions(__normalizeEvalOptions(options));
    try {
      await __isolateHost_callResource(
        "runtime",
        this.#resourceId,
        "eval",
        [code, abortable.options],
      );
    } finally {
      abortable.cleanup();
    }
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
    const abortable = __prepareAbortableOptions(
      options
        ? {
            requestId: options.requestId,
            metadata: options.metadata,
            signal: options.signal,
          }
        : null,
      __requestSignal(request),
    );
    let result;
    try {
      result = await __isolateHost_callResource(
        "appServer",
        this.#resourceId,
        "handle",
        [
          serializedRequest,
          abortable.options,
        ],
      );
    } finally {
      abortable.cleanup();
    }
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
    const abortable = __prepareAbortableOptions(options ?? null);
    let result;
    try {
      result = await __isolateHost_callResource(
        "testRuntime",
        this.#resourceId,
        "run",
        [code, abortable.options],
      );
    } finally {
      abortable.cleanup();
    }
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

  test = {
    onEvent: (handler) => {
      const subscriptionPromise = __isolateHost_callResource(
        "testRuntime",
        this.#resourceId,
        "test.on",
        [handler],
      );
      return () => {
        void subscriptionPromise
          .then((subscriptionId) => __isolateHost_callResource(
            "testRuntime",
            this.#resourceId,
            "test.off",
            [subscriptionId],
          ))
          .catch(() => {});
      };
    },
  };
}

class NestedNamespacedRuntime {
  #resourceId;

  constructor(resourceId) {
    this.#resourceId = resourceId;
  }

  async eval(code, options) {
    const abortable = __prepareAbortableOptions(__normalizeEvalOptions(options));
    try {
      await __isolateHost_callResource(
        "namespacedRuntime",
        this.#resourceId,
        "eval",
        [code, abortable.options],
      );
    } finally {
      abortable.cleanup();
    }
    await __waitForNestedCallbacks();
  }

  async runTests(code, options) {
    const abortable = __prepareAbortableOptions(options ?? null);
    let result;
    try {
      result = await __isolateHost_callResource(
        "namespacedRuntime",
        this.#resourceId,
        "runTests",
        [code, abortable.options],
      );
    } finally {
      abortable.cleanup();
    }
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

  test = {
    onEvent: (handler) => {
      const subscriptionPromise = __isolateHost_callResource(
        "namespacedRuntime",
        this.#resourceId,
        "test.on",
        [handler],
      );
      return () => {
        void subscriptionPromise
          .then((subscriptionId) => __isolateHost_callResource(
            "namespacedRuntime",
            this.#resourceId,
            "test.off",
            [subscriptionId],
          ))
          .catch(() => {});
      };
    },
  };

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

export function createModuleResolver() {
  return __createNestedModuleResolverBuilder();
}
`;
