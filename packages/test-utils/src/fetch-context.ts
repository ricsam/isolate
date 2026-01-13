import type ivm from "isolated-vm";
import type { TestContext } from "./index.ts";

export interface FetchTestContext extends TestContext {
  // Context with fetch APIs set up
}

/**
 * Create a test context with fetch APIs set up (Headers, Request, Response, FormData, fetch)
 */
export async function createFetchTestContext(): Promise<FetchTestContext> {
  const ivmModule = await import("isolated-vm");
  const { setupFetch, clearAllInstanceState } = await import(
    "@ricsam/isolate-fetch"
  );

  const isolate = new ivmModule.default.Isolate();
  const context = await isolate.createContext();

  clearAllInstanceState();

  const fetchHandle = await setupFetch(context);

  return {
    isolate,
    context,
    dispose() {
      fetchHandle.dispose();
      context.release();
      isolate.dispose();
    },
  };
}
