import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";

describe("class-helpers", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
  });

  afterEach(() => {
    context.release();
    isolate.dispose();
  });

  describe("isDefineClassInstance", () => {
    test("returns true for unmarshalled defineClass instances", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // interface PointState {
      //   x: number;
      //   y: number;
      // }
      //
      // const PointClass = defineClass<PointState>(context, stateMap, {
      //   name: "Point",
      //   construct: (args) => ({
      //     x: Number(args[0] ?? 0),
      //     y: Number(args[1] ?? 0),
      //   }),
      //   properties: {
      //     x: {
      //       get(this: PointState) {
      //         return this.x;
      //       },
      //     },
      //     y: {
      //       get(this: PointState) {
      //         return this.y;
      //       },
      //     },
      //   },
      // });
      // context.setProp(context.global, "Point", PointClass);
      // PointClass.dispose();
      //
      // const result = context.evalCode(`new Point(10, 20)`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create Point");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // assert.strictEqual(isDefineClassInstance(unmarshalled), true);
    });

    test("returns false for plain objects", async () => {
      // TODO: Implement test
      // assert.strictEqual(isDefineClassInstance({ foo: "bar" }), false);
      // assert.strictEqual(isDefineClassInstance(null), false);
      // assert.strictEqual(isDefineClassInstance(undefined), false);
      // assert.strictEqual(isDefineClassInstance(42), false);
      // assert.strictEqual(isDefineClassInstance("string"), false);
    });

    test("returns false for objects with only some properties", async () => {
      // TODO: Implement test
      // assert.strictEqual(isDefineClassInstance({ __instanceId__: 1 }), false);
      // assert.strictEqual(isDefineClassInstance({ __className__: "Test" }), false);
      // assert.strictEqual(
      //   isDefineClassInstance({ __instanceId__: 1, __className__: "Test" }),
      //   false
      // );
    });
  });

  describe("isInstanceOf", () => {
    test("returns true when className matches", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // interface TestState {
      //   value: string;
      // }
      //
      // const TestClass = defineClass<TestState>(context, stateMap, {
      //   name: "TestClass",
      //   construct: () => ({ value: "test" }),
      // });
      // context.setProp(context.global, "TestClass", TestClass);
      // TestClass.dispose();
      //
      // const result = context.evalCode(`new TestClass()`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create TestClass");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // assert.strictEqual(isInstanceOf(unmarshalled, "TestClass"), true);
      // assert.strictEqual(isInstanceOf(unmarshalled, "OtherClass"), false);
    });

    test("returns false for non-defineClass values", async () => {
      // TODO: Implement test
      // assert.strictEqual(isInstanceOf({ foo: "bar" }, "TestClass"), false);
      // assert.strictEqual(isInstanceOf(null, "TestClass"), false);
    });
  });

  describe("getClassInstanceState", () => {
    test("retrieves the internal state of a defineClass instance", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // interface CounterState {
      //   count: number;
      //   name: string;
      // }
      //
      // const CounterClass = defineClass<CounterState>(context, stateMap, {
      //   name: "Counter",
      //   construct: (args) => ({
      //     count: Number(args[0] ?? 0),
      //     name: String(args[1] ?? "default"),
      //   }),
      //   methods: {
      //     increment(this: CounterState) {
      //       this.count++;
      //       return this.count;
      //     },
      //   },
      //   properties: {
      //     count: {
      //       get(this: CounterState) {
      //         return this.count;
      //       },
      //     },
      //     name: {
      //       get(this: CounterState) {
      //         return this.name;
      //       },
      //     },
      //   },
      // });
      // context.setProp(context.global, "Counter", CounterClass);
      // CounterClass.dispose();
      //
      // const result = context.evalCode(`new Counter(5, "myCounter")`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create Counter");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // const state = getClassInstanceState<CounterState>(unmarshalled);
      // assert.ok(state);
      // assert.strictEqual(state?.count, 5);
      // assert.strictEqual(state?.name, "myCounter");
    });

    test("returns undefined for non-defineClass values", async () => {
      // TODO: Implement test
      // assert.strictEqual(getClassInstanceState({ foo: "bar" }), undefined);
      // assert.strictEqual(getClassInstanceState(null), undefined);
    });
  });

  describe("getInstanceId", () => {
    test("returns the instance ID of a defineClass instance", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // const SimpleClass = defineClass(context, stateMap, {
      //   name: "Simple",
      //   construct: () => ({}),
      // });
      // context.setProp(context.global, "Simple", SimpleClass);
      // SimpleClass.dispose();
      //
      // const result = context.evalCode(`new Simple()`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create Simple");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // const id = getInstanceId(unmarshalled);
      // assert.strictEqual(typeof id, "number");
      // assert.ok(id > 0);
    });

    test("returns undefined for non-defineClass values", async () => {
      // TODO: Implement test
      // assert.strictEqual(getInstanceId({ foo: "bar" }), undefined);
    });
  });

  describe("getClassName", () => {
    test("returns the class name of a defineClass instance", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // const NamedClass = defineClass(context, stateMap, {
      //   name: "NamedClass",
      //   construct: () => ({}),
      // });
      // context.setProp(context.global, "NamedClass", NamedClass);
      // NamedClass.dispose();
      //
      // const result = context.evalCode(`new NamedClass()`);
      // if (result.error) {
      //   result.error.dispose();
      //   throw new Error("Failed to create NamedClass");
      // }
      //
      // const unmarshalled = unmarshal(context, result.value);
      // result.value.dispose();
      //
      // assert.strictEqual(getClassName(unmarshalled), "NamedClass");
    });

    test("returns undefined for non-defineClass values", async () => {
      // TODO: Implement test
      // assert.strictEqual(getClassName({ foo: "bar" }), undefined);
    });
  });

  describe("cross-class state access", () => {
    test("can access state from one class instance passed to another", async () => {
      // TODO: Implement test
      // const stateMap = createStateMap();
      //
      // interface FileState {
      //   name: string;
      //   data: Uint8Array;
      //   type: string;
      // }
      //
      // interface FormDataState {
      //   entries: Array<{ name: string; value: unknown }>;
      // }
      //
      // // Simulate File class
      // const FileClass = defineClass<FileState>(context, stateMap, {
      //   name: "File",
      //   construct: (args) => ({
      //     name: String(args[1] ?? "unnamed"),
      //     data: args[0] as Uint8Array ?? new Uint8Array(),
      //     type: (args[2] as { type?: string })?.type ?? "application/octet-stream",
      //   }),
      //   properties: {
      //     name: {
      //       get(this: FileState) {
      //         return this.name;
      //       },
      //     },
      //   },
      // });
      // context.setProp(context.global, "File", FileClass);
      // FileClass.dispose();
      //
      // // Simulate FormData class that receives File instances
      // const FormDataClass = defineClass<FormDataState>(context, stateMap, {
      //   name: "FormData",
      //   construct: () => ({ entries: [] }),
      //   methods: {
      //     append(this: FormDataState, name: unknown, value: unknown) {
      //       // When File is passed, it's unmarshalled with class identity preserved
      //       if (isInstanceOf(value, "File")) {
      //         const fileState = getClassInstanceState<FileState>(value);
      //         if (fileState) {
      //           this.entries.push({
      //             name: String(name),
      //             value: {
      //               filename: fileState.name,
      //               data: fileState.data,
      //               type: fileState.type,
      //             },
      //           });
      //           return;
      //         }
      //       }
      //       this.entries.push({ name: String(name), value: String(value) });
      //     },
      //     getEntries(this: FormDataState) {
      //       return this.entries;
      //     },
      //   },
      // });
      // context.setProp(context.global, "FormData", FormDataClass);
      // FormDataClass.dispose();
      //
      // // Test: Create File, pass to FormData, verify state was accessed
      // const result = context.evalCode(`
      //   const file = new File(null, "test.txt", { type: "text/plain" });
      //   const fd = new FormData();
      //   fd.append("myFile", file);
      //   fd.getEntries();
      // `);
      //
      // if (result.error) {
      //   const error = context.dump(result.error);
      //   result.error.dispose();
      //   throw new Error(`Eval failed: ${JSON.stringify(error)}`);
      // }
      //
      // const entries = unmarshal(context, result.value) as Array<{
      //   name: string;
      //   value: { filename: string; type: string };
      // }>;
      // result.value.dispose();
      //
      // assert.strictEqual(entries.length, 1);
      // assert.strictEqual(entries[0].name, "myFile");
      // assert.strictEqual(entries[0].value.filename, "test.txt");
      // assert.strictEqual(entries[0].value.type, "text/plain");
    });
  });
});
