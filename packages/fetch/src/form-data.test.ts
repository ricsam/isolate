import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  createFetchTestContext,
  evalCode,
  runTestCode,
  type FetchTestContext,
} from "@ricsam/isolate-test-utils";

describe("FormData", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("append string value", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("name", "John Doe");
      formData.append("email", "john@example.com");

      JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        hasName: formData.has("name"),
      })
    `
    );
    const result = JSON.parse(data) as {
      name: string;
      email: string;
      hasName: boolean;
    };

    assert.strictEqual(result.name, "John Doe");
    assert.strictEqual(result.email, "john@example.com");
    assert.strictEqual(result.hasName, true);
  });

  test("forEach callback iterates entries", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("name", "John");
      formData.append("age", "30");
      formData.append("city", "NYC");

      const entries = [];
      formData.forEach((value, key) => {
        entries.push({ key, value });
      });

      JSON.stringify(entries)
    `
    );
    const entries = JSON.parse(data) as { key: string; value: string }[];

    assert.strictEqual(entries.length, 3);
    assert.deepStrictEqual(
      entries.map((e) => e.key),
      ["name", "age", "city"]
    );
    assert.deepStrictEqual(
      entries.map((e) => e.value),
      ["John", "30", "NYC"]
    );
  });

  test("FormData is iterable with for...of", () => {
    const result = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("name", "Alice");
      formData.append("age", "30");
      const entries = [];
      for (const [key, value] of formData) {
        entries.push([key, value]);
      }
      JSON.stringify(entries);
      `
    );
    const entries = JSON.parse(result) as string[][];

    assert.ok(entries.some(([k, v]) => k === "name" && v === "Alice"));
    assert.ok(entries.some(([k, v]) => k === "age" && v === "30"));
  });

  test("instanceof FormData returns true", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      JSON.stringify({ instanceofFormData: formData instanceof FormData })
      `
    );
    const result = JSON.parse(data) as { instanceofFormData: boolean };
    assert.strictEqual(result.instanceofFormData, true);
  });

  test("constructor.name is 'FormData'", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      JSON.stringify({ constructorName: formData.constructor.name })
      `
    );
    const result = JSON.parse(data) as { constructorName: string };
    assert.strictEqual(result.constructorName, "FormData");
  });

  test("getAll returns all values for a key", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("tags", "javascript");
      formData.append("tags", "typescript");
      formData.append("tags", "node");
      JSON.stringify({
        first: formData.get("tags"),
        all: formData.getAll("tags"),
      })
      `
    );
    const result = JSON.parse(data) as { first: string; all: string[] };

    assert.strictEqual(result.first, "javascript");
    assert.deepStrictEqual(result.all, ["javascript", "typescript", "node"]);
  });

  test("set replaces existing value", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("name", "John");
      formData.append("name", "Jane");
      formData.set("name", "Alice");
      JSON.stringify({
        name: formData.get("name"),
        all: formData.getAll("name"),
      })
      `
    );
    const result = JSON.parse(data) as { name: string; all: string[] };

    assert.strictEqual(result.name, "Alice");
    assert.deepStrictEqual(result.all, ["Alice"]);
  });

  test("delete removes all values for a key", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      formData.append("name", "John");
      formData.append("name", "Jane");
      formData.delete("name");
      JSON.stringify({
        hasName: formData.has("name"),
        name: formData.get("name"),
      })
      `
    );
    const result = JSON.parse(data) as { hasName: boolean; name: string | null };

    assert.strictEqual(result.hasName, false);
    assert.strictEqual(result.name, null);
  });

  test("handles File objects", () => {
    const data = evalCode<string>(
      ctx.context,
      `
      const formData = new FormData();
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });
      formData.append('file', file);
      const retrieved = formData.get('file');
      JSON.stringify({
        isFile: retrieved instanceof File,
        name: retrieved.name,
        type: retrieved.type
      })
      `
    );
    const result = JSON.parse(data) as {
      isFile: boolean;
      name: string;
      type: string;
    };

    assert.strictEqual(result.isFile, true);
    assert.strictEqual(result.name, "test.txt");
    assert.strictEqual(result.type, "text/plain");
  });
});

/**
 * Native FormData -> Isolate tests
 *
 * These tests verify that native FormData objects passed into the isolate
 * behave identically to FormData instances created with `new FormData()` in the isolate.
 */
