import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState, type FetchHandle } from "./index.ts";

describe("Request Body Consumption", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("accessing request.body before request.json() should not lose body data", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // This pattern is used by frameworks like Better Auth:
          // First access request.body (e.g., to check if body exists)
          const bodyStream = request.body; // Getter is called

          // Then try to parse the JSON body
          try {
            const data = await request.json();
            return Response.json({ success: true, received: data });
          } catch (error) {
            return Response.json({
              success: false,
              error: error.message,
              bodyWasNull: bodyStream === null
            }, { status: 500 });
          }
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      })
    );

    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.deepStrictEqual(data.received, { email: "test@example.com" });
  });

  test("accessing request.body getter multiple times should return consistent stream", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Access body getter multiple times
          const body1 = request.body;
          const body2 = request.body;

          // Both should reference the same stream
          const areSame = body1 === body2;

          // Should still be able to read the body
          try {
            const text = await request.text();
            return Response.json({
              success: true,
              bodiesAreSame: areSame,
              bodyText: text
            });
          } catch (error) {
            return Response.json({
              success: false,
              error: error.message,
              bodiesAreSame: areSame
            }, { status: 500 });
          }
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "Hello World",
      })
    );

    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.bodiesAreSame, true);
    assert.strictEqual(data.bodyText, "Hello World");
  });
});

describe("HTTP Roundtrip", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("GET request returns correct response body", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("Hello from isolate!");
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), "Hello from isolate!");
  });

  test("POST request with JSON body is received correctly", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const body = await request.json();
          return Response.json({ received: body });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test", value: 42 }),
      })
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(data.received, { name: "test", value: 42 });
  });

  test("Response headers are preserved", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("OK", {
            headers: {
              "X-Custom-Header": "custom-value",
              "X-Another-Header": "another-value"
            }
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/")
    );
    assert.strictEqual(response.headers.get("X-Custom-Header"), "custom-value");
    assert.strictEqual(response.headers.get("X-Another-Header"), "another-value");
  });

  test("Response status codes work correctly", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const url = new URL(request.url);
          const status = parseInt(url.searchParams.get("status") || "200", 10);
          return new Response("Status test", { status });
        }
      });
    `);

    const ok = await fetchHandle.dispatchRequest(
      new Request("http://localhost/?status=200")
    );
    assert.strictEqual(ok.status, 200);

    const notFound = await fetchHandle.dispatchRequest(
      new Request("http://localhost/?status=404")
    );
    assert.strictEqual(notFound.status, 404);

    const serverError = await fetchHandle.dispatchRequest(
      new Request("http://localhost/?status=500")
    );
    assert.strictEqual(serverError.status, 500);
  });

  test("JSON response via Response.json()", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.json({
            message: "Hello",
            items: [1, 2, 3],
            nested: { foo: "bar" }
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/")
    );
    assert.ok(response.headers.get("Content-Type")?.includes("application/json"));
    const data = await response.json();
    assert.deepStrictEqual(data, {
      message: "Hello",
      items: [1, 2, 3],
      nested: { foo: "bar" },
    });
  });

  test("Request URL and method are accessible", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.json({
            method: request.method,
            url: request.url
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/test?foo=bar", { method: "PUT" })
    );
    const data = await response.json();
    assert.strictEqual(data.method, "PUT");
    assert.ok(data.url.includes("/api/test?foo=bar"));
  });

  test("Request headers are accessible", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.json({
            auth: request.headers.get("Authorization"),
            custom: request.headers.get("X-Custom")
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/", {
        headers: {
          Authorization: "Bearer token123",
          "X-Custom": "custom-value",
        },
      })
    );
    const data = await response.json();
    assert.strictEqual(data.auth, "Bearer token123");
    assert.strictEqual(data.custom, "custom-value");
  });

  test("Large response body can be read", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          // Generate a ~10KB response
          const chunk = "0123456789".repeat(100);
          const body = chunk.repeat(10);
          return new Response(body);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/")
    );
    const text = await response.text();
    assert.strictEqual(text.length, 10000);
  });

  test("Request with text body is forwarded to handler", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const body = await request.text();
          return new Response("Received: " + body.length + " chars");
        }
      });
    `);

    const largeBody = "x".repeat(5000);
    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/", {
        method: "POST",
        body: largeBody,
      })
    );
    const text = await response.text();
    assert.strictEqual(text, "Received: 5000 chars");
  });
});

describe("Response Clone", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("response.clone() preserves headers including cookies", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Simulate auth handler that adds a cookie
          function authHandler(req) {
            const response = new Response(JSON.stringify({ authenticated: true }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": "session=abc123; HttpOnly; Secure"
              }
            });
            return response;
          }

          const response = await authHandler(request);
          const clone = response.clone();

          // Read the clone body
          const cloneBody = await clone.text();

          // Return original response
          return response;
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Set-Cookie"), "session=abc123; HttpOnly; Secure");
  });
});

