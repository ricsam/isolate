/**
 * Request/Response serialization utilities.
 *
 * Shared by both isolate-daemon and isolate-client for converting
 * between Web API Request/Response objects and serializable data.
 */

import type { SerializedRequest, SerializedResponse } from "./types.ts";

function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}

/**
 * Serialize a Request to a plain object for transmission over IPC.
 */
export async function serializeRequest(request: Request): Promise<SerializedRequest> {
  const headers: [string, string][] = [];
  request.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  if (request.body) {
    body = new Uint8Array(await request.arrayBuffer());
  }

  return {
    method: request.method,
    url: request.url,
    headers,
    body,
    signalAborted: request.signal?.aborted ?? false,
  };
}

/**
 * Serialize a Response to a plain object for transmission over IPC.
 */
export async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });

  let body: Uint8Array | null = null;
  if (response.body && !isNullBodyStatus(response.status)) {
    body = new Uint8Array(await response.arrayBuffer());
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
  };
}

/**
 * Deserialize a plain object back into a Request.
 */
export function deserializeRequest(data: SerializedRequest): Request {
  let signal: AbortSignal | undefined;
  if (data.signalAborted !== undefined) {
    const controller = new AbortController();
    if (data.signalAborted) {
      controller.abort();
    }
    signal = controller.signal;
  }

  return new Request(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body as unknown as BodyInit | null | undefined,
    signal,
  });
}

/**
 * Deserialize a plain object back into a Response.
 */
export function deserializeResponse(data: SerializedResponse): Response {
  const body = isNullBodyStatus(data.status) ? null : data.body;
  return new Response(body as unknown as BodyInit | null, {
    status: data.status,
    statusText: data.statusText,
    headers: data.headers,
  });
}
