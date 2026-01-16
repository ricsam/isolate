/**
 * Internal APIs for @ricsam/isolate-runtime
 *
 * These are not part of the public API and may change without notice.
 * Only used by @ricsam/isolate-daemon internally.
 */

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

/**
 * @internal Options for creating a legacy runtime.
 */
export interface InternalRuntimeOptions {
  memoryLimitMB?: number;
  console?: ConsoleOptions;
  fetch?: FetchOptions;
  fs?: FsOptions;
  /** Current working directory for path.resolve(). Defaults to "/" */
  cwd?: string;
}

/**
 * @internal Runtime handle with direct isolate/context access.
 * Used by isolate-daemon for low-level operations.
 */
export interface InternalRuntimeHandle {
  readonly isolate: ivm.Isolate;
  readonly context: ivm.Context;
  readonly fetch: FetchHandle;
  readonly timers: TimersHandle;
  readonly console: ConsoleHandle;
  dispose(): void;
}

/**
 * @internal Create a runtime with direct access to isolate and context.
 * This is for internal use by @ricsam/isolate-daemon only.
 */
export async function createInternalRuntime(
  options?: InternalRuntimeOptions
): Promise<InternalRuntimeHandle> {
  const opts = options ?? {};

  const isolate = new ivm.Isolate({
    memoryLimit: opts.memoryLimitMB,
  });

  const context = await isolate.createContext();

  // Setup all APIs
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

  handles.core = await setupCore(context);
  handles.console = await setupConsole(context, opts.console);
  handles.encoding = await setupEncoding(context);
  handles.timers = await setupTimers(context);
  handles.path = await setupPath(context, { cwd: opts.cwd });
  handles.crypto = await setupCrypto(context);
  handles.fetch = await setupFetch(context, opts.fetch);

  if (opts.fs) {
    handles.fs = await setupFs(context, opts.fs);
  }

  return {
    isolate,
    context,
    fetch: handles.fetch,
    timers: handles.timers!,
    console: handles.console!,
    dispose() {
      handles.fs?.dispose();
      handles.fetch?.dispose();
      handles.crypto?.dispose();
      handles.path?.dispose();
      handles.timers?.dispose();
      handles.encoding?.dispose();
      handles.console?.dispose();
      handles.core?.dispose();
      context.release();
      isolate.dispose();
    },
  };
}
