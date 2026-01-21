import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState } from "@ricsam/isolate-core";
import {
  getStreamRegistryForContext,
  startNativeStreamReader,
} from "./stream-state.ts";
import type { StreamStateRegistry } from "./stream-state.ts";

export { clearAllInstanceState };

export interface FetchOptions {
  /** Handler for fetch requests from the isolate */
  onFetch?: (request: Request) => Promise<Response>;
}

// ============================================================================
// Serve Types
// ============================================================================

export interface UpgradeRequest {
  requested: true;
  connectionId: string;
}

export interface WebSocketCommand {
  type: "message" | "close";
  connectionId: string;
  data?: string | ArrayBuffer;
  code?: number;
  reason?: string;
}

interface ServeState {
  pendingUpgrade: UpgradeRequest | null;
  activeConnections: Map<string, { connectionId: string }>;
}

export interface DispatchRequestOptions {
  // Reserved for future options
}

export interface FetchHandle {
  dispose(): void;
  /** Dispatch an HTTP request to the isolate's serve() handler */
  dispatchRequest(request: Request, options?: DispatchRequestOptions): Promise<Response>;
  /** Check if isolate requested WebSocket upgrade */
  getUpgradeRequest(): UpgradeRequest | null;
  /** Dispatch WebSocket open event to isolate */
  dispatchWebSocketOpen(connectionId: string): void;
  /** Dispatch WebSocket message event to isolate */
  dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): void;
  /** Dispatch WebSocket close event to isolate */
  dispatchWebSocketClose(connectionId: string, code: number, reason: string): void;
  /** Dispatch WebSocket error event to isolate */
  dispatchWebSocketError(connectionId: string, error: Error): void;
  /** Register callback for WebSocket commands from isolate */
  onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void;
  /** Check if serve() has been called */
  hasServeHandler(): boolean;
  /** Check if there are active WebSocket connections */
  hasActiveConnections(): boolean;
}

// ============================================================================
// Instance State Management
// ============================================================================

const instanceStateMap = new WeakMap<ivm.Context, Map<number, unknown>>();
/** Map of streamId -> passthruBody for lazy callback streaming */
const passthruBodies = new WeakMap<ivm.Context, Map<number, ReadableStream<Uint8Array>>>();
let nextInstanceId = 1;

function getInstanceStateMapForContext(
  context: ivm.Context
): Map<number, unknown> {
  let map = instanceStateMap.get(context);
  if (!map) {
    map = new Map();
    instanceStateMap.set(context, map);
  }
  return map;
}

function getPassthruBodiesForContext(
  context: ivm.Context
): Map<number, ReadableStream<Uint8Array>> {
  let map = passthruBodies.get(context);
  if (!map) {
    map = new Map();
    passthruBodies.set(context, map);
  }
  return map;
}

// ============================================================================
// State Types
// ============================================================================

interface ResponseState {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array | null;
  bodyUsed: boolean;
  type: string;
  url: string;
  redirected: boolean;
  streamId: number | null;
  /** Direct pass-through body for callback streams (bypasses registry for better streaming) */
  passthruBody?: ReadableStream<Uint8Array>;
}

interface RequestState {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array | null;
  bodyUsed: boolean;
  streamId: number | null;
  mode: string;
  credentials: string;
  cache: string;
  redirect: string;
  referrer: string;
  integrity: string;
}

// ============================================================================
// Headers Implementation (Pure JS)
// ============================================================================

const headersCode = `
(function() {
  class Headers {
    #headers = new Map(); // lowercase key -> [originalCase, values[]]

    constructor(init) {
      if (init instanceof Headers) {
        init.forEach((value, key) => this.append(key, value));
      } else if (Array.isArray(init)) {
        for (const pair of init) {
          if (Array.isArray(pair) && pair.length >= 2) {
            this.append(pair[0], pair[1]);
          }
        }
      } else if (init && typeof init === 'object') {
        for (const [key, value] of Object.entries(init)) {
          this.append(key, value);
        }
      }
    }

    append(name, value) {
      const key = String(name).toLowerCase();
      const valueStr = String(value);
      const existing = this.#headers.get(key);
      if (existing) {
        existing[1].push(valueStr);
      } else {
        this.#headers.set(key, [String(name), [valueStr]]);
      }
    }

    delete(name) {
      this.#headers.delete(String(name).toLowerCase());
    }

    get(name) {
      const entry = this.#headers.get(String(name).toLowerCase());
      return entry ? entry[1].join(', ') : null;
    }

    getSetCookie() {
      const entry = this.#headers.get('set-cookie');
      return entry ? [...entry[1]] : [];
    }

    has(name) {
      return this.#headers.has(String(name).toLowerCase());
    }

    set(name, value) {
      const key = String(name).toLowerCase();
      this.#headers.set(key, [String(name), [String(value)]]);
    }

    forEach(callback, thisArg) {
      for (const [key, [originalName, values]] of this.#headers) {
        callback.call(thisArg, values.join(', '), originalName, this);
      }
    }

    *entries() {
      for (const [key, [name, values]] of this.#headers) {
        yield [name, values.join(', ')];
      }
    }

    *keys() {
      for (const [key, [name]] of this.#headers) {
        yield name;
      }
    }

    *values() {
      for (const [key, [name, values]] of this.#headers) {
        yield values.join(', ');
      }
    }

    [Symbol.iterator]() {
      return this.entries();
    }
  }

  globalThis.Headers = Headers;
})();
`;

// ============================================================================
// FormData Implementation (Pure JS)
// ============================================================================

const formDataCode = `
(function() {
  class FormData {
    #entries = []; // Array of [name, value]

    append(name, value, filename) {
      let finalValue = value;
      if (value instanceof Blob && !(value instanceof File)) {
        if (filename !== undefined) {
          finalValue = new File([value], String(filename), { type: value.type });
        }
      } else if (value instanceof File && filename !== undefined) {
        finalValue = new File([value], String(filename), {
          type: value.type,
          lastModified: value.lastModified
        });
      }
      this.#entries.push([String(name), finalValue]);
    }

    delete(name) {
      const nameStr = String(name);
      this.#entries = this.#entries.filter(([n]) => n !== nameStr);
    }

    get(name) {
      const nameStr = String(name);
      const entry = this.#entries.find(([n]) => n === nameStr);
      return entry ? entry[1] : null;
    }

    getAll(name) {
      const nameStr = String(name);
      return this.#entries.filter(([n]) => n === nameStr).map(([, v]) => v);
    }

    has(name) {
      return this.#entries.some(([n]) => n === String(name));
    }

    set(name, value, filename) {
      const nameStr = String(name);
      this.delete(nameStr);
      this.append(nameStr, value, filename);
    }

    *entries() {
      for (const [name, value] of this.#entries) {
        yield [name, value];
      }
    }

    *keys() {
      for (const [name] of this.#entries) {
        yield name;
      }
    }

    *values() {
      for (const [, value] of this.#entries) {
        yield value;
      }
    }

    forEach(callback, thisArg) {
      for (const [name, value] of this.#entries) {
        callback.call(thisArg, value, name, this);
      }
    }

    [Symbol.iterator]() {
      return this.entries();
    }
  }

  globalThis.FormData = FormData;
})();
`;

// ============================================================================
// Multipart FormData Parsing/Serialization (Pure JS)
// ============================================================================

