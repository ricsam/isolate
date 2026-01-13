import ivm from "isolated-vm";

export interface TestRuntime {
  logs: Record<string, unknown>;
  result: unknown;
}

export interface TestRunner {
  input(inputs: Record<string, unknown>): TestRuntime;
}

/**
 * Run isolate code with native objects as input and capture logs
 *
 * This utility allows testing whether native objects passed INTO the isolate
 * behave like isolate instances. It converts native web API classes (Headers,
 * Request, Response, URL, Blob, File, FormData) to their isolate equivalents
 * before executing the test code.
 *
 * @example
 * const runtime = runTestCode(ctx.context, `
 *   const headers = testingInput.headers;
 *   log("instanceof", headers instanceof Headers);
 *   log("contentType", headers.get("content-type"));
 * `).input({
 *   headers: new Headers({ "content-type": "application/json" })
 * });
 *
 * expect(runtime.logs.instanceof).toBe(true);
 * expect(runtime.logs.contentType).toBe("application/json");
 */
export function runTestCode(context: ivm.Context, code: string): TestRunner {
  return {
    input(inputs: Record<string, unknown>): TestRuntime {
      const logs: Record<string, unknown> = {};

      // Setup log capture - log(tag, value) stores as logs[tag] = value
      // Values are unmarshalled back to native types for bidirectional testing
      const logCallback = new ivm.Callback(
        (tag: string, valueJson: string) => {
          const value = JSON.parse(valueJson);
          logs[tag] = unmarshalFromJson(value);
        }
      );
      context.global.setSync("__log_callback__", logCallback);

      // Create a wrapper log function that serializes values
      context.evalSync(`
        globalThis.log = function(tag, value) {
          __log_callback__(tag, JSON.stringify(__serializeForLog__(value)));
        };

        globalThis.__serializeForLog__ = function(value) {
          if (value instanceof Headers) {
            const pairs = [];
            for (const [k, v] of value) pairs.push([k, v]);
            return { __type__: 'Headers', pairs };
          }
          if (value instanceof Request) {
            const headers = [];
            for (const [k, v] of value.headers) headers.push([k, v]);
            return {
              __type__: 'Request',
              url: value.url,
              method: value.method,
              headers,
              mode: value.mode,
              credentials: value.credentials,
              cache: value.cache,
              redirect: value.redirect,
              referrer: value.referrer,
              referrerPolicy: value.referrerPolicy,
              integrity: value.integrity,
            };
          }
          if (value instanceof Response) {
            const headers = [];
            for (const [k, v] of value.headers) headers.push([k, v]);
            return {
              __type__: 'Response',
              status: value.status,
              statusText: value.statusText,
              ok: value.ok,
              headers,
              type: value.type,
              redirected: value.redirected,
              url: value.url,
            };
          }
          if (value instanceof FormData) {
            const entries = [];
            for (const [k, v] of value) {
              if (v instanceof File) {
                entries.push([k, { __type__: 'File', name: v.name, type: v.type, lastModified: v.lastModified }]);
              } else {
                entries.push([k, v]);
              }
            }
            return { __type__: 'FormData', entries };
          }
          if (value instanceof URL) {
            return { __type__: 'URL', href: value.href };
          }
          if (value instanceof File) {
            return { __type__: 'File', name: value.name, type: value.type, lastModified: value.lastModified };
          }
          if (value instanceof Blob) {
            return { __type__: 'Blob', type: value.type, size: value.size };
          }
          if (Array.isArray(value)) {
            return value.map(v => __serializeForLog__(v));
          }
          if (value && typeof value === 'object' && value.constructor === Object) {
            const result = {};
            for (const [k, v] of Object.entries(value)) {
              result[k] = __serializeForLog__(v);
            }
            return result;
          }
          return value;
        };
      `);

      // Marshal inputs with special handling for native web API classes
      marshalInputs(context, inputs);

      // Run the code
      let returnValue: unknown = undefined;
      try {
        returnValue = context.evalSync(code);
      } catch (error) {
        // Clean up before re-throwing
        context.evalSync(`
          delete globalThis.testingInput;
          delete globalThis.log;
          delete globalThis.__log_callback__;
          delete globalThis.__serializeForLog__;
        `);
        throw error;
      }

      // Cleanup
      context.evalSync(`
        delete globalThis.testingInput;
        delete globalThis.log;
        delete globalThis.__log_callback__;
        delete globalThis.__serializeForLog__;
      `);

      return { logs, result: returnValue };
    },
  };
}

