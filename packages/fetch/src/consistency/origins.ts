/**
 * Helper functions for creating web objects from different origins.
 * Used to test that objects behave identically regardless of how they were created.
 *
 * Note: The `customFunction` origin is tested where supported. For Response and Request,
 * this requires constructing the object in the isolate using parameters passed from
 * a host custom function, since native objects cannot be serialized across the boundary.
 */

import { createRuntime, type RuntimeHandle } from "@ricsam/isolate-runtime";
import { clearAllInstanceState } from "@ricsam/isolate-core";

// ============================================================================
// Types
// ============================================================================

export type ResponseOrigin =
  | "direct"
  | "customFunction"
  | "fetchCallback";

export type RequestOrigin =
  | "direct"
  | "customFunction"
  | "serveRequest";

export type HeadersOrigin = "direct" | "fromResponse" | "fromRequest";

// Blob and File don't have special marshalling support for custom functions
export type BlobOrigin = "direct";

export type FileOrigin = "direct";

// FormData doesn't have special marshalling support for custom functions
export type FormDataOrigin = "direct" | "fromResponse";

export const RESPONSE_ORIGINS: ResponseOrigin[] = [
  "direct",
  "customFunction",
  "fetchCallback",
];

export const REQUEST_ORIGINS: RequestOrigin[] = [
  "direct",
  "customFunction",
  "serveRequest",
];

export const HEADERS_ORIGINS: HeadersOrigin[] = [
  "direct",
  "fromResponse",
  "fromRequest",
];

export const BLOB_ORIGINS: BlobOrigin[] = ["direct"];

export const FILE_ORIGINS: FileOrigin[] = ["direct"];

export const FORMDATA_ORIGINS: FormDataOrigin[] = [
  "direct",
  "fromResponse",
];

// ============================================================================
// Test Context
// ============================================================================

export interface ConsistencyTestContext {
  /** The runtime handle */
  runtime: RuntimeHandle;
  /** Execute code in the runtime */
  eval(code: string): Promise<void>;
  /** Dispatch an HTTP request to the serve() handler */
  dispatchRequest(request: Request): Promise<Response>;
  /** Set the mock response for the next fetch call */
  setMockResponse(response: MockResponse): void;
  /** Get a result from the isolate via setResult() */
  getResult<T = unknown>(): T | undefined;
  /** Clear the stored result */
  clearResult(): void;
  /** Dispose all resources */
  dispose(): Promise<void>;
}

