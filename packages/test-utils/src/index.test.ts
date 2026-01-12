import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import {
  createTestContext,
  createCoreTestContext,
  evalCode,
  evalCodeAsync,
  evalCodeJson,
  evalCodeJsonAsync,
  injectGlobals,
  MockFileSystem,
  createFsTestContext,
  createRuntimeTestContext,
  startIntegrationServer,
  type TestContext,
  type FsTestContext,
  type RuntimeTestContext,
  type IntegrationServer,
} from "./index.ts";

// ============================================================================
// createTestContext tests
// ============================================================================

describe("createTestContext", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("creates a basic context", async () => {
    ctx = await createTestContext();
    assert.ok(ctx.isolate);
    assert.ok(ctx.context);
    assert.ok(typeof ctx.dispose === "function");
  });

  test("can evaluate code in context", async () => {
    ctx = await createTestContext();
    const result = ctx.context.evalSync("1 + 1");
    assert.strictEqual(result, 2);
  });
});

describe("createCoreTestContext", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("creates a context with core APIs", async () => {
    ctx = await createCoreTestContext();
    assert.ok(ctx.isolate);
    assert.ok(ctx.context);
  });

  test("has Blob available", async () => {
    ctx = await createCoreTestContext();
    const result = ctx.context.evalSync("typeof Blob");
    assert.strictEqual(result, "function");
  });

  test("has URL available", async () => {
    ctx = await createCoreTestContext();
    const result = ctx.context.evalSync(
      "new URL('https://example.com').hostname"
    );
    assert.strictEqual(result, "example.com");
  });
});

// ============================================================================
// evalCode tests
// ============================================================================

describe("evalCode", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("evaluates code synchronously", async () => {
    ctx = await createTestContext();
    const result = evalCode<number>(ctx.context, "2 + 3");
    assert.strictEqual(result, 5);
  });

  test("returns string", async () => {
    ctx = await createTestContext();
    const result = evalCode<string>(ctx.context, '"hello"');
    assert.strictEqual(result, "hello");
  });
});

describe("evalCodeAsync", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("evaluates async code", async () => {
    ctx = await createTestContext();
    const result = await evalCodeAsync<number>(
      ctx.context,
      "Promise.resolve(42)"
    );
    assert.strictEqual(result, 42);
  });

  test("handles async IIFE", async () => {
    ctx = await createTestContext();
    const result = await evalCodeAsync<string>(
      ctx.context,
      `(async () => { return "async result"; })()`
    );
    assert.strictEqual(result, "async result");
  });
});

describe("evalCodeJson", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("parses JSON result", async () => {
    ctx = await createTestContext();
    const result = evalCodeJson<{ name: string }>(
      ctx.context,
      'JSON.stringify({ name: "test" })'
    );
    assert.deepStrictEqual(result, { name: "test" });
  });
});

describe("evalCodeJsonAsync", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("parses async JSON result", async () => {
    ctx = await createTestContext();
    const result = await evalCodeJsonAsync<{ value: number }>(
      ctx.context,
      `(async () => JSON.stringify({ value: 123 }))()`
    );
    assert.deepStrictEqual(result, { value: 123 });
  });
});

describe("injectGlobals", () => {
  let ctx: TestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("injects primitive values", async () => {
    ctx = await createTestContext();
    await injectGlobals(ctx.context, {
      testString: "hello",
      testNumber: 42,
      testBool: true,
    });
    assert.strictEqual(evalCode<string>(ctx.context, "testString"), "hello");
    assert.strictEqual(evalCode<number>(ctx.context, "testNumber"), 42);
    assert.strictEqual(evalCode<boolean>(ctx.context, "testBool"), true);
  });

  test("injects objects", async () => {
    ctx = await createTestContext();
    await injectGlobals(ctx.context, {
      testConfig: { debug: true, level: 3 },
    });
    const result = evalCodeJson<{ debug: boolean; level: number }>(
      ctx.context,
      "JSON.stringify(testConfig)"
    );
    assert.deepStrictEqual(result, { debug: true, level: 3 });
  });
});

