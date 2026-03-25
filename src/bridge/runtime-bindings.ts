import path from "node:path";
import type { RuntimeOptions } from "../internal/client/index.ts";
import type { ModuleLoaderCallback } from "../internal/protocol/index.ts";
import { getRequestContext } from "./request-context.ts";
import type {
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
  return handler.constructor.name === "AsyncGeneratorFunction";
}

export function createRuntimeBindingsAdapter(
  bindings: HostBindings,
  getRuntimeId: () => string,
  diagnostics: MutableRuntimeDiagnostics,
): RuntimeBindingsAdapter {
  const contextFactory = createHostCallContextFactory(getRuntimeId);
  const moduleLoader = createModuleLoader(
    bindings.modules,
    contextFactory.createHostCallContext,
    diagnostics,
  );

  return {
    runtimeOptions: {
      console: bindings.console?.onEntry
        ? {
            onEntry: (entry) => {
              const context = contextFactory.createHostCallContext(
                `console:${crypto.randomUUID()}`,
              );
              bindings.console?.onEntry?.(entry, context);
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
              return await bindings.fetch!(request, context);
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
      customFunctions: bindings.tools
        ? Object.fromEntries(
            Object.entries(bindings.tools).map(([name, handler]) => {
              if (isAsyncGeneratorFunction(handler)) {
                return [
                  name,
                  {
                    type: "asyncIterator" as const,
                    fn: (...args: unknown[]) => {
                      diagnostics.pendingTools += 1;
                      diagnostics.activeResources += 1;
                      const context = contextFactory.createHostCallContext(
                        `tool:${name}:${crypto.randomUUID()}`,
                      );
                      const iterator = handler(
                        ...args,
                        context,
                      ) as AsyncGenerator<unknown, unknown, unknown>;
                      return (async function* () {
                        try {
                          yield* iterator;
                        } finally {
                          diagnostics.pendingTools -= 1;
                          diagnostics.activeResources -= 1;
                        }
                      })();
                    },
                  },
                ];
              }

              return [
                name,
                {
                  type: "async" as const,
                  fn: async (...args: unknown[]) => {
                    diagnostics.pendingTools += 1;
                    diagnostics.activeResources += 1;
                    try {
                      const context = contextFactory.createHostCallContext(
                        `tool:${name}:${crypto.randomUUID()}`,
                      );
                      return await handler(...args, context);
                    } finally {
                      diagnostics.pendingTools -= 1;
                      diagnostics.activeResources -= 1;
                    }
                  },
                },
              ];
            }),
          )
        : undefined,
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
): ModuleLoaderCallback | undefined {
  if (!resolver) {
    return undefined;
  }

  return async (specifier, importer) => {
    diagnostics.pendingModules += 1;
    diagnostics.activeResources += 1;
    try {
      const context = createHostCallContext(`module:${crypto.randomUUID()}`);
      return await resolver.resolve(specifier, importer, context);
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
