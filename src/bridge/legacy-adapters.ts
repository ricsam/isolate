import path from "node:path";
import type { RuntimeOptions } from "../internal/client/index.ts";
import { invokeBestEffortEventHandler } from "../internal/event-callback.ts";
import type { ModuleLoaderCallback } from "../internal/protocol/index.ts";
import { getRequestContext } from "./request-context.ts";
import type { HostBindings, HostCallContext, ModuleResolveResult, ModuleResolver, ModuleSource, ToolHandler } from "../types.ts";
import type { MutableRuntimeDiagnostics } from "./diagnostics.ts";

function createHostCallContext(
  runtimeId: string,
  signal: AbortSignal,
  resourceId: string,
): HostCallContext {
  const requestContext = getRequestContext();
  return {
    signal,
    runtimeId,
    requestId: requestContext.requestId,
    resourceId,
    metadata: requestContext.metadata,
  };
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

export function createLegacyRuntimeOptions(
  bindings: HostBindings,
  getRuntimeId: () => string,
  diagnostics: MutableRuntimeDiagnostics,
): RuntimeOptions {
  const moduleLoader = createLegacyModuleLoader(bindings.modules, getRuntimeId, diagnostics);

  return {
    console: bindings.console?.onEntry
      ? {
          onEntry: (entry) => {
            const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `console:${crypto.randomUUID()}`);
            invokeBestEffortEventHandler(
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
            const request = new Request(url, {
              method: init.method,
              headers: init.headers,
              body: init.rawBody ? init.rawBody.slice(0) : null,
            });
            const context = createHostCallContext(getRuntimeId(), init.signal, `fetch:${crypto.randomUUID()}`);
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
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:read:${crypto.randomUUID()}`);
                return await bindings.files!.readFile!(filePath, context);
              }
            : undefined,
          writeFile: bindings.files.writeFile
            ? async (filePath: string, data: ArrayBuffer) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:write:${crypto.randomUUID()}`);
                return await bindings.files!.writeFile!(filePath, data, context);
              }
            : undefined,
          unlink: bindings.files.unlink
            ? async (filePath: string) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:unlink:${crypto.randomUUID()}`);
                return await bindings.files!.unlink!(filePath, context);
              }
            : undefined,
          readdir: bindings.files.readdir
            ? async (dirPath: string) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:readdir:${crypto.randomUUID()}`);
                return await bindings.files!.readdir!(dirPath, context);
              }
            : undefined,
          mkdir: bindings.files.mkdir
            ? async (dirPath: string, options?: { recursive?: boolean }) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:mkdir:${crypto.randomUUID()}`);
                return await bindings.files!.mkdir!(dirPath, options, context);
              }
            : undefined,
          rmdir: bindings.files.rmdir
            ? async (dirPath: string) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:rmdir:${crypto.randomUUID()}`);
                return await bindings.files!.rmdir!(dirPath, context);
              }
            : undefined,
          stat: bindings.files.stat
            ? async (filePath: string) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:stat:${crypto.randomUUID()}`);
                return await bindings.files!.stat!(filePath, context);
              }
            : undefined,
          rename: bindings.files.rename
            ? async (from: string, to: string) => {
                const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `files:rename:${crypto.randomUUID()}`);
                return await bindings.files!.rename!(from, to, context);
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
                    const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `tool:${name}:${crypto.randomUUID()}`);
                    const iterator = handler(...args, context) as AsyncGenerator<unknown, unknown, unknown>;
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
                    const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `tool:${name}:${crypto.randomUUID()}`);
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
  };
}

function createLegacyModuleLoader(
  resolver: ModuleResolver | undefined,
  getRuntimeId: () => string,
  diagnostics: MutableRuntimeDiagnostics,
): ModuleLoaderCallback | undefined {
  if (!resolver) {
    return undefined;
  }

  return async (specifier, importer) => {
    diagnostics.activeResources += 1;
    try {
      const context = createHostCallContext(getRuntimeId(), AbortSignal.abort(), `module:${crypto.randomUUID()}`);
      const result = await resolver.resolve(specifier, importer, context);
      return result;
    } finally {
      diagnostics.activeResources -= 1;
    }
  };
}

export function createMappedNodeModulesLoader(mappings: Array<{ from: string; to: string }>): ModuleLoaderCallback | undefined {
  if (mappings.length === 0) {
    return undefined;
  }
  throw new Error("createMappedNodeModulesLoader is no longer used directly; call createModuleResolver().mountNodeModules() instead.");
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
  return normalizeModuleResolveResult(specifier, resolver.resolve(specifier, importer, context), importer.resolveDir);
}

export async function normalizeExplicitModuleResult(
  specifier: string,
  result: ModuleResolveResult,
  fallbackResolveDir?: string,
): Promise<ModuleSource | null> {
  return normalizeModuleResolveResult(specifier, result, fallbackResolveDir);
}
