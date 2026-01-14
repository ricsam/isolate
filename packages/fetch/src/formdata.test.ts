import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch, clearAllInstanceState, type FetchHandle } from "./index.ts";
import { setupCore } from "@ricsam/isolate-core";

describe("FormData Integration", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;
  let fetchHandle: FetchHandle;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
    // Setup core first (provides Blob, File, etc.)
    await setupCore(context);
    fetchHandle = await setupFetch(context);
  });

  afterEach(() => {
    fetchHandle.dispose();
    context.release();
    isolate.dispose();
  });

  test("FormData handler works with fetch", async () => {
    context.evalSync(`
      serve({
        async fetch(request, server) {
          const formData = await request.formData();
          const file = formData.get("file");
          if (!file || typeof file === "string") {
            return Response.json({ error: "No file provided" }, { status: 400 });
          }
          return Response.json({
            success: true,
            name: file.name,
            size: file.size,
            type: file.type
          });
        }
      });
    `);

    // Create multipart/form-data request
    const boundary = "----TestBoundary123";
    const body = [
      `------TestBoundary123`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Hello World`,
      `------TestBoundary123--`,
    ].join("\r\n");

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
      })
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.name, "test.txt");
  });

  test("FormData with text fields", async () => {
    context.evalSync(`
      serve({
        async fetch(request, server) {
          const formData = await request.formData();
          const name = formData.get("name");
          const email = formData.get("email");

          return Response.json({
            name,
            email
          });
        }
      });
    `);

    // Create multipart/form-data request with text fields
    const boundary = "----TestBoundary456";
    const body = [
      `------TestBoundary456`,
      `Content-Disposition: form-data; name="name"`,
      ``,
      `John Doe`,
      `------TestBoundary456`,
      `Content-Disposition: form-data; name="email"`,
      ``,
      `john@example.com`,
      `------TestBoundary456--`,
    ].join("\r\n");

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/submit", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
      })
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.name, "John Doe");
    assert.strictEqual(data.email, "john@example.com");
  });

  test("FormData with multiple files", async () => {
    context.evalSync(`
      serve({
        async fetch(request, server) {
          const formData = await request.formData();
          const files = formData.getAll("files");

          return Response.json({
            count: files.length,
            names: files.map(f => typeof f === 'string' ? f : f.name)
          });
        }
      });
    `);

    // Create multipart/form-data request with multiple files
    const boundary = "----TestBoundary789";
    const body = [
      `------TestBoundary789`,
      `Content-Disposition: form-data; name="files"; filename="file1.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Content of file 1`,
      `------TestBoundary789`,
      `Content-Disposition: form-data; name="files"; filename="file2.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Content of file 2`,
      `------TestBoundary789--`,
    ].join("\r\n");

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/upload-multiple", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
      })
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.count, 2);
    assert.deepStrictEqual(data.names, ["file1.txt", "file2.txt"]);
  });

  test("FormData file content can be read", async () => {
    context.evalSync(`
      serve({
        async fetch(request, server) {
          const formData = await request.formData();
          const file = formData.get("file");
          if (!file || typeof file === "string") {
            return Response.json({ error: "No file provided" }, { status: 400 });
          }

          const content = await file.text();

          return Response.json({
            name: file.name,
            content: content
          });
        }
      });
    `);

    // Create multipart/form-data request
    const boundary = "----TestBoundaryContent";
    const body = [
      `------TestBoundaryContent`,
      `Content-Disposition: form-data; name="file"; filename="message.txt"`,
      `Content-Type: text/plain`,
      ``,
      `Hello from file content!`,
      `------TestBoundaryContent--`,
    ].join("\r\n");

    const response = await fetchHandle.dispatchRequest(
      new Request("http://localhost/api/read", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: body,
      })
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.name, "message.txt");
    assert.strictEqual(data.content, "Hello from file content!");
  });
});
