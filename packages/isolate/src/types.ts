import type {
  ConsoleEntry as LegacyConsoleEntry,
  PlaywrightEvent as LegacyPlaywrightEvent,
  RunResults as LegacyRunResults,
  TestEvent as LegacyTestEvent,
} from "./internal/client/index.ts";

export type ConsoleEntry = LegacyConsoleEntry;
export type RunResults = LegacyRunResults;
export type TestEvent = LegacyTestEvent;
export type PlaywrightEvent = LegacyPlaywrightEvent;

export interface HostCallContext {
  signal: AbortSignal;
  runtimeId: string;
  requestId?: string;
  resourceId: string;
  metadata: Record<string, string>;
}

export interface ModuleImporter {
  path: string;
  resolveDir: string;
}

export interface ModuleSource {
  code: string;
  filename: string;
  resolveDir: string;
  static?: boolean;
}

export type ModuleResolveResult =
  | string
  | ModuleSource
  | null
  | undefined
  | Promise<string | ModuleSource | null | undefined>;

export type ModuleResolverSourceLoader = (
  relativePath: string,
  context: HostCallContext,
) => ModuleResolveResult;

export type ModuleResolverFallback = (
  specifier: string,
  importer: ModuleImporter,
  context: HostCallContext,
) => ModuleResolveResult;

export interface ModuleResolver {
  mountNodeModules(virtualMount: string, hostPath: string): ModuleResolver;
  virtual(specifier: string, source: ModuleResolveResult | (() => ModuleResolveResult), options?: Partial<ModuleSource>): ModuleResolver;
  virtualFile(specifier: string, filePath: string, options?: Partial<ModuleSource>): ModuleResolver;
  sourceTree(prefix: string, loader: ModuleResolverSourceLoader): ModuleResolver;
  fallback(loader: ModuleResolverFallback): ModuleResolver;
  resolve(specifier: string, importer: ModuleImporter, context: HostCallContext): Promise<ModuleSource>;
}

