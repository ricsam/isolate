/**
 * Internal types for the isolate daemon.
 */

import type { Socket } from "node:net";
import type ivm from "isolated-vm";
import type { InternalRuntimeHandle } from "@ricsam/isolate-runtime";
import type { CallbackRegistration } from "@ricsam/isolate-protocol";
import type { PlaywrightHandle } from "@ricsam/isolate-playwright";
import type { SourceMap, TransformResult } from "@ricsam/isolate-transform";

/**
 * Options for starting the daemon.
 */
export interface DaemonOptions {
  /** Unix socket path (preferred) */
  socketPath?: string;
  /** TCP host (fallback) */
  host?: string;
  /** TCP port (fallback) */
  port?: number;
  /** Maximum number of isolates */
  maxIsolates?: number;
  /** Default memory limit for isolates in megabytes */
  defaultMemoryLimitMB?: number;
}

/**
 * Handle returned by startDaemon.
 */
export interface DaemonHandle {
  /** Close the daemon and all connections */
  close(): Promise<void>;
  /** Get daemon statistics */
  getStats(): DaemonStats;
  /** Socket path or address the daemon is listening on */
  address: string;
}

/**
 * Daemon statistics.
 */
export interface DaemonStats {
  activeIsolates: number;
  activeConnections: number;
  totalIsolatesCreated: number;
  totalRequestsProcessed: number;
}

/**
 * Internal state for a single isolate instance.
 */
export interface IsolateInstance {
  isolateId: string;
  runtime: InternalRuntimeHandle;
  ownerConnection: Socket | null;
  callbacks: Map<number, CallbackRegistration>;
  createdAt: number;
  lastActivity: number;
  /** Whether test environment is enabled */
  testEnvironmentEnabled?: boolean;
  /** Playwright handle for event management (if setup) */
  playwrightHandle?: PlaywrightHandle;
  /** Module loader callback ID (if registered) */
  moduleLoaderCallbackId?: number;
  /** Cache of compiled ES modules (cleared on reuse) */
  moduleCache?: Map<string, ivm.Module>;
  /** Cache of static modules that survive namespace reuse */
  staticModuleCache?: Map<string, ivm.Module>;
  /** Cache of transformed JS by content hash (survives reuse) */
  transformCache?: Map<string, TransformResult>;
  /** Map from module to its filename (for tracking importer path) */
  moduleToFilename?: Map<ivm.Module, string>;
  /** Pending callback promises for current eval */
  pendingCallbacks: Promise<unknown>[];
  /** Source maps for error stack trace mapping */
  sourceMaps?: Map<string, SourceMap>;

  // Registries for returned callbacks/promises/iterators from custom function calls
  /** Functions returned by custom function calls (callable from isolate) */
  returnedCallbacks?: Map<number, Function>;
  /** Promises returned by custom function calls (resolvable from isolate) */
  returnedPromises?: Map<number, Promise<unknown>>;
  /** Async iterators returned by custom function calls (iterable from isolate) */
  returnedIterators?: Map<number, AsyncIterator<unknown>>;
  /** Next ID for daemon-local callback registration (starts at high number to avoid conflicts) */
  nextLocalCallbackId?: number;

  // Namespace pooling fields
  /** Namespace ID for pooling/reuse (if set, runtime is cached on dispose) */
  namespaceId?: string;
  /** Whether this runtime is soft-deleted (disposed but cached for reuse) */
  isDisposed: boolean;
  /** Timestamp when runtime was disposed (for LRU eviction) */
  disposedAt?: number;

  // Mutable callback context for runtime reuse
  /** Mutable context for callbacks - allows updating callback IDs/connection on reuse */
  callbackContext?: CallbackContext;
}

/**
 * Mutable context for callbacks that can be updated on runtime reuse.
 * This allows closures to reference current callback IDs instead of captured values.
 */
export interface CallbackContext {
  /** Current connection state (updated on reuse) */
  connection: ConnectionState | null;
  /** Console onEntry callback ID */
  consoleOnEntry?: number;
  /** Fetch callback ID */
  fetch?: number;
  /** Module loader callback ID */
  moduleLoader?: number;
  /** FS callback IDs by name */
  fs: {
    readFile?: number;
    writeFile?: number;
    stat?: number;
    readdir?: number;
    unlink?: number;
    mkdir?: number;
    rmdir?: number;
  };
  /** Custom function callback IDs by name */
  custom: Map<string, number>;
}

/**
 * Pending request waiting for response.
 */
export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Stream session for tracking active streams.
 */
export interface StreamSession {
  streamId: number;
  direction: "upload" | "download";
  requestId: number;
  state: "active" | "closing" | "closed";
  bytesTransferred: number;
  credit: number;
  creditResolver?: () => void;
}

/**
 * Stream receiver for collecting uploaded stream chunks.
 */
export interface StreamReceiver {
  streamId: number;
  requestId: number;
  chunks: Uint8Array[];
  totalBytes: number;
  resolve: (body: Uint8Array) => void;
  reject: (error: Error) => void;
}

/**
 * Callback stream receiver for streaming fetch callback responses.
 * Receives streamed response body from client for fetch callbacks.
 */
export interface CallbackStreamReceiver {
  streamId: number;
  requestId: number;
  metadata: {
    status: number;
    statusText: string;
    headers: [string, string][];
  };
  controller: ReadableStreamDefaultController<Uint8Array>;
  state: "active" | "closed" | "errored";
  pendingChunks: Uint8Array[];
  error?: Error;
  pullResolvers: Array<() => void>;
  controllerFinalized: boolean;
}

/**
 * Internal state for a client connection.
 */
export interface ConnectionState {
  socket: Socket;
  isolates: Set<string>;
  pendingRequests: Map<number, PendingRequest>;
  pendingCallbacks: Map<number, PendingRequest>;
  nextRequestId: number;
  nextCallbackId: number;
  nextStreamId: number;
  /** Active download streams (daemon sending to client) */
  activeStreams: Map<number, StreamSession>;
  /** Active upload stream receivers (client sending to daemon) */
  streamReceivers: Map<number, StreamReceiver>;
  /** Active callback stream receivers (for streaming fetch callback responses) */
  callbackStreamReceivers: Map<number, CallbackStreamReceiver>;
}

/**
 * Global daemon state.
 */
export interface DaemonState {
  isolates: Map<string, IsolateInstance>;
  connections: Map<Socket, ConnectionState>;
  stats: DaemonStats;
  options: Required<DaemonOptions>;
  /** Index of namespaced runtimes by namespace ID for fast lookup */
  namespacedRuntimes: Map<string, IsolateInstance>;
}