const multipartCode = `
(function() {
  // Find byte sequence in Uint8Array
  function findSequence(haystack, needle, start = 0) {
    outer: for (let i = start; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  // Parse header lines into object
  function parseHeaders(text) {
    const headers = {};
    for (const line of text.split(/\\r?\\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const name = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[name] = value;
      }
    }
    return headers;
  }

  // Parse multipart/form-data body into FormData
  globalThis.__parseMultipartFormData = function(bodyBytes, contentType) {
    const formData = new FormData();

    // Extract boundary from Content-Type
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) return formData;

    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const boundaryBytes = encoder.encode('--' + boundary);

    // Find first boundary
    let pos = findSequence(bodyBytes, boundaryBytes, 0);
    if (pos === -1) return formData;
    pos += boundaryBytes.length;

    while (pos < bodyBytes.length) {
      // Skip CRLF after boundary
      if (bodyBytes[pos] === 0x0d && bodyBytes[pos + 1] === 0x0a) pos += 2;
      else if (bodyBytes[pos] === 0x0a) pos += 1;

      // Check for closing boundary (--)
      if (bodyBytes[pos] === 0x2d && bodyBytes[pos + 1] === 0x2d) break;

      // Find header/body separator (CRLFCRLF)
      const crlfcrlf = encoder.encode('\\r\\n\\r\\n');
      const headersEnd = findSequence(bodyBytes, crlfcrlf, pos);
      if (headersEnd === -1) break;

      // Parse headers
      const headersText = decoder.decode(bodyBytes.slice(pos, headersEnd));
      const headers = parseHeaders(headersText);
      pos = headersEnd + 4;

      // Find next boundary
      const nextBoundary = findSequence(bodyBytes, boundaryBytes, pos);
      if (nextBoundary === -1) break;

      // Extract content (minus trailing CRLF)
      let contentEnd = nextBoundary;
      if (contentEnd > 0 && bodyBytes[contentEnd - 1] === 0x0a) contentEnd--;
      if (contentEnd > 0 && bodyBytes[contentEnd - 1] === 0x0d) contentEnd--;
      const content = bodyBytes.slice(pos, contentEnd);

      // Parse Content-Disposition
      const disposition = headers['content-disposition'] || '';
      const nameMatch = disposition.match(/name="([^"]+)"/);
      const filenameMatch = disposition.match(/filename="([^"]+)"/);

      if (nameMatch) {
        const name = nameMatch[1];
        if (filenameMatch) {
          const filename = filenameMatch[1];
          const mimeType = headers['content-type'] || 'application/octet-stream';
          const file = new File([content], filename, { type: mimeType });
          formData.append(name, file);
        } else {
          formData.append(name, decoder.decode(content));
        }
      }

      pos = nextBoundary + boundaryBytes.length;
    }

    return formData;
  };

  // Serialize FormData to multipart/form-data format
  globalThis.__serializeFormData = function(formData) {
    const boundary = '----FormDataBoundary' + Math.random().toString(36).slice(2) +
                     Math.random().toString(36).slice(2);
    const encoder = new TextEncoder();
    const parts = [];

    for (const [name, value] of formData.entries()) {
      if (value instanceof File) {
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"; filename="' + value.name + '"',
          'Content-Type: ' + (value.type || 'application/octet-stream'),
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));
        // Use existing __Blob_bytes callback (File extends Blob)
        parts.push(__Blob_bytes(value._getInstanceId()));
        parts.push(encoder.encode('\\r\\n'));
      } else if (value instanceof Blob) {
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"; filename="blob"',
          'Content-Type: ' + (value.type || 'application/octet-stream'),
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));
        parts.push(__Blob_bytes(value._getInstanceId()));
        parts.push(encoder.encode('\\r\\n'));
      } else {
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"',
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));
        parts.push(encoder.encode(String(value)));
        parts.push(encoder.encode('\\r\\n'));
      }
    }

    // Closing boundary
    parts.push(encoder.encode('--' + boundary + '--\\r\\n'));

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    return {
      body: body,
      contentType: 'multipart/form-data; boundary=' + boundary
    };
  };
})();
`;

// ============================================================================
// Stream Callbacks (Host State)
// ============================================================================

function setupStreamCallbacks(
  context: ivm.Context,
  streamRegistry: StreamStateRegistry
): void {
  const global = context.global;

  // Create stream (returns ID)
  global.setSync(
    "__Stream_create",
    new ivm.Callback(() => {
      return streamRegistry.create();
    })
  );

  // Push chunk (sync) - receives number[] from isolate
  global.setSync(
    "__Stream_push",
    new ivm.Callback((streamId: number, chunkArray: number[]) => {
      const chunk = new Uint8Array(chunkArray);
      return streamRegistry.push(streamId, chunk);
    })
  );

  // Close stream (sync)
  global.setSync(
    "__Stream_close",
    new ivm.Callback((streamId: number) => {
      streamRegistry.close(streamId);
    })
  );

  // Error stream (sync)
  global.setSync(
    "__Stream_error",
    new ivm.Callback((streamId: number, message: string) => {
      streamRegistry.error(streamId, new Error(message));
    })
  );

  // Check backpressure (sync)
  global.setSync(
    "__Stream_isQueueFull",
    new ivm.Callback((streamId: number) => {
      return streamRegistry.isQueueFull(streamId);
    })
  );

  // Pull chunk (async with applySyncPromise)
  const pullRef = new ivm.Reference(async (streamId: number) => {
    const result = await streamRegistry.pull(streamId);
    if (result.done) {
      return JSON.stringify({ done: true });
    }
    return JSON.stringify({ done: false, value: Array.from(result.value) });
  });
  global.setSync("__Stream_pull_ref", pullRef);
}

// ============================================================================
// Host-Backed ReadableStream (Isolate Code)
// ============================================================================

const hostBackedStreamCode = `
(function() {
  const _streamIds = new WeakMap();

  // Polyfill values() on ReadableStream if not available (older V8 versions)
  if (typeof ReadableStream.prototype.values !== 'function') {
    ReadableStream.prototype.values = function(options) {
      const reader = this.getReader();
      return {
        async next() {
          const { value, done } = await reader.read();
          if (done) {
            reader.releaseLock();
            return { value: undefined, done: true };
          }
          return { value, done: false };
        },
        async return(value) {
          reader.releaseLock();
          return { value, done: true };
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
    };
  }

  // Create a proper ReadableStream subclass that reports as "ReadableStream"
  class HostBackedReadableStream extends ReadableStream {
    constructor(streamId) {
      if (streamId === undefined) {
        streamId = __Stream_create();
      }

      let closed = false;

      super({
        async pull(controller) {
          if (closed) return;

          const resultJson = __Stream_pull_ref.applySyncPromise(undefined, [streamId]);
          const result = JSON.parse(resultJson);

          if (result.done) {
            closed = true;
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(result.value));
        },
        cancel(reason) {
          closed = true;
          __Stream_error(streamId, String(reason || "cancelled"));
        }
      });

      _streamIds.set(this, streamId);
    }

    // Override to report as ReadableStream for spec compliance
    get [Symbol.toStringTag]() {
      return 'ReadableStream';
    }

    _getStreamId() {
      return _streamIds.get(this);
    }

    static _fromStreamId(streamId) {
      return new HostBackedReadableStream(streamId);
    }
  }

  // Make constructor.name return 'ReadableStream' for spec compliance
  Object.defineProperty(HostBackedReadableStream, 'name', { value: 'ReadableStream' });

  globalThis.HostBackedReadableStream = HostBackedReadableStream;
})();
`;

// ============================================================================
// Response Implementation (Host State + Isolate Class)
// ============================================================================

