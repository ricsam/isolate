import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { defineClass, clearAllInstanceState } from "./index.ts";

describe("class-builder", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("defineClass", () => {
    describe("basic class creation", () => {
      test("creates a class that can be instantiated", async () => {
        defineClass(context, {
          name: "TestClass",
          construct: () => ({ created: true }),
        });

        const result = await context.eval(`
          const instance = new TestClass();
          instance instanceof TestClass
        `);
        assert.strictEqual(result, true);
      });

      test("passes constructor arguments", async () => {
        defineClass(context, {
          name: "ArgsClass",
          construct: (args) => ({ value: args[0] }),
          properties: {
            value: { get: (state) => state.value },
          },
        });

        const result = await context.eval(`
          const instance = new ArgsClass(42);
          instance.value
        `);
        assert.strictEqual(result, 42);
      });
    });

    describe("methods", () => {
      test("defines instance methods", async () => {
        defineClass(context, {
          name: "MethodClass",
          construct: () => ({ count: 0 }),
          methods: {
            increment: { fn: (state) => ++state.count },
            getCount: { fn: (state) => state.count },
          },
        });

        const result = await context.eval(`
          const instance = new MethodClass();
          instance.increment();
          instance.increment();
          instance.getCount()
        `);
        assert.strictEqual(result, 2);
      });

      test("methods receive arguments", async () => {
        defineClass(context, {
          name: "ArgsMethodClass",
          construct: () => ({ value: 0 }),
          methods: {
            add: { fn: (state, amount: unknown) => (state.value += amount as number) },
            getValue: { fn: (state) => state.value },
          },
        });

        const result = await context.eval(`
          const instance = new ArgsMethodClass();
          instance.add(5);
          instance.add(3);
          instance.getValue()
        `);
        assert.strictEqual(result, 8);
      });
    });

    describe("properties", () => {
      test("defines getter properties", async () => {
        defineClass(context, {
          name: "GetterClass",
          construct: () => ({ name: "test" }),
          properties: {
            name: { get: (state) => state.name },
          },
        });

        const result = await context.eval(`
          const instance = new GetterClass();
          instance.name
        `);
        assert.strictEqual(result, "test");
      });

      test("defines setter properties", async () => {
        defineClass(context, {
          name: "SetterClass",
          construct: () => ({ value: 0 }),
          properties: {
            value: {
              get: (state) => state.value,
              set: (state, val) => {
                state.value = val as number;
              },
            },
          },
        });

        const result = await context.eval(`
          const instance = new SetterClass();
          instance.value = 100;
          instance.value
        `);
        assert.strictEqual(result, 100);
      });
    });

    describe("static methods", () => {
      test("defines static methods", async () => {
        defineClass(context, {
          name: "StaticMethodClass",
          staticMethods: {
            create: { fn: () => "created" },
          },
        });

        const result = await context.eval(`
          StaticMethodClass.create()
        `);
        assert.strictEqual(result, "created");
      });
    });

    describe("static properties", () => {
      test("defines static properties", async () => {
        defineClass(context, {
          name: "StaticPropClass",
          staticProperties: {
            VERSION: "1.0.0",
          },
        });

        const result = await context.eval(`
          StaticPropClass.VERSION
        `);
        assert.strictEqual(result, "1.0.0");
      });
    });

    describe("async methods", () => {
      test("methods can return promises", async () => {
        defineClass(context, {
          name: "AsyncClass",
          construct: () => ({}),
          methods: {
            fetchData: {
              fn: async () => {
                await new Promise((r) => setTimeout(r, 10));
                return "async data";
              },
              async: true,
            },
          },
        });

        const result = await context.eval(`
          (async () => {
            const instance = new AsyncClass();
            return await instance.fetchData();
          })()
        `, { promise: true });
        assert.strictEqual(result, "async data");
      });
    });
  });

  describe("multiple instances", () => {
    test("each instance has independent state", async () => {
      defineClass(context, {
        name: "CounterClass",
        construct: () => ({ count: 0 }),
        methods: {
          increment: { fn: (state) => ++state.count },
          getCount: { fn: (state) => state.count },
        },
      });

      const result = await context.eval(`
        const a = new CounterClass();
        const b = new CounterClass();
        a.increment();
        a.increment();
        a.increment();
        b.increment();
        JSON.stringify({ a: a.getCount(), b: b.getCount() })
      `);
      const parsed = JSON.parse(result as string);
      assert.strictEqual(parsed.a, 3);
      assert.strictEqual(parsed.b, 1);
    });
  });

  describe("error type preservation", () => {
    test("preserves TypeError from constructor", async () => {
      defineClass(context, {
        name: "TypeErrorClass",
        construct: () => {
          throw new TypeError("type error in constructor");
        },
      });

      const result = await context.eval(`
        try {
          new TypeErrorClass();
          "no error";
        } catch (e) {
          e instanceof TypeError ? "TypeError" : e.constructor.name;
        }
      `);
      assert.strictEqual(result, "TypeError");
    });

    test("preserves RangeError from method", async () => {
      defineClass(context, {
        name: "RangeErrorClass",
        construct: () => ({}),
        methods: {
          throwRange: {
            fn: () => {
              throw new RangeError("range error");
            },
          },
        },
      });

      const result = await context.eval(`
        try {
          const instance = new RangeErrorClass();
          instance.throwRange();
          "no error";
        } catch (e) {
          e instanceof RangeError ? "RangeError" : e.constructor.name;
        }
      `);
      assert.strictEqual(result, "RangeError");
    });

    test("preserves SyntaxError from method", async () => {
      defineClass(context, {
        name: "SyntaxErrorClass",
        construct: () => ({}),
        methods: {
          throwSyntax: {
            fn: () => {
              throw new SyntaxError("syntax error");
            },
          },
        },
      });

      const result = await context.eval(`
        try {
          const instance = new SyntaxErrorClass();
          instance.throwSyntax();
          "no error";
        } catch (e) {
          e instanceof SyntaxError ? "SyntaxError" : e.constructor.name;
        }
      `);
      assert.strictEqual(result, "SyntaxError");
    });

    test("preserves ReferenceError from getter", async () => {
      defineClass(context, {
        name: "ReferenceErrorClass",
        construct: () => ({}),
        properties: {
          value: {
            get: () => {
              throw new ReferenceError("reference error");
            },
          },
        },
      });

      const result = await context.eval(`
        try {
          const instance = new ReferenceErrorClass();
          instance.value;
          "no error";
        } catch (e) {
          e instanceof ReferenceError ? "ReferenceError" : e.constructor.name;
        }
      `);
      assert.strictEqual(result, "ReferenceError");
    });

    test("falls back to Error for unknown error types", async () => {
      defineClass(context, {
        name: "CustomErrorClass",
        construct: () => ({}),
        methods: {
          throwCustom: {
            fn: () => {
              const err = new Error("custom error");
              err.name = "CustomError";
              throw err;
            },
          },
        },
      });

      const result = await context.eval(`
        try {
          const instance = new CustomErrorClass();
          instance.throwCustom();
          "no error";
        } catch (e) {
          e instanceof Error ? "Error" : "not Error";
        }
      `);
      assert.strictEqual(result, "Error");
    });

    test("preserves error message", async () => {
      defineClass(context, {
        name: "MessageErrorClass",
        construct: () => ({}),
        methods: {
          throwWithMessage: {
            fn: () => {
              throw new Error("specific error message");
            },
          },
        },
      });

      const result = await context.eval(`
        try {
          const instance = new MessageErrorClass();
          instance.throwWithMessage();
          "no error";
        } catch (e) {
          e.message;
        }
      `);
      assert.strictEqual(result, "specific error message");
    });
  });
});
