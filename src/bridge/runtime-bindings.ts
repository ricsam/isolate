import path from "node:path";
import type { RuntimeOptions } from "../internal/client/index.ts";
import { invokeBestEffortEventHandlerNonReentrant } from "../internal/event-callback.ts";
import type { ModuleLoaderCallback } from "../internal/protocol/index.ts";
import { createPlaywrightFactoryHandler } from "../internal/playwright/client.ts";
import { getRequestContext } from "./request-context.ts";
import {
  SANDBOX_ISOLATE_MODULE_SOURCE,
  SANDBOX_ISOLATE_MODULE_SPECIFIER,
  type NestedHostBindings,
  type NestedResourceKind,
} from "./sandbox-isolate.ts";
import type {
  CreateAppServerOptions,
  CreateNamespacedRuntimeOptions,
  CreateRuntimeOptions,
  CreateTestRuntimeOptions,
  HostBindings,
  HostCallContext,
  ModuleResolveResult,
  ModuleResolver,
  ModuleSource,
  ToolHandler,
} from "../types.ts";
import type { MutableRuntimeDiagnostics } from "./diagnostics.ts";

export interface RuntimeBindingsAdapter {
  runtimeOptions: RuntimeOptions;
  abort(reason?: unknown): void;
  reset(reason?: unknown): void;
}

export interface RuntimeBindingsAdapterOptions {
  nestedHost?: NestedHostBindings;
}

interface ResponseDescriptor {
  __type: "ResponseRef";
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body?: number[] | null;
}

interface AsyncIteratorMarkedHandler {
  __isolateCallbackKind?: "asyncGenerator";
}

interface ProxyBackedHandler {
  __isolateCallbackProxy?: unknown;
}

function copyIsolateCallbackMetadata<T extends (...args: unknown[]) => unknown>(
  source: ToolHandler,
  target: T,
): T {
  if ((source as ProxyBackedHandler).__isolateCallbackProxy === true) {
    Object.defineProperty(target, "__isolateCallbackProxy", {
      configurable: true,
      enumerable: false,
      value: true,
      writable: false,
    });
  }

  if (
    (source as AsyncIteratorMarkedHandler).__isolateCallbackKind ===
    "asyncGenerator"
  ) {
    Object.defineProperty(target, "__isolateCallbackKind", {
      configurable: true,
      enumerable: false,
      value: "asyncGenerator",
      writable: false,
    });
  }

  return target;
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  const error = new Error(
    typeof reason === "string" ? reason : "The operation was aborted",
  );
  error.name = "AbortError";
  return error;
}

function createAbortSignalComposer() {
  const controllers = new Set<AbortController>();

  const compose = (...signals: Array<AbortSignal | undefined>): AbortSignal => {
    const activeSignals = signals.filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );

    if (activeSignals.length === 0) {
      return AbortSignal.abort(createAbortError());
    }

    const aborted = activeSignals.find((signal) => signal.aborted);
    if (aborted) {
      return AbortSignal.abort(aborted.reason ?? createAbortError());
    }

    if (activeSignals.length === 1) {
      return activeSignals[0]!;
    }

    const controller = new AbortController();
    controllers.add(controller);

    const cleanup = () => {
      for (const signal of activeSignals) {
        signal.removeEventListener("abort", onAbort);
      }
      controllers.delete(controller);
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

    return controller.signal;
  };

  const abortAll = (reason?: unknown) => {
    const error = createAbortError(reason);
    for (const controller of controllers) {
      if (!controller.signal.aborted) {
        controller.abort(error);
      }
    }
    controllers.clear();
  };

  return { compose, abortAll };
}

