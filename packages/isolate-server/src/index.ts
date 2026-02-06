import type {
  DaemonConnection,
  DispatchOptions,
  RemoteRuntime,
  RuntimeOptions,
  UpgradeRequest,
  WebSocketCommand,
} from "@ricsam/isolate-client";
import { isBenignDisposeError } from "@ricsam/isolate-client";

const LINKER_CONFLICT_ERROR = "Module is currently being linked by another linker";

function isLinkerConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(LINKER_CONFLICT_ERROR);
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

  async reload(): Promise<void> {
    const startOptions = this.lastStartOptions;
    if (!startOptions) {
      throw new Error("Server not configured. Call start() first.");
    }

    this.closed = false;
    await this.withLifecycleLock(async () => {
      if (this.runtime) {
        const runtime = this.runtime;
        this.runtime = null;
        await this.disposeRuntime(runtime);
      }

      this.runtime = await this.createAndInitializeRuntime(startOptions);
    });
  }

  async close(): Promise<void> {
    await this.withLifecycleLock(async () => {
      if (this.runtime) {
        const runtime = this.runtime;
        this.runtime = null;
        await this.disposeRuntime(runtime);
      }

      this.closed = true;
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

  private async disposeRuntime(runtime: RemoteRuntime): Promise<void> {
    try {
      await runtime.dispose();
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

  private async dispatchRequestWithRetry(
    request: Request,
    options?: DispatchOptions
  ): Promise<Response> {
    const runtime = await this.getActiveRuntime();
    try {
      return await runtime.fetch.dispatchRequest(request, options);
    } catch (error) {
      if (!isLinkerConflictError(error)) {
        throw error;
      }

      await this.reload();
      const retryRuntime = await this.getActiveRuntime();
      return retryRuntime.fetch.dispatchRequest(request, options);
    }
  }
}