export interface MockResponse {
  status?: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Create a test context for consistency tests.
 * Provides helpers for creating objects from different origins.
 */
export async function createConsistencyTestContext(): Promise<ConsistencyTestContext> {
  // Clear any previous instance state
  clearAllInstanceState();

  let mockResponse: MockResponse = { status: 200, body: "" };
  let storedResult: unknown = undefined;

  // Pending parameters for custom function origins
  // These are stored on the host and retrieved by the isolate to construct objects
  let pendingResponseParams: { body: string; init: ResponseInit } | null = null;
  let pendingRequestParams: { url: string; init: RequestInit } | null = null;

  const runtime = await createRuntime({
    fetch: async (request: Request) => {
      // Return mock response
      return new Response(mockResponse.body ?? "", {
        status: mockResponse.status ?? 200,
        statusText: mockResponse.statusText ?? "",
        headers: mockResponse.headers,
      });
    },
    customFunctions: {
      setResult: {
        fn: (value: unknown) => {
          storedResult = value;
        },
        type: "sync",
      },
      // For Response customFunction origin: store params, return them for isolate to construct
      __setResponseParams: {
        fn: (body: string, init: ResponseInit) => {
          pendingResponseParams = { body, init };
        },
        type: "sync",
      },
      __getResponseParams: {
        fn: () => {
          const params = pendingResponseParams;
          pendingResponseParams = null;
          return params;
        },
        type: "sync",
      },
      // For Request customFunction origin: store params, return them for isolate to construct
      __setRequestParams: {
        fn: (url: string, init: RequestInit) => {
          pendingRequestParams = { url, init };
        },
        type: "sync",
      },
      __getRequestParams: {
        fn: () => {
          const params = pendingRequestParams;
          pendingRequestParams = null;
          return params;
        },
        type: "sync",
      },
    },
  });

  return {
    runtime,
    eval: runtime.eval.bind(runtime),
    dispatchRequest: runtime.fetch.dispatchRequest.bind(runtime.fetch),
    setMockResponse(response: MockResponse) {
      mockResponse = response;
    },
    getResult<T = unknown>(): T | undefined {
      return storedResult as T | undefined;
    },
    clearResult() {
      storedResult = undefined;
    },
    async dispose() {
      await runtime.dispose();
    },
  };
}

// ============================================================================
// Response Helpers
// ============================================================================

export interface ResponseOptions {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
}

/**
 * Create a Response in the isolate from the specified origin.
 * The Response is stored at globalThis.__testResponse.
 */
export async function getResponseFromOrigin(
  ctx: ConsistencyTestContext,
  origin: ResponseOrigin,
  body: string,
  options?: ResponseOptions
): Promise<void> {
  const init = {
    status: options?.status ?? 200,
    statusText: options?.statusText ?? "",
    headers: options?.headers ?? {},
  };
  const initJson = JSON.stringify(init);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testResponse = new Response(${JSON.stringify(body)}, ${initJson});
      `);
      break;

    case "customFunction":
      // Store params on host, then retrieve and construct in isolate
      // This simulates getting data from a custom function and constructing a Response
      await ctx.eval(`
        __setResponseParams(${JSON.stringify(body)}, ${initJson});
        const params = __getResponseParams();
        globalThis.__testResponse = new Response(params.body, params.init);
      `);
      break;

    case "fetchCallback":
      ctx.setMockResponse({
        status: init.status,
        statusText: init.statusText,
        body,
        headers: init.headers,
      });
      await ctx.eval(`
        globalThis.__testResponse = await fetch("https://example.com/test");
      `);
      break;
  }
}

// ============================================================================
// Request Helpers
// ============================================================================

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Create a Request in the isolate from the specified origin.
 * The Request is stored at globalThis.__testRequest.
 */
export async function getRequestFromOrigin(
  ctx: ConsistencyTestContext,
  origin: RequestOrigin,
  url: string,
  options?: RequestOptions
): Promise<void> {
  const init: RequestInit = {
    method: options?.method ?? "GET",
    headers: options?.headers ?? {},
  };

  // Only add body for non-GET/HEAD requests
  if (options?.body && init.method !== "GET" && init.method !== "HEAD") {
    init.body = options.body;
  }

  const initJson = JSON.stringify(init);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testRequest = new Request(${JSON.stringify(url)}, ${initJson});
      `);
      break;

    case "customFunction":
      // Store params on host, then retrieve and construct in isolate
      // This simulates getting data from a custom function and constructing a Request
      await ctx.eval(`
        __setRequestParams(${JSON.stringify(url)}, ${initJson});
        const params = __getRequestParams();
        globalThis.__testRequest = new Request(params.url, params.init);
      `);
      break;

    case "serveRequest":
      // Setup serve handler that captures the request
      await ctx.eval(`
        serve({
          fetch(request) {
            globalThis.__testRequest = request;
            return new Response("ok");
          }
        });
      `);

      // Dispatch a request from the host
      const request = new Request(url, init as RequestInit);
      await ctx.dispatchRequest(request);
      break;
  }
}

// ============================================================================
// Headers Helpers
// ============================================================================

/**
 * Create Headers in the isolate from the specified origin.
 * The Headers is stored at globalThis.__testHeaders.
 */