/**
 * Marshal inputs into the isolate, converting native web API classes
 */
function marshalInputs(
  context: ivm.Context,
  inputs: Record<string, unknown>
): void {
  // Create the testingInput object in the isolate
  context.evalSync(`globalThis.testingInput = {};`);

  for (const [key, value] of Object.entries(inputs)) {
    marshalValue(context, `testingInput.${key}`, value);
  }
}

/**
 * Marshal a single value into the isolate at the given path
 */
function marshalValue(
  context: ivm.Context,
  path: string,
  value: unknown
): void {
  // Check for native Headers
  if (value instanceof Headers) {
    const pairs: [string, string][] = [];
    value.forEach((v, k) => pairs.push([k, v]));
    const pairsJson = JSON.stringify(pairs);
    context.evalSync(`${path} = new Headers(${pairsJson});`);
    return;
  }

  // Check for native Request
  if (value instanceof Request) {
    // First marshal the headers
    const headerPairs: [string, string][] = [];
    value.headers.forEach((v, k) => headerPairs.push([k, v]));
    const headersJson = JSON.stringify(headerPairs);

    const urlJson = JSON.stringify(value.url);
    const methodJson = JSON.stringify(value.method);
    const modeJson = JSON.stringify(value.mode);
    const credentialsJson = JSON.stringify(value.credentials);
    const cacheJson = JSON.stringify(value.cache);
    const redirectJson = JSON.stringify(value.redirect);
    const referrerJson = JSON.stringify(value.referrer);
    const referrerPolicyJson = JSON.stringify(value.referrerPolicy);
    const integrityJson = JSON.stringify(value.integrity);

    context.evalSync(`
      ${path} = new Request(${urlJson}, {
        method: ${methodJson},
        headers: new Headers(${headersJson}),
        mode: ${modeJson},
        credentials: ${credentialsJson},
        cache: ${cacheJson},
        redirect: ${redirectJson},
        referrer: ${referrerJson},
        referrerPolicy: ${referrerPolicyJson},
        integrity: ${integrityJson},
      });
    `);
    return;
  }

  // Check for native Response
  if (value instanceof Response) {
    const headerPairs: [string, string][] = [];
    value.headers.forEach((v, k) => headerPairs.push([k, v]));
    const headersJson = JSON.stringify(headerPairs);

    const statusJson = JSON.stringify(value.status);
    const statusTextJson = JSON.stringify(value.statusText);

    context.evalSync(`
      ${path} = new Response(null, {
        status: ${statusJson},
        statusText: ${statusTextJson},
        headers: new Headers(${headersJson}),
      });
    `);
    return;
  }

  // Check for native FormData
  if (value instanceof FormData) {
    context.evalSync(`${path} = new FormData();`);

    for (const [key, entryValue] of value.entries()) {
      const keyJson = JSON.stringify(key);

      if (entryValue instanceof File) {
        const nameJson = JSON.stringify(entryValue.name);
        const typeJson = JSON.stringify(entryValue.type);
        const lastModifiedJson = JSON.stringify(entryValue.lastModified);
        context.evalSync(`
          ${path}.append(${keyJson}, new File([], ${nameJson}, { type: ${typeJson}, lastModified: ${lastModifiedJson} }));
        `);
      } else {
        const valueJson = JSON.stringify(entryValue);
        context.evalSync(`${path}.append(${keyJson}, ${valueJson});`);
      }
    }
    return;
  }

  // Check for native URL
  if (value instanceof URL) {
    const hrefJson = JSON.stringify(value.href);
    context.evalSync(`${path} = new URL(${hrefJson});`);
    return;
  }

  // Check for native File (before Blob, since File extends Blob)
  if (value instanceof File) {
    const nameJson = JSON.stringify(value.name);
    const typeJson = JSON.stringify(value.type);
    const lastModifiedJson = JSON.stringify(value.lastModified);
    context.evalSync(
      `${path} = new File([], ${nameJson}, { type: ${typeJson}, lastModified: ${lastModifiedJson} });`
    );
    return;
  }

  // Check for native Blob
  if (value instanceof Blob) {
    const typeJson = JSON.stringify(value.type);
    context.evalSync(`${path} = new Blob([], { type: ${typeJson} });`);
    return;
  }

  // Handle arrays recursively
  if (Array.isArray(value)) {
    context.evalSync(`${path} = [];`);
    for (let i = 0; i < value.length; i++) {
      marshalValue(context, `${path}[${i}]`, value[i]);
    }
    return;
  }

  // Handle plain objects recursively
  if (value && typeof value === "object" && value.constructor === Object) {
    context.evalSync(`${path} = {};`);
    for (const [key, val] of Object.entries(value)) {
      // Use bracket notation for safe property access
      marshalValue(context, `${path}[${JSON.stringify(key)}]`, val);
    }
    return;
  }

  // For primitives, set directly via JSON
  const valueJson = JSON.stringify(value);
  context.evalSync(`${path} = ${valueJson};`);
}

