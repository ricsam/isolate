import { describe, test, afterEach } from "node:test";
import assert from "node:assert";
import { createRuntime, type RuntimeHandle } from "@ricsam/isolate-runtime";
import { createNodeFileSystemHandler } from "./node-adapter.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, "fixtures");

describe("FS + HTTP Integration Tests", () => {
  let runtime: RuntimeHandle | undefined;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
      runtime = undefined;
    }
  });

  test("binary file (image) can be read from disk and returned in response", async () => {
    // 1. Read original image bytes for comparison
    const originalBytes = fs.readFileSync(join(fixturesDir, "test-image.png"));

    // 2. Create runtime with fs enabled, pointing to fixtures dir
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    // 3. Run code that reads file and returns as Response
    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();
      const arrayBuffer = await file.arrayBuffer();

      const response = new Response(arrayBuffer, {
        headers: { "Content-Type": "image/png" }
      });

      // Return the response body as array for comparison
      const responseBuffer = await response.arrayBuffer();
      returnResult(Array.from(new Uint8Array(responseBuffer)));
    `);

    // 4. Verify response matches original file
    const responseBytes = new Uint8Array(result as number[]);
    assert.deepStrictEqual(responseBytes, new Uint8Array(originalBytes));
  });

  test("new Response(file) streams file directly (WHATWG compliant)", async () => {
    // 1. Read original image bytes for comparison
    const originalBytes = fs.readFileSync(join(fixturesDir, "test-image.png"));

    // 2. Create runtime with fs enabled
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    // 3. Run code that passes File directly to Response
    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();

      // Pass File directly to Response - should stream automatically
      const response = new Response(file);

      // Return the response body as array for comparison
      const responseBuffer = await response.arrayBuffer();
      returnResult(Array.from(new Uint8Array(responseBuffer)));
    `);

    // 4. Verify response matches original file
    const responseBytes = new Uint8Array(result as number[]);
    assert.deepStrictEqual(responseBytes, new Uint8Array(originalBytes));
  });

  test("new Response(blob) streams blob directly (WHATWG compliant)", async () => {
    // 1. Read original image bytes for comparison
    const originalBytes = fs.readFileSync(join(fixturesDir, "test-image.png"));

    // 2. Create runtime with fs enabled
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    // 3. Run code that creates Blob from file and passes to Response
    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();

      // Create a Blob from file contents and pass directly to Response
      const arrayBuffer = await file.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "image/png" });
      const response = new Response(blob);

      // Return the response body as array for comparison
      const responseBuffer = await response.arrayBuffer();
      returnResult(Array.from(new Uint8Array(responseBuffer)));
    `);

    // 4. Verify response matches original file
    const responseBytes = new Uint8Array(result as number[]);
    assert.deepStrictEqual(responseBytes, new Uint8Array(originalBytes));
  });

  test("new Response(file.slice()) returns sliced blob (WHATWG compliant)", async () => {
    // 1. Read original image bytes for comparison
    const originalBytes = fs.readFileSync(join(fixturesDir, "test-image.png"));

    // 2. Create runtime with fs enabled
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    // 3. Run code that uses file.slice() - File extends Blob
    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();

      // Use file.slice() to get first 100 bytes - File extends Blob
      const slicedBlob = file.slice(0, 100);
      const response = new Response(slicedBlob);

      // Return the response body as array for comparison
      const responseBuffer = await response.arrayBuffer();
      returnResult(Array.from(new Uint8Array(responseBuffer)));
    `);

    // 4. Verify response is first 100 bytes
    const responseBytes = new Uint8Array(result as number[]);
    const expectedSlice = new Uint8Array(originalBytes).slice(0, 100);
    assert.deepStrictEqual(responseBytes, expectedSlice);
  });

  test("file.type returns correct MIME type", async () => {
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();
      returnResult(file.type);
    `);

    assert.strictEqual(result, "image/png");
  });

  test("file.name returns correct filename", async () => {
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();
      returnResult(file.name);
    `);

    assert.strictEqual(result, "test-image.png");
  });

  test("file.size returns correct size", async () => {
    const originalBytes = fs.readFileSync(join(fixturesDir, "test-image.png"));

    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();
      returnResult(file.size);
    `);

    assert.strictEqual(result, originalBytes.length);
  });

  test("file instanceof checks work correctly", async () => {
    let result: unknown;
    runtime = await createRuntime({
      fs: {
        getDirectory: async () => createNodeFileSystemHandler(fixturesDir),
      },
      customFunctions: {
        returnResult: {
          fn: (value: unknown) => { result = value; },
          type: 'sync',
        },
      },
    });

    await runtime.eval(`
      const root = await getDirectory("/");
      const fileHandle = await root.getFileHandle("test-image.png");
      const file = await fileHandle.getFile();
      returnResult({
        isFile: file instanceof File,
        isBlob: file instanceof Blob,
      });
    `);

    assert.deepStrictEqual(result, {
      isFile: true,
      isBlob: true,
    });
  });
});