function setupResponse(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): void {
  const global = context.global;

  // Register host callbacks
  global.setSync(
    "__Response_construct",
    new ivm.Callback(
      (
        bodyBytes: number[] | null,
        status: number,
        statusText: string,
        headers: [string, string][]
      ) => {
        const instanceId = nextInstanceId++;
        const body = bodyBytes ? new Uint8Array(bodyBytes) : null;
        const state: ResponseState = {
          status,
          statusText,
          headers,
          body,
          bodyUsed: false,
          type: "default",
          url: "",
          redirected: false,
          streamId: null,
        };
        stateMap.set(instanceId, state);
        return instanceId;
      }
    )
  );

  // Streaming Response constructor - creates Response with stream ID but no buffered body
  global.setSync(
    "__Response_constructStreaming",
    new ivm.Callback(
      (
        streamId: number,
        status: number,
        statusText: string,
        headers: [string, string][]
      ) => {
        const instanceId = nextInstanceId++;
        const state: ResponseState = {
          status,
          statusText,
          headers,
          body: null, // No buffered body - using stream
          bodyUsed: false,
          type: "default",
          url: "",
          redirected: false,
          streamId, // Stream ID for body
        };
        stateMap.set(instanceId, state);
        return instanceId;
      }
    )
  );

  global.setSync(
    "__Response_constructFromFetch",
    new ivm.Callback(
      (
        bodyBytes: number[] | null,
        status: number,
        statusText: string,
        headers: [string, string][],
        url: string,
        redirected: boolean
      ) => {
        const instanceId = nextInstanceId++;
        const body = bodyBytes ? new Uint8Array(bodyBytes) : null;
        const state: ResponseState = {
          status,
          statusText,
          headers,
          body,
          bodyUsed: false,
          type: "default",
          url,
          redirected,
          streamId: null,
        };
        stateMap.set(instanceId, state);
        return instanceId;
      }
    )
  );

  global.setSync(
    "__Response_get_status",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.status ?? 200;
    })
  );

  global.setSync(
    "__Response_get_statusText",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.statusText ?? "";
    })
  );

  global.setSync(
    "__Response_get_headers",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.headers ?? [];
    })
  );

  global.setSync(
    "__Response_get_bodyUsed",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.bodyUsed ?? false;
    })
  );

  global.setSync(
    "__Response_get_url",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.url ?? "";
    })
  );

  global.setSync(
    "__Response_get_redirected",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.redirected ?? false;
    })
  );

  global.setSync(
    "__Response_get_type",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.type ?? "default";
    })
  );

  global.setSync(
    "__Response_setType",
    new ivm.Callback((instanceId: number, type: string) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      if (state) {
        state.type = type;
      }
    })
  );

  global.setSync(
    "__Response_markBodyUsed",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      if (state) {
        if (state.bodyUsed) {
          throw new Error("[TypeError]Body has already been consumed");
        }
        state.bodyUsed = true;
      }
    })
  );

  global.setSync(
    "__Response_text",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      if (!state || !state.body) return "";
      return new TextDecoder().decode(state.body);
    })
  );

  global.setSync(
    "__Response_arrayBuffer",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      if (!state || !state.body) {
        return new ivm.ExternalCopy(new ArrayBuffer(0)).copyInto();
      }
      return new ivm.ExternalCopy(state.body.buffer.slice(
        state.body.byteOffset,
        state.body.byteOffset + state.body.byteLength
      )).copyInto();
    })
  );

  global.setSync(
    "__Response_clone",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      if (!state) {
        throw new Error("[TypeError]Cannot clone invalid Response");
      }
      const newId = nextInstanceId++;
      const newState: ResponseState = {
        ...state,
        body: state.body ? new Uint8Array(state.body) : null,
        bodyUsed: false,
      };
      stateMap.set(newId, newState);
      return newId;
    })
  );

  global.setSync(
    "__Response_getStreamId",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as ResponseState | undefined;
      return state?.streamId ?? null;
    })
  );

  // Inject Response class
  const responseCode = `
(function() {
  const _responseInstanceIds = new WeakMap();

  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|Error)\\](.*)$/);
    if (match) {
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  function __prepareBody(body) {
    if (body === null || body === undefined) return null;
    if (typeof body === 'string') {
      const encoder = new TextEncoder();
      return Array.from(encoder.encode(body));
    }
    if (body instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(body));
    }
    if (body instanceof Uint8Array) {
      return Array.from(body);
    }
    if (ArrayBuffer.isView(body)) {
      return Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    }
    if (body instanceof Blob) {
      // Mark as needing async Blob handling - will be read in constructor
      return { __isBlob: true, blob: body };
    }
    // Handle HostBackedReadableStream specially - preserve streamId
    if (body instanceof HostBackedReadableStream) {
      return { __isHostStream: true, stream: body, streamId: body._getStreamId() };
    }
    // Handle native ReadableStream
    if (body instanceof ReadableStream) {
      return { __isStream: true, stream: body };
    }
    // Try to convert to string
    return Array.from(new TextEncoder().encode(String(body)));
  }

  class Response {
    #instanceId;
    #headers;
    #streamId = null;
    #blobInitPromise = null; // For async Blob body initialization

    constructor(body, init = {}) {
      // Handle internal construction from instance ID
      if (typeof body === 'number' && init === null) {
        this.#instanceId = body;
        this.#headers = new Headers(__Response_get_headers(body));
        this.#streamId = __Response_getStreamId(body);
        return;
      }

      const preparedBody = __prepareBody(body);

      // Handle Blob body - create streaming response and push blob data
      if (preparedBody && preparedBody.__isBlob) {
        this.#streamId = __Stream_create();
        const status = init.status ?? 200;
        const statusText = init.statusText ?? '';
        const headers = new Headers(init.headers);
        const headersArray = Array.from(headers.entries());

        this.#instanceId = __Response_constructStreaming(
          this.#streamId,
          status,
          statusText,
          headersArray
        );
        this.#headers = headers;

        // Start async blob initialization and stream pumping
        const streamId = this.#streamId;
        const blob = preparedBody.blob;
        this.#blobInitPromise = (async () => {
          try {
            const buffer = await blob.arrayBuffer();
            __Stream_push(streamId, Array.from(new Uint8Array(buffer)));
            __Stream_close(streamId);
          } catch (error) {
            __Stream_error(streamId, String(error));
          }
        })();
        return;
      }

      // Handle HostBackedReadableStream - reuse existing streamId for pass-through
      if (preparedBody && preparedBody.__isHostStream) {
        // Reuse the existing streamId to preserve the pass-through body mapping
        this.#streamId = preparedBody.streamId;
        const status = init.status ?? 200;
        const statusText = init.statusText ?? '';
        const headers = new Headers(init.headers);
        const headersArray = Array.from(headers.entries());

        this.#instanceId = __Response_constructStreaming(
          this.#streamId,
          status,
          statusText,
          headersArray
        );
        this.#headers = headers;
        // Don't pump - the body is already backed by this streamId
        return;
      }

      // Handle native ReadableStream body
      if (preparedBody && preparedBody.__isStream) {
        this.#streamId = __Stream_create();
        const status = init.status ?? 200;
        const statusText = init.statusText ?? '';
        const headers = new Headers(init.headers);
        const headersArray = Array.from(headers.entries());

        this.#instanceId = __Response_constructStreaming(
          this.#streamId,
          status,
          statusText,
          headersArray
        );
        this.#headers = headers;

        // Start pumping the source stream to host queue (fire-and-forget)
        this._startStreamPump(preparedBody.stream);
        return;
      }

      // Existing buffered body handling
      const bodyBytes = preparedBody;
      const status = init.status ?? 200;
      const statusText = init.statusText ?? '';
      const headersInit = init.headers;
      const headers = new Headers(headersInit);
      const headersArray = Array.from(headers.entries());

      this.#instanceId = __Response_construct(bodyBytes, status, statusText, headersArray);
      this.#headers = headers;
    }

    async _startStreamPump(sourceStream) {
      const streamId = this.#streamId;
      try {
        const reader = sourceStream.getReader();
        while (true) {
          // Check backpressure - wait if queue is full
          while (__Stream_isQueueFull(streamId)) {
            await new Promise(r => setTimeout(r, 1));
          }

          const { done, value } = await reader.read();
          if (done) {
            __Stream_close(streamId);
            break;
          }
          if (value) {
            __Stream_push(streamId, Array.from(value));
          }
        }
      } catch (error) {
        __Stream_error(streamId, String(error));
      }
    }

    _getInstanceId() {
      return this.#instanceId;
    }

    static _fromInstanceId(instanceId) {
      return new Response(instanceId, null);
    }

    get status() {
      return __Response_get_status(this.#instanceId);
    }

    get statusText() {
      return __Response_get_statusText(this.#instanceId);
    }

    get ok() {
      const status = this.status;
      return status >= 200 && status < 300;
    }

    get headers() {
      return this.#headers;
    }

    get bodyUsed() {
      return __Response_get_bodyUsed(this.#instanceId);
    }

    get url() {
      return __Response_get_url(this.#instanceId);
    }

    get redirected() {
      return __Response_get_redirected(this.#instanceId);
    }

    get type() {
      return __Response_get_type(this.#instanceId);
    }

    get body() {
      const streamId = __Response_getStreamId(this.#instanceId);
      if (streamId !== null) {
        return HostBackedReadableStream._fromStreamId(streamId);
      }

      // Fallback: create host-backed stream from buffered body
      const instanceId = this.#instanceId;
      const newStreamId = __Stream_create();
      const buffer = __Response_arrayBuffer(instanceId);

      if (buffer.byteLength > 0) {
        __Stream_push(newStreamId, Array.from(new Uint8Array(buffer)));
      }
      __Stream_close(newStreamId);

      return HostBackedReadableStream._fromStreamId(newStreamId);
    }

    async text() {
      try {
        __Response_markBodyUsed(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }
      return __Response_text(this.#instanceId);
    }

    async json() {
      const text = await this.text();
      return JSON.parse(text);
    }

    async arrayBuffer() {
      try {
        __Response_markBodyUsed(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }

      // For streaming responses (including Blob bodies), consume the stream
      if (this.#streamId !== null) {
        // Wait for blob init to complete if needed
        if (this.#blobInitPromise) {
          await this.#blobInitPromise;
          this.#blobInitPromise = null;
        }

        const reader = this.body.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        // Concatenate all chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result.buffer;
      }

      return __Response_arrayBuffer(this.#instanceId);
    }

    async blob() {
      const buffer = await this.arrayBuffer();
      const contentType = this.headers.get('content-type') || '';
      return new Blob([buffer], { type: contentType });
    }

    async formData() {
      const contentType = this.headers.get('content-type') || '';

      // Parse multipart/form-data
      if (contentType.includes('multipart/form-data')) {
        const buffer = await this.arrayBuffer();
        return __parseMultipartFormData(new Uint8Array(buffer), contentType);
      }

      // Parse application/x-www-form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await this.text();
        const formData = new FormData();
        const params = new URLSearchParams(text);
        for (const [key, value] of params) {
          formData.append(key, value);
        }
        return formData;
      }

      throw new TypeError('Unsupported content type for formData()');
    }

    clone() {
      if (this.bodyUsed) {
        throw new TypeError('Cannot clone a Response that has already been used');
      }
      const newId = __Response_clone(this.#instanceId);
      const cloned = Response._fromInstanceId(newId);
      return cloned;
    }

    static json(data, init = {}) {
      const body = JSON.stringify(data);
      const headers = new Headers(init.headers);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      return new Response(body, { ...init, headers });
    }

    static redirect(url, status = 302) {
      if (![301, 302, 303, 307, 308].includes(status)) {
        throw new RangeError('Invalid redirect status code');
      }
      const headers = new Headers({ Location: String(url) });
      return new Response(null, { status, headers });
    }

    static error() {
      const response = new Response(null, { status: 0, statusText: '' });
      __Response_setType(response._getInstanceId(), 'error');
      return response;
    }
  }

  globalThis.Response = Response;
})();
`;

  context.evalSync(responseCode);
}

