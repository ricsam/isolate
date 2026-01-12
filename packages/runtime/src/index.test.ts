import { test, describe } from "node:test";
import assert from "node:assert";
import { createRuntime, type RuntimeHandle } from "./index.ts";

describe("@ricsam/isolate-runtime", () => {
  describe("createRuntime", () => {
    test("creates runtime with default options", async () => {
      const runtime = await createRuntime();
      try {
        assert(runtime.isolate, "isolate should be defined");
        assert(runtime.context, "context should be defined");
        assert(typeof runtime.tick === "function", "tick should be a function");
        assert(
          typeof runtime.dispose === "function",
          "dispose should be a function"
        );
      } finally {
        runtime.dispose();
      }
    });

    test("runtime has all globals defined", async () => {
      const runtime = await createRuntime();
      try {
        const result = await runtime.context.eval(`
          JSON.stringify({
            hasFetch: typeof fetch === 'function',
            hasConsole: typeof console === 'object',
            hasCrypto: typeof crypto === 'object',
            hasSetTimeout: typeof setTimeout === 'function',
            hasSetInterval: typeof setInterval === 'function',
            hasClearTimeout: typeof clearTimeout === 'function',
            hasClearInterval: typeof clearInterval === 'function',
            hasPath: typeof path === 'object',
            hasTextEncoder: typeof TextEncoder === 'function',
            hasTextDecoder: typeof TextDecoder === 'function',
            hasBlob: typeof Blob === 'function',
            hasFile: typeof File === 'function',
            hasURL: typeof URL === 'function',
            hasURLSearchParams: typeof URLSearchParams === 'function',
            hasHeaders: typeof Headers === 'function',
            hasRequest: typeof Request === 'function',
            hasResponse: typeof Response === 'function',
            hasFormData: typeof FormData === 'function',
            hasAbortController: typeof AbortController === 'function',
            hasAbortSignal: typeof AbortSignal === 'function',
            hasReadableStream: typeof ReadableStream === 'function',
            hasBtoa: typeof btoa === 'function',
            hasAtob: typeof atob === 'function',
          })
        `);
        const globals = JSON.parse(result as string);

        assert.strictEqual(globals.hasFetch, true, "fetch should be defined");
        assert.strictEqual(
          globals.hasConsole,
          true,
          "console should be defined"
        );
        assert.strictEqual(globals.hasCrypto, true, "crypto should be defined");
        assert.strictEqual(
          globals.hasSetTimeout,
          true,
          "setTimeout should be defined"
        );
        assert.strictEqual(
          globals.hasSetInterval,
          true,
          "setInterval should be defined"
        );
        assert.strictEqual(
          globals.hasClearTimeout,
          true,
          "clearTimeout should be defined"
        );
        assert.strictEqual(
          globals.hasClearInterval,
          true,
          "clearInterval should be defined"
        );
        assert.strictEqual(globals.hasPath, true, "path should be defined");
        assert.strictEqual(
          globals.hasTextEncoder,
          true,
          "TextEncoder should be defined"
        );
        assert.strictEqual(
          globals.hasTextDecoder,
          true,
          "TextDecoder should be defined"
        );
        assert.strictEqual(globals.hasBlob, true, "Blob should be defined");
        assert.strictEqual(globals.hasFile, true, "File should be defined");
        assert.strictEqual(globals.hasURL, true, "URL should be defined");
        assert.strictEqual(
          globals.hasURLSearchParams,
          true,
          "URLSearchParams should be defined"
        );
        assert.strictEqual(
          globals.hasHeaders,
          true,
          "Headers should be defined"
        );
        assert.strictEqual(
          globals.hasRequest,
          true,
          "Request should be defined"
        );
        assert.strictEqual(
          globals.hasResponse,
          true,
          "Response should be defined"
        );
        assert.strictEqual(
          globals.hasFormData,
          true,
          "FormData should be defined"
        );
        assert.strictEqual(
          globals.hasAbortController,
          true,
          "AbortController should be defined"
        );
        assert.strictEqual(
          globals.hasAbortSignal,
          true,
          "AbortSignal should be defined"
        );
        assert.strictEqual(
          globals.hasReadableStream,
          true,
          "ReadableStream should be defined"
        );
        assert.strictEqual(globals.hasBtoa, true, "btoa should be defined");
        assert.strictEqual(globals.hasAtob, true, "atob should be defined");
      } finally {
        runtime.dispose();
      }
    });

    test("dispose cleans up resources", async () => {
      const runtime = await createRuntime();
      runtime.dispose();

      // After dispose, the isolate should be disposed
      // Attempting to use it should throw
      assert.throws(
        () => {
          runtime.isolate.createContextSync();
        },
        /disposed/i,
        "isolate should be disposed"
      );
    });

    test("accepts memory limit option", async () => {
      const runtime = await createRuntime({
        memoryLimit: 128,
      });
      try {
        assert(runtime.isolate, "isolate should be created with memory limit");
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("console integration", () => {
    test("console.log is captured", async () => {
      const logs: Array<{ level: string; args: unknown[] }> = [];

      const runtime = await createRuntime({
        console: {
          onLog: (level, ...args) => {
            logs.push({ level, args });
          },
        },
      });

      try {
        await runtime.context.eval(`
          console.log("hello", "world");
          console.warn("warning message");
          console.error("error message");
        `);

        assert.strictEqual(logs.length, 3, "should have captured 3 logs");
        assert.strictEqual(logs[0].level, "log");
        assert.deepStrictEqual(logs[0].args, ["hello", "world"]);
        assert.strictEqual(logs[1].level, "warn");
        assert.deepStrictEqual(logs[1].args, ["warning message"]);
        assert.strictEqual(logs[2].level, "error");
        assert.deepStrictEqual(logs[2].args, ["error message"]);
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("fetch integration", () => {
    test("fetch calls onFetch handler", async () => {
      let capturedRequest: Request | null = null;

      const runtime = await createRuntime({
        fetch: {
          onFetch: async (request) => {
            capturedRequest = request;
            return new Response(JSON.stringify({ message: "mocked" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          },
        },
      });

      try {
        const result = await runtime.context.eval(
          `
          (async () => {
            const response = await fetch("https://example.com/api", {
              method: "POST",
              headers: { "X-Custom": "header" },
              body: "test body"
            });
            return JSON.stringify({
              status: response.status,
              body: await response.json()
            });
          })()
        `,
          { promise: true }
        );

        const data = JSON.parse(result as string);
        assert.strictEqual(data.status, 200);
        assert.deepStrictEqual(data.body, { message: "mocked" });

        // Verify the request was captured correctly
        assert(capturedRequest, "request should be captured");
        assert.strictEqual(capturedRequest!.url, "https://example.com/api");
        assert.strictEqual(capturedRequest!.method, "POST");
        assert.strictEqual(capturedRequest!.headers.get("X-Custom"), "header");
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("timers integration", () => {
    test("setTimeout works with tick()", async () => {
      const runtime = await createRuntime();

      try {
        // Set up a timeout that modifies a global variable
        await runtime.context.eval(`
          globalThis.timerFired = false;
          globalThis.timerValue = 0;
          setTimeout(() => {
            globalThis.timerFired = true;
            globalThis.timerValue = 42;
          }, 100);
        `);

        // Before tick, timer should not have fired
        let result = await runtime.context.eval(`globalThis.timerFired`);
        assert.strictEqual(result, false, "timer should not fire before tick");

        // Tick forward 50ms - still not enough
        await runtime.tick(50);
        result = await runtime.context.eval(`globalThis.timerFired`);
        assert.strictEqual(result, false, "timer should not fire at 50ms");

        // Tick forward another 50ms (total 100ms) - now it should fire
        await runtime.tick(50);
        result = await runtime.context.eval(`globalThis.timerFired`);
        assert.strictEqual(result, true, "timer should fire at 100ms");

        result = await runtime.context.eval(`globalThis.timerValue`);
        assert.strictEqual(result, 42, "timer should have set value");
      } finally {
        runtime.dispose();
      }
    });

    test("setInterval works with tick()", async () => {
      const runtime = await createRuntime();

      try {
        await runtime.context.eval(`
          globalThis.intervalCount = 0;
          setInterval(() => {
            globalThis.intervalCount++;
          }, 100);
        `);

        // Tick incrementally - interval fires at each 100ms boundary
        await runtime.tick(100); // t=100ms, first fire
        let count = await runtime.context.eval(`globalThis.intervalCount`);
        assert.strictEqual(count, 1, "interval should fire once at 100ms");

        await runtime.tick(100); // t=200ms, second fire
        count = await runtime.context.eval(`globalThis.intervalCount`);
        assert.strictEqual(count, 2, "interval should fire twice at 200ms");
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("crypto integration", () => {
    test("crypto.randomUUID generates valid UUIDs", async () => {
      const runtime = await createRuntime();

      try {
        const uuid = (await runtime.context.eval(
          `crypto.randomUUID()`
        )) as string;
        assert.match(
          uuid,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          "should generate valid UUID v4"
        );
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("path integration", () => {
    test("path.join works correctly", async () => {
      const runtime = await createRuntime();

      try {
        const result = await runtime.context.eval(`path.join('a', 'b', 'c')`);
        assert.strictEqual(result, "a/b/c");
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("encoding integration", () => {
    test("btoa and atob work correctly", async () => {
      const runtime = await createRuntime();

      try {
        const encoded = await runtime.context.eval(`btoa('hello')`);
        assert.strictEqual(encoded, "aGVsbG8=");

        const decoded = await runtime.context.eval(`atob('aGVsbG8=')`);
        assert.strictEqual(decoded, "hello");
      } finally {
        runtime.dispose();
      }
    });
  });

  describe("GC disposal", () => {
    test("resources are cleaned up on dispose", async () => {
      const runtime = await createRuntime();

      // Create some resources
      await runtime.context.eval(`
        const blob = new Blob(["test"]);
        const url = new URL("https://example.com");
        setTimeout(() => {}, 1000);
      `);

      // Dispose should not throw
      assert.doesNotThrow(() => {
        runtime.dispose();
      }, "dispose should not throw");

      // After dispose, attempting to use the context should fail
      await assert.rejects(
        async () => {
          await runtime.context.eval(`1 + 1`);
        },
        /released|disposed/i,
        "context should be released after dispose"
      );
    });
  });

  describe("fs integration", () => {
    test("navigator.storage.getDirectory works when handler provided", async () => {
      const files = new Map<
        string,
        { data: Uint8Array; lastModified: number; type: string }
      >();
      const directories = new Set<string>(["/"]); // Root directory exists

      const runtime = await createRuntime({
        fs: {
          handler: {
            async getFileHandle(path, options) {
              if (!files.has(path) && !options?.create) {
                throw new Error("[NotFoundError]File not found");
              }
              if (!files.has(path) && options?.create) {
                files.set(path, {
                  data: new Uint8Array(0),
                  lastModified: Date.now(),
                  type: "",
                });
              }
            },
            async getDirectoryHandle(path, options) {
              if (!directories.has(path) && !options?.create) {
                throw new Error("[NotFoundError]Directory not found");
              }
              if (options?.create) {
                directories.add(path);
              }
            },
            async removeEntry(path) {
              files.delete(path);
              directories.delete(path);
            },
            async readDirectory(path) {
              const entries: Array<{ name: string; kind: "file" | "directory" }> =
                [];
              for (const filePath of files.keys()) {
                const dir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
                if (dir === path) {
                  entries.push({
                    name: filePath.substring(filePath.lastIndexOf("/") + 1),
                    kind: "file",
                  });
                }
              }
              for (const dirPath of directories) {
                if (dirPath !== path && dirPath.startsWith(path)) {
                  const relativePath = dirPath.substring(path.length);
                  const parts = relativePath.split("/").filter(Boolean);
                  if (parts.length === 1) {
                    entries.push({ name: parts[0], kind: "directory" });
                  }
                }
              }
              return entries;
            },
            async readFile(path) {
              const file = files.get(path);
              if (!file) {
                throw new Error("[NotFoundError]File not found");
              }
              return {
                data: file.data,
                size: file.data.length,
                lastModified: file.lastModified,
                type: file.type,
              };
            },
            async writeFile(path, data) {
              const existing = files.get(path);
              files.set(path, {
                data,
                lastModified: Date.now(),
                type: existing?.type ?? "",
              });
            },
            async truncateFile(path, size) {
              const file = files.get(path);
              if (file) {
                file.data = file.data.slice(0, size);
              }
            },
            async getFileMetadata(path) {
              const file = files.get(path);
              if (!file) {
                throw new Error("[NotFoundError]File not found");
              }
              return {
                size: file.data.length,
                lastModified: file.lastModified,
                type: file.type,
              };
            },
          },
        },
      });

      try {
        const result = await runtime.context.eval(
          `
          (async () => {
            const root = await navigator.storage.getDirectory();
            return root.kind;
          })()
        `,
          { promise: true }
        );
        assert.strictEqual(result, "directory");
      } finally {
        runtime.dispose();
      }
    });
  });
});