// ============================================================================
// MockFileSystem tests
// ============================================================================

describe("MockFileSystem", () => {
  test("creates empty file system with root directory", () => {
    const fs = new MockFileSystem();
    assert.strictEqual(fs.directories.has("/"), true);
    assert.strictEqual(fs.files.size, 0);
  });

  test("setFile creates file with content", async () => {
    const fs = new MockFileSystem();
    fs.setFile("/test.txt", "Hello, World!");

    const file = await fs.readFile("/test.txt");
    assert.strictEqual(new TextDecoder().decode(file.data), "Hello, World!");
  });

  test("getFile retrieves file content", () => {
    const fs = new MockFileSystem();
    fs.setFile("/test.txt", "content");

    const data = fs.getFile("/test.txt");
    assert.ok(data);
    assert.strictEqual(new TextDecoder().decode(data), "content");
  });

  test("getFileAsString retrieves file as string", () => {
    const fs = new MockFileSystem();
    fs.setFile("/test.txt", "string content");

    const content = fs.getFileAsString("/test.txt");
    assert.strictEqual(content, "string content");
  });

  test("createDirectory creates nested directories", () => {
    const fs = new MockFileSystem();
    fs.createDirectory("/a/b/c");

    assert.strictEqual(fs.directories.has("/a"), true);
    assert.strictEqual(fs.directories.has("/a/b"), true);
    assert.strictEqual(fs.directories.has("/a/b/c"), true);
  });

  test("reset clears all files and directories", async () => {
    const fs = new MockFileSystem();
    fs.setFile("/test.txt", "content");
    fs.createDirectory("/dir");

    fs.reset();

    assert.strictEqual(fs.files.size, 0);
    assert.strictEqual(fs.directories.size, 1); // Only root
    assert.strictEqual(fs.directories.has("/"), true);
  });

  test("getFileHandle throws NotFoundError for missing file", async () => {
    const fs = new MockFileSystem();
    await assert.rejects(
      fs.getFileHandle("/missing.txt"),
      /NotFoundError/
    );
  });

  test("getFileHandle creates file with create option", async () => {
    const fs = new MockFileSystem();
    await fs.getFileHandle("/new.txt", { create: true });
    assert.strictEqual(fs.files.has("/new.txt"), true);
  });

  test("readDirectory lists files and directories", async () => {
    const fs = new MockFileSystem();
    fs.setFile("/file1.txt", "content");
    fs.setFile("/file2.txt", "content");
    fs.createDirectory("/subdir");

    const entries = await fs.readDirectory("/");
    assert.strictEqual(entries.length, 3);

    const names = entries.map((e) => e.name).sort();
    assert.deepStrictEqual(names, ["file1.txt", "file2.txt", "subdir"]);
  });
});

// ============================================================================
// createFsTestContext tests
// ============================================================================

describe("createFsTestContext", () => {
  let ctx: FsTestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("creates context with file system APIs", async () => {
    ctx = await createFsTestContext();
    assert.ok(ctx.isolate);
    assert.ok(ctx.context);
    assert.ok(ctx.mockFs);
  });

  test("mockFs is connected to context", async () => {
    ctx = await createFsTestContext();

    // Create a file in mockFs
    ctx.mockFs.setFile("/test.txt", "Hello from test!");

    // Read it from the isolate
    const result = await ctx.context.eval(
      `
      (async () => {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle("test.txt");
        const file = await fileHandle.getFile();
        return await file.text();
      })()
    `,
      { promise: true }
    );

    assert.strictEqual(result, "Hello from test!");
  });
});

// ============================================================================
// createRuntimeTestContext tests
// ============================================================================