function createHostCallContextFactory(getRuntimeId: () => string) {
  let runtimeController = new AbortController();
  const composedSignals = createAbortSignalComposer();

  const createHostCallContext = (
    resourceId: string,
    baseSignal?: AbortSignal,
  ): HostCallContext => {
    const requestContext = getRequestContext();
    const ownerSignal = requestContext.signal ?? runtimeController.signal;
    const signal = baseSignal
      ? composedSignals.compose(ownerSignal, baseSignal)
      : ownerSignal;

    return {
      signal,
      runtimeId: getRuntimeId(),
      requestId: requestContext.requestId,
      resourceId,
      metadata: requestContext.metadata,
    };
  };

  const abort = (reason?: unknown) => {
    if (!runtimeController.signal.aborted) {
      runtimeController.abort(createAbortError(reason));
    }
    composedSignals.abortAll(reason);
  };

  const reset = (reason?: unknown) => {
    abort(reason);
    runtimeController = new AbortController();
  };

  return { createHostCallContext, abort, reset };
}

async function normalizeModuleResolveResult(
  specifier: string,
  result: ModuleResolveResult,
  fallbackResolveDir?: string,
): Promise<ModuleSource | null> {
  const resolved = await result;
  if (resolved == null) {
    return null;
  }

  if (typeof resolved === "string") {
    const filename = path.posix.basename(specifier) || "__virtual_module__.js";
    const resolveDir = specifier.startsWith("/")
      ? path.posix.dirname(specifier)
      : fallbackResolveDir ?? "/";
    return {
      code: resolved,
      filename,
      resolveDir,
    };
  }

  return {
    static: resolved.static,
    filename: resolved.filename,
    resolveDir: resolved.resolveDir,
    code: resolved.code,
  };
}

function isAsyncGeneratorFunction(handler: ToolHandler): boolean {
  return (
    handler.constructor.name === "AsyncGeneratorFunction" ||
    (handler as AsyncIteratorMarkedHandler).__isolateCallbackKind ===
      "asyncGenerator"
  );
}

function isResponseDescriptor(value: unknown): value is ResponseDescriptor {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { __type?: unknown }).__type === "ResponseRef" &&
      Array.isArray((value as { headers?: unknown }).headers),
  );
}

function normalizeFetchResponse(value: unknown): Response {
  if (value instanceof Response) {
    return value;
  }

  if (isResponseDescriptor(value)) {
    const body = value.body ? new Uint8Array(value.body) : null;
    return new Response(body, {
      status: value.status,
      statusText: value.statusText,
      headers: value.headers,
    });
  }

  throw new TypeError("Fetch bindings must return a Response.");
}