describe("Headers instanceof and constructor behavior (better-auth/better-call compatibility)", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("request.headers should work with instanceof check", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const cookie = request.headers.get("cookie");
          const instanceofHeaders = request.headers instanceof Headers;
          const constructorName = request.headers.constructor.name;

          return Response.json({
            cookie,
            instanceofHeaders,
            constructorName
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "session=abc123; other=value",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.cookie, "session=abc123; other=value");
    assert.strictEqual(data.instanceofHeaders, true);
    assert.strictEqual(data.constructorName, "Headers");
  });

  test("new Headers(request.headers) should preserve cookies", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const originalCookie = request.headers.get("cookie");

          // This is what better-call does internally
          const copiedHeaders = new Headers(request.headers);
          const copiedCookie = copiedHeaders.get("cookie");

          return Response.json({
            originalCookie,
            copiedCookie,
            cookiesMatch: originalCookie === copiedCookie
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "session=abc123; token=xyz",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.originalCookie, "session=abc123; token=xyz");
    assert.strictEqual(data.copiedCookie, "session=abc123; token=xyz");
    assert.strictEqual(data.cookiesMatch, true);
  });

  test("headers passed to nested function should preserve instanceof behavior", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Simulate what better-auth does: pass headers to a nested function
          function processContext(context) {
            const headers = context.headers;
            return {
              hasCookie: headers.has("cookie"),
              getCookie: headers.get("cookie"),
              instanceofHeaders: headers instanceof Headers,
              constructorName: headers.constructor.name,
            };
          }

          const result = processContext({ headers: request.headers });

          return Response.json(result);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "better-auth.session_token=abc123",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.hasCookie, true);
    assert.strictEqual(data.getCookie, "better-auth.session_token=abc123");
    assert.strictEqual(data.instanceofHeaders, true);
    assert.strictEqual(data.constructorName, "Headers");
  });

  test("better-call createInternalContext pattern should preserve cookies", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Simulate the createInternalContext pattern from better-call
          function createInternalContext(context) {
            const isHeadersLike = (obj) => obj && typeof obj.get === "function" && typeof obj.has === "function";

            let requestHeaders = null;

            if ("headers" in context && context.headers) {
              if (isHeadersLike(context.headers)) {
                requestHeaders = context.headers;
              } else if (context.headers instanceof Headers) {
                requestHeaders = context.headers;
              } else {
                try {
                  requestHeaders = new Headers(context.headers);
                } catch (e) {
                  // Ignore errors
                }
              }
            }

            return {
              requestHeadersType: requestHeaders?.constructor?.name,
              hasCookie: requestHeaders?.has?.("cookie"),
              getCookie: requestHeaders?.get?.("cookie"),
            };
          }

          // Call like better-auth does: auth.api.getSession({ headers: request.headers })
          const result = createInternalContext({ headers: request.headers });

          return Response.json(result);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "better-auth.session_token=abc123.signature",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.requestHeadersType, "Headers");
    assert.strictEqual(data.hasCookie, true);
    assert.strictEqual(data.getCookie, "better-auth.session_token=abc123.signature");
  });

  test("headers.entries() should iterate all headers including cookies", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          const entries = [];
          for (const [key, value] of request.headers.entries()) {
            entries.push({ key, value });
          }

          const cookieEntry = entries.find(e => e.key === "cookie");

          return Response.json({
            entriesCount: entries.length,
            hasCookieEntry: !!cookieEntry,
            cookieValue: cookieEntry?.value,
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "session=test123",
          "content-type": "application/json",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.hasCookieEntry, true);
    assert.strictEqual(data.cookieValue, "session=test123");
  });

  test("async function receiving headers should preserve cookie access", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          async function getSession(options) {
            // Simulate async processing like better-auth does
            await Promise.resolve();

            const headers = options.headers;
            return {
              hasCookie: headers.has("cookie"),
              cookieValue: headers.get("cookie"),
            };
          }

          const session = await getSession({ headers: request.headers });

          return Response.json(session);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "auth_token=secret123",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.hasCookie, true);
    assert.strictEqual(data.cookieValue, "auth_token=secret123");
  });

  test("multiple async hops should preserve headers", async () => {
    context.evalSync(`
      serve({
        async fetch(request) {
          // Level 1: Router context
          async function routerContext(req) {
            return await authApi({ headers: req.headers });
          }

          // Level 2: Auth API
          async function authApi(options) {
            await Promise.resolve();
            return await createInternalContext(options);
          }

          // Level 3: Internal context (like better-call)
          async function createInternalContext(context) {
            await Promise.resolve();
            const headers = context.headers;

            return {
              level: "createInternalContext",
              hasCookie: headers?.has?.("cookie") ?? false,
              getCookie: headers?.get?.("cookie") ?? null,
              constructorName: headers?.constructor?.name,
            };
          }

          const result = await routerContext(request);

          return Response.json(result);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", {
        headers: {
          cookie: "session_token=deep_test_123",
        },
      })
    );

    const data = await response.json();
    assert.strictEqual(data.level, "createInternalContext");
    assert.strictEqual(data.hasCookie, true);
    assert.strictEqual(data.getCookie, "session_token=deep_test_123");
    assert.strictEqual(data.constructorName, "Headers");
  });
});
