import { IsolateServer } from "../internal/server/index.ts";
import type { DaemonConnection } from "../internal/client/index.ts";
import { createRuntimeDiagnostics } from "../bridge/diagnostics.ts";
import { createRuntimeBindingsAdapter } from "../bridge/runtime-bindings.ts";
import { withRequestContext } from "../bridge/request-context.ts";
import type { AppServer, CreateAppServerOptions, RequestResult } from "../types.ts";

export async function createAppServerAdapter(
  getConnection: () => Promise<DaemonConnection>,
  options: CreateAppServerOptions,
): Promise<AppServer> {
  const diagnostics = createRuntimeDiagnostics();
  const server = new IsolateServer({
    namespaceId: options.key,
    getConnection,
  });

  let runtimeId = options.key;
  const bindingsAdapter = createRuntimeBindingsAdapter(
    options.bindings,
    () => runtimeId,
    diagnostics,
  );
  await server.start({
    entry: options.entry,
    entryFilename: options.entryFilename,
    runtimeOptions: {
      ...bindingsAdapter.runtimeOptions,
      cwd: options.cwd,
      memoryLimitMB: options.memoryLimitMB,
      executionTimeout: options.executionTimeout,
      testEnvironment: options.features?.tests ?? false,
    },
    onWebSocketCommand: (command) => {
      options.webSockets?.onCommand?.(command);
    },
  });
  runtimeId = server.getRuntime()?.id ?? options.key;

  async function handleRequest(request: Request, handleOptions?: { requestId?: string; signal?: AbortSignal; metadata?: Record<string, string> }): Promise<RequestResult> {
    diagnostics.activeRequests += 1;
    diagnostics.lifecycleState = "active";
    try {
      return await withRequestContext(
        {
          requestId: handleOptions?.requestId,
          metadata: handleOptions?.metadata,
          signal: handleOptions?.signal ?? request.signal,
        },
        async () => {
          const response = await server.fetch.dispatchRequest(request, {
            signal: handleOptions?.signal,
            requestId: handleOptions?.requestId,
            metadata: handleOptions?.metadata,
          });
          const upgradeRequest = await server.fetch.getUpgradeRequest();
          if (upgradeRequest?.requested) {
            return {
              type: "websocket",
              upgradeData: {
                requested: upgradeRequest.requested,
                connectionId: upgradeRequest.connectionId,
              },
            };
          }

          return {
            type: "response",
            response,
          };
        },
      );
    } catch (error) {
      diagnostics.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      diagnostics.activeRequests -= 1;
      diagnostics.lifecycleState = "idle";
    }
  }

  return {
    handle: handleRequest,
    ws: {
      open: async (connectionId) => {
        await server.fetch.dispatchWebSocketOpen(connectionId);
      },
      message: async (connectionId, data) => {
        await server.fetch.dispatchWebSocketMessage(connectionId, data);
      },
      close: async (connectionId, code, reason) => {
        await server.fetch.dispatchWebSocketClose(connectionId, code, reason);
      },
      error: async (connectionId, error) => {
        await server.fetch.dispatchWebSocketError(connectionId, error);
      },
    },
    reload: async () => {
      diagnostics.lifecycleState = "reloading";
      try {
        bindingsAdapter.reset("AppServer.reload()");
        await server.reload();
        runtimeId = server.getRuntime()?.id ?? options.key;
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    dispose: async (disposeOptions) => {
      diagnostics.lifecycleState = "disposing";
      try {
        if (disposeOptions?.hard) {
          bindingsAdapter.reset(disposeOptions?.reason ?? "AppServer.dispose(hard)");
          await server.reload();
          bindingsAdapter.abort(disposeOptions?.reason ?? "AppServer.dispose(hard)");
          await server.close();
          return;
        }
        bindingsAdapter.abort(disposeOptions?.reason ?? "AppServer.dispose()");
        await server.close();
      } finally {
        diagnostics.lifecycleState = "idle";
      }
    },
    diagnostics: async () => ({
      ...diagnostics,
      reused: server.getRuntime()?.reused,
    }),
  };
}
