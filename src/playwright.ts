import {
  createPlaywrightFactoryHandler,
  getPlaywrightHandlerMetadata,
  type PlaywrightCallback,
} from "./internal/playwright/client.ts";
import type {
  CollectedData,
  PlaywrightEvent,
  PlaywrightFileData,
  PlaywrightOperation,
  PlaywrightResult,
} from "./internal/protocol/index.ts";

export type PlaywrightSessionHandlerCallback = PlaywrightCallback;

export interface CreatePlaywrightSessionHandlerOptions<
  TContext = unknown,
  TPage = unknown,
  TContextOptions = unknown,
> {
  timeout?: number;
  createContext?: (
    options?: TContextOptions,
  ) => Promise<TContext> | TContext;
  createPage?: (context: TContext) => Promise<TPage> | TPage;
  readFile?: (
    filePath: string,
  ) => Promise<PlaywrightFileData> | PlaywrightFileData;
  writeFile?: (
    filePath: string,
    data: Buffer,
  ) => Promise<void> | void;
  evaluatePredicate?: (predicateId: number, data: unknown) => boolean;
}

export interface PlaywrightSessionHandler {
  handler: PlaywrightSessionHandlerCallback;
  getCollectedData(): CollectedData;
  getTrackedResources(): { contexts: string[]; pages: string[] };
  clearCollectedData(): void;
  /** Sync-only, best-effort Playwright event notifications. Returned promises are ignored. */
  onEvent(callback: (event: PlaywrightEvent) => void): () => void;
}

export {
  DEFAULT_PLAYWRIGHT_HANDLER_META,
  PLAYWRIGHT_HANDLER_META,
} from "./internal/playwright/types.ts";

export type {
  BrowserConsoleLogEntry,
  DefaultPlaywrightHandler,
  DefaultPlaywrightHandlerMetadata,
  DefaultPlaywrightHandlerOptions,
  NetworkRequestInfo,
  NetworkResponseInfo,
  PageErrorInfo,
  PlaywrightCollector,
  PlaywrightHandlerMetadata,
  PlaywrightHandle,
  RequestFailureInfo,
} from "./internal/playwright/client.ts";

export type {
  CollectedData,
  PlaywrightEvent,
  PlaywrightFileData,
  PlaywrightOperation,
  PlaywrightResult,
};

export {
  createPlaywrightHandler,
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
  getPlaywrightHandlerMetadata,
} from "./internal/playwright/client.ts";

export function createPlaywrightSessionHandler<
  TContext = unknown,
  TPage = unknown,
  TContextOptions = unknown,
>(
  options: CreatePlaywrightSessionHandlerOptions<
    TContext,
    TPage,
    TContextOptions
  > = {},
): PlaywrightSessionHandler {
  const handler = createPlaywrightFactoryHandler({
    timeout: options.timeout,
    createContext: options.createContext,
    createPage: options.createPage,
    readFile: options.readFile,
    writeFile: options.writeFile,
    evaluatePredicate: options.evaluatePredicate,
  } as Parameters<typeof createPlaywrightFactoryHandler>[0]);
  const metadata = getPlaywrightHandlerMetadata(handler);

  if (!metadata?.collector) {
    throw new Error(
      "Playwright session handler metadata is unavailable for the generated handler.",
    );
  }

  return {
    handler: handler as (
      op: PlaywrightOperation,
    ) => Promise<PlaywrightResult>,
    getCollectedData: () => metadata.collector.getCollectedData(),
    getTrackedResources: () => metadata.collector.getTrackedResources(),
    clearCollectedData: () => metadata.collector.clearCollectedData(),
    onEvent: (callback) => metadata.collector.onEvent(callback),
  };
}