// ============================================================================
// Request Implementation (Host State + Isolate Class)
// ============================================================================

function setupRequest(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): void {
  const global = context.global;

  // Register host callbacks
  global.setSync(
    "__Request_construct",
    new ivm.Callback(
      (
        url: string,
        method: string,
        headers: [string, string][],
        bodyBytes: number[] | null,
        mode: string,
        credentials: string,
        cache: string,
        redirect: string,
        referrer: string,
        integrity: string
      ) => {
        const instanceId = nextInstanceId++;
        const body = bodyBytes ? new Uint8Array(bodyBytes) : null;
        const state: RequestState = {
          url,
          method,
          headers,
          body,
          bodyUsed: false,
          streamId: null,
          mode,
          credentials,
          cache,
          redirect,
          referrer,
          integrity,
        };
        stateMap.set(instanceId, state);
        return instanceId;
      }
    )
  );

  global.setSync(
    "__Request_get_method",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.method ?? "GET";
    })
  );

  global.setSync(
    "__Request_get_url",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.url ?? "";
    })
  );

  global.setSync(
    "__Request_get_headers",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.headers ?? [];
    })
  );

  global.setSync(
    "__Request_get_bodyUsed",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.bodyUsed ?? false;
    })
  );

  global.setSync(
    "__Request_get_mode",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.mode ?? "cors";
    })
  );

  global.setSync(
    "__Request_get_credentials",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.credentials ?? "same-origin";
    })
  );

  global.setSync(
    "__Request_get_cache",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.cache ?? "default";
    })
  );

  global.setSync(
    "__Request_get_redirect",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.redirect ?? "follow";
    })
  );

  global.setSync(
    "__Request_get_referrer",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.referrer ?? "about:client";
    })
  );

  global.setSync(
    "__Request_get_integrity",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.integrity ?? "";
    })
  );

  global.setSync(
    "__Request_markBodyUsed",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      if (state) {
        if (state.bodyUsed) {
          throw new Error("[TypeError]Body has already been consumed");
        }
        state.bodyUsed = true;
      }
    })
  );

  global.setSync(
    "__Request_text",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      if (!state || !state.body) return "";
      return new TextDecoder().decode(state.body);
    })
  );

  global.setSync(
    "__Request_arrayBuffer",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      if (!state || !state.body) {
        return new ivm.ExternalCopy(new ArrayBuffer(0)).copyInto();
      }
      return new ivm.ExternalCopy(state.body.buffer.slice(
        state.body.byteOffset,
        state.body.byteOffset + state.body.byteLength
      )).copyInto();
    })
  );

  global.setSync(
    "__Request_getBodyBytes",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      if (!state || !state.body) return null;
      return Array.from(state.body);
    })
  );

  global.setSync(
    "__Request_clone",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      if (!state) {
        throw new Error("[TypeError]Cannot clone invalid Request");
      }
      const newId = nextInstanceId++;
      const newState: RequestState = {
        ...state,
        body: state.body ? new Uint8Array(state.body) : null,
        bodyUsed: false,
      };
      stateMap.set(newId, newState);
      return newId;
    })
  );

  global.setSync(
    "__Request_getStreamId",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as RequestState | undefined;
      return state?.streamId ?? null;
    })
  );

  // Inject Request class
  const requestCode = `
(function() {
  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|Error)\\](.*)$/);
    if (match) {
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  function __prepareBody(body) {
    if (body === null || body === undefined) return null;
    if (typeof body === 'string') {
      const encoder = new TextEncoder();
      return Array.from(encoder.encode(body));
    }
    if (body instanceof ArrayBuffer) {
      return Array.from(new Uint8Array(body));
    }
    if (body instanceof Uint8Array) {
      return Array.from(body);
    }
    if (ArrayBuffer.isView(body)) {
      return Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    }
    if (body instanceof URLSearchParams) {
      return Array.from(new TextEncoder().encode(body.toString()));
    }
    if (body instanceof FormData) {
      // Check if FormData has any File/Blob entries
      let hasFiles = false;
      for (const [, value] of body.entries()) {
        if (value instanceof File || value instanceof Blob) {
          hasFiles = true;
          break;
        }
      }

      if (hasFiles) {
        // Serialize as multipart/form-data
        const { body: bytes, contentType } = __serializeFormData(body);
        globalThis.__pendingFormDataContentType = contentType;
        return Array.from(bytes);
      }

      // URL-encoded for string-only FormData
      const parts = [];
      body.forEach((value, key) => {
        if (typeof value === 'string') {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        }
      });
      return Array.from(new TextEncoder().encode(parts.join('&')));
    }
    // Try to convert to string
    return Array.from(new TextEncoder().encode(String(body)));
  }

  // Helper to consume a HostBackedReadableStream and concatenate all chunks
  async function __consumeStream(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Concatenate all chunks
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  class Request {
    #instanceId;
    #headers;
    #signal;
    #streamId;
    #cachedBody = null;

    constructor(input, init = {}) {
      // Handle internal construction from instance ID
      if (typeof input === 'number' && init === null) {
        this.#instanceId = input;
        this.#headers = new Headers(__Request_get_headers(input));
        this.#signal = null;
        this.#streamId = __Request_getStreamId(input);
        return;
      }

      let url;
      let method = 'GET';
      let headers;
      let body = null;
      let signal = null;
      let mode = 'cors';
      let credentials = 'same-origin';
      let cache = 'default';
      let redirect = 'follow';
      let referrer = 'about:client';
      let integrity = '';

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
        headers = new Headers(input.headers);
        signal = input.signal;
        mode = input.mode;
        credentials = input.credentials;
        cache = input.cache;
        redirect = input.redirect;
        referrer = input.referrer;
        integrity = input.integrity;
        // Note: We don't copy the body from the input Request
      } else {
        url = String(input);
        headers = new Headers();
      }

      // Apply init overrides
      if (init.method !== undefined) method = String(init.method).toUpperCase();
      if (init.headers !== undefined) headers = new Headers(init.headers);
      if (init.body !== undefined) body = init.body;
      if (init.signal !== undefined) signal = init.signal;
      if (init.mode !== undefined) mode = init.mode;
      if (init.credentials !== undefined) credentials = init.credentials;
      if (init.cache !== undefined) cache = init.cache;
      if (init.redirect !== undefined) redirect = init.redirect;
      if (init.referrer !== undefined) referrer = init.referrer;
      if (init.integrity !== undefined) integrity = init.integrity;

      // Validate: body with GET/HEAD
      if (body !== null && (method === 'GET' || method === 'HEAD')) {
        throw new TypeError('Request with GET/HEAD method cannot have body');
      }

      const bodyBytes = __prepareBody(body);

      // Handle Content-Type for FormData
      if (globalThis.__pendingFormDataContentType) {
        headers.set('content-type', globalThis.__pendingFormDataContentType);
        delete globalThis.__pendingFormDataContentType;
      } else if (body instanceof FormData && !headers.has('content-type')) {
        headers.set('content-type', 'application/x-www-form-urlencoded');
      }

      const headersArray = Array.from(headers.entries());

      this.#instanceId = __Request_construct(
        url, method, headersArray, bodyBytes,
        mode, credentials, cache, redirect, referrer, integrity
      );
      this.#headers = headers;
      this.#signal = signal;
      this.#streamId = null;
    }

    _getInstanceId() {
      return this.#instanceId;
    }

    static _fromInstanceId(instanceId) {
      return new Request(instanceId, null);
    }

    get method() {
      return __Request_get_method(this.#instanceId);
    }

    get url() {
      return __Request_get_url(this.#instanceId);
    }

    get headers() {
      return this.#headers;
    }

    get bodyUsed() {
      return __Request_get_bodyUsed(this.#instanceId);
    }

    get signal() {
      return this.#signal;
    }

    get mode() {
      return __Request_get_mode(this.#instanceId);
    }

    get credentials() {
      return __Request_get_credentials(this.#instanceId);
    }

    get cache() {
      return __Request_get_cache(this.#instanceId);
    }

    get redirect() {
      return __Request_get_redirect(this.#instanceId);
    }

    get referrer() {
      return __Request_get_referrer(this.#instanceId);
    }

    get integrity() {
      return __Request_get_integrity(this.#instanceId);
    }

    get body() {
      // Per WHATWG Fetch spec: GET/HEAD requests cannot have a body
      const method = __Request_get_method(this.#instanceId);
      if (method === 'GET' || method === 'HEAD') {
        return null;
      }

      // Return cached body if available
      if (this.#cachedBody !== null) {
        return this.#cachedBody;
      }

      // If we have a stream ID, create and cache the stream
      if (this.#streamId !== null) {
        this.#cachedBody = HostBackedReadableStream._fromStreamId(this.#streamId);
        return this.#cachedBody;
      }

      // Check if there's any buffered body data
      const buffer = __Request_arrayBuffer(this.#instanceId);
      if (buffer.byteLength === 0) {
        return null;  // Return null per WHATWG Fetch spec for empty body
      }

      // Create stream from non-empty buffered body
      const newStreamId = __Stream_create();
      __Stream_push(newStreamId, Array.from(new Uint8Array(buffer)));
      __Stream_close(newStreamId);

      this.#cachedBody = HostBackedReadableStream._fromStreamId(newStreamId);
      return this.#cachedBody;
    }

    async text() {
      try {
        __Request_markBodyUsed(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }

      // If streaming, consume the stream
      if (this.#streamId !== null) {
        const bytes = await __consumeStream(this.body);
        return new TextDecoder().decode(bytes);
      }

      // Fallback to host callback for buffered body
      return __Request_text(this.#instanceId);
    }

    async json() {
      const text = await this.text();
      return JSON.parse(text);
    }

    async arrayBuffer() {
      try {
        __Request_markBodyUsed(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }

      // If streaming, consume the stream
      if (this.#streamId !== null) {
        const bytes = await __consumeStream(this.body);
        return bytes.buffer;
      }

      return __Request_arrayBuffer(this.#instanceId);
    }

    async blob() {
      const buffer = await this.arrayBuffer();
      const contentType = this.headers.get('content-type') || '';
      return new Blob([buffer], { type: contentType });
    }

    async formData() {
      const contentType = this.headers.get('content-type') || '';

      // Parse multipart/form-data
      if (contentType.includes('multipart/form-data')) {
        const buffer = await this.arrayBuffer();
        return __parseMultipartFormData(new Uint8Array(buffer), contentType);
      }

      // Parse application/x-www-form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await this.text();
        const formData = new FormData();
        const params = new URLSearchParams(text);
        for (const [key, value] of params) {
          formData.append(key, value);
        }
        return formData;
      }

      throw new TypeError('Unsupported content type for formData()');
    }

    clone() {
      if (this.bodyUsed) {
        throw new TypeError('Cannot clone a Request that has already been used');
      }
      const newId = __Request_clone(this.#instanceId);
      const cloned = Request._fromInstanceId(newId);
      cloned.#signal = this.#signal;
      return cloned;
    }

    _getBodyBytes() {
      return __Request_getBodyBytes(this.#instanceId);
    }
  }

  globalThis.Request = Request;
})();
`;

  context.evalSync(requestCode);
}

