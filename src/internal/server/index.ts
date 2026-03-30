import type {
  DaemonConnection,
  DispatchOptions,
  RemoteRuntime,
  RuntimeOptions,
  UpgradeRequest,
  WebSocketCommand,
} from "../client/index.ts";
import { isBenignDisposeError } from "../client/index.ts";

const LINKER_CONFLICT_ERROR = "Module is currently being linked by another linker";

function isLinkerConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(LINKER_CONFLICT_ERROR);
}

function isDisposedRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /runtime has been disposed|runtime was permanently disposed|runtime was soft-disposed|isolated is disposed/i.test(
    message
  );
}

type RuntimeRetirementAction = "reload" | "close";

interface RuntimeRetirementRecord {
  runtimeId: string;
  action: RuntimeRetirementAction;
  reason: string;
  hard: boolean;
  at: number;
  activeRequests: number;
  replacementRuntimeId?: string;
}

function formatLifecycleReason(action: string, reason?: string): string {
  const trimmedReason = reason?.trim();
  return trimmedReason ? `${action}(${trimmedReason})` : `${action}()`;
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function summarizeRequest(request: Request): string {
  try {
    const url = new URL(request.url);
    return `${request.method} ${url.origin}${url.pathname}${url.search}`;
  } catch {
    return `${request.method} ${request.url}`;
  }
}

export interface IsolateServerOptions {
  namespaceId: string;
  getConnection: () => Promise<DaemonConnection>;
}

export interface IsolateServerStartOptions {
  runtimeOptions: RuntimeOptions;
  entry: string;
  entryFilename?: string;
  onWebSocketCommand?: (cmd: WebSocketCommand) => void;
}

export interface IsolateServerFetch {
  dispatchRequest(request: Request, options?: DispatchOptions): Promise<Response>;
  getUpgradeRequest(): Promise<UpgradeRequest | null>;
  dispatchWebSocketOpen(connectionId: string): Promise<void>;
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): Promise<void>;
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): Promise<void>;
  dispatchWebSocketError(connectionId: string, error: Error): Promise<void>;
  hasServeHandler(): Promise<boolean>;
  hasActiveConnections(): Promise<boolean>;
}

export class IsolateServer {
  private readonly namespaceId: string;
  private readonly getConnection: () => Promise<DaemonConnection>;
  private runtime: RemoteRuntime | null = null;
  private lastStartOptions: IsolateServerStartOptions | null = null;
  private lifecycleLock: Promise<void> = Promise.resolve();
  private activeRequestCount = 0;
  private lastRuntimeRetirement: RuntimeRetirementRecord | null = null;
  private closed = true;

  readonly fetch: IsolateServerFetch = {
    dispatchRequest: (request, options) => this.dispatchRequestWithRetry(request, options),
    getUpgradeRequest: async () => {
      const runtime = await this.getActiveRuntime();
      return runtime.fetch.getUpgradeRequest();
    },
    dispatchWebSocketOpen: async (connectionId) => {
      const runtime = await this.getActiveRuntime();
      await runtime.fetch.dispatchWebSocketOpen(connectionId);
    },
    dispatchWebSocketMessage: async (connectionId, message) => {
      const runtime = await this.getActiveRuntime();
      await runtime.fetch.dispatchWebSocketMessage(connectionId, message);
    },
    dispatchWebSocketClose: async (connectionId, code, reason) => {
      const runtime = await this.getActiveRuntime();
      await runtime.fetch.dispatchWebSocketClose(connectionId, code, reason);
    },
    dispatchWebSocketError: async (connectionId, error) => {
      const runtime = await this.getActiveRuntime();
      await runtime.fetch.dispatchWebSocketError(connectionId, error);
    },
    hasServeHandler: async () => {
      const runtime = await this.getActiveRuntime();
      return runtime.fetch.hasServeHandler();
    },
    hasActiveConnections: async () => {
      const runtime = await this.getActiveRuntime();
      return runtime.fetch.hasActiveConnections();
    },
  };

  constructor(options: IsolateServerOptions) {
    this.namespaceId = options.namespaceId;
    this.getConnection = options.getConnection;
  }

