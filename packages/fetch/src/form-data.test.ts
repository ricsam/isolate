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

/**
 * Multipart FormData Parsing and Serialization Tests
 */
describe("Multipart FormData", () => {
  let ctx: FetchTestContext;

  beforeEach(async () => {
    ctx = await createFetchTestContext();
  });

  afterEach(() => {
    ctx.dispose();
  });

  describe("Parsing", () => {
    test("parses multipart with text fields only", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const boundary = "----TestBoundary";
          const body = [
            "------TestBoundary\\r\\n",
            'Content-Disposition: form-data; name="field1"\\r\\n',
            "\\r\\n",
            "value1",
            "\\r\\n------TestBoundary\\r\\n",
            'Content-Disposition: form-data; name="field2"\\r\\n',
            "\\r\\n",
            "value2",
            "\\r\\n------TestBoundary--\\r\\n"
          ].join("");

          const response = new Response(body, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
          });
          const formData = await response.formData();
          return JSON.stringify({
            field1: formData.get('field1'),
            field2: formData.get('field2')
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as { field1: string; field2: string };
      assert.strictEqual(result.field1, "value1");
      assert.strictEqual(result.field2, "value2");
    });

    test("parses multipart with file fields - returns File instances", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const encoder = new TextEncoder();
          const body = encoder.encode([
            '------TestBoundary\\r\\n',
            'Content-Disposition: form-data; name="file"; filename="test.txt"\\r\\n',
            'Content-Type: text/plain\\r\\n',
            '\\r\\n',
            'Hello World',
            '\\r\\n------TestBoundary--\\r\\n'
          ].join(''));

          const response = new Response(body, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
          });
          const formData = await response.formData();
          const file = formData.get('file');

          return JSON.stringify({
            isFile: file instanceof File,
            name: file.name,
            type: file.type,
            size: file.size
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        isFile: boolean;
        name: string;
        type: string;
        size: number;
      };
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.name, "test.txt");
      assert.strictEqual(result.type, "text/plain");
      assert.strictEqual(result.size, 11);
    });

    test("File.text() works on parsed file", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const encoder = new TextEncoder();
          const body = encoder.encode([
            '------TestBoundary\\r\\n',
            'Content-Disposition: form-data; name="file"; filename="test.txt"\\r\\n',
            'Content-Type: text/plain\\r\\n',
            '\\r\\n',
            'File content here',
            '\\r\\n------TestBoundary--\\r\\n'
          ].join(''));

          const response = new Response(body, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
          });
          const formData = await response.formData();
          const file = formData.get('file');
          return await file.text();
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(data, "File content here");
    });

    test("parses multipart with mixed text and file fields", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const encoder = new TextEncoder();
          const body = encoder.encode([
            '------TestBoundary\\r\\n',
            'Content-Disposition: form-data; name="name"\\r\\n',
            '\\r\\n',
            'John Doe',
            '\\r\\n------TestBoundary\\r\\n',
            'Content-Disposition: form-data; name="avatar"; filename="photo.jpg"\\r\\n',
            'Content-Type: image/jpeg\\r\\n',
            '\\r\\n',
            'binary-image-data',
            '\\r\\n------TestBoundary--\\r\\n'
          ].join(''));

          const response = new Response(body, {
            headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
          });
          const formData = await response.formData();

          return JSON.stringify({
            name: formData.get('name'),
            isFile: formData.get('avatar') instanceof File,
            filename: formData.get('avatar').name,
            filetype: formData.get('avatar').type
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        name: string;
        isFile: boolean;
        filename: string;
        filetype: string;
      };
      assert.strictEqual(result.name, "John Doe");
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.filename, "photo.jpg");
      assert.strictEqual(result.filetype, "image/jpeg");
    });
  });

  describe("Serialization", () => {
    test("serializes FormData with File as multipart", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const file = new File(["test content"], "test.txt", { type: "text/plain" });
          const formData = new FormData();
          formData.append("file", file);
          formData.append("name", "John");

          const { body, contentType } = __serializeFormData(formData);
          const text = new TextDecoder().decode(body);

          return JSON.stringify({
            hasBoundary: contentType.includes('boundary='),
            hasFilename: text.includes('filename="test.txt"'),
            hasFileContent: text.includes('test content'),
            hasName: text.includes('name="name"'),
            hasJohn: text.includes('John')
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        hasBoundary: boolean;
        hasFilename: boolean;
        hasFileContent: boolean;
        hasName: boolean;
        hasJohn: boolean;
      };
      assert.strictEqual(result.hasBoundary, true);
      assert.strictEqual(result.hasFilename, true);
      assert.strictEqual(result.hasFileContent, true);
      assert.strictEqual(result.hasName, true);
      assert.strictEqual(result.hasJohn, true);
    });

    test("Request with FormData + File uses multipart Content-Type", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const file = new File(["uploaded content"], "upload.txt", { type: "text/plain" });
          const formData = new FormData();
          formData.append("file", file);

          const request = new Request("http://test/upload", {
            method: "POST",
            body: formData
          });

          const contentType = request.headers.get('content-type');
          return JSON.stringify({
            isMultipart: contentType.includes('multipart/form-data'),
            hasBoundary: contentType.includes('boundary=')
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        isMultipart: boolean;
        hasBoundary: boolean;
      };
      assert.strictEqual(result.isMultipart, true);
      assert.strictEqual(result.hasBoundary, true);
    });

    test("Request with string-only FormData uses url-encoded", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const formData = new FormData();
          formData.append("name", "John");
          formData.append("email", "john@example.com");

          const request = new Request("http://test/submit", {
            method: "POST",
            body: formData
          });

          return request.headers.get('content-type');
        })()
        `,
        { promise: true }
      );

      assert.strictEqual(data, "application/x-www-form-urlencoded");
    });
  });

  describe("Round-trip", () => {
    test("serialize then parse recovers original data", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          // Create original FormData with file and text
          const originalFile = new File(["Hello, World!"], "greeting.txt", { type: "text/plain" });
          const originalFormData = new FormData();
          originalFormData.append("message", "Test message");
          originalFormData.append("attachment", originalFile);

          // Serialize to multipart
          const { body, contentType } = __serializeFormData(originalFormData);

          // Parse it back
          const response = new Response(body, {
            headers: { 'Content-Type': contentType }
          });
          const parsedFormData = await response.formData();

          // Check values
          const parsedFile = parsedFormData.get('attachment');
          const parsedFileContent = await parsedFile.text();

          return JSON.stringify({
            message: parsedFormData.get('message'),
            isFile: parsedFile instanceof File,
            filename: parsedFile.name,
            filetype: parsedFile.type,
            fileContent: parsedFileContent
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        message: string;
        isFile: boolean;
        filename: string;
        filetype: string;
        fileContent: string;
      };
      assert.strictEqual(result.message, "Test message");
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.filename, "greeting.txt");
      assert.strictEqual(result.filetype, "text/plain");
      assert.strictEqual(result.fileContent, "Hello, World!");
    });

    test("handles Blob entries in FormData", async () => {
      const data = await ctx.context.eval(
        `
        (async () => {
          const blob = new Blob(["blob content"], { type: "application/octet-stream" });
          const formData = new FormData();
          formData.append("data", blob);

          // Serialize and parse back
          const { body, contentType } = __serializeFormData(formData);
          const response = new Response(body, {
            headers: { 'Content-Type': contentType }
          });
          const parsedFormData = await response.formData();

          const parsedBlob = parsedFormData.get('data');
          const content = await parsedBlob.text();

          return JSON.stringify({
            isFile: parsedBlob instanceof File,
            filename: parsedBlob.name,
            content: content
          });
        })()
        `,
        { promise: true }
      );

      const result = JSON.parse(data as string) as {
        isFile: boolean;
        filename: string;
        content: string;
      };
      // Blob is serialized as File with default name "blob"
      assert.strictEqual(result.isFile, true);
      assert.strictEqual(result.filename, "blob");
      assert.strictEqual(result.content, "blob content");
    });
  });
});