// ============================================================================
// fetch Implementation
// ============================================================================

/** Threshold for streaming fetch responses (64KB) */
const FETCH_STREAM_THRESHOLD = 64 * 1024;

function setupFetchFunction(
  context: ivm.Context,
  stateMap: Map<number, unknown>,
  streamRegistry: StreamStateRegistry,
  options?: FetchOptions
): void {
  const global = context.global;

  // Create async fetch reference
  // We use JSON serialization for complex data to avoid transfer issues
  const fetchRef = new ivm.Reference(
    async (
      url: string,
      method: string,
      headersJson: string,
      bodyJson: string | null,
      signalAborted: boolean
    ) => {
      // Check if already aborted
      if (signalAborted) {
        throw new Error("[AbortError]The operation was aborted.");
      }

      // Parse headers and body from JSON
      const headers = JSON.parse(headersJson) as [string, string][];
      const bodyBytes = bodyJson ? JSON.parse(bodyJson) as number[] : null;

      // Construct native Request
      const body = bodyBytes ? new Uint8Array(bodyBytes) : null;
      const nativeRequest = new Request(url, {
        method,
        headers,
        body,
      });

      // Call user's onFetch handler or default fetch
      const onFetch = options?.onFetch ?? fetch;
      const nativeResponse = await onFetch(nativeRequest);

      // Determine if we should stream the response
      const contentLength = nativeResponse.headers.get("content-length");
      const knownSize = contentLength ? parseInt(contentLength, 10) : null;

      // Check for callback stream marker (set by daemon's onFetch for streaming callback responses)
      const isCallbackStream = (nativeResponse as Response & { __isCallbackStream?: boolean }).__isCallbackStream;

      // Network responses have http/https URLs
      const isNetworkResponse = nativeResponse.url && (nativeResponse.url.startsWith('http://') || nativeResponse.url.startsWith('https://'));

      // Stream if:
      // - Callback stream (already streaming from client)
      // - OR network response with no content-length or size > threshold
      const shouldStream = nativeResponse.body && (
        isCallbackStream ||
        (isNetworkResponse && (knownSize === null || knownSize > FETCH_STREAM_THRESHOLD))
      );

      if (shouldStream && nativeResponse.body) {
        // For callback streams, use lazy streaming to preserve timing
        // For other streams, use eager pumping
        if (isCallbackStream) {
          // Create a stream in the registry but don't pump eagerly
          // Store passthruBody so dispatchRequest can use it directly
          const streamId = streamRegistry.create();
          const passthruMap = getPassthruBodiesForContext(context);
          passthruMap.set(streamId, nativeResponse.body);

          const instanceId = nextInstanceId++;
          const state: ResponseState = {
            status: nativeResponse.status,
            statusText: nativeResponse.statusText,
            headers: Array.from(nativeResponse.headers.entries()),
            body: new Uint8Array(0), // Empty for streaming
            bodyUsed: false,
            type: "default",
            url: nativeResponse.url,
            redirected: nativeResponse.redirected,
            streamId, // Registry stream for isolate access
          };
          stateMap.set(instanceId, state);
          return instanceId;
        }

        // Registry path: pump chunks to stream registry
        const streamId = streamRegistry.create();

        // Store the response state with stream ID immediately
        const instanceId = nextInstanceId++;
        const state: ResponseState = {
          status: nativeResponse.status,
          statusText: nativeResponse.statusText,
          headers: Array.from(nativeResponse.headers.entries()),
          body: new Uint8Array(0), // Empty for streaming
          bodyUsed: false,
          type: "default",
          url: nativeResponse.url,
          redirected: nativeResponse.redirected,
          streamId, // Stream ID for body
        };
        stateMap.set(instanceId, state);

        // Start pumping chunks in the background with backpressure
        const reader = nativeResponse.body.getReader();
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                streamRegistry.close(streamId);
                break;
              }
              if (value) {
                // Wait for queue to drain if full (backpressure)
                while (streamRegistry.isQueueFull(streamId)) {
                  await new Promise(r => setTimeout(r, 1));
                }
                streamRegistry.push(streamId, value);
              }
            }
          } catch (err) {
            streamRegistry.error(streamId, err);
          } finally {
            reader.releaseLock();
          }
        })();

        return instanceId;
      }

      // Buffered path for small responses with known size
      const responseBody = await nativeResponse.arrayBuffer();
      const responseBodyArray = Array.from(new Uint8Array(responseBody));

      // Store the response in the state map and return just the ID + metadata
      const instanceId = nextInstanceId++;
      const state: ResponseState = {
        status: nativeResponse.status,
        statusText: nativeResponse.statusText,
        headers: Array.from(nativeResponse.headers.entries()),
        body: new Uint8Array(responseBodyArray),
        bodyUsed: false,
        type: "default",
        url: nativeResponse.url,
        redirected: nativeResponse.redirected,
        streamId: null,
      };
      stateMap.set(instanceId, state);

      // Return only the instance ID - avoid complex object transfer
      return instanceId;
    }
  );

  global.setSync("__fetch_ref", fetchRef);

  // Inject fetch function
  const fetchCode = `
(function() {
  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|AbortError|Error)\\](.*)$/);
    if (match) {
      if (match[1] === 'AbortError') {
        return new DOMException(match[2], 'AbortError');
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  globalThis.fetch = function(input, init = {}) {
    // Create Request from input
    const request = input instanceof Request ? input : new Request(input, init);

    // Get signal info
    const signal = init.signal ?? request.signal;
    const signalAborted = signal?.aborted ?? false;

    // Serialize headers and body to JSON for transfer
    const headersJson = JSON.stringify(Array.from(request.headers.entries()));
    const bodyBytes = request._getBodyBytes();
    const bodyJson = bodyBytes ? JSON.stringify(bodyBytes) : null;

    // Call host - returns just the response instance ID
    try {
      const instanceId = __fetch_ref.applySyncPromise(undefined, [
        request.url,
        request.method,
        headersJson,
        bodyJson,
        signalAborted
      ]);

      // Construct Response from the instance ID
      return Response._fromInstanceId(instanceId);
    } catch (err) {
      throw __decodeError(err);
    }
  };
})();
`;

  context.evalSync(fetchCode);
}