export function createRuntimeBindingsAdapter(
  bindings: HostBindings,
  getRuntimeId: () => string,
  diagnostics: MutableRuntimeDiagnostics,
  options?: RuntimeBindingsAdapterOptions,
): RuntimeBindingsAdapter {
  const contextFactory = createHostCallContextFactory(getRuntimeId);
  const moduleLoader = createModuleLoader(
    bindings.modules,
    contextFactory.createHostCallContext,
    diagnostics,
    options?.nestedHost,
  );
  const customFunctions = createCustomFunctions(
    bindings.tools,
    options?.nestedHost,
    contextFactory.createHostCallContext,
    diagnostics,
  );
  const browserPlaywright = createBrowserPlaywrightOptions(
    bindings.browser,
    contextFactory.createHostCallContext,
  );

  return {
    runtimeOptions: {
      console: bindings.console?.onEntry
        ? {
            onEntry: (entry) => {
              const context = contextFactory.createHostCallContext(
                `console:${crypto.randomUUID()}`,
              );
              invokeBestEffortEventHandlerNonReentrant(
                "bindings.console.onEntry",
                bindings.console?.onEntry,
                entry,
                context,
              );
            },
          }
        : undefined,
      fetch: bindings.fetch
        ? async (url, init) => {
            diagnostics.pendingFetches += 1;
            diagnostics.activeResources += 1;
            try {
              const context = contextFactory.createHostCallContext(
                `fetch:${crypto.randomUUID()}`,
                init.signal,
              );
              const request = new Request(url, {
                method: init.method,
                headers: init.headers,
                body: init.rawBody ? init.rawBody.slice(0) : null,
                signal: context.signal,
              });
              return normalizeFetchResponse(
                await bindings.fetch!(request, context),
              );
            } finally {
              diagnostics.pendingFetches -= 1;
              diagnostics.activeResources -= 1;
            }
          }
        : undefined,
      fs: bindings.files
        ? {
            readFile: bindings.files.readFile
              ? async (filePath: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:read:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.readFile!(filePath, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            writeFile: bindings.files.writeFile
              ? async (filePath: string, data: ArrayBuffer) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:write:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.writeFile!(filePath, data, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            unlink: bindings.files.unlink
              ? async (filePath: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:unlink:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.unlink!(filePath, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            readdir: bindings.files.readdir
              ? async (dirPath: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:readdir:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.readdir!(dirPath, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            mkdir: bindings.files.mkdir
              ? async (dirPath: string, options?: { recursive?: boolean }) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:mkdir:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.mkdir!(dirPath, options, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            rmdir: bindings.files.rmdir
              ? async (dirPath: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:rmdir:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.rmdir!(dirPath, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            stat: bindings.files.stat
              ? async (filePath: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:stat:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.stat!(filePath, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
            rename: bindings.files.rename
              ? async (from: string, to: string) => {
                  diagnostics.pendingFiles += 1;
                  diagnostics.activeResources += 1;
                  try {
                    const context = contextFactory.createHostCallContext(
                      `files:rename:${crypto.randomUUID()}`,
                    );
                    return await bindings.files!.rename!(from, to, context);
                  } finally {
                    diagnostics.pendingFiles -= 1;
                    diagnostics.activeResources -= 1;
                  }
                }
              : undefined,
          }
        : undefined,
      moduleLoader,
      customFunctions,
      playwright: browserPlaywright,
    },
    abort: contextFactory.abort,
    reset: contextFactory.reset,
  };
}

function createModuleLoader(
  resolver: ModuleResolver | undefined,
  createHostCallContext: (
    resourceId: string,
    baseSignal?: AbortSignal,
  ) => HostCallContext,
  diagnostics: MutableRuntimeDiagnostics,
  nestedHost: NestedHostBindings | undefined,
): ModuleLoaderCallback | undefined {
  if (!resolver && !nestedHost) {
    return undefined;
  }

  return async (specifier, importer) => {
    if (nestedHost && specifier === SANDBOX_ISOLATE_MODULE_SPECIFIER) {
      return {
        code: SANDBOX_ISOLATE_MODULE_SOURCE,
        filename: "isolate-sandbox.js",
        resolveDir: "/",
        static: true,
      };
    }

    if (!resolver) {
      throw new Error(`Unable to resolve module: ${specifier}`);
    }

    diagnostics.pendingModules += 1;
    diagnostics.activeResources += 1;
    try {
      const context = createHostCallContext(`module:${crypto.randomUUID()}`);
      const resolved = await normalizeExplicitModuleResult(
        specifier,
        resolver.resolve(specifier, importer, context),
        importer.resolveDir,
      );
      if (!resolved) {
        throw new Error(`Unable to resolve module: ${specifier}`);
      }
      return resolved;
    } finally {
      diagnostics.pendingModules -= 1;
      diagnostics.activeResources -= 1;
    }
  };
}

export async function tryResolveModule(
  resolver: ModuleResolver | undefined,
  specifier: string,
  importer: { path: string; resolveDir: string },
  context: HostCallContext,
): Promise<ModuleSource | null> {
  if (!resolver) {
    return null;
  }
  return normalizeModuleResolveResult(
    specifier,
    resolver.resolve(specifier, importer, context),
    importer.resolveDir,
  );
}

export async function normalizeExplicitModuleResult(
  specifier: string,
  result: ModuleResolveResult,
  fallbackResolveDir?: string,
): Promise<ModuleSource | null> {
  return normalizeModuleResolveResult(specifier, result, fallbackResolveDir);
}

function createBrowserPlaywrightOptions(
  browser: HostBindings["browser"] | undefined,
  createHostCallContext: (
    resourceId: string,
    baseSignal?: AbortSignal,
  ) => HostCallContext,
): RuntimeOptions["playwright"] | undefined {
  if (!browser) {
    return undefined;
  }

  const hasHandler = typeof browser.handler === "function";
  const hasFactoryBindings =
    typeof browser.createContext === "function" ||
    typeof browser.createPage === "function" ||
    typeof browser.readFile === "function" ||
    typeof browser.writeFile === "function";

  if (hasHandler && hasFactoryBindings) {
    throw new Error(
      "browser bindings must use either handler-first or factory-first mode, not both.",
    );
  }

  if (hasHandler) {
    return {
      handler: browser.handler,
      hasDefaultPage: false,
      console: browser.captureConsole ?? false,
      onEvent: browser.onEvent
        ? (event) => {
            const context = createHostCallContext(
              `browser:event:${event.type}:${crypto.randomUUID()}`,
            );
            invokeBestEffortEventHandlerNonReentrant(
              "bindings.browser.onEvent",
              browser.onEvent,
              event,
              context,
            );
          }
        : undefined,
    };
  }

  return {
    handler: createPlaywrightFactoryHandler({
      createContext: browser.createContext
        ? async (options) => {
            const context = createHostCallContext(
              `browser:createContext:${crypto.randomUUID()}`,
            );
            return await browser.createContext!(options, context);
          }
        : undefined,
      createPage: browser.createPage
        ? async (contextHandle) => {
            const context = createHostCallContext(
              `browser:createPage:${crypto.randomUUID()}`,
            );
            return await browser.createPage!(contextHandle, context);
          }
        : undefined,
      readFile: browser.readFile
        ? async (filePath) => {
            const context = createHostCallContext(
              `browser:readFile:${crypto.randomUUID()}`,
            );
            const buffer = await browser.readFile!(filePath, context);
            return {
              name: path.basename(filePath),
              mimeType: "application/octet-stream",
              buffer,
            };
          }
        : undefined,
      writeFile: browser.writeFile
        ? async (filePath, data) => {
            const context = createHostCallContext(
              `browser:writeFile:${crypto.randomUUID()}`,
            );
            await browser.writeFile!(filePath, data, context);
          }
        : undefined,
    }),
    hasDefaultPage: false,
    console: browser.captureConsole ?? false,
    onEvent: browser.onEvent
      ? (event) => {
          const context = createHostCallContext(
            `browser:event:${event.type}:${crypto.randomUUID()}`,
          );
          invokeBestEffortEventHandlerNonReentrant(
            "bindings.browser.onEvent",
            browser.onEvent,
            event,
            context,
          );
        }
      : undefined,
  };
}

function createCustomFunctions(
  tools: HostBindings["tools"] | undefined,
  nestedHost: NestedHostBindings | undefined,
  createHostCallContext: (
    resourceId: string,
    baseSignal?: AbortSignal,
  ) => HostCallContext,
  diagnostics: MutableRuntimeDiagnostics,
): RuntimeOptions["customFunctions"] {
  const definitions: NonNullable<RuntimeOptions["customFunctions"]> = {};

  if (tools) {
    for (const [name, handler] of Object.entries(tools)) {
      if (isAsyncGeneratorFunction(handler)) {
        const fn = copyIsolateCallbackMetadata(
          handler,
          (...args: unknown[]) => {
            diagnostics.pendingTools += 1;
            diagnostics.activeResources += 1;
            const context = createHostCallContext(
              `tool:${name}:${crypto.randomUUID()}`,
            );
            const iteratorResult = handler(
              ...args,
              context,
            ) as
              | AsyncIterable<unknown>
              | Promise<AsyncIterable<unknown>>;
            return (async function* () {
              const iterator = await iteratorResult;
              const iterable =
                iterator &&
                typeof (iterator as { [Symbol.asyncIterator]?: unknown })[
                  Symbol.asyncIterator
                ] === "function"
                  ? (iterator as AsyncIterable<unknown>)
                  : iterator &&
                      typeof (iterator as { next?: unknown }).next === "function"
                    ? {
                        [Symbol.asyncIterator]() {
                          return iterator as unknown as AsyncIterator<unknown>;
                        },
                      }
                    : null;
              try {
                if (!iterable) {
                  throw new TypeError(
                    `Tool ${name} did not return an async iterator.`,
                  );
                }
                yield* iterable;
              } finally {
                diagnostics.pendingTools -= 1;
                diagnostics.activeResources -= 1;
              }
            })();
          },
        );
        definitions[name] = {
          type: "asyncIterator",
          fn,
        };
        continue;
      }

      const fn = copyIsolateCallbackMetadata(
        handler,
        async (...args: unknown[]) => {
          diagnostics.pendingTools += 1;
          diagnostics.activeResources += 1;
          try {
            const context = createHostCallContext(
              `tool:${name}:${crypto.randomUUID()}`,
            );
            return await handler(...args, context);
          } finally {
            diagnostics.pendingTools -= 1;
            diagnostics.activeResources -= 1;
          }
        },
      );

      definitions[name] = {
        type: "async",
        fn,
      };
    }
  }

  if (nestedHost) {
    const reservedNames = [
      "__isolateHost_createHost",
      "__isolateHost_closeHost",
      "__isolateHost_hostDiagnostics",
      "__isolateHost_createResource",
      "__isolateHost_disposeNamespace",
      "__isolateHost_callResource",
      "__isolateHost_drainCallbacks",
    ];
    for (const name of reservedNames) {
      if (definitions[name]) {
        throw new Error(
          `Tool name ${name} is reserved for internal sandbox host bindings.`,
        );
      }
    }

    definitions.__isolateHost_createHost = {
      type: "async",
      fn: async () => {
        const context = createHostCallContext(
          `nestedHost:createHost:${crypto.randomUUID()}`,
        );
        return await nestedHost.createHost(context);
      },
    };
    definitions.__isolateHost_closeHost = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const hostId = args[0] as string;
        const context = createHostCallContext(
          `nestedHost:closeHost:${crypto.randomUUID()}`,
        );
        await nestedHost.closeHost(hostId, context);
      },
    };
    definitions.__isolateHost_hostDiagnostics = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const hostId = args[0] as string;
        const context = createHostCallContext(
          `nestedHost:diagnostics:${crypto.randomUUID()}`,
        );
        return await nestedHost.diagnostics(hostId, context);
      },
    };
    definitions.__isolateHost_createResource = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const hostId = args[0] as string;
        const kind = args[1] as NestedResourceKind;
        const resourceOptions = args[2] as
          | CreateRuntimeOptions
          | CreateAppServerOptions
          | CreateTestRuntimeOptions
          | {
              key: string;
              options: CreateNamespacedRuntimeOptions;
            };
        const context = createHostCallContext(
          `nestedHost:createResource:${kind}:${crypto.randomUUID()}`,
        );
        return await nestedHost.createResource(
          hostId,
          kind,
          resourceOptions,
          context,
        );
      },
    };
    definitions.__isolateHost_disposeNamespace = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const hostId = args[0] as string;
        const key = args[1] as string;
        const options =
          ((args[2] as { reason?: string } | null) ?? undefined);
        const context = createHostCallContext(
          `nestedHost:disposeNamespace:${crypto.randomUUID()}`,
        );
        await nestedHost.disposeNamespace(hostId, key, options, context);
      },
    };
    definitions.__isolateHost_callResource = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const kind = args[0] as NestedResourceKind;
        const resourceId = args[1] as string;
        const method = args[2] as string;
        const methodArgs = args[3] as unknown[];
        const context = createHostCallContext(
          `nestedHost:callResource:${kind}:${method}:${crypto.randomUUID()}`,
        );
        return await nestedHost.callResource(
          kind,
          resourceId,
          method,
          Array.isArray(methodArgs) ? methodArgs : [],
          context,
        );
      },
    };
    definitions.__isolateHost_drainCallbacks = {
      type: "async",
      fn: async (...args: unknown[]) => {
        const settleTurns =
          typeof args[0] === "number" &&
            Number.isFinite(args[0]) &&
            args[0] > 0
            ? Math.floor(args[0])
            : 1;

        for (let index = 0; index < settleTurns; index += 1) {
          await Promise.resolve();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      },
    };
  }

  return Object.keys(definitions).length > 0 ? definitions : undefined;
}
