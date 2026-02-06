/**
 * @ricsam/isolate-client
 *
 * Client library for connecting to the isolate daemon.
 * Works with Bun, Node.js, and other JavaScript runtimes.
 */

export { connect, isBenignDisposeError } from "./connection.ts";
export type {
  ConnectOptions,
  DaemonConnection,
  Namespace,
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
  PlaywrightEvent,
  TestEnvironmentOptions,
  RunResults,
  TestResult,
  TestInfo,
  TestError,
  TestEvent,
  SuiteInfo,
  SuiteResult,
  CollectedData,
  ConsoleEntry,
  CustomFunctions,
  UpgradeRequest,
  WebSocketCommand,
} from "./types.ts";