// ============================================================================
// Server Implementation (for serve())
// ============================================================================

function setupServer(
  context: ivm.Context,
  serveState: ServeState
): void {
  const global = context.global;

  // Setup upgrade registry in isolate (data stays in isolate, never marshalled to host)
  context.evalSync(`
    globalThis.__upgradeRegistry__ = new Map();
    globalThis.__upgradeIdCounter__ = 0;
  `);

  // Host callback to notify about pending upgrade
  global.setSync(
    "__setPendingUpgrade__",
    new ivm.Callback((connectionId: string) => {
      serveState.pendingUpgrade = { requested: true, connectionId };
    })
  );

  // Pure JS Server class with upgrade method
  context.evalSync(`
(function() {
  class Server {
    upgrade(request, options) {
      const data = options?.data;
      const connectionId = String(++globalThis.__upgradeIdCounter__);
      globalThis.__upgradeRegistry__.set(connectionId, data);
      __setPendingUpgrade__(connectionId);
      return true;
    }
  }
  globalThis.__Server__ = Server;
})();
  `);
}

// ============================================================================
// ServerWebSocket Implementation (for serve())
// ============================================================================

function setupServerWebSocket(
  context: ivm.Context,
  wsCommandCallbacks: Set<(cmd: WebSocketCommand) => void>
): void {
  const global = context.global;

  // Host callback for ws.send()
  global.setSync(
    "__ServerWebSocket_send",
    new ivm.Callback((connectionId: string, data: string) => {
      const cmd: WebSocketCommand = { type: "message", connectionId, data };
      for (const cb of wsCommandCallbacks) cb(cmd);
    })
  );

  // Host callback for ws.close()
  global.setSync(
    "__ServerWebSocket_close",
    new ivm.Callback((connectionId: string, code?: number, reason?: string) => {
      const cmd: WebSocketCommand = { type: "close", connectionId, code, reason };
      for (const cb of wsCommandCallbacks) cb(cmd);
    })
  );

  // Pure JS ServerWebSocket class
  context.evalSync(`
(function() {
  const _wsInstanceData = new WeakMap();

  class ServerWebSocket {
    constructor(connectionId) {
      _wsInstanceData.set(this, { connectionId, readyState: 1 });
    }

    get data() {
      const state = _wsInstanceData.get(this);
      return globalThis.__upgradeRegistry__.get(state.connectionId);
    }

    get readyState() {
      return _wsInstanceData.get(this).readyState;
    }

    send(message) {
      const state = _wsInstanceData.get(this);
      if (state.readyState !== 1) throw new Error("WebSocket is not open");
      // Convert ArrayBuffer/Uint8Array to string for transfer
      let data = message;
      if (message instanceof ArrayBuffer) {
        data = new TextDecoder().decode(message);
      } else if (message instanceof Uint8Array) {
        data = new TextDecoder().decode(message);
      }
      __ServerWebSocket_send(state.connectionId, data);
    }

    close(code, reason) {
      const state = _wsInstanceData.get(this);
      if (state.readyState === 3) return;
      state.readyState = 2; // CLOSING
      __ServerWebSocket_close(state.connectionId, code, reason);
    }

    _setReadyState(readyState) {
      _wsInstanceData.get(this).readyState = readyState;
    }
  }

  globalThis.__ServerWebSocket__ = ServerWebSocket;
})();
  `);
}