  async start(options: IsolateServerStartOptions): Promise<void> {
    this.lastStartOptions = options;
    this.closed = false;

    await this.withLifecycleLock(async () => {
      if (this.runtime) {
        return;
      }

      this.runtime = await this.createAndInitializeRuntime(options);
    });
  }

  async reload(reason?: string): Promise<void> {
    const startOptions = this.lastStartOptions;
    if (!startOptions) {
      throw new Error("Server not configured. Call start() first.");
    }

    const lifecycleReason = formatLifecycleReason("IsolateServer.reload", reason);
    this.closed = false;
    await this.withLifecycleLock(async () => {
      const previousRuntime = this.runtime;
      this.log("reload requested", {
        namespaceId: this.namespaceId,
        runtimeId: previousRuntime?.id ?? null,
        reason: lifecycleReason,
        activeRequests: this.activeRequestCount,
      });

      if (previousRuntime) {
        this.runtime = null;
        this.recordRuntimeRetirement(previousRuntime, "reload", lifecycleReason, true);
        await this.disposeRuntime(previousRuntime, {
          hard: true,
          reason: lifecycleReason,
        });
      }

      try {
        const nextRuntime = await this.createAndInitializeRuntime(startOptions);
        this.runtime = nextRuntime;
      } catch (error) {
        this.log("reload failed", {
          namespaceId: this.namespaceId,
          previousRuntimeId: previousRuntime?.id ?? null,
          reason: lifecycleReason,
          activeRequests: this.activeRequestCount,
          error: error instanceof Error ? error.message : String(error),
        }, "warn");
        throw error;
      }

      if (
        previousRuntime &&
        this.lastRuntimeRetirement?.runtimeId === previousRuntime.id &&
        this.lastRuntimeRetirement.action === "reload"
      ) {
        this.lastRuntimeRetirement.replacementRuntimeId = this.runtime?.id;
      }

      this.log("reload completed", {
        namespaceId: this.namespaceId,
        previousRuntimeId: previousRuntime?.id ?? null,
        runtimeId: this.runtime?.id ?? null,
        reason: lifecycleReason,
        activeRequests: this.activeRequestCount,
      });
    });
  }

  async close(reason?: string): Promise<void> {
    const lifecycleReason = formatLifecycleReason("IsolateServer.close", reason);
    await this.withLifecycleLock(async () => {
      const previousRuntime = this.runtime;
      this.log("close requested", {
        namespaceId: this.namespaceId,
        runtimeId: previousRuntime?.id ?? null,
        reason: lifecycleReason,
        activeRequests: this.activeRequestCount,
      });

      if (previousRuntime) {
        this.runtime = null;
        this.recordRuntimeRetirement(previousRuntime, "close", lifecycleReason, false);
        await this.disposeRuntime(previousRuntime, {
          reason: lifecycleReason,
        });
      }

      this.closed = true;
      this.log("close completed", {
        namespaceId: this.namespaceId,
        previousRuntimeId: previousRuntime?.id ?? null,
        reason: lifecycleReason,
        activeRequests: this.activeRequestCount,
      });
    });
  }

  getRuntime(): RemoteRuntime | null {
    return this.runtime;
  }

  private async withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleLock;
    let release!: () => void;
    this.lifecycleLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private buildRuntimeOptions(options: IsolateServerStartOptions): RuntimeOptions {
    if (options.onWebSocketCommand) {
      return {
        ...options.runtimeOptions,
        onWebSocketCommand: options.onWebSocketCommand,
      };
    }

    return options.runtimeOptions;
  }

  private async createAndInitializeRuntime(
    options: IsolateServerStartOptions,
    allowRetry: boolean = true
  ): Promise<RemoteRuntime> {
    const connection = await this.getConnection();
    const namespace = connection.createNamespace(this.namespaceId);
    const runtimeOptions = this.buildRuntimeOptions(options);
    const runtime = await namespace.createRuntime(runtimeOptions);

    try {
      await runtime.eval(
        `import ${JSON.stringify(options.entry)};`,
        options.entryFilename ?? "/isolate_server_entry.js"
      );
      return runtime;
    } catch (error) {
      await this.disposeRuntime(runtime);
      if (!allowRetry || !isLinkerConflictError(error)) {
        throw error;
      }

      const retryRuntime = await namespace.createRuntime(runtimeOptions);
      try {
        await retryRuntime.eval(
          `import ${JSON.stringify(options.entry)};`,
          options.entryFilename ?? "/isolate_server_entry.js"
        );
        return retryRuntime;
      } catch (retryError) {
        await this.disposeRuntime(retryRuntime);
        throw retryError;
      }
    }
  }

