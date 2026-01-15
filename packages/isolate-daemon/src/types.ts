/**
 * Internal types for the isolate daemon.
 */

import type { Socket } from "node:net";
import type ivm from "isolated-vm";
import type { InternalRuntimeHandle } from "@ricsam/isolate-runtime/internal";
import type { CallbackRegistration } from "@ricsam/isolate-protocol";
import type { Browser, BrowserContext, Page } from "playwright";
import type { PlaywrightHandle } from "@ricsam/isolate-playwright";

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
  /** Default memory limit for isolates (MB) */
  defaultMemoryLimit?: number;
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
  ownerConnection: Socket;
  callbacks: Map<number, CallbackRegistration>;
  createdAt: number;
  lastActivity: number;
  /** Playwright browser instance (if setup) */
  browser?: Browser;
  /** Playwright browser context (if setup) */
  browserContext?: BrowserContext;
  /** Playwright page (if setup) */
  page?: Page;
  /** Playwright handle for event management (if setup) */
  playwrightHandle?: PlaywrightHandle;
  /** Module loader callback ID (if registered) */
  moduleLoaderCallbackId?: number;
  /** Cache of compiled ES modules */
  moduleCache?: Map<string, ivm.Module>;
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
}

/**
 * Global daemon state.
 */
export interface DaemonState {
  isolates: Map<string, IsolateInstance>;
  connections: Map<Socket, ConnectionState>;
  stats: DaemonStats;
  options: Required<DaemonOptions>;
}
