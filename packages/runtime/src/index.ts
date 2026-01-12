import ivm from "isolated-vm";
import { setupCore } from "@ricsam/isolate-core";
import { setupConsole } from "@ricsam/isolate-console";
import { setupEncoding } from "@ricsam/isolate-encoding";
import { setupTimers } from "@ricsam/isolate-timers";
import { setupPath } from "@ricsam/isolate-path";
import { setupCrypto } from "@ricsam/isolate-crypto";
import { setupFetch } from "@ricsam/isolate-fetch";
import { setupFs } from "@ricsam/isolate-fs";

import type { ConsoleOptions, ConsoleHandle } from "@ricsam/isolate-console";
import type { FetchOptions, FetchHandle } from "@ricsam/isolate-fetch";
import type { FsOptions, FsHandle } from "@ricsam/isolate-fs";
import type { CoreHandle } from "@ricsam/isolate-core";
import type { EncodingHandle } from "@ricsam/isolate-encoding";
import type { TimersHandle } from "@ricsam/isolate-timers";
import type { PathHandle } from "@ricsam/isolate-path";
import type { CryptoHandle } from "@ricsam/isolate-crypto";

export interface RuntimeOptions {
  /** Isolate memory limit in MB */
  memoryLimit?: number;
  /** Console options */
  console?: ConsoleOptions;
  /** Fetch options */
  fetch?: FetchOptions;
  /** File system options (optional - fs only set up if provided) */
  fs?: FsOptions;
}

export interface RuntimeHandle {
  /** The isolate instance */
  readonly isolate: ivm.Isolate;
  /** The context instance */
  readonly context: ivm.Context;
  /** Process pending timers */
  tick(ms?: number): Promise<void>;
  /** Dispose all resources */
  dispose(): void;
}

/**
 * Create a fully configured isolated-vm runtime
 *
 * Sets up all WHATWG APIs: fetch, fs, console, crypto, encoding, timers
 *
 * @example
 * const runtime = await createRuntime({
 *   console: {
 *     onLog: (level, ...args) => console.log(`[${level}]`, ...args)
 *   },
 *   fetch: {
 *     onFetch: async (request) => fetch(request)
 *   }
 * });
 *
 * await runtime.context.eval(`
 *   console.log("Hello from sandbox!");
 *   const response = await fetch("https://example.com");
 * `);
 *
 * runtime.dispose();
 */
export async function createRuntime(
  options?: RuntimeOptions
): Promise<RuntimeHandle> {
  const opts = options ?? {};

  // Create isolate with optional memory limit
  const isolate = new ivm.Isolate({
    memoryLimit: opts.memoryLimit,
  });
  const context = await isolate.createContext();

  // Store all handles for disposal
  const handles: {
    core?: CoreHandle;
    console?: ConsoleHandle;
    encoding?: EncodingHandle;
    timers?: TimersHandle;
    path?: PathHandle;
    crypto?: CryptoHandle;
    fetch?: FetchHandle;
    fs?: FsHandle;
  } = {};

  // Setup all APIs in order
  // Core must be first as it provides Blob, File, streams, URL, etc.
  handles.core = await setupCore(context);

  // Console
  handles.console = await setupConsole(context, opts.console);

  // Encoding (btoa/atob)
  handles.encoding = await setupEncoding(context);

  // Timers (setTimeout, setInterval)
  handles.timers = await setupTimers(context);

  // Path module
  handles.path = await setupPath(context);

  // Crypto (randomUUID, getRandomValues)
  handles.crypto = await setupCrypto(context);

  // Fetch API
  handles.fetch = await setupFetch(context, opts.fetch);

  // File system (only if handler provided)
  if (opts.fs) {
    handles.fs = await setupFs(context, opts.fs);
  }

  return {
    isolate,
    context,
    async tick(ms?: number) {
      await handles.timers!.tick(ms);
    },
    dispose() {
      // Dispose all handles
      handles.fs?.dispose();
      handles.fetch?.dispose();
      handles.crypto?.dispose();
      handles.path?.dispose();
      handles.timers?.dispose();
      handles.encoding?.dispose();
      handles.console?.dispose();
      handles.core?.dispose();

      // Release context and dispose isolate
      context.release();
      isolate.dispose();
    },
  };
}

// Re-export all package types and functions
export { setupCore } from "@ricsam/isolate-core";
export type { CoreHandle, SetupCoreOptions } from "@ricsam/isolate-core";

export { setupConsole } from "@ricsam/isolate-console";
export type { ConsoleHandle, ConsoleOptions } from "@ricsam/isolate-console";

export { setupCrypto } from "@ricsam/isolate-crypto";
export type { CryptoHandle } from "@ricsam/isolate-crypto";

export { setupEncoding } from "@ricsam/isolate-encoding";
export type { EncodingHandle } from "@ricsam/isolate-encoding";

export { setupFetch } from "@ricsam/isolate-fetch";
export type { FetchHandle, FetchOptions } from "@ricsam/isolate-fetch";

export { setupFs } from "@ricsam/isolate-fs";
export type { FsHandle, FsOptions, FileSystemHandler } from "@ricsam/isolate-fs";

export { setupPath } from "@ricsam/isolate-path";
export type { PathHandle } from "@ricsam/isolate-path";

export { setupTimers } from "@ricsam/isolate-timers";
export type { TimersHandle } from "@ricsam/isolate-timers";
