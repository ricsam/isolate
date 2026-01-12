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

  describe("createStateMap", () => {
    test("returns a WeakMap", () => {
      // TODO: Implement test
      // const map = createStateMap();
      // assert.ok(map instanceof WeakMap);
    });
  });

  describe("getState and setState", () => {
    test("stores and retrieves state by handle", async () => {
      // TODO: Implement test
      // const handle = context.newObject();
      // const state = { value: 42 };
      //
      // setState(stateMap, handle, state);
      // const retrieved = getState(stateMap, handle);
      //
      // assert.strictEqual(retrieved, state);
      // assert.strictEqual(retrieved?.value, 42);
      // handle.dispose();
    });

    test("returns undefined for unknown handle", async () => {
      // TODO: Implement test
      // const handle = context.newObject();
      // const state = getState(stateMap, handle);
      //
      // assert.strictEqual(state, undefined);
      // handle.dispose();
    });
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

  describe("getInstanceState", () => {
    test("retrieves state from an instance handle", async () => {
      // TODO: Implement test
      // interface TestState {
      //   data: string;
      // }
      //
      // const TestClass = defineClass<TestState>(context, stateMap, {
      //   name: "TestClass",
      //   construct: () => ({ data: "hello" }),
      // });
      // context.setProp(context.global, "TestClass", TestClass);
      // TestClass.dispose();
      //
      // const result = context.evalCode(`new TestClass()`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create instance");
      // }
      //
      // const instanceHandle = result.value;
      // const state = getInstanceState<TestState>(context, instanceHandle);
      //
      // assert.ok(state);
      // assert.strictEqual(state?.data, "hello");
      // instanceHandle.dispose();
    });

    test("returns undefined for non-instance handles", async () => {
      // TODO: Implement test
      // const handle = context.newObject();
      // const state = getInstanceState(context, handle);
      //
      // assert.strictEqual(state, undefined);
      // handle.dispose();
    });
  });

  describe("cleanupInstanceState", () => {
    test("removes instance state by ID", async () => {
      // TODO: Implement test
      // const TestClass = defineClass(context, stateMap, {
      //   name: "CleanupTest",
      //   construct: () => ({ value: 123 }),
      // });
      // context.setProp(context.global, "CleanupTest", TestClass);
      // TestClass.dispose();
      //
      // const result = context.evalCode(`new CleanupTest()`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create instance");
      // }
      //
      // const instanceHandle = result.value;
      //
      // // Get the instance ID
      // const idHandle = context.getProp(instanceHandle, "__instanceId__");
      // const instanceId = context.getNumber(idHandle);
      // idHandle.dispose();
      //
      // // Verify state exists before cleanup
      // assert.ok(getInstanceState(context, instanceHandle));
      //
      // // Clean up
      // cleanupInstanceState(instanceId);
      //
      // // Verify state is gone
      // assert.strictEqual(getInstanceState(context, instanceHandle), undefined);
      //
      // instanceHandle.dispose();
    });
  });

  describe("clearAllInstanceState", () => {
    test("clears all instance states", async () => {
      // TODO: Implement test
      // const TestClass = defineClass(context, stateMap, {
      //   name: "ClearAllTest",
      //   construct: () => ({ value: 1 }),
      // });
      // context.setProp(context.global, "ClearAllTest", TestClass);
      // TestClass.dispose();
      //
      // // Create multiple instances
      // const result1 = context.evalCode(`new ClearAllTest()`);
      // const result2 = context.evalCode(`new ClearAllTest()`);
      //
      // if (result1.error) {
      //   result1.error.dispose();
      //   throw new Error("Failed to create instance 1");
      // }
      // if (result2.error) {
      //   result2.error.dispose();
      //   throw new Error("Failed to create instance 2");
      // }
      //
      // const handle1 = result1.value;
      // const handle2 = result2.value;
      //
      // // Verify states exist
      // assert.ok(getInstanceState(context, handle1));
      // assert.ok(getInstanceState(context, handle2));
      //
      // // Clear all
      // clearAllInstanceState();
      //
      // // Verify all states are gone
      // assert.strictEqual(getInstanceState(context, handle1), undefined);
      // assert.strictEqual(getInstanceState(context, handle2), undefined);
      //
      // handle1.dispose();
      // handle2.dispose();
    });
  });

  describe("inheritance (extends)", () => {
    test("child class extends parent class", async () => {
      // Define parent class
      defineClass(context, {
        name: "Animal",
        construct: () => ({ species: "unknown" }),
        methods: {
          speak: { fn: (state) => `I am a ${state.species}` },
        },
      });

      // Define child class
      defineClass(context, {
        name: "Dog",
        extends: "Animal",
        construct: () => ({ species: "dog", name: "Buddy" }),
        methods: {
          bark: { fn: (state) => `${state.name} says woof!` },
        },
      });

      const result = await context.eval(`
        const dog = new Dog();
        JSON.stringify({
          bark: dog.bark(),
          speak: dog.speak(),
          isAnimal: dog instanceof Animal,
          isDog: dog instanceof Dog,
        })
      `);

      const data = JSON.parse(result as string);
      assert.strictEqual(data.bark, "Buddy says woof!");
      assert.strictEqual(data.speak, "I am a dog");
      assert.strictEqual(data.isAnimal, true);
      assert.strictEqual(data.isDog, true);
    });

    test("child can override parent methods", async () => {
      defineClass(context, {
        name: "Base",
        construct: () => ({}),
        methods: {
          greet: { fn: () => "Hello from Base" },
        },
      });

      defineClass(context, {
        name: "Derived",
        extends: "Base",
        construct: () => ({}),
        methods: {
          greet: { fn: () => "Hello from Derived" },
        },
      });

      const result = await context.eval(`
        const d = new Derived();
        d.greet()
      `);

      assert.strictEqual(result, "Hello from Derived");
    });

    test("child inherits parent properties", async () => {
      defineClass(context, {
        name: "Parent",
        construct: () => ({ value: 42 }),
        properties: {
          value: { get: (state) => state.value },
        },
      });

      defineClass(context, {
        name: "Child",
        extends: "Parent",
        construct: () => ({ value: 100, extra: "child" }),
        properties: {
          extra: { get: (state) => state.extra },
        },
      });

      const result = await context.eval(`
        const c = new Child();
        JSON.stringify({ value: c.value, extra: c.extra })
      `);

      const data = JSON.parse(result as string);
      assert.strictEqual(data.value, 100);
      assert.strictEqual(data.extra, "child");
    });

    test("multiple instances of inherited class have independent state", async () => {
      defineClass(context, {
        name: "BaseCounter",
        construct: () => ({ count: 0 }),
        methods: {
          increment: { fn: (state) => ++state.count },
        },
      });

      defineClass(context, {
        name: "NamedCounter",
        extends: "BaseCounter",
        construct: () => ({ count: 0, name: "counter" }),
        properties: {
          name: { get: (state) => state.name },
        },
      });

      const result = await context.eval(`
        const c1 = new NamedCounter();
        const c2 = new NamedCounter();
        c1.increment();
        c1.increment();
        c2.increment();
        JSON.stringify({
          c1Count: c1.increment(),
          c2Count: c2.increment(),
        })
      `);

      const data = JSON.parse(result as string);
      assert.strictEqual(data.c1Count, 3);
      assert.strictEqual(data.c2Count, 2);
    });
  });
});
