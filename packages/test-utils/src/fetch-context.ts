import type ivm from "isolated-vm";
import type { TestContext } from "./index.ts";
import ivmModule from "isolated-vm";
import { setupFetch, clearAllInstanceState } from "@ricsam/isolate-fetch";

export interface FetchTestContext extends TestContext {
  // Context with fetch APIs set up
}

/**
 * Create a test context with fetch APIs set up (Headers, Request, Response, FormData, fetch)
 */
export async function createFetchTestContext(): Promise<FetchTestContext> {
  const isolate = new ivmModule.Isolate();
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