describe("Native FormData -> Isolate", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("native FormData should pass instanceof check in isolate", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("name", "John");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      log("instanceof", formData instanceof FormData);
      log("constructorName", formData.constructor.name);
    `
    ).input({
      formData: nativeFormData,
    });

    assert.deepStrictEqual(runtime.logs, {
      instanceof: true,
      constructorName: "FormData",
    });
  });

  test("get() returns correct values", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("name", "John");
    nativeFormData.append("email", "john@example.com");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      log("name", formData.get("name"));
      log("email", formData.get("email"));
      log("missing", formData.get("missing"));
    `
    ).input({
      formData: nativeFormData,
    });

    assert.deepStrictEqual(runtime.logs, {
      name: "John",
      email: "john@example.com",
      missing: null,
    });
  });

  test("has() returns correct boolean", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("existing", "value");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      log("hasExisting", formData.has("existing"));
      log("hasMissing", formData.has("missing"));
    `
    ).input({
      formData: nativeFormData,
    });

    assert.deepStrictEqual(runtime.logs, {
      hasExisting: true,
      hasMissing: false,
    });
  });

  test("append() and set() work correctly", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("initial", "value");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      formData.append("added", "new-value");
      formData.set("initial", "updated-value");
      log("added", formData.get("added"));
      log("initial", formData.get("initial"));
    `
    ).input({
      formData: nativeFormData,
    });

    assert.deepStrictEqual(runtime.logs, {
      added: "new-value",
      initial: "updated-value",
    });
  });

  test("delete() removes entries", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("toDelete", "value");
    nativeFormData.append("toKeep", "value");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      log("beforeDelete", formData.has("toDelete"));
      formData.delete("toDelete");
      log("afterDelete", formData.has("toDelete"));
      log("kept", formData.has("toKeep"));
    `
    ).input({
      formData: nativeFormData,
    });

    assert.deepStrictEqual(runtime.logs, {
      beforeDelete: true,
      afterDelete: false,
      kept: true,
    });
  });

  test("entries() returns all entries", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("name", "Alice");
    nativeFormData.append("age", "30");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      log("entries", Array.from(formData.entries()));
    `
    ).input({
      formData: nativeFormData,
    });

    const entries = runtime.logs.entries as Array<[string, string]>;
    assert.ok(entries.some(([k, v]) => k === "name" && v === "Alice"));
    assert.ok(entries.some(([k, v]) => k === "age" && v === "30"));
  });

  test("for...of iteration works", () => {
    const nativeFormData = new FormData();
    nativeFormData.append("x", "1");
    nativeFormData.append("y", "2");

    const runtime = runTestCode(
      ctx.context,
      `
      const formData = testingInput.formData;
      const entries = [];
      for (const [key, value] of formData) {
        entries.push([key, value]);
      }
      log("entries", entries);
    `
    ).input({
      formData: nativeFormData,
    });

    const entries = runtime.logs.entries as Array<[string, string]>;
    assert.ok(entries.some(([k, v]) => k === "x" && v === "1"));
    assert.ok(entries.some(([k, v]) => k === "y" && v === "2"));
  });

  describe("Bidirectional Conversion (Native->Isolate->Native)", () => {
    test("FormData created in isolate should return as native FormData", () => {
      const runtime = runTestCode(
        ctx.context,
        `
        const formData = new FormData();
        formData.append("name", "John");
        formData.append("email", "john@example.com");
        log("formData", formData);
      `
      ).input({});

      assert.ok(runtime.logs.formData instanceof FormData);
      assert.strictEqual((runtime.logs.formData as FormData).get("name"), "John");
      assert.strictEqual(
        (runtime.logs.formData as FormData).get("email"),
        "john@example.com"
      );
    });

    test("native FormData passed through isolate returns as native FormData", () => {
      const nativeFormData = new FormData();
      nativeFormData.append("key1", "value1");
      nativeFormData.append("key2", "value2");

      const runtime = runTestCode(
        ctx.context,
        `
        const formData = testingInput.formData;
        log("formData", formData);
      `
      ).input({
        formData: nativeFormData,
      });

      assert.ok(runtime.logs.formData instanceof FormData);
      assert.strictEqual((runtime.logs.formData as FormData).get("key1"), "value1");
      assert.strictEqual((runtime.logs.formData as FormData).get("key2"), "value2");
    });

    test("modifications in isolate are preserved when returning as native FormData", () => {
      const nativeFormData = new FormData();
      nativeFormData.append("original", "value");

      const runtime = runTestCode(
        ctx.context,
        `
        const formData = testingInput.formData;
        formData.append("added", "newValue");
        formData.set("updated", "updatedValue");
        log("formData", formData);
      `
      ).input({
        formData: nativeFormData,
      });

      assert.ok(runtime.logs.formData instanceof FormData);
      const formData = runtime.logs.formData as FormData;
      assert.strictEqual(formData.get("original"), "value");
      assert.strictEqual(formData.get("added"), "newValue");
      assert.strictEqual(formData.get("updated"), "updatedValue");
    });

    test("nested object with FormData converts properly", () => {
      const nativeFormData = new FormData();
      nativeFormData.append("field", "test");

      const runtime = runTestCode(
        ctx.context,
        `
        const formData = testingInput.formData;
        log("result", {
          formData: formData,
          metadata: { submitted: true }
        });
      `
      ).input({
        formData: nativeFormData,
      });

      const result = runtime.logs.result as {
        formData: FormData;
        metadata: { submitted: boolean };
      };
      assert.ok(result.formData instanceof FormData);
      assert.strictEqual(result.formData.get("field"), "test");
      assert.deepStrictEqual(result.metadata, { submitted: true });
    });
  });
});