export async function getHeadersFromOrigin(
  ctx: ConsistencyTestContext,
  origin: HeadersOrigin,
  init: Record<string, string>
): Promise<void> {
  const initJson = JSON.stringify(init);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testHeaders = new Headers(${initJson});
      `);
      break;

    case "fromResponse":
      await ctx.eval(`
        const response = new Response(null, { headers: ${initJson} });
        globalThis.__testHeaders = response.headers;
      `);
      break;

    case "fromRequest":
      await ctx.eval(`
        const request = new Request("https://example.com", { headers: ${initJson} });
        globalThis.__testHeaders = request.headers;
      `);
      break;
  }
}

// ============================================================================
// Blob Helpers
// ============================================================================

export interface BlobOptions {
  type?: string;
}

/**
 * Create a Blob in the isolate from the specified origin.
 * The Blob is stored at globalThis.__testBlob.
 */
export async function getBlobFromOrigin(
  ctx: ConsistencyTestContext,
  origin: BlobOrigin,
  content: string,
  options?: BlobOptions
): Promise<void> {
  const blobOptions = { type: options?.type ?? "" };
  const optionsJson = JSON.stringify(blobOptions);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testBlob = new Blob([${JSON.stringify(content)}], ${optionsJson});
      `);
      break;
  }
}

// ============================================================================
// File Helpers
// ============================================================================

export interface FileOptions {
  type?: string;
  lastModified?: number;
}

/**
 * Create a File in the isolate from the specified origin.
 * The File is stored at globalThis.__testFile.
 */
export async function getFileFromOrigin(
  ctx: ConsistencyTestContext,
  origin: FileOrigin,
  content: string,
  filename: string,
  options?: FileOptions
): Promise<void> {
  const fileOptions = {
    type: options?.type ?? "",
    lastModified: options?.lastModified ?? Date.now(),
  };
  const optionsJson = JSON.stringify(fileOptions);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testFile = new File([${JSON.stringify(content)}], ${JSON.stringify(filename)}, ${optionsJson});
      `);
      break;
  }
}

// ============================================================================
// FormData Helpers
// ============================================================================

/**
 * Create FormData in the isolate from the specified origin.
 * The FormData is stored at globalThis.__testFormData.
 */
export async function getFormDataFromOrigin(
  ctx: ConsistencyTestContext,
  origin: FormDataOrigin,
  entries: Array<[string, string]>
): Promise<void> {
  const entriesJson = JSON.stringify(entries);

  switch (origin) {
    case "direct":
      await ctx.eval(`
        globalThis.__testFormData = new FormData();
        for (const [key, value] of ${entriesJson}) {
          globalThis.__testFormData.append(key, value);
        }
      `);
      break;

    case "fromResponse":
      // Create a response with urlencoded body and parse it
      const params = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      await ctx.eval(`
        const response = new Response(${JSON.stringify(params)}, {
          headers: { "content-type": "application/x-www-form-urlencoded" }
        });
        globalThis.__testFormData = await response.formData();
      `);
      break;
  }
}

// ============================================================================
// Host-side helpers for dispatchResponse origin
// ============================================================================

/**
 * Setup a serve handler that returns the specified response.
 */
export async function setupServeHandler(
  ctx: ConsistencyTestContext,
  body: string,
  options?: ResponseOptions
): Promise<void> {
  const init = {
    status: options?.status ?? 200,
    statusText: options?.statusText ?? "",
    headers: options?.headers ?? {},
  };
  const initJson = JSON.stringify(init);

  await ctx.eval(`
    serve({
      fetch(request) {
        return new Response(${JSON.stringify(body)}, ${initJson});
      }
    });
  `);
}

/**
 * Dispatch a request and get the Response on the host side.
 * This tests the host-side conversion of Response from isolate.
 */
export async function getDispatchResponse(
  ctx: ConsistencyTestContext,
  body: string,
  options?: ResponseOptions
): Promise<Response> {
  await setupServeHandler(ctx, body, options);
  return ctx.dispatchRequest(new Request("https://example.com/test"));
}
