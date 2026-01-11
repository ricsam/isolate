import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupFetch } from "./index.ts";

describe("@ricsam/isolate-fetch", () => {
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

  describe("Headers", () => {
    test("creates Headers with no arguments", async () => {
      // TODO: Implement test
    });

    test("creates Headers from object", async () => {
      // TODO: Implement test
    });

    test("get is case-insensitive", async () => {
      // TODO: Implement test
    });

    test("forEach iterates all headers", async () => {
      // TODO: Implement test
    });

    test("getSetCookie returns array", async () => {
      // TODO: Implement test
    });
  });

  describe("Request", () => {
    test("creates Request with URL string", async () => {
      // TODO: Implement test
    });

    test("creates Request with URL and init", async () => {
      // TODO: Implement test
    });

    test("has correct method", async () => {
      // TODO: Implement test
    });

    test("has correct headers", async () => {
      // TODO: Implement test
    });

    test("can read body as text", async () => {
      // TODO: Implement test
    });

    test("can read body as JSON", async () => {
      // TODO: Implement test
    });

    test("can read body as formData", async () => {
      // TODO: Implement test
    });
  });

  describe("Response", () => {
    test("creates Response with body", async () => {
      // TODO: Implement test
    });

    test("has correct status", async () => {
      // TODO: Implement test
    });

    test("has correct statusText", async () => {
      // TODO: Implement test
    });

    test("has correct headers", async () => {
      // TODO: Implement test
    });

    test("can read body as text", async () => {
      // TODO: Implement test
    });

    test("can read body as JSON", async () => {
      // TODO: Implement test
    });

    test("Response.json() static method", async () => {
      // TODO: Implement test
    });

    test("Response.redirect() static method", async () => {
      // TODO: Implement test
    });
  });

  describe("FormData", () => {
    test("creates empty FormData", async () => {
      // TODO: Implement test
    });

    test("append and get values", async () => {
      // TODO: Implement test
    });

    test("handles File objects", async () => {
      // TODO: Implement test
    });
  });

  describe("AbortController", () => {
    test("creates AbortController", async () => {
      // TODO: Implement test
    });

    test("signal starts not aborted", async () => {
      // TODO: Implement test
    });

    test("abort() sets signal.aborted to true", async () => {
      // TODO: Implement test
    });
  });

  describe("fetch function", () => {
    test("calls onFetch handler", async () => {
      // TODO: Implement test
    });

    test("returns Response from handler", async () => {
      // TODO: Implement test
    });

    test("supports abort signal", async () => {
      // TODO: Implement test
    });
  });
});
