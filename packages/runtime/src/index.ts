import type ivm from "isolated-vm";
import type { ConsoleOptions } from "@ricsam/isolate-console";
import type { FetchOptions } from "@ricsam/isolate-fetch";
import type { FsOptions } from "@ricsam/isolate-fs";

export interface RuntimeOptions {
  /** Console options */
  console?: ConsoleOptions;
  /** Fetch options */
  fetch?: FetchOptions;
  /** File system options */
  fs?: FsOptions;
}

export interface RuntimeHandle {
  /** The isolate instance */
  readonly isolate: ivm.Isolate;
  /** The context instance */
  readonly context: ivm.Context;
  /** Process pending timers */
  tick(): Promise<void>;
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
  // TODO: Implement runtime creation
  const isolate = new (await import("isolated-vm")).default.Isolate();
  const context = await isolate.createContext();

  return {
    isolate,
    context,
    async tick() {
      // TODO: Process pending timers
    },
    dispose() {
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
export type { FsHandle, FsOptions } from "@ricsam/isolate-fs";

export { setupTimers } from "@ricsam/isolate-timers";
export type { TimersHandle } from "@ricsam/isolate-timers";
