/**
 * @ricsam/isolate-client
 *
 * Client library for connecting to the isolate daemon.
 * Works with Bun, Node.js, and other JavaScript runtimes.
 */

export { connect } from "./connection.ts";
export type {
  ConnectOptions,
  DaemonConnection,
  RuntimeOptions,
  RemoteRuntime,
  RemoteFetchHandle,
  RemoteTimersHandle,
  RemoteConsoleHandle,
  RemoteTestEnvironmentHandle,
  RemotePlaywrightHandle,
  DispatchOptions,
  ConsoleCallbacks,
  FetchCallback,
  FileSystemCallbacks,
  PlaywrightOptions,
  TestResults,
  TestResult,
  PlaywrightTestResults,
  CollectedData,
} from "./types.ts";