  private async disposeRuntime(
    runtime: RemoteRuntime,
    options?: { hard?: boolean; reason?: string }
  ): Promise<void> {
    try {
      await runtime.dispose(options);
    } catch (error) {
      if (!isBenignDisposeError(error)) {
        throw error;
      }
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.runtime) {
      return;
    }

    if (!this.lastStartOptions) {
      throw new Error("Server not configured. Call start() first.");
    }

    if (this.closed) {
      this.closed = false;
    }

    await this.start(this.lastStartOptions);
  }

  private async getActiveRuntime(): Promise<RemoteRuntime> {
    await this.ensureStarted();
    if (!this.runtime) {
      throw new Error("Server runtime failed to start.");
    }
    return this.runtime;
  }

  private recordRuntimeRetirement(
    runtime: RemoteRuntime,
    action: RuntimeRetirementAction,
    reason: string,
    hard: boolean
  ): RuntimeRetirementRecord {
    const record: RuntimeRetirementRecord = {
      runtimeId: runtime.id,
      action,
      reason,
      hard,
      at: Date.now(),
      activeRequests: this.activeRequestCount,
    };
    this.lastRuntimeRetirement = record;
    return record;
  }

  private getLastRuntimeRetirementLogFields(): Record<string, unknown> {
    if (!this.lastRuntimeRetirement) {
      return {
        lastRetirementAction: "unknown",
      };
    }

    return {
      lastRetirementAction: this.lastRuntimeRetirement.action,
      lastRetirementReason: this.lastRuntimeRetirement.reason,
      lastRetirementRuntimeId: this.lastRuntimeRetirement.runtimeId,
      lastRetirementHard: this.lastRuntimeRetirement.hard,
      lastRetirementAgeMs: Date.now() - this.lastRuntimeRetirement.at,
      lastRetirementActiveRequests: this.lastRuntimeRetirement.activeRequests,
      lastRetirementReplacementRuntimeId: this.lastRuntimeRetirement.replacementRuntimeId ?? null,
    };
  }

  private log(
    message: string,
    fields: Record<string, unknown>,
    level: "log" | "warn" = "log"
  ): void {
    const suffix = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatLogValue(value)}`)
      .join(" ");

    const logger = level === "warn" ? console.warn : console.log;
    logger(`[isolate-server] ${message}${suffix ? `; ${suffix}` : ""}`);
  }

  private async dispatchRequestWithRetry(
    request: Request,
    options?: DispatchOptions
  ): Promise<Response> {
    this.activeRequestCount += 1;
    try {
      const runtime = await this.getActiveRuntime();
      try {
        return await runtime.fetch.dispatchRequest(request, options);
      } catch (error) {
        if (!isLinkerConflictError(error) && !isDisposedRuntimeError(error)) {
          throw error;
        }

        const requestSummary = summarizeRequest(request);
        if (isLinkerConflictError(error)) {
          await this.reload(`request-linker-conflict: ${requestSummary}`);
        } else if (this.runtime?.id === runtime.id) {
          this.runtime = null;
        }

        const retryRuntime = await this.getActiveRuntime();
        this.log(
          isLinkerConflictError(error)
            ? "request recovered after linker conflict"
            : "request recovered after disposed runtime",
          {
            namespaceId: this.namespaceId,
            request: requestSummary,
            requestId: options?.requestId ?? null,
            metadataKeys: Object.keys(options?.metadata ?? {}),
            previousRuntimeId: runtime.id,
            runtimeId: retryRuntime.id,
            activeRequests: this.activeRequestCount,
            error: error instanceof Error ? error.message : String(error),
            ...this.getLastRuntimeRetirementLogFields(),
          },
          "warn"
        );
        return retryRuntime.fetch.dispatchRequest(request, options);
      }
    } finally {
      this.activeRequestCount -= 1;
    }
  }
}
