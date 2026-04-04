import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type DaemonConnection, type RemoteRuntime, type RuntimeOptions } from "../internal/client/index.ts";
import {
  createBrowserSourceFromBindings,
  type BrowserSource,
} from "../internal/browser-source.ts";
import { createRuntimeDiagnostics } from "../bridge/diagnostics.ts";
import { createRuntimeBindingsAdapter } from "../bridge/runtime-bindings.ts";
import { createNamespacedRuntimeAdapter } from "../runtime/namespaced-runtime.ts";
import { createScriptRuntimeAdapter } from "../runtime/script-runtime.ts";
import { createTestRuntimeAdapter } from "../runtime/test-runtime.ts";
import { createTestEventSubscriptions } from "../runtime/test-event-subscriptions.ts";
import { createAppServerAdapter } from "../server/app-server.ts";
import { createNestedHostBindings } from "./nested-host-controller.ts";
import type {
  AppServer,
  CreateAppServerOptions,
  CreateIsolateHostOptions,
  CreateNamespacedRuntimeOptions,
  CreateRuntimeOptions,
  CreateTestRuntimeOptions,
  IsolateHost,
  NamespacedRuntime,
  ScriptRuntime,
  TestRuntime,
} from "../types.ts";

function resolveDefaultDaemonEntrypoint(): string | null {
  const localPath = path.resolve(import.meta.dirname, "../daemon.ts");
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return null;
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(socketPath)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Daemon socket not available after ${timeoutMs}ms`);
}

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function normalizeNamespaceInUseError(error: unknown, key: string): Error {
  if (error instanceof Error && error.name === "NamespaceInUseError") {
    return error;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "");
  if (/already has an active runtime|creation already in progress/i.test(message)) {
    return createNamedError(
      "NamespaceInUseError",
      `Namespace "${key}" already has a live runtime.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

class HostImpl implements IsolateHost {
  private readonly options: CreateIsolateHostOptions;
  private daemonProcess: ChildProcess | null = null;
  private connection: DaemonConnection | null = null;
  private connectionPromise: Promise<DaemonConnection> | null = null;
  private readonly servers = new Set<object>();
  private readonly runtimes = new Set<object>();
  private readonly namespacedRuntimes = new Map<string, ReturnType<typeof createNamespacedRuntimeAdapter>>();
  private readonly pendingNamespacedKeys = new Set<string>();

  constructor(options?: CreateIsolateHostOptions) {
    this.options = options ?? {};
  }

  async createAppServer(options: CreateAppServerOptions) {
    return await this.createAppServerInternal(options);
  }

  async createRuntime(options: CreateRuntimeOptions) {
    return await this.createRuntimeInternal(options);
  }

  async createTestRuntime(options: CreateTestRuntimeOptions) {
    return await this.createTestRuntimeInternal(options);
  }

  async getNamespacedRuntime(
    key: string,
    options: CreateNamespacedRuntimeOptions,
  ) {
    return await this.createNamespacedRuntimeInternal(key, options);
  }

  async disposeNamespace(key: string, options?: { reason?: string }) {
    this.pendingNamespacedKeys.delete(key);
    const runtime = this.namespacedRuntimes.get(key);
    if (runtime) {
      runtime.invalidate(
        options?.reason
          ? `Namespace "${key}" was disposed: ${options.reason}`
          : `Namespace "${key}" was disposed.`,
      );
      this.namespacedRuntimes.delete(key);
    }

    const connection = await this.getConnection();
    await connection.disposeNamespace(key, {
      reason: options?.reason,
    });
  }

  async diagnostics() {
    return {
      runtimes: this.runtimes.size,
      servers: this.servers.size,
      connected: this.connection?.isConnected() ?? false,
    };
  }

  async close(): Promise<void> {
    for (const [key, runtime] of this.namespacedRuntimes) {
      runtime.invalidate(`Host closed while namespace "${key}" was active.`);
    }
    this.namespacedRuntimes.clear();
    this.pendingNamespacedKeys.clear();

    if (this.connection) {
      await this.connection.close().catch(() => {});
    }
    this.connection = null;
    this.connectionPromise = null;

    if (this.daemonProcess) {
      const process = this.daemonProcess;
      this.daemonProcess = null;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          process.kill("SIGKILL");
          resolve();
        }, 5000);
        process.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        process.kill("SIGTERM");
      });
    }
  }

  private async createRuntimeInternal(
    options: CreateRuntimeOptions,
  ): Promise<ScriptRuntime> {
    const diagnostics = createRuntimeDiagnostics();
    let runtimeId = options.key ?? "runtime";
    const browserSource = createBrowserSourceFromBindings(options.bindings.browser);
    const bindingsAdapter = createRuntimeBindingsAdapter(
      options.bindings,
      () => runtimeId,
      diagnostics,
      {
        nestedHost: this.createNestedBindings(browserSource),
      },
    );
    const runtime = await this.createRemoteRuntime(
      {
        ...bindingsAdapter.runtimeOptions,
        cwd: options.cwd,
        memoryLimitMB: options.memoryLimitMB,
        executionTimeout: options.executionTimeout,
      },
      options.key,
    );
    runtimeId = runtime.id;
    const adapter = createScriptRuntimeAdapter(runtime, diagnostics, {
      hasBrowser: Boolean(options.bindings.browser),
      onBeforeDispose: (reason) => bindingsAdapter.abort(reason),
    });
    this.runtimes.add(adapter);
    return adapter;
  }

  private async createTestRuntimeInternal(
    options: CreateTestRuntimeOptions,
  ): Promise<TestRuntime> {
    const testRuntime = await createTestRuntimeAdapter(
      async (runtimeOptions) => await this.createRemoteRuntime(runtimeOptions, options.key),
      options,
      {
        nestedHost: this.createNestedBindings(
          createBrowserSourceFromBindings(options.bindings.browser),
        ),
      },
    );
    this.runtimes.add(testRuntime);
    return testRuntime;
  }

  private async createNamespacedRuntimeInternal(
    key: string,
    options: CreateNamespacedRuntimeOptions,
  ): Promise<NamespacedRuntime> {
    if (this.pendingNamespacedKeys.has(key) || this.namespacedRuntimes.has(key)) {
      throw createNamedError(
        "NamespaceInUseError",
        `Namespace "${key}" already has a live runtime.`,
      );
    }

    this.pendingNamespacedKeys.add(key);
    const diagnostics = createRuntimeDiagnostics();
    const testEvents = createTestEventSubscriptions();
    let runtimeId = key;
    const browserSource = createBrowserSourceFromBindings(options.bindings.browser);
    const bindingsAdapter = createRuntimeBindingsAdapter(
      options.bindings,
      () => runtimeId,
      diagnostics,
      {
        nestedHost: this.createNestedBindings(browserSource),
      },
    );

    try {
      const runtime = await this.createRemoteRuntime(
        {
          ...bindingsAdapter.runtimeOptions,
          cwd: options.cwd,
          memoryLimitMB: options.memoryLimitMB,
          executionTimeout: options.executionTimeout,
          testEnvironment: {
            onEvent: (event) => testEvents.emit(event),
          },
        },
        key,
      );
      runtimeId = runtime.id;

      let adapter: ReturnType<typeof createNamespacedRuntimeAdapter>;
      adapter = createNamespacedRuntimeAdapter(runtime, diagnostics, {
        hasBrowser: Boolean(options.bindings.browser),
        abortBindings: (reason) => bindingsAdapter.abort(reason),
        testEvents,
        onRelease: () => {
          if (this.namespacedRuntimes.get(key) === adapter) {
            this.namespacedRuntimes.delete(key);
          }
        },
      });

      this.namespacedRuntimes.set(key, adapter);
      this.runtimes.add(adapter);
      return adapter;
    } catch (error) {
      throw normalizeNamespaceInUseError(error, key);
    } finally {
      this.pendingNamespacedKeys.delete(key);
    }
  }

  private async createAppServerInternal(
    options: CreateAppServerOptions,
  ): Promise<AppServer> {
    const server = await createAppServerAdapter(
      () => this.getConnection(),
      options,
      {
        nestedHost: this.createNestedBindings(
          createBrowserSourceFromBindings(options.bindings.browser),
        ),
      },
    );
    this.servers.add(server);
    return server;
  }

  private createNestedBindings(
    defaultBrowserSource: BrowserSource | undefined,
  ) {
    return createNestedHostBindings(
      {
        createRuntime: async (options) => await this.createRuntimeInternal(options),
        createAppServer: async (options) =>
          await this.createAppServerInternal(options),
        createTestRuntime: async (options) =>
          await this.createTestRuntimeInternal(options),
        getNamespacedRuntime: async (key, options) =>
          await this.createNamespacedRuntimeInternal(key, options),
        disposeNamespace: async (key, options) =>
          await this.disposeNamespace(key, options),
        isConnected: () => this.connection?.isConnected() ?? false,
      },
      defaultBrowserSource,
    );
  }

  private async createRemoteRuntime(options: RuntimeOptions, key?: string): Promise<RemoteRuntime> {
    const connection = await this.getConnection();
    if (key) {
      return await connection.createNamespace(key).createRuntime(options);
    }
    return await connection.createRuntime(options);
  }

  private async getConnection(): Promise<DaemonConnection> {
    if (this.connection?.isConnected()) {
      return this.connection;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      await this.ensureDaemon();
      this.connection = await connect({
        socket: this.options.daemon?.socketPath ?? "/tmp/isolate.sock",
        timeout: this.options.daemon?.timeoutMs ?? 5000,
      });
      return this.connection;
    })();

    return await this.connectionPromise.finally(() => {
      this.connectionPromise = null;
    });
  }

  private async ensureDaemon(): Promise<void> {
    if (this.connection?.isConnected()) {
      return;
    }

    if (this.options.daemon?.autoStart === false) {
      return;
    }

    if (this.daemonProcess) {
      return;
    }

    const socketPath = this.options.daemon?.socketPath ?? "/tmp/isolate.sock";
    const entrypoint = this.options.daemon?.entrypoint ?? resolveDefaultDaemonEntrypoint();

    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch {
      // ignore stale socket cleanup failures
    }

    const cli = entrypoint
      ? ["node", "--experimental-strip-types", entrypoint, "--socket", socketPath]
      : ["isolate-daemon", "--socket", socketPath];
    const cwd = this.options.daemon?.cwd ?? (entrypoint ? path.resolve(import.meta.dirname, "../..") : process.cwd());
    this.daemonProcess = spawn(cli[0]!, cli.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    });

    this.daemonProcess.stdout?.on("data", (data: Buffer) => {
      console.log("[isolate-host]", data.toString().trim());
    });
    this.daemonProcess.stderr?.on("data", (data: Buffer) => {
      console.error("[isolate-host]", data.toString().trim());
    });
    this.daemonProcess.on("exit", () => {
      this.daemonProcess = null;
      this.connection = null;
      this.connectionPromise = null;
    });

    await waitForSocket(socketPath, this.options.daemon?.timeoutMs ?? 10_000);
  }
}

export async function createIsolateHost(options?: CreateIsolateHostOptions): Promise<IsolateHost> {
  return new HostImpl(options);
}