/**
 * Unmarshal a value from JSON, converting special __type__ markers back to native instances
 */
function unmarshalFromJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => unmarshalFromJson(v));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Check for special type markers
    if (obj.__type__ === "Headers") {
      const pairs = obj.pairs as [string, string][];
      const headers = new Headers();
      for (const [k, v] of pairs) {
        headers.append(k, v);
      }
      return headers;
    }

    if (obj.__type__ === "Request") {
      const headers = new Headers();
      for (const [k, v] of obj.headers as [string, string][]) {
        headers.append(k, v);
      }
      return new Request(obj.url as string, {
        method: obj.method as string,
        headers,
        mode: obj.mode as RequestMode,
        credentials: obj.credentials as RequestCredentials,
        cache: obj.cache as RequestCache,
        redirect: obj.redirect as RequestRedirect,
        referrer: obj.referrer as string,
        referrerPolicy: obj.referrerPolicy as ReferrerPolicy,
        integrity: obj.integrity as string,
      });
    }

    if (obj.__type__ === "Response") {
      const headers = new Headers();
      for (const [k, v] of obj.headers as [string, string][]) {
        headers.append(k, v);
      }
      return new Response(null, {
        status: obj.status as number,
        statusText: obj.statusText as string,
        headers,
      });
    }

    if (obj.__type__ === "FormData") {
      const formData = new FormData();
      for (const [k, v] of obj.entries as [string, unknown][]) {
        if (
          typeof v === "object" &&
          v !== null &&
          (v as Record<string, unknown>).__type__ === "File"
        ) {
          const fileObj = v as Record<string, unknown>;
          formData.append(
            k,
            new File([], fileObj.name as string, {
              type: fileObj.type as string,
              lastModified: fileObj.lastModified as number,
            })
          );
        } else {
          formData.append(k, v as string);
        }
      }
      return formData;
    }

    if (obj.__type__ === "URL") {
      return new URL(obj.href as string);
    }

    if (obj.__type__ === "File") {
      return new File([], obj.name as string, {
        type: obj.type as string,
        lastModified: obj.lastModified as number,
      });
    }

    if (obj.__type__ === "Blob") {
      return new Blob([], { type: obj.type as string });
    }

    // Plain object - recursively unmarshal properties
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = unmarshalFromJson(v);
    }
    return result;
  }

  return value;
}