// ============================================================================
// serve() Function Implementation
// ============================================================================

function setupServe(context: ivm.Context): void {
  // Pure JS serve() that stores options on __serveOptions__ global
  context.evalSync(`
(function() {
  globalThis.__serveOptions__ = null;

  function serve(options) {
    globalThis.__serveOptions__ = options;
  }

  globalThis.serve = serve;
})();
  `);
}

// ============================================================================
// Main Setup Function
// ============================================================================

/**
 * Setup Fetch API in an isolated-vm context
 *
 * Injects fetch, Request, Response, Headers, FormData
 * Also sets up core APIs (Blob, File, AbortController, etc.) if not already present
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
  // Setup core APIs first (Blob, File, AbortController, Streams, etc.)
  await setupCore(context);

  const stateMap = getInstanceStateMapForContext(context);
  const streamRegistry = getStreamRegistryForContext(context);

  // Inject Headers (pure JS)
  context.evalSync(headersCode);

  // Inject FormData (pure JS)
  context.evalSync(formDataCode);

  // Inject multipart parsing/serialization (pure JS)
  context.evalSync(multipartCode);

  // Setup stream callbacks and inject HostBackedReadableStream
  setupStreamCallbacks(context, streamRegistry);
  context.evalSync(hostBackedStreamCode);

  // Setup Response (host state + isolate class)
  setupResponse(context, stateMap);

  // Setup Request (host state + isolate class)
  setupRequest(context, stateMap);

  // Setup fetch function
  setupFetchFunction(context, stateMap, streamRegistry, options);

  // Setup serve state
  const serveState: ServeState = {
    pendingUpgrade: null,
    activeConnections: new Map(),
  };

  // Setup WebSocket command callbacks
  const wsCommandCallbacks = new Set<(cmd: WebSocketCommand) => void>();

  // Setup Server class
  setupServer(context, serveState);

  // Setup ServerWebSocket class
  setupServerWebSocket(context, wsCommandCallbacks);

  // Setup serve function
  setupServe(context);

  return {
    dispose() {
      // Clear state for this context
      stateMap.clear();
      // Clear upgrade registry
      context.evalSync(`globalThis.__upgradeRegistry__.clear()`);
      // Clear serve state
      serveState.activeConnections.clear();
      serveState.pendingUpgrade = null;
    },

    async dispatchRequest(
      request: Request,
      _dispatchOptions?: DispatchRequestOptions
    ): Promise<Response> {
      // Clean up previous pending upgrade if not consumed
      if (serveState.pendingUpgrade) {
        const oldConnectionId = serveState.pendingUpgrade.connectionId;
        context.evalSync(`globalThis.__upgradeRegistry__.delete("${oldConnectionId}")`);
        serveState.pendingUpgrade = null;
      }

      // Check if serve handler exists
      const hasHandler = context.evalSync(`!!globalThis.__serveOptions__?.fetch`);
      if (!hasHandler) {
        throw new Error("No serve() handler registered");
      }

      // Setup streaming for request body
      // Per WHATWG Fetch spec, GET/HEAD requests cannot have bodies
      let requestStreamId: number | null = null;
      let streamCleanup: (() => Promise<void>) | null = null;
      const canHaveBody = !['GET', 'HEAD'].includes(request.method.toUpperCase());

      if (canHaveBody && request.body) {
        // Create a stream in the registry for the request body
        requestStreamId = streamRegistry.create();

        // Start background reader that pushes from native stream to host queue
        streamCleanup = startNativeStreamReader(
          request.body,
          requestStreamId,
          streamRegistry
        );
      }

      try {
        const headersArray = Array.from(request.headers.entries());

        // Create Request instance in isolate
        const requestInstanceId = nextInstanceId++;
        const requestState: RequestState = {
          url: request.url,
          method: request.method,
          headers: headersArray,
          body: null, // No buffered body - using stream
          bodyUsed: false,
          streamId: requestStreamId,
          mode: request.mode,
          credentials: request.credentials,
          cache: request.cache,
          redirect: request.redirect,
          referrer: request.referrer,
          integrity: request.integrity,
        };
        stateMap.set(requestInstanceId, requestState);

        // Call the fetch handler and get response
        // We use eval with promise: true to handle async handlers
        const responseInstanceId = await context.eval(`
          (async function() {
            const request = Request._fromInstanceId(${requestInstanceId});
            const server = new __Server__();
            const response = await Promise.resolve(__serveOptions__.fetch(request, server));
            return response._getInstanceId();
          })()
        `, { promise: true });

        // Get ResponseState from the instance
        const responseState = stateMap.get(responseInstanceId) as ResponseState | undefined;
        if (!responseState) {
          throw new Error("Response state not found");
        }

        // Check if there's a pass-through body for this stream (callback stream)
        if (responseState.streamId !== null) {
          const passthruMap = getPassthruBodiesForContext(context);
          const passthruBody = passthruMap.get(responseState.streamId);

          if (passthruBody) {
            // Use pass-through body directly for true streaming
            passthruMap.delete(responseState.streamId); // Clean up

            const responseHeaders = new Headers(responseState.headers);
            const status =
              responseState.status === 101 ? 200 : responseState.status;
            const response = new Response(passthruBody, {
              status,
              statusText: responseState.statusText,
              headers: responseHeaders,
            });

            // @ts-expect-error - adding custom property
            response._originalStatus = responseState.status;

            return response;
          }
        }

        // Check if response has streaming body (registry stream)
        if (responseState.streamId !== null) {
          const responseStreamId = responseState.streamId;
          let streamDone = false;

          // Create native stream that waits for data from isolate
          const pumpedStream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (streamDone) return;

              // Wait for data to be available
              while (!streamDone) {
                // Check if data is available
                const state = streamRegistry.get(responseStreamId);
                if (!state) {
                  controller.close();
                  streamDone = true;
                  return;
                }

                // If queue has data or stream is done, break and pull
                if (state.queue.length > 0 || state.closed || state.errored) {
                  break;
                }

                // Small delay to avoid busy-waiting
                await new Promise((r) => setTimeout(r, 1));
              }

              try {
                const result = await streamRegistry.pull(responseStreamId);
                if (result.done) {
                  controller.close();
                  streamDone = true;
                  streamRegistry.delete(responseStreamId);
                  return;
                }
                controller.enqueue(result.value);
              } catch (error) {
                controller.error(error);
                streamDone = true;
                streamRegistry.delete(responseStreamId);
              }
            },
            cancel() {
              streamDone = true;
              streamRegistry.error(
                responseStreamId,
                new Error("Stream cancelled")
              );
              streamRegistry.delete(responseStreamId);
            },
          });

          const responseHeaders = new Headers(responseState.headers);
          const status =
            responseState.status === 101 ? 200 : responseState.status;
          const response = new Response(pumpedStream, {
            status,
            statusText: responseState.statusText,
            headers: responseHeaders,
          });

          // @ts-expect-error - adding custom property
          response._originalStatus = responseState.status;

          return response;
        }

        // Convert to native Response (non-streaming)
        const responseHeaders = new Headers(responseState.headers);
        const responseBody = responseState.body;

        // Note: Status 101 (Switching Protocols) is not valid for Response constructor
        // We use 200 as the status but preserve the actual status in a custom header
        // The caller should check getUpgradeRequest() for WebSocket upgrades
        const status = responseState.status === 101 ? 200 : responseState.status;
        const response = new Response(responseBody as ConstructorParameters<typeof Response>[0], {
          status,
          statusText: responseState.statusText,
          headers: responseHeaders,
        });

        // Expose the original status via a property for callers to check
        // @ts-expect-error - adding custom property
        response._originalStatus = responseState.status;

        return response;
      } finally {
        // Wait for native body to finish streaming into registry
        if (requestStreamId !== null) {
          // Give time for small bodies to fully stream
          const startTime = Date.now();
          let streamState = streamRegistry.get(requestStreamId);
          while (streamState && !streamState.closed && !streamState.errored && Date.now() - startTime < 100) {
            await new Promise(resolve => setTimeout(resolve, 5));
            streamState = streamRegistry.get(requestStreamId);
          }
        }

        // Cleanup: cancel stream reader if still running
        if (streamCleanup) {
          await streamCleanup();
        }

        // Don't delete stream here - let it be consumed by the Request
        // Stream will be cleaned up when context is disposed
      }
    },

    getUpgradeRequest(): UpgradeRequest | null {
      const result = serveState.pendingUpgrade;
      // Don't clear yet - it will be cleared on next dispatchRequest or consumed by dispatchWebSocketOpen
      return result;
    },

    dispatchWebSocketOpen(connectionId: string): void {
      // Store connection (data stays in isolate registry)
      serveState.activeConnections.set(connectionId, { connectionId });

      // Check if websocket.open handler exists
      const hasOpenHandler = context.evalSync(`!!globalThis.__serveOptions__?.websocket?.open`);

      // Create ServerWebSocket instance (always needed for message/close handlers)
      context.evalSync(`
        (function() {
          const ws = new __ServerWebSocket__("${connectionId}");
          globalThis.__activeWs_${connectionId}__ = ws;
        })()
      `);

      // Call open handler if it exists
      if (hasOpenHandler) {
        context.evalSync(`
          (function() {
            const ws = globalThis.__activeWs_${connectionId}__;
            __serveOptions__.websocket.open(ws);
          })()
        `);
      }

      // Clear pending upgrade after successful open
      if (serveState.pendingUpgrade?.connectionId === connectionId) {
        serveState.pendingUpgrade = null;
      }
    },

    dispatchWebSocketMessage(connectionId: string, message: string | ArrayBuffer): void {
      // Check if connection is tracked
      if (!serveState.activeConnections.has(connectionId)) {
        return; // Silently ignore for unknown connections
      }

      // Check if message handler exists
      const hasMessageHandler = context.evalSync(`!!globalThis.__serveOptions__?.websocket?.message`);
      if (!hasMessageHandler) {
        return;
      }

      // Marshal message and call handler
      if (typeof message === "string") {
        context.evalSync(`
          (function() {
            const ws = globalThis.__activeWs_${connectionId}__;
            if (ws) __serveOptions__.websocket.message(ws, "${message.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}");
          })()
        `);
      } else {
        // ArrayBuffer - convert to base64 or pass as array
        const bytes = Array.from(new Uint8Array(message));
        context.evalSync(`
          (function() {
            const ws = globalThis.__activeWs_${connectionId}__;
            if (ws) {
              const bytes = new Uint8Array([${bytes.join(",")}]);
              __serveOptions__.websocket.message(ws, bytes.buffer);
            }
          })()
        `);
      }
    },

    dispatchWebSocketClose(connectionId: string, code: number, reason: string): void {
      // Check if connection is tracked
      if (!serveState.activeConnections.has(connectionId)) {
        return;
      }

      // Update readyState to CLOSED
      context.evalSync(`
        (function() {
          const ws = globalThis.__activeWs_${connectionId}__;
          if (ws) ws._setReadyState(3);
        })()
      `);

      // Check if close handler exists
      const hasCloseHandler = context.evalSync(`!!globalThis.__serveOptions__?.websocket?.close`);
      if (hasCloseHandler) {
        const safeReason = reason.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        context.evalSync(`
          (function() {
            const ws = globalThis.__activeWs_${connectionId}__;
            if (ws) __serveOptions__.websocket.close(ws, ${code}, "${safeReason}");
          })()
        `);
      }

      // Cleanup
      context.evalSync(`
        delete globalThis.__activeWs_${connectionId}__;
        globalThis.__upgradeRegistry__.delete("${connectionId}");
      `);
      serveState.activeConnections.delete(connectionId);
    },

    dispatchWebSocketError(connectionId: string, error: Error): void {
      // Check if connection is tracked
      if (!serveState.activeConnections.has(connectionId)) {
        return;
      }

      // Check if error handler exists
      const hasErrorHandler = context.evalSync(`!!globalThis.__serveOptions__?.websocket?.error`);
      if (!hasErrorHandler) {
        return;
      }

      const safeName = error.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const safeMessage = error.message.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      context.evalSync(`
        (function() {
          const ws = globalThis.__activeWs_${connectionId}__;
          if (ws) {
            const error = { name: "${safeName}", message: "${safeMessage}" };
            __serveOptions__.websocket.error(ws, error);
          }
        })()
      `);
    },

    onWebSocketCommand(callback: (cmd: WebSocketCommand) => void): () => void {
      wsCommandCallbacks.add(callback);
      return () => wsCommandCallbacks.delete(callback);
    },

    hasServeHandler(): boolean {
      return context.evalSync(`!!globalThis.__serveOptions__?.fetch`) as boolean;
    },

    hasActiveConnections(): boolean {
      return serveState.activeConnections.size > 0;
    },
  };
}
