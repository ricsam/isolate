/**
 * Marshalling integration tests using custom callback functions for roundtrip testing.
 * These tests verify that JavaScript types are properly preserved when passed between
 * the host (client) and the isolate runtime.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection, RemoteRuntime } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-test-marshal.sock";

describe("marshalling integration", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  describe("roundtrip via callback functions", () => {
    it("should roundtrip Date types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getDate: {
            fn: () => new Date("2024-01-15T12:00:00Z"),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const date = getDate();
          receiveResult({
            isDate: date instanceof Date,
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            isoString: date.toISOString(),
          });
        `);
        assert.deepStrictEqual(received, {
          isDate: true,
          year: 2024,
          month: 1,
          day: 15,
          isoString: "2024-01-15T12:00:00.000Z",
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip RegExp types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getRegex: {
            fn: () => /test-pattern/gi,
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const regex = getRegex();
          receiveResult({
            isRegExp: regex instanceof RegExp,
            source: regex.source,
            flags: regex.flags,
            testMatch: regex.test("TEST-PATTERN"),
          });
        `);
        assert.deepStrictEqual(received, {
          isRegExp: true,
          source: "test-pattern",
          flags: "gi",
          testMatch: true,
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip URL types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getUrl: {
            fn: () => new URL("https://example.com/path?q=1#hash"),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const url = getUrl();
          receiveResult({
            isURL: url instanceof URL,
            href: url.href,
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
          });
        `);
        assert.deepStrictEqual(received, {
          isURL: true,
          href: "https://example.com/path?q=1#hash",
          pathname: "/path",
          search: "?q=1",
          hash: "#hash",
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip Headers types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getHeaders: {
            fn: () =>
              new Headers({
                "Content-Type": "application/json",
                "X-Custom": "value",
              }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const headers = getHeaders();
          receiveResult({
            isHeaders: headers instanceof Headers,
            contentType: headers.get("content-type"),
            custom: headers.get("x-custom"),
          });
        `);
        assert.deepStrictEqual(received, {
          isHeaders: true,
          contentType: "application/json",
          custom: "value",
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip undefined values", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getObject: {
            fn: () => ({
              defined: "value",
              undef: undefined,
              nil: null,
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const obj = getObject();
          receiveResult({
            defined: obj.defined,
            hasUndef: "undef" in obj,
            undefType: typeof obj.undef,
            nil: obj.nil,
          });
        `);
        assert.deepStrictEqual(received, {
          defined: "value",
          hasUndef: true,
          undefType: "undefined",
          nil: null,
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip BigInt types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getBigInt: {
            fn: () => BigInt("9007199254740993"),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const big = getBigInt();
          receiveResult({
            isBigInt: typeof big === 'bigint',
            value: big.toString(),
            isLarge: big > Number.MAX_SAFE_INTEGER,
          });
        `);
        assert.deepStrictEqual(received, {
          isBigInt: true,
          value: "9007199254740993",
          isLarge: true,
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip Uint8Array types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getBuffer: {
            fn: () => new Uint8Array([1, 2, 3, 4, 5]),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const buf = getBuffer();
          receiveResult({
            isUint8Array: buf instanceof Uint8Array,
            length: buf.length,
            values: Array.from(buf),
          });
        `);
        assert.deepStrictEqual(received, {
          isUint8Array: true,
          length: 5,
          values: [1, 2, 3, 4, 5],
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip Request types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getRequest: {
            fn: () =>
              new Request("https://api.example.com/data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: "value" }),
              }),
            type: "async",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const req = await getRequest();
            const bodyText = await req.text();
            receiveResult({
              isRequest: req instanceof Request,
              url: req.url,
              method: req.method,
              contentType: req.headers.get("content-type"),
              body: bodyText,
            });
          })();
        `);
        assert.deepStrictEqual(received, {
          isRequest: true,
          url: "https://api.example.com/data",
          method: "POST",
          contentType: "application/json",
          body: '{"key":"value"}',
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip Response types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getResponse: {
            fn: () =>
              new Response(JSON.stringify({ data: "test" }), {
                status: 201,
                statusText: "Created",
                headers: { "X-Test": "value" },
              }),
            type: "async",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const res = await getResponse();
            const bodyText = await res.text();
            receiveResult({
              isResponse: res instanceof Response,
              status: res.status,
              statusText: res.statusText,
              xTest: res.headers.get("x-test"),
              body: bodyText,
            });
          })();
        `);
        assert.deepStrictEqual(received, {
          isResponse: true,
          status: 201,
          statusText: "Created",
          xTest: "value",
          body: '{"data":"test"}',
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip File types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getFile: {
            fn: () =>
              new File(["file content here"], "test.txt", {
                type: "text/plain",
                lastModified: 1704067200000,
              }),
            type: "async",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const file = await getFile();
            const text = await file.text();
            receiveResult({
              isFile: file instanceof File,
              name: file.name,
              type: file.type,
              lastModified: file.lastModified,
              content: text,
            });
          })();
        `);
        assert.deepStrictEqual(received, {
          isFile: true,
          name: "test.txt",
          type: "text/plain",
          lastModified: 1704067200000,
          content: "file content here",
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should roundtrip nested complex types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getComplexData: {
            fn: () => ({
              date: new Date("2024-01-01"),
              regex: /test/gi,
              url: new URL("https://example.com"),
              headers: new Headers({ "X-Custom": "value" }),
              buffer: new Uint8Array([1, 2, 3]),
              nested: {
                anotherDate: new Date("2024-06-15"),
                big: BigInt("12345678901234567890"),
              },
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const data = getComplexData();
          receiveResult({
            dateYear: data.date.getFullYear(),
            regexSource: data.regex.source,
            urlPath: data.url.pathname,
            headerValue: data.headers.get("x-custom"),
            bufferLength: data.buffer.length,
            nestedDateMonth: data.nested.anotherDate.getMonth() + 1,
            nestedBig: data.nested.big.toString(),
          });
        `);
        assert.deepStrictEqual(received, {
          dateYear: 2024,
          regexSource: "test",
          urlPath: "/",
          headerValue: "value",
          bufferLength: 3,
          nestedDateMonth: 6,
          nestedBig: "12345678901234567890",
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should marshal arguments from isolate to host", async () => {
      let receivedDate: unknown;
      let receivedUrl: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          processDate: {
            fn: (date: unknown) => {
              receivedDate = date;
              return (date as Date).toISOString();
            },
            type: "sync",
          },
          processUrl: {
            fn: (url: unknown) => {
              receivedUrl = url;
              return (url as URL).pathname;
            },
            type: "sync",
          },
          receiveResult: {
            fn: () => {},
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          const dateResult = processDate(new Date("2024-03-15T10:30:00Z"));
          const urlResult = processUrl(new URL("https://example.com/api/users?page=1"));
          receiveResult({ dateResult, urlResult });
        `);
        assert.ok(receivedDate instanceof Date);
        assert.strictEqual(
          (receivedDate as Date).toISOString(),
          "2024-03-15T10:30:00.000Z"
        );
        assert.ok(receivedUrl instanceof URL);
        assert.strictEqual((receivedUrl as URL).search, "?page=1");
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("callback returns from custom functions", () => {
    it("should handle function returned from custom function", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getMultiplier: {
            fn: ((factor: number) => (x: number) => x * factor) as (...args: unknown[]) => unknown,
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const double = getMultiplier(2);
            const triple = getMultiplier(3);
            receiveResult({
              doubled: await double(5),
              tripled: await triple(5),
            });
          })();
        `);
        assert.deepStrictEqual(received, { doubled: 10, tripled: 15 });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle multiple levels of function returns", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          createAdder: {
            fn: ((base: number) => (x: number) => (y: number) => base + x + y) as (...args: unknown[]) => unknown,
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const addFrom10 = createAdder(10);
            const add10Plus5 = await addFrom10(5);
            const result = await add10Plus5(3);
            receiveResult({ result });
          })();
        `);
        assert.deepStrictEqual(received, { result: 18 });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle async function returned from custom function", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getAsyncFetcher: {
            fn: ((prefix: string) => async (id: number) => {
              return `${prefix}-${id}`;
            }) as (...args: unknown[]) => unknown,
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const fetchUser = getAsyncFetcher("user");
            const result = await fetchUser(42);
            receiveResult({ result });
          })();
        `);
        assert.deepStrictEqual(received, { result: "user-42" });
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("nested async iterators", () => {
    it("should handle object with multiple async iterators", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getStreams: {
            fn: () => ({
              numbers: (async function* () {
                yield 1;
                yield 2;
                yield 3;
              })(),
              letters: (async function* () {
                yield "a";
                yield "b";
              })(),
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const streams = getStreams();
            const nums = [];
            const lets = [];
            for await (const n of streams.numbers) nums.push(n);
            for await (const l of streams.letters) lets.push(l);
            receiveResult({ nums, lets });
          })();
        `);
        assert.deepStrictEqual(received, { nums: [1, 2, 3], lets: ["a", "b"] });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle deeply nested async iterators", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getNestedStreams: {
            fn: () => ({
              level1: {
                level2: {
                  stream: (async function* () {
                    yield "deep1";
                    yield "deep2";
                  })(),
                },
              },
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const data = getNestedStreams();
            const values = [];
            for await (const v of data.level1.level2.stream) values.push(v);
            receiveResult({ values });
          })();
        `);
        assert.deepStrictEqual(received, { values: ["deep1", "deep2"] });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle async iterator yielding complex types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getComplexStream: {
            fn: () =>
              (async function* () {
                yield { date: new Date("2024-01-01"), value: 1 };
                yield { date: new Date("2024-02-01"), value: 2 };
              })(),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const stream = getComplexStream();
            const items = [];
            for await (const item of stream) {
              items.push({
                month: item.date.getMonth() + 1,
                value: item.value,
              });
            }
            receiveResult({ items });
          })();
        `);
        assert.deepStrictEqual(received, {
          items: [
            { month: 1, value: 1 },
            { month: 2, value: 2 },
          ],
        });
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("nested Promise refs", () => {
    it("should handle object with multiple promises", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getPromises: {
            fn: () => ({
              fast: Promise.resolve("quick"),
              slow: new Promise((r) => setTimeout(() => r("delayed"), 10)),
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const { fast, slow } = getPromises();
            receiveResult({ fast: await fast, slow: await slow });
          })();
        `);
        assert.deepStrictEqual(received, { fast: "quick", slow: "delayed" });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle deeply nested promises", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getNestedPromises: {
            fn: () => ({
              level1: {
                level2: {
                  promise: Promise.resolve("deep value"),
                },
              },
            }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const data = getNestedPromises();
            const value = await data.level1.level2.promise;
            receiveResult({ value });
          })();
        `);
        assert.deepStrictEqual(received, { value: "deep value" });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle promises resolving to complex types", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getPromiseOfComplex: {
            fn: () =>
              Promise.resolve({
                date: new Date("2024-06-15"),
                url: new URL("https://example.com/data"),
                buffer: new Uint8Array([10, 20, 30]),
              }),
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const data = await getPromiseOfComplex();
            receiveResult({
              dateMonth: data.date.getMonth() + 1,
              urlPath: data.url.pathname,
              bufferFirst: data.buffer[0],
            });
          })();
        `);
        assert.deepStrictEqual(received, {
          dateMonth: 6,
          urlPath: "/data",
          bufferFirst: 10,
        });
      } finally {
        await runtime.dispose();
      }
    });

    it("should handle array of promises", async () => {
      let received: unknown;
      const runtime = await client.createRuntime({
        customFunctions: {
          getPromiseArray: {
            fn: () => [
              Promise.resolve(1),
              Promise.resolve(2),
              Promise.resolve(3),
            ],
            type: "sync",
          },
          receiveResult: {
            fn: (result: unknown) => {
              received = result;
            },
            type: "sync",
          },
        },
      });

      try {
        await runtime.eval(`
          (async () => {
            const promises = getPromiseArray();
            const values = await Promise.all(promises);
            receiveResult({ values });
          })();
        `);
        assert.deepStrictEqual(received, { values: [1, 2, 3] });
      } finally {
        await runtime.dispose();
      }
    });
  });
});
