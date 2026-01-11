import type ivm from "isolated-vm";

export interface FetchOptions {
  /** Handler for fetch requests from the isolate */
  onFetch?: (request: Request) => Promise<Response>;
}

export interface FetchHandle {
  dispose(): void;
}

/**
 * Setup Fetch API in an isolated-vm context
 *
 * Injects fetch, Request, Response, Headers, FormData, AbortController
 *
 * @example
 * const handle = await setupFetch(context, {
 *   onFetch: async (request) => {
 *     // Proxy fetch requests to the host
 *     return fetch(request);
 *   }
 * });
 *
 * await context.eval(`
 *   const response = await fetch("https://example.com");
 *   const text = await response.text();
 * `);
 */
export async function setupFetch(
  context: ivm.Context,
  options?: FetchOptions
): Promise<FetchHandle> {
  // TODO: Implement fetch setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
