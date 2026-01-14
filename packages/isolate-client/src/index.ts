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
  DispatchOptions,
  ConsoleCallbacks,
  FetchCallback,
  FileSystemCallbacks,
  TestResults,
  TestResult,
  PlaywrightSetupOptions,
  PlaywrightTestResults,
  PlaywrightEventHandler,
  CollectedData,
} from "./types.ts";