describe("createRuntimeTestContext", () => {
  let ctx: RuntimeTestContext | undefined;

  afterEach(() => {
    ctx?.dispose();
    ctx = undefined;
  });

  test("creates full runtime context", async () => {
    ctx = await createRuntimeTestContext();
    assert.ok(ctx.isolate);
    assert.ok(ctx.context);
    assert.ok(typeof ctx.tick === "function");
    assert.ok(Array.isArray(ctx.logs));
    assert.ok(Array.isArray(ctx.fetchCalls));
  });

  test("captures console logs", async () => {
    ctx = await createRuntimeTestContext();

    ctx.context.evalSync('console.log("test message")');
    ctx.context.evalSync('console.warn("warning message")');

    assert.strictEqual(ctx.logs.length, 2);
    assert.strictEqual(ctx.logs[0].level, "log");
    assert.deepStrictEqual(ctx.logs[0].args, ["test message"]);
    assert.strictEqual(ctx.logs[1].level, "warn");
    assert.deepStrictEqual(ctx.logs[1].args, ["warning message"]);
  });

  test("captures and mocks fetch calls", async () => {
    ctx = await createRuntimeTestContext();

    ctx.setMockResponse({
      status: 200,
      body: '{"data": "test"}',
      headers: { "Content-Type": "application/json" },
    });

    const result = await ctx.context.eval(
      `
      (async () => {
        const response = await fetch("https://api.example.com/data");
        const json = await response.json();
        return JSON.stringify({ status: response.status, data: json });
      })()
    `,
      { promise: true }
    );

    const parsed = JSON.parse(result as string);
    assert.strictEqual(parsed.status, 200);
    assert.deepStrictEqual(parsed.data, { data: "test" });

    assert.strictEqual(ctx.fetchCalls.length, 1);
    assert.strictEqual(ctx.fetchCalls[0].url, "https://api.example.com/data");
    assert.strictEqual(ctx.fetchCalls[0].method, "GET");
  });

  test("tick advances timers", async () => {
    ctx = await createRuntimeTestContext();

    ctx.context.evalSync(`
      globalThis.timerFired = false;
      setTimeout(() => { globalThis.timerFired = true; }, 100);
    `);

    // Timer should not have fired yet
    assert.strictEqual(evalCode<boolean>(ctx.context, "timerFired"), false);

    // Advance time
    await ctx.tick(100);

    // Timer should have fired
    assert.strictEqual(evalCode<boolean>(ctx.context, "timerFired"), true);
  });
});

// ============================================================================
// startIntegrationServer tests
// ============================================================================

describe("startIntegrationServer", () => {
  let server: IntegrationServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  test("starts server on available port", async () => {
    server = await startIntegrationServer();
    assert.ok(server.port > 0);
    assert.ok(server.url.startsWith("http://localhost:"));
  });

  test("responds with configured response", async () => {
    server = await startIntegrationServer();
    server.setResponse("/api/test", {
      status: 200,
      body: '{"message": "hello"}',
      headers: { "Content-Type": "application/json" },
    });

    const response = await fetch(`${server.url}/api/test`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(data, { message: "hello" });
  });

  test("records requests", async () => {
    server = await startIntegrationServer();
    server.setDefaultResponse({ status: 200, body: "OK" });

    await fetch(`${server.url}/api/endpoint`, {
      method: "POST",
      headers: { "X-Custom": "value" },
      body: "request body",
    });

    const requests = server.getRequests();
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].method, "POST");
    assert.strictEqual(requests[0].path, "/api/endpoint");
    assert.strictEqual(requests[0].headers["x-custom"], "value");
    assert.strictEqual(requests[0].body, "request body");
  });

  test("clears requests", async () => {
    server = await startIntegrationServer();
    server.setDefaultResponse({ status: 200 });

    await fetch(`${server.url}/test`);
    assert.strictEqual(server.getRequests().length, 1);

    server.clearRequests();
    assert.strictEqual(server.getRequests().length, 0);
  });

  test("returns 404 for unmatched paths", async () => {
    server = await startIntegrationServer();

    const response = await fetch(`${server.url}/unknown`);
    assert.strictEqual(response.status, 404);
  });
});
