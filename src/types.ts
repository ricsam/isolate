import type {
  ConsoleEntry as LegacyConsoleEntry,
  PlaywrightEvent as LegacyPlaywrightEvent,
  RunResults as LegacyRunResults,
  TestEvent as LegacyTestEvent,
} from "./internal/client/index.ts";
import type { PlaywrightSessionHandlerCallback } from "./playwright.ts";

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

interface HostBrowserBindingBase {
  captureConsole?: boolean;
  /** Sync-only, best-effort event notifications. Returned promises are ignored. */
  onEvent?: (event: PlaywrightEvent, context: HostCallContext) => void;
}

export type BrowserProfileMode = "storageState" | "persistent";

export interface HostBrowserProfileOptions {
  /**
   * Virtual filesystem root used for isolate-owned browser profile data.
   *
   * Defaults to `/.browser-profiles`.
   */
  root?: string;
  /**
   * Default persistence mode for `browser.newContext({ profile })`.
   *
   * Defaults to `"storageState"`.
   */
  defaultMode?: BrowserProfileMode;
  /**
   * Save profile data when the context is closed.
   *
   * Defaults to `true`.
   */
  autosave?: boolean;
  /**
   * Include IndexedDB when saving storage-state profiles.
   *
   * Defaults to `false`.
   */
  indexedDB?: boolean;
}

export interface HostBrowserFactoryBindings extends HostBrowserBindingBase {
  createContext?: (options: unknown, context: HostCallContext) => Promise<any> | any;
  createPersistentContext?: (
    userDataDir: string,
    options: unknown,
    context: HostCallContext,
  ) => Promise<any> | any;
  createPage?: (contextHandle: any, context: HostCallContext) => Promise<any> | any;
  readFile?: (path: string, context: HostCallContext) => Promise<Buffer> | Buffer;
  writeFile?: (path: string, data: Buffer, context: HostCallContext) => Promise<void> | void;
  profiles?: boolean | HostBrowserProfileOptions;
  handler?: never;
}

export interface HostBrowserHandlerBindings extends HostBrowserBindingBase {
  handler: PlaywrightSessionHandlerCallback;
  createContext?: never;
  createPersistentContext?: never;
  createPage?: never;
  readFile?: never;
  writeFile?: never;
  profiles?: never;
}

export type HostBrowserBindings =
  | HostBrowserFactoryBindings
  | HostBrowserHandlerBindings;

export type ToolHandler = (
  ...args: [...unknown[], HostCallContext]
) => unknown | Promise<unknown> | AsyncGenerator<unknown, unknown, unknown>;

export type ToolBindings = Record<string, ToolHandler>;

export interface HostBindings {
  console?: {
    /** Sync-only, best-effort console notifications. Returned promises are ignored. */
    onEntry?: (entry: ConsoleEntry, context: HostCallContext) => void;
  };
  fetch?: (request: Request, context: HostCallContext) => Response | Promise<Response>;
  files?: FileBindings;
  modules?: ModuleResolver;
  tools?: ToolBindings;
  browser?: HostBrowserBindings;
}

/**
 * Controls whether nested runtimes inherit the parent runtime's fetch binding.
 *
 * - `"inherit"` copies the parent fetch binding into nested resources that do
 *   not provide their own fetch binding, preserving the host's URL policy,
 *   logging, rate limits, and accounting.
 * - `"disabled"` leaves fetch unbound unless the nested resource explicitly
 *   provides a fetch binding. Unbound fetch calls reject instead of falling
 *   back to native host fetch.
 */
export type NestedHostFetchPolicy = "inherit" | "disabled";

/**
 * Policy for exposing the synthetic `@ricsam/isolate` nested host API inside a
 * runtime.
 *
 * This policy is enforced by the parent host, not by sandbox code. Resource
 * limits are tracked at the root nested resource group and include recursive
 * descendants, so a child cannot reset its quotas by creating grandchildren.
 * Namespaced runtime keys are also scoped inside that resource group before
 * they reach the shared host.
 */
