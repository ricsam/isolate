/**
 * Types for the isolate client.
 */

import type {
  RunTestsResult,
  TestResult as ProtocolTestResult,
  PlaywrightTestResult as ProtocolPlaywrightTestResult,
  CollectedData as ProtocolCollectedData,
} from "@ricsam/isolate-protocol";

// Re-export test result types
export type TestResults = RunTestsResult;
export type TestResult = ProtocolTestResult;
export type PlaywrightTestResults = ProtocolPlaywrightTestResult;
export type CollectedData = ProtocolCollectedData;

/**
 * Options for connecting to the daemon.
 */
export interface ConnectOptions {
  /** Unix socket path */
  socket?: string;
  /** TCP host */
  host?: string;
  /** TCP port */
  port?: number;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Connection to the daemon.
 */
export interface DaemonConnection {
  /** Create a new runtime in the daemon */
  createRuntime(options?: RuntimeOptions): Promise<RemoteRuntime>;
  /** Close the connection */
  close(): Promise<void>;
  /** Check if connected */
  isConnected(): boolean;
}

/**
 * Options for creating a runtime.
 */
export interface RuntimeOptions {
  /** Memory limit in MB */
  memoryLimit?: number;
  /** Console callback handlers */
  console?: ConsoleCallbacks;
  /** Fetch callback handler */
  fetch?: FetchCallback;
  /** File system callback handlers */
  fs?: FileSystemCallbacks;
}

/**
 * Console callback handlers.
 */
export interface ConsoleCallbacks {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
  dir?: (...args: unknown[]) => void;
}

/**
 * Fetch callback type.
 */
export type FetchCallback = (request: Request) => Response | Promise<Response>;

/**
 * File system callback handlers.
 */
export interface FileSystemCallbacks {
  readFile?: (path: string) => Promise<ArrayBuffer>;
  writeFile?: (path: string, data: ArrayBuffer) => Promise<void>;
  unlink?: (path: string) => Promise<void>;
  readdir?: (path: string) => Promise<string[]>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rmdir?: (path: string) => Promise<void>;
  stat?: (path: string) => Promise<{ isFile: boolean; isDirectory: boolean; size: number }>;
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Remote runtime handle.
 */
export interface RemoteRuntime {
  /** The isolate ID */
  readonly isolateId: string;

  /** Execute code in the isolate */
  eval(code: string, filename?: string): Promise<unknown>;

  /** Dispatch an HTTP request to the isolate's fetch handler */
  dispatchRequest(
    request: Request,
    options?: DispatchOptions
  ): Promise<Response>;

  /** Advance virtual timers */
  tick(ms?: number): Promise<void>;

  /** Setup test environment (describe, it, expect, etc.) */
  setupTestEnvironment(): Promise<void>;

  /** Run all registered tests and return results */
  runTests(timeout?: number): Promise<TestResults>;

  /** Setup Playwright browser environment */
  setupPlaywright(options?: PlaywrightSetupOptions): Promise<void>;

  /** Run all registered Playwright tests */
  runPlaywrightTests(timeout?: number): Promise<PlaywrightTestResults>;

  /** Reset/clear all Playwright tests */
  resetPlaywrightTests(): Promise<void>;

  /** Get collected console logs and network data */
  getCollectedData(): Promise<CollectedData>;

  /** Dispose the runtime */
  dispose(): Promise<void>;
}

/**
 * Options for dispatching a request.
 */
export interface DispatchOptions {
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * Options for setting up Playwright.
 */
export interface PlaywrightSetupOptions {
  /** Browser type to use */
  browserType?: "chromium" | "firefox" | "webkit";
  /** Run browser in headless mode */
  headless?: boolean;
  /** Base URL for navigation */
  baseURL?: string;
  /** Console log event handler */
  onConsoleLog?: (log: { level: string; args: unknown[] }) => void;
  /** Network request event handler */
  onNetworkRequest?: (request: { url: string; method: string; headers: Record<string, string>; timestamp: number }) => void;
  /** Network response event handler */
  onNetworkResponse?: (response: { url: string; status: number; headers: Record<string, string>; timestamp: number }) => void;
}

/**
 * Handler for Playwright events streamed from daemon.
 */
export interface PlaywrightEventHandler {
  onConsoleLog?: (log: { level: string; args: unknown[] }) => void;
  onNetworkRequest?: (request: { url: string; method: string; headers: Record<string, string>; timestamp: number }) => void;
  onNetworkResponse?: (response: { url: string; status: number; headers: Record<string, string>; timestamp: number }) => void;
}
