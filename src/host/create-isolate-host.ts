import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type DaemonConnection, type RemoteRuntime, type RuntimeOptions } from "../internal/client/index.ts";
import { createRuntimeDiagnostics } from "../bridge/diagnostics.ts";
import { createRuntimeBindingsAdapter } from "../bridge/runtime-bindings.ts";
import { createBrowserRuntimeAdapter } from "../browser/browser-runtime.ts";
import { createScriptRuntimeAdapter } from "../runtime/script-runtime.ts";
import { createAppServerAdapter } from "../server/app-server.ts";
import type { CreateBrowserRuntimeOptions, CreateIsolateHostOptions, CreateRuntimeOptions, IsolateHost } from "../types.ts";

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

class HostImpl implements IsolateHost {
  private readonly options: CreateIsolateHostOptions;
  private daemonProcess: ChildProcess | null = null;
  private connection: DaemonConnection | null = null;
  private connectionPromise: Promise<DaemonConnection> | null = null;
  private readonly servers = new Set<object>();
  private readonly runtimes = new Set<object>();

  constructor(options?: CreateIsolateHostOptions) {
    this.options = options ?? {};
  }

  async createAppServer(options: CreateRuntimeOptions & { key: string; entry: string; entryFilename?: string; webSockets?: { onCommand?: (command: { type: "message" | "close"; connectionId: string; data?: string | ArrayBuffer; code?: number; reason?: string }) => void } }) {
    const server = await createAppServerAdapter(() => this.getConnection(), options);
    this.servers.add(server);
    return server;
  }

  async createRuntime(options: CreateRuntimeOptions) {
    const diagnostics = createRuntimeDiagnostics();
    let runtimeId = options.key ?? "runtime";
    const bindingsAdapter = createRuntimeBindingsAdapter(
      options.bindings,
      () => runtimeId,
      diagnostics,
    );
    const runtime = await this.createRemoteRuntime(
      {
        ...bindingsAdapter.runtimeOptions,
        cwd: options.cwd,
        memoryLimitMB: options.memoryLimitMB,
        executionTimeout: options.executionTimeout,
        testEnvironment: options.features?.tests ?? false,
      },
      options.key,
    );
    runtimeId = runtime.id;
    const adapter = createScriptRuntimeAdapter(runtime, diagnostics, {
      onBeforeDispose: (reason) => bindingsAdapter.abort(reason),
    });
    this.runtimes.add(adapter);
    return adapter;
  }

  async createBrowserRuntime(options: CreateBrowserRuntimeOptions) {
    const browserRuntime = await createBrowserRuntimeAdapter(
      async (runtimeOptions) => await this.createRemoteRuntime(runtimeOptions, options.key),
      options,
    );
    this.runtimes.add(browserRuntime);
    return browserRuntime;
  }

  async diagnostics() {
    return {
      runtimes: this.runtimes.size,
      servers: this.servers.size,
      connected: this.connection?.isConnected() ?? false,
    };
  }

  async close(): Promise<void> {
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
