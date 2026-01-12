import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState } from "@ricsam/isolate-core";

export { clearAllInstanceState };

export interface FetchOptions {
  /** Handler for fetch requests from the isolate */
  onFetch?: (request: Request) => Promise<Response>;
}

export interface FetchHandle {
  dispose(): void;
}

// ============================================================================
// Instance State Management
// ============================================================================

const instanceStateMap = new WeakMap<ivm.Context, Map<number, unknown>>();
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
}

interface RequestState {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array | null;
  bodyUsed: boolean;
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
      // For Blob, we need to get the bytes synchronously
      // This is a limitation - we'll convert to string for now
      throw new TypeError('Blob body requires async handling');
    }
    if (body instanceof ReadableStream) {
      throw new TypeError('ReadableStream body not yet supported');
    }
    // Try to convert to string
    return Array.from(new TextEncoder().encode(String(body)));
  }

  class Response {
    #instanceId;
    #headers;

    constructor(body, init = {}) {
      // Handle internal construction from instance ID
      if (typeof body === 'number' && init === null) {
        this.#instanceId = body;
        this.#headers = new Headers(__Response_get_headers(body));
        return;
      }

      const bodyBytes = __prepareBody(body);
      const status = init.status ?? 200;
      const statusText = init.statusText ?? '';
      const headersInit = init.headers;
      const headers = new Headers(headersInit);
      const headersArray = Array.from(headers.entries());

      this.#instanceId = __Response_construct(bodyBytes, status, statusText, headersArray);
      this.#headers = headers;
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
      // Return a ReadableStream that reads the body
      const instanceId = this.#instanceId;
      return new ReadableStream({
        start(controller) {
          const buffer = __Response_arrayBuffer(instanceId);
          if (buffer.byteLength > 0) {
            controller.enqueue(new Uint8Array(buffer));
          }
          controller.close();
        }
      });
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
      return __Response_arrayBuffer(this.#instanceId);
    }

    async blob() {
      const buffer = await this.arrayBuffer();
      const contentType = this.headers.get('content-type') || '';
      return new Blob([buffer], { type: contentType });
    }

    async formData() {
      const contentType = this.headers.get('content-type') || '';
      const text = await this.text();

      // Parse application/x-www-form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = new FormData();
        const params = new URLSearchParams(text);
        for (const [key, value] of params) {
          formData.append(key, value);
        }
        return formData;
      }

      // For multipart/form-data, throw for now (complex parsing)
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
      // Serialize FormData as URL-encoded for simplicity
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

  class Request {
    #instanceId;
    #headers;
    #signal;

    constructor(input, init = {}) {
      // Handle internal construction from instance ID
      if (typeof input === 'number' && init === null) {
        this.#instanceId = input;
        this.#headers = new Headers(__Request_get_headers(input));
        this.#signal = null;
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
      const headersArray = Array.from(headers.entries());

      this.#instanceId = __Request_construct(
        url, method, headersArray, bodyBytes,
        mode, credentials, cache, redirect, referrer, integrity
      );
      this.#headers = headers;
      this.#signal = signal;
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
      // Return a ReadableStream that reads the body
      const instanceId = this.#instanceId;
      return new ReadableStream({
        start(controller) {
          const buffer = __Request_arrayBuffer(instanceId);
          if (buffer.byteLength > 0) {
            controller.enqueue(new Uint8Array(buffer));
          }
          controller.close();
        }
      });
    }

    async text() {
      try {
        __Request_markBodyUsed(this.#instanceId);
      } catch (err) {
        throw __decodeError(err);
      }
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
      return __Request_arrayBuffer(this.#instanceId);
    }

    async blob() {
      const buffer = await this.arrayBuffer();
      const contentType = this.headers.get('content-type') || '';
      return new Blob([buffer], { type: contentType });
    }

    async formData() {
      const contentType = this.headers.get('content-type') || '';
      const text = await this.text();

      // Parse application/x-www-form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
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

function setupFetchFunction(
  context: ivm.Context,
  stateMap: Map<number, unknown>,
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

      // Read response body
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

  // Inject Headers (pure JS)
  context.evalSync(headersCode);

  // Inject FormData (pure JS)
  context.evalSync(formDataCode);

  // Setup Response (host state + isolate class)
  setupResponse(context, stateMap);

  // Setup Request (host state + isolate class)
  setupRequest(context, stateMap);

  // Setup fetch function
  setupFetchFunction(context, stateMap, options);

  return {
    dispose() {
      // Clear state for this context
      stateMap.clear();
    },
  };
}
