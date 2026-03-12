import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState, cleanupUnmarshaledHandles } from "./index.ts";

describe("DOMParser", () => {
  let isolate: ivm.Isolate;
  let context: ivm.Context;

  beforeEach(async () => {
    isolate = new ivm.Isolate();
    context = await isolate.createContext();
    clearAllInstanceState();
  });

  afterEach(() => {
    cleanupUnmarshaledHandles(context);
    context.release();
    isolate.dispose();
  });

  test("is injected and constructible", async () => {
    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const parser = new DOMParser();
        return JSON.stringify({
          domParserType: typeof DOMParser,
          isInstance: parser instanceof DOMParser
        });
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.domParserType, "function");
    assert.strictEqual(parsed.isInstance, true);
  });

  test("parses text/html and exposes DOM constructors coherently", async () => {
    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
          '<!doctype html><html><body><div id="greet">hello</div></body></html>',
          'text/html'
        );
        return JSON.stringify({
          text: doc.querySelector('#greet')?.textContent,
          isDocument: doc instanceof Document,
          isNode: doc.documentElement instanceof Node,
          isElement: doc.documentElement instanceof Element,
          hasEventTarget: typeof EventTarget === 'function',
          hasCustomEvent: typeof CustomEvent === 'function'
        });
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.text, "hello");
    assert.strictEqual(parsed.isDocument, true);
    assert.strictEqual(parsed.isNode, true);
    assert.strictEqual(parsed.isElement, true);
    assert.strictEqual(parsed.hasEventTarget, true);
    assert.strictEqual(parsed.hasCustomEvent, true);
  });

  test("parses application/xml", async () => {
    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const parser = new DOMParser();
        const doc = parser.parseFromString('<root><item>1</item></root>', 'application/xml');
        return JSON.stringify({
          root: doc.documentElement.nodeName,
          value: doc.getElementsByTagName('item')[0]?.textContent
        });
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.root, "root");
    assert.strictEqual(parsed.value, "1");
  });

  test("coalesces XML text nodes from entity-heavy content", async () => {
    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const parser = new DOMParser();
        const doc = parser.parseFromString('<ETag>&quot;abc123&quot;</ETag>', 'application/xml');
        const etag = doc.documentElement;
        return JSON.stringify({
          childCount: etag.childNodes.length,
          textContent: etag.textContent
        });
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.childCount, 1);
    assert.strictEqual(parsed.textContent, '"abc123"');
  });

  test("throws TypeError for invalid MIME type", async () => {
    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const parser = new DOMParser();
        try {
          parser.parseFromString('<root/>', 'invalid/type');
          return JSON.stringify({ didThrow: false });
        } catch (e) {
          return JSON.stringify({
            didThrow: true,
            name: e.name,
            isTypeError: e instanceof TypeError
          });
        }
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.didThrow, true);
    assert.strictEqual(parsed.name, "TypeError");
    assert.strictEqual(parsed.isTypeError, true);
  });

  test("can disable DOMParser injection", async () => {
    await setupCore(context, { domParser: false });

    const result = await context.eval(`typeof DOMParser`);
    assert.strictEqual(result, "undefined");
  });

  test("setupCore can be called repeatedly without reinitializing DOMParser", async () => {
    await setupCore(context);
    await context.eval(`globalThis.__firstDOMParser = DOMParser;`);

    await setupCore(context);

    const result = await context.eval(`
      (() => {
        const doc = new DOMParser().parseFromString('<root><item>x</item></root>', 'application/xml');
        const sameConstructor = DOMParser === globalThis.__firstDOMParser;
        delete globalThis.__firstDOMParser;
        return JSON.stringify({
          sameConstructor,
          value: doc.getElementsByTagName('item')[0]?.textContent
        });
      })()
    `);
    const parsed = JSON.parse(result as string);

    assert.strictEqual(parsed.sameConstructor, true);
    assert.strictEqual(parsed.value, "x");
  });
});
