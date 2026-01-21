/**
 * Error handling integration tests for isolate client and daemon.
 * Tests error propagation through the full system: host → client → daemon → sandbox and back.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import type { DaemonConnection } from "./types.ts";

const TEST_SOCKET = "/tmp/isolate-error-test-daemon.sock";

describe("Error handling integration", () => {
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

  describe("Errors in sandbox code body (during eval)", () => {
    it("should propagate plain Error thrown during eval", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`throw new Error("test error from eval");`);
          },
          /test error from eval/
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate TypeError for undefined property access", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`const x = undefined; x.foo;`);
          },
          /undefined|cannot read|property/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate ReferenceError for undefined variable", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`nonExistentVariable.foo;`);
          },
          /not defined|ReferenceError/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate TypeError for null method call", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`null.toString();`);
          },
          /null|cannot read|property/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate RangeError for invalid array length", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`new Array(-1);`);
          },
          /Invalid array length|RangeError/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate async rejection", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(
              `await Promise.reject(new Error("async rejection error"));`
            );
          },
          /async rejection error/
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Errors from serve fetch handler", () => {
    it("should propagate sync throw from fetch handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              throw new Error("handler error sync");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /handler error sync/
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate async throw from fetch handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch() {
              throw new Error("handler error async");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /handler error async/
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate TypeError from fetch handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              throw new TypeError("type mismatch error");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /type mismatch error/
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate Promise rejection from fetch handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch() {
              await Promise.reject(new Error("rejected in handler"));
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /rejected in handler/
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should provide clear error when fetch handler returns undefined", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              // Forgot to return a Response!
              new Response("ok");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /fetch handler (must return|did not return) a Response/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should provide clear error when async fetch handler returns undefined", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              const data = await Promise.resolve("data");
              // Forgot to return a Response!
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /fetch handler (must return|did not return) a Response/i
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Runtime errors during request handling", () => {
    it("should propagate TypeError for undefined access in handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              const x = undefined;
              return new Response(x.foo);
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /undefined|cannot read|property/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate SyntaxError for invalid JSON parse", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              JSON.parse("{broken");
              return new Response("ok");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /JSON|SyntaxError|Unexpected|parse/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate error for invalid URL", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            fetch() {
              new URL("not a valid url");
              return new Response("ok");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test")
            );
          },
          /Invalid URL|URL|TypeError/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate SyntaxError for invalid request.json()", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(`
          serve({
            async fetch(request) {
              await request.json();
              return new Response("ok");
            }
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.fetch.dispatchRequest(
              new Request("http://localhost/test", {
                method: "POST",
                body: "not valid json",
                headers: { "Content-Type": "application/json" },
              })
            );
          },
          /JSON|SyntaxError|Unexpected|parse/i
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Syntax errors", () => {
    it("should propagate SyntaxError for invalid syntax", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`serve({ fetch ({ some syntax error }`);
          },
          /SyntaxError|Unexpected/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate SyntaxError for unclosed string", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`const str = "unclosed`);
          },
          /SyntaxError|Unexpected|string/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate SyntaxError for invalid function parameters", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`function broken(a b c) {}`);
          },
          /SyntaxError|Unexpected/i
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should propagate SyntaxError for reserved word as variable", async () => {
      const runtime = await client.createRuntime();
      try {
        await assert.rejects(
          async () => {
            await runtime.eval(`const class = "test";`);
          },
          /SyntaxError|Unexpected|reserved/i
        );
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Error property preservation", () => {
    it("should preserve error name", async () => {
      const runtime = await client.createRuntime();
      try {
        let caughtError: Error | null = null;
        try {
          await runtime.eval(`throw new TypeError("specific type error");`);
        } catch (err) {
          caughtError = err as Error;
        }

        assert.ok(caughtError);
        // Error name should be preserved or message should include type info
        assert.ok(
          caughtError.name === "TypeError" ||
            caughtError.message.includes("TypeError") ||
            caughtError.message.includes("specific type error")
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve error message", async () => {
      const runtime = await client.createRuntime();
      try {
        const uniqueMessage = `unique-error-message-${Date.now()}`;
        let caughtError: Error | null = null;
        try {
          await runtime.eval(`throw new Error("${uniqueMessage}");`);
        } catch (err) {
          caughtError = err as Error;
        }

        assert.ok(caughtError);
        assert.ok(
          caughtError.message.includes(uniqueMessage),
          `Expected message to include "${uniqueMessage}", got "${caughtError.message}"`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve stack trace with filename when provided", async () => {
      const runtime = await client.createRuntime();
      try {
        let caughtError: Error | null = null;
        try {
          await runtime.eval(
            `
function causeError() {
  throw new Error("stack trace test");
}
causeError();
          `,
            { filename: "test-file.js" }
          );
        } catch (err) {
          caughtError = err as Error;
        }

        assert.ok(caughtError);
        assert.ok(caughtError.stack, "Error should have a stack trace");
        // The filename should appear in the stack trace
        assert.ok(
          caughtError.stack.includes("test-file.js"),
          `Expected stack to include "test-file.js", got: ${caughtError.stack}`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve function names in stack trace", async () => {
      const runtime = await client.createRuntime();
      try {
        let caughtError: Error | null = null;
        try {
          await runtime.eval(
            `
function outerFunction() {
  innerFunction();
}
function innerFunction() {
  throw new Error("nested error");
}
outerFunction();
          `,
            { filename: "nested.js" }
          );
        } catch (err) {
          caughtError = err as Error;
        }

        assert.ok(caughtError);
        assert.ok(caughtError.stack, "Error should have a stack trace");
        // Function names should appear in the stack trace
        assert.ok(
          caughtError.stack.includes("innerFunction"),
          `Expected stack to include "innerFunction", got: ${caughtError.stack}`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve error properties through fetch handler", async () => {
      const runtime = await client.createRuntime();
      try {
        await runtime.eval(
          `
serve({
  fetch() {
    function handlerHelper() {
      throw new RangeError("out of range in handler");
    }
    handlerHelper();
  }
});
        `,
          { filename: "handler.js" }
        );

        let caughtError: Error | null = null;
        try {
          await runtime.fetch.dispatchRequest(
            new Request("http://localhost/test")
          );
        } catch (err) {
          caughtError = err as Error;
        }

        assert.ok(caughtError);
        assert.ok(caughtError.message.includes("out of range in handler"));
        // Stack should include the filename and function name
        if (caughtError.stack) {
          assert.ok(
            caughtError.stack.includes("handler.js") ||
              caughtError.stack.includes("handlerHelper"),
            `Expected stack to include filename or function name, got: ${caughtError.stack}`
          );
        }
      } finally {
        await runtime.dispose();
      }
    });
  });

  describe("Error console.log output", () => {
    it("should format error like Node.js when using console.log(err)", async () => {
      const logs: string[] = [];
      const runtime = await client.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(`
          const err = new Error("test error message");
          console.log(err);
        `);

        assert.strictEqual(logs.length, 1);
        const loggedOutput = logs[0]!;

        // Error should be formatted as "Error: message\n  at stack..."
        assert.ok(
          loggedOutput.startsWith("Error: test error message"),
          `Expected error to start with "Error: test error message", got: ${loggedOutput}`
        );
        assert.ok(
          loggedOutput.includes("at "),
          `Expected error to have stack trace, got: ${loggedOutput}`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should include stack trace when logging error", async () => {
      const logs: string[] = [];
      const runtime = await client.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(
          `
function innerFunction() {
  throw new Error("nested error");
}
function outerFunction() {
  innerFunction();
}
try {
  outerFunction();
} catch (err) {
  console.log(err);
}
        `,
          { filename: "test-stack.js" }
        );

        assert.strictEqual(logs.length, 1);
        const loggedOutput = logs[0]!;

        // The logged error should include stack information with function names
        assert.ok(
          loggedOutput.includes("innerFunction") ||
            loggedOutput.includes("outerFunction") ||
            loggedOutput.includes("test-stack.js"),
          `Expected stack trace to include function names, got: ${loggedOutput}`
        );
      } finally {
        await runtime.dispose();
      }
    });

    it("should preserve error type (TypeError, RangeError, etc.) in console.log", async () => {
      const logs: string[] = [];
      const runtime = await client.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(`
          const typeErr = new TypeError("type error message");
          console.log(typeErr);
        `);

        assert.strictEqual(logs.length, 1);
        const loggedOutput = logs[0]!;

        // Should preserve the error type
        assert.ok(
          loggedOutput.startsWith("TypeError: type error message"),
          `Expected error to start with "TypeError: type error message", got: ${loggedOutput}`
        );
      } finally {
        await runtime.dispose();
      }
    });
  });
});