export interface FileBindings {
  readFile?: (path: string, context: HostCallContext) => Promise<ArrayBuffer>;
  writeFile?: (path: string, data: ArrayBuffer, context: HostCallContext) => Promise<void>;
  unlink?: (path: string, context: HostCallContext) => Promise<void>;
  readdir?: (path: string, context: HostCallContext) => Promise<string[]>;
  mkdir?: (path: string, options: { recursive?: boolean } | undefined, context: HostCallContext) => Promise<void>;
  rmdir?: (path: string, context: HostCallContext) => Promise<void>;
  stat?: (
    path: string,
    context: HostCallContext,
  ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  rename?: (from: string, to: string, context: HostCallContext) => Promise<void>;
}

export type ToolHandler = (
  ...args: [...unknown[], HostCallContext]
) => unknown | Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

export type ToolBindings = Record<string, ToolHandler>;

export interface HostBindings {
  console?: {
    onEntry?: (entry: ConsoleEntry, context: HostCallContext) => void;
  };
  fetch?: (request: Request, context: HostCallContext) => Response | Promise<Response>;
  files?: FileBindings;
  modules?: ModuleResolver;
  tools?: ToolBindings;
}

export interface RuntimeDiagnostics {
  activeRequests: number;
  activeResources: number;
  pendingFiles: number;
  pendingFetches: number;
  pendingModules: number;
  pendingTools: number;
  streamCount: number;
  lastError?: string;
  reused?: boolean;
  lifecycleState: "idle" | "active" | "reloading" | "disposing";
}

export interface BrowserRuntimeDiagnostics extends RuntimeDiagnostics {
  browserConsoleLogs: number;
  networkRequests: number;
  networkResponses: number;
  pageErrors: number;
  requestFailures: number;
  collectedData: {
    browserConsoleLogs: unknown[];
    pageErrors: unknown[];
    networkRequests: unknown[];
    networkResponses: unknown[];
    requestFailures: unknown[];
  };
}

export interface WebSocketUpgradeData {
  connectionId: string;
  requested?: boolean;
  [key: string]: unknown;
}

export type RequestResult =
  | { type: "response"; response: Response }
  | { type: "websocket"; upgradeData: WebSocketUpgradeData };

export interface AppServer {
  handle(request: Request, options?: { requestId?: string; signal?: AbortSignal; metadata?: Record<string, string> }): Promise<RequestResult>;
  ws: {
    open(connectionId: string): Promise<void>;
    message(connectionId: string, data: string | ArrayBuffer): Promise<void>;
    close(connectionId: string, code: number, reason: string): Promise<void>;
    error(connectionId: string, error: Error): Promise<void>;
  };
  reload(reason?: string): Promise<void>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  diagnostics(): Promise<RuntimeDiagnostics>;
}

export interface ScriptRuntime {
  eval(
    code: string,
    options?: string | { filename?: string; executionTimeout?: number },
  ): Promise<void>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  diagnostics(): Promise<RuntimeDiagnostics>;
  events: {
    on(event: string, handler: (payload: unknown) => void): () => void;
    emit(event: string, payload: unknown): Promise<void>;
  };
  tests: {
    run(options?: { timeoutMs?: number }): Promise<RunResults>;
    hasTests(): Promise<boolean>;
    reset(): Promise<void>;
  };
}

export interface BrowserRuntime {
  run(
    code: string,
    options?: { filename?: string; asTestSuite?: boolean; timeoutMs?: number },
  ): Promise<{ tests?: RunResults; value?: unknown }>;
  diagnostics(): Promise<BrowserRuntimeDiagnostics>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
}

export interface CreateRuntimeOptions {
  key?: string;
  bindings: HostBindings;
  features?: {
    tests?: boolean;
  };
  cwd?: string;
  executionTimeout?: number;
  memoryLimitMB?: number;
}

export interface CreateAppServerOptions extends CreateRuntimeOptions {
  key: string;
  entry: string;
  entryFilename?: string;
  webSockets?: {
    onCommand?: (command: { type: "message" | "close"; connectionId: string; data?: string | ArrayBuffer; code?: number; reason?: string }) => void;
  };
}

export interface CreateBrowserRuntimeOptions extends CreateRuntimeOptions {
  browser: {
    page: any;
    readFile?: (normalizedVirtualPath: string) => Promise<Buffer>;
    captureConsole?: boolean;
    writeFile?: (normalizedVirtualPath: string, data: Buffer) => Promise<void> | void;
    createPage?: (context: any) => Promise<any> | any;
    createContext?: (options?: any) => Promise<any> | any;
    onEvent?: (event: PlaywrightEvent) => void;
  };
}

export interface IsolateHost {
  createAppServer(options: CreateAppServerOptions): Promise<AppServer>;
  createRuntime(options: CreateRuntimeOptions): Promise<ScriptRuntime>;
  createBrowserRuntime(options: CreateBrowserRuntimeOptions): Promise<BrowserRuntime>;
  diagnostics(): Promise<{ runtimes: number; servers: number; connected: boolean }>;
  close(): Promise<void>;
}

export interface CreateIsolateHostOptions {
  engine?: "auto";
  daemon?: {
    socketPath?: string;
    entrypoint?: string;
    cwd?: string;
    timeoutMs?: number;
    autoStart?: boolean;
  };
}

export type TypeProfileName = "backend" | "agent" | "browser-test";
export type TypeCapability = "fetch" | "files" | "tests" | "browser" | "tools" | "console" | "encoding" | "timers";

export interface TypeProfile {
  profile: TypeProfileName;
  capabilities: TypeCapability[];
  include: Array<"core" | "fetch" | "fs" | "console" | "encoding" | "timers" | "testEnvironment" | "playwright">;
  files: Array<{ name: string; content: string }>;
}

export interface TypecheckRequest {
  code: string;
  profile?: TypeProfileName;
  capabilities?: TypeCapability[];
  libraryTypes?: Record<string, { files: Array<{ path: string; content: string }> }>;
  compilerOptions?: Record<string, unknown>;
}