export interface NestedHostPolicy {
  /**
   * Fetch inheritance mode for nested resources.
   *
   * Defaults to `"disabled"`, which means nested resources do not receive the
   * parent's fetch binding unless the host opts in with `"inherit"`.
   */
  fetch?: NestedHostFetchPolicy;
  /**
   * Maximum number of live nested resources in the resource group.
   *
   * This includes runtimes, test runtimes, namespaced runtimes, app servers,
   * and all recursive descendants.
   */
  maxTotalResources?: number;
  /**
   * Maximum number of live nested runtime resources.
   *
   * Script runtimes, test runtimes, and namespaced runtimes count toward this
   * quota. App servers are counted separately by `maxAppServers`.
   */
  maxRuntimes?: number;
  /** Maximum number of live nested app servers. */
  maxAppServers?: number;
  /**
   * Maximum memory limit, in MB, that a nested runtime or app server may
   * request.
   *
   * If omitted by the nested caller, the child receives this limit. Requests
   * above the limit are rejected before the child resource is created.
   */
  maxMemoryLimitMB?: number;
  /**
   * Maximum default execution timeout, in milliseconds, for nested runtimes and
   * app servers.
   *
   * If omitted by the nested caller, the child receives this timeout. Requests
   * above the limit are rejected before the child resource is created.
   */
  maxExecutionTimeoutMs?: number;
  /**
   * Optional lifetime cap, in milliseconds, for each nested app server.
   *
   * When set, the parent host disposes the app server after this duration even
   * if sandbox code keeps a reference to it.
   */
  maxAppServerLifetimeMs?: number;
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

export interface BrowserDiagnostics {
  contexts: number;
  pages: number;
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

export interface RuntimeResourceDiagnostics {
  runtime: RuntimeDiagnostics;
  browser?: BrowserDiagnostics;
}

export interface TestDiagnostics {
  enabled: true;
  registeredTests: number;
  lastRun?: RunResults;
}

export interface TestRuntimeDiagnostics extends RuntimeResourceDiagnostics {
  test: TestDiagnostics;
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
  diagnostics(): Promise<RuntimeResourceDiagnostics>;
}

export type ScriptRuntimeEvalOptions = {
  filename?: string;
  executionTimeout?: number;
  signal?: AbortSignal;
};

export type TestRuntimeRunOptions = {
  filename?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export interface ScriptRuntime {
  eval(
    code: string,
    options?: string | ScriptRuntimeEvalOptions,
  ): Promise<void>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  diagnostics(): Promise<RuntimeResourceDiagnostics>;
  events: {
    /** Sync-only, best-effort event notifications. Returned promises are ignored. */
    on(event: string, handler: (payload: unknown) => void): () => void;
    emit(event: string, payload: unknown): Promise<void>;
  };
}

export interface TestRuntime {
  run(
    code: string,
    options?: TestRuntimeRunOptions,
  ): Promise<RunResults>;
  diagnostics(): Promise<TestRuntimeDiagnostics>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  test: {
    /** Sync-only, best-effort test lifecycle notifications. Returned promises are ignored. */
    onEvent(handler: (event: TestEvent) => void): () => void;
  };
}

export interface NamespacedRuntime {
  eval(
    code: string,
    options?: ScriptRuntimeEvalOptions,
  ): Promise<void>;
  runTests(
    code: string,
    options?: TestRuntimeRunOptions,
  ): Promise<RunResults>;
  diagnostics(): Promise<TestRuntimeDiagnostics>;
  dispose(options?: { hard?: boolean; reason?: string }): Promise<void>;
  test: {
    /** Sync-only, best-effort test lifecycle notifications. Returned promises are ignored. */
    onEvent(handler: (event: TestEvent) => void): () => void;
  };
  events: {
    /** Sync-only, best-effort event notifications. Returned promises are ignored. */
    on(event: string, handler: (payload: unknown) => void): () => void;
    emit(event: string, payload: unknown): Promise<void>;
  };
}

export interface CreateRuntimeOptions {
  key?: string;
  bindings: HostBindings;
  cwd?: string;
  executionTimeout?: number;
  memoryLimitMB?: number;
  /**
   * Expose the brokered nested host API to code running in this runtime.
   *
   * Pass `false` to disable `@ricsam/isolate` in the sandbox, or pass a policy
   * to allow nested runtimes and app servers within explicit fetch, quota, and
   * namespace boundaries.
   */
  nestedHost?: false | NestedHostPolicy;
}

export interface CreateNamespacedRuntimeOptions {
  bindings: HostBindings;
  cwd?: string;
  executionTimeout?: number;
  memoryLimitMB?: number;
  /**
   * Expose the brokered nested host API to code running in this namespaced
   * runtime.
   *
   * Pass `false` to disable `@ricsam/isolate` in the sandbox, or pass a policy
   * to allow nested runtimes and app servers within explicit fetch, quota, and
   * namespace boundaries.
   */
  nestedHost?: false | NestedHostPolicy;
}

export interface CreateTestRuntimeOptions extends CreateRuntimeOptions {}

export interface CreateAppServerOptions extends CreateRuntimeOptions {
  key: string;
  entry: string;
  entryFilename?: string;
  webSockets?: {
    onCommand?: (command: { type: "message" | "close"; connectionId: string; data?: string | ArrayBuffer; code?: number; reason?: string }) => void;
  };
}

export interface IsolateHost {
  createAppServer(options: CreateAppServerOptions): Promise<AppServer>;
  createRuntime(options: CreateRuntimeOptions): Promise<ScriptRuntime>;
  createTestRuntime(options: CreateTestRuntimeOptions): Promise<TestRuntime>;
  getNamespacedRuntime(
    key: string,
    options: CreateNamespacedRuntimeOptions,
  ): Promise<NamespacedRuntime>;
  disposeNamespace(key: string, options?: { reason?: string }): Promise<void>;
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
export type TypeCapability =
  | "fetch"
  | "files"
  | "tests"
  | "browser"
  | "tools"
  | "console"
  | "crypto"
  | "encoding"
  | "timers";

export interface TypeProfile {
  profile: TypeProfileName;
  capabilities: TypeCapability[];
  include: Array<
    "core"
    | "sandboxIsolate"
    | "fetch"
    | "fs"
    | "console"
    | "crypto"
    | "encoding"
    | "timers"
    | "testEnvironment"
    | "playwright"
  >;
  files: Array<{ name: string; content: string }>;
}

export interface TypecheckRequest {
  code: string;
  profile?: TypeProfileName;
  capabilities?: TypeCapability[];
  libraryTypes?: Record<string, { files: Array<{ path: string; content: string }> }>;
  compilerOptions?: Record<string, unknown>;
}
