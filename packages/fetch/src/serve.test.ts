import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState, type FetchHandle } from "./index.ts";

describe("serve()", () => {
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

  test("serve() returns response with body", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          return new Response("Hello!");
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), "Hello!");
  });

  test("serve() returns JSON response", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          return Response.json({ message: "Hello, World!" });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "application/json");
    const data = await response.json();
    assert.deepStrictEqual(data, { message: "Hello, World!" });
  });

  test("serve() handles request properties", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          const url = request.url;
          const method = request.method;
          return new Response("URL: " + url + ", Method: " + method);
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test", { method: "POST" })
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), "URL: http://localhost/test, Method: POST");
  });

  test("dispatchRequest mirrors abort to request.signal inside isolate", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Promise((resolve) => {
            let abortEvents = 0;

            request.signal.addEventListener("abort", () => {
              abortEvents++;
              resolve(Response.json({
                aborted: request.signal.aborted,
                abortEvents
              }));
            }, { once: true });
          });
        }
      });
    `);

    const controller = new AbortController();
    const responsePromise = fetchHandle.dispatchRequest(
      new Request("http://localhost/abort"),
      { signal: controller.signal }
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();

    const response = await Promise.race([
      responsePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for abort propagation")), 2000)
      ),
    ]);
    const result = await response.json() as {
      aborted: boolean;
      abortEvents: number;
    };

    assert.strictEqual(result.aborted, true);
    assert.strictEqual(result.abortEvents, 1);
  });

  test("serve() with async fetch handler", async () => {
    context.evalSync(`
      serve({
        async fetch(request, server) {
          return Response.json({ message: "Hello from isolate!" });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "application/json");
    const data = await response.json();
    assert.deepStrictEqual(data, { message: "Hello from isolate!" });
  });

  test("serve() with Headers(undefined) should return valid response", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          const responseHeaders = new Headers(undefined);
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: responseHeaders,
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(data, []);
  });

  test("serve() with Headers instance passed to Response", async () => {
    context.evalSync(`
      serve({
        fetch(request, server) {
          const headers = new Headers({ "Content-Type": "application/json" });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: headers,
          });
        }
      });
    `);

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "application/json");
    const data = await response.json();
    assert.deepStrictEqual(data, { ok: true });
  });

  test("Response should have same attributes as native Response - basic", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("Hello, world!", { status: 200 });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = new Response("Hello, world!", { status: 200 });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.statusText, nativeResponse.statusText);
    assert.strictEqual(isolateResponse.ok, nativeResponse.ok);
    assert.strictEqual(await isolateResponse.text(), await nativeResponse.text());
  });

  test("Response should have same attributes as native Response - with statusText", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("Created!", { status: 201, statusText: "Created" });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = new Response("Created!", { status: 201, statusText: "Created" });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.statusText, nativeResponse.statusText);
    assert.strictEqual(isolateResponse.ok, nativeResponse.ok);
  });

  test("Response should have same attributes as native Response - error status", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("Not Found", { status: 404, statusText: "Not Found" });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = new Response("Not Found", { status: 404, statusText: "Not Found" });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.statusText, nativeResponse.statusText);
    assert.strictEqual(isolateResponse.ok, nativeResponse.ok);
    assert.strictEqual(isolateResponse.ok, false);
  });

  test("Response should have same attributes as native Response - with headers object", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("test", {
            status: 200,
            headers: {
              "Content-Type": "text/plain",
              "X-Custom-Header": "custom-value"
            }
          });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = new Response("test", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "X-Custom-Header": "custom-value"
      }
    });

    assert.strictEqual(isolateResponse.headers.get("content-type"), nativeResponse.headers.get("content-type"));
    assert.strictEqual(isolateResponse.headers.get("x-custom-header"), nativeResponse.headers.get("x-custom-header"));
  });

  test("Response should have same attributes as native Response - with Headers instance", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const headers = new Headers();
          headers.set("Content-Type", "application/json");
          headers.set("X-Request-Id", "12345");
          return new Response('{"data": true}', { status: 200, headers });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    const nativeHeaders = new Headers();
    nativeHeaders.set("Content-Type", "application/json");
    nativeHeaders.set("X-Request-Id", "12345");
    const nativeResponse = new Response('{"data": true}', { status: 200, headers: nativeHeaders });

    assert.strictEqual(isolateResponse.headers.get("content-type"), nativeResponse.headers.get("content-type"));
    assert.strictEqual(isolateResponse.headers.get("x-request-id"), nativeResponse.headers.get("x-request-id"));
    assert.deepStrictEqual(await isolateResponse.json(), await nativeResponse.json());
  });

  test("Response.json() should have same attributes as native Response.json()", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.json({ message: "hello", count: 42 });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = Response.json({ message: "hello", count: 42 });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.ok(isolateResponse.headers.get("content-type")?.includes("application/json"));
    assert.ok(nativeResponse.headers.get("content-type")?.includes("application/json"));
    assert.deepStrictEqual(await isolateResponse.json(), await nativeResponse.json());
  });

  test("Response.json() with custom status should match native", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.json({ error: "not found" }, { status: 404 });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = Response.json({ error: "not found" }, { status: 404 });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.ok, nativeResponse.ok);
    assert.deepStrictEqual(await isolateResponse.json(), await nativeResponse.json());
  });

  test("Response.redirect() should have same attributes as native Response.redirect()", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.redirect("https://example.com/new-location");
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = Response.redirect("https://example.com/new-location");

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.headers.get("location"), nativeResponse.headers.get("location"));
  });

  test("Response.redirect() with custom status should match native", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return Response.redirect("https://example.com/moved", 301);
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = Response.redirect("https://example.com/moved", 301);

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.headers.get("location"), nativeResponse.headers.get("location"));
  });

  test("Response with null body should match native", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          return new Response(null, { status: 204 });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );
    const nativeResponse = new Response(null, { status: 204 });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(await isolateResponse.text(), await nativeResponse.text());
  });

  test("Response with ArrayBuffer body should match native", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
          return new Response(buffer, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" }
          });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    const nativeResponse = new Response(buffer, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" }
    });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(isolateResponse.headers.get("content-type"), nativeResponse.headers.get("content-type"));

    const isolateBuffer = await isolateResponse.arrayBuffer();
    const nativeBuffer = await nativeResponse.arrayBuffer();
    assert.deepStrictEqual(new Uint8Array(isolateBuffer), new Uint8Array(nativeBuffer));
  });

  test("Response with Uint8Array body should match native", async () => {
    context.evalSync(`
      serve({
        fetch(request) {
          const bytes = new Uint8Array([87, 111, 114, 108, 100]);
          return new Response(bytes, { status: 200 });
        }
      });
    `);

    const isolateResponse = await fetchHandle.dispatchRequest(
      new Request("http://localhost/test")
    );

    const bytes = new Uint8Array([87, 111, 114, 108, 100]);
    const nativeResponse = new Response(bytes, { status: 200 });

    assert.strictEqual(isolateResponse.status, nativeResponse.status);
    assert.strictEqual(await isolateResponse.text(), await nativeResponse.text());
  });

  test("hasServeHandler returns true after serve() is called", async () => {
    assert.strictEqual(fetchHandle.hasServeHandler(), false);

    context.evalSync(`
      serve({
        fetch(request) {
          return new Response("OK");
        }
      });
    `);

    assert.strictEqual(fetchHandle.hasServeHandler(), true);
  });

  test("dispatchRequest throws if no serve handler", async () => {
    await assert.rejects(
      async () => {
        await fetchHandle.dispatchRequest(new Request("http://localhost/test"));
      },
      /No serve\(\) handler registered/
    );
  });
});
