import ivm from "isolated-vm";
import type {
  PlaywrightOperation,
} from "@ricsam/isolate-protocol";
import {
  DEFAULT_PLAYWRIGHT_HANDLER_META,
} from "./types.ts";

// Re-export handler functions from handler.ts
export {
  createPlaywrightHandler,
  defaultPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
} from "./handler.ts";

// Re-export protocol types
export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent, PlaywrightFileData } from "@ricsam/isolate-protocol";
export { DEFAULT_PLAYWRIGHT_HANDLER_META };

// Re-export types from types.ts
export type {
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PlaywrightCallback,
  PlaywrightSetupOptions,
  PlaywrightHandle,
} from "./types.ts";

// Import handler functions for use within this module
import {
  createPlaywrightHandler,
  getDefaultPlaywrightHandlerMetadata,
} from "./handler.ts";
import type {
  PlaywrightCallback,
  PlaywrightSetupOptions,
  PlaywrightHandle,
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
} from "./types.ts";

// ============================================================================
// Setup Playwright
// ============================================================================

/**
 * Set up playwright in an isolate context.
 *
 * For local use: provide `page` option (direct page access)
 * For remote use: provide `handler` option (callback pattern)
 */
export async function setupPlaywright(
  context: ivm.Context,
  options: PlaywrightSetupOptions
): Promise<PlaywrightHandle> {
  const timeout = options.timeout ?? 30000;

  // Determine if we have a page or handler.
  // Handlers created via defaultPlaywrightHandler() carry page metadata so
  // event capture/collected data keeps working in handler-first mode.
  const explicitPage = "page" in options ? options.page : undefined;
  const handler = "handler" in options ? options.handler : undefined;
  const handlerMetadata = handler
    ? getDefaultPlaywrightHandlerMetadata(handler)
    : undefined;
  const page = explicitPage ?? handlerMetadata?.page;

  // Get lifecycle callbacks
  const createPage = "createPage" in options ? options.createPage : undefined;
  const createContext = "createContext" in options ? options.createContext : undefined;
  const readFile = "readFile" in options ? options.readFile : undefined;
  const writeFile = "writeFile" in options ? options.writeFile : undefined;

  // Create handler from page if needed
  const effectiveHandler = handler ?? (page ? createPlaywrightHandler(page, {
    timeout,
    readFile,
    writeFile,
    createPage,
    createContext,
  }) : undefined);

  if (!effectiveHandler) {
    throw new Error("Either page or handler must be provided to setupPlaywright");
  }

  // State for collected data (only used when page is provided directly)
  const browserConsoleLogs: BrowserConsoleLogEntry[] = [];
  const networkRequests: NetworkRequestInfo[] = [];
  const networkResponses: NetworkResponseInfo[] = [];

  const global = context.global;

  // ========================================================================
  // Event Capture (only when page is provided directly)
  // ========================================================================

  let requestHandler: ((request: import("playwright").Request) => void) | undefined;
  let responseHandler: ((response: import("playwright").Response) => void) | undefined;
  let consoleHandler: ((msg: import("playwright").ConsoleMessage) => void) | undefined;

  if (page) {
    // Get onEvent callback if provided
    const onEvent = "onEvent" in options ? options.onEvent : undefined;

    requestHandler = (request: import("playwright").Request) => {
      const info: NetworkRequestInfo = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() ?? undefined,
        resourceType: request.resourceType(),
        timestamp: Date.now(),
      };
      networkRequests.push(info);

      if (onEvent) {
        onEvent({
          type: "networkRequest",
          url: info.url,
          method: info.method,
          headers: info.headers,
          postData: info.postData,
          resourceType: info.resourceType,
          timestamp: info.timestamp,
        });
      }
    };

    responseHandler = (response: import("playwright").Response) => {
      const info: NetworkResponseInfo = {
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        timestamp: Date.now(),
      };
      networkResponses.push(info);

      if (onEvent) {
        onEvent({
          type: "networkResponse",
          url: info.url,
          status: info.status,
          statusText: info.statusText,
          headers: info.headers,
          timestamp: info.timestamp,
        });
      }
    };

    consoleHandler = (msg: import("playwright").ConsoleMessage) => {
      const args = msg.args().map((arg) => String(arg));
      const entry: BrowserConsoleLogEntry = {
        level: msg.type(),
        stdout: args.join(" "),
        timestamp: Date.now(),
      };
      browserConsoleLogs.push(entry);

      if (onEvent) {
        onEvent({
          type: "browserConsoleLog",
          level: entry.level,
          stdout: entry.stdout,
          timestamp: entry.timestamp,
        });
      }

      // Print to stdout if console option is true
      if ("console" in options && options.console) {
        const prefix = `[browser:${entry.level}]`;
        console.log(prefix, entry.stdout);
      }
    };

    page.on("request", requestHandler);
    page.on("response", responseHandler);
    page.on("console", consoleHandler);
  }

  // ========================================================================
  // Unified Handler Reference
  // ========================================================================

  // Single handler reference that receives operation objects
  global.setSync(
    "__Playwright_handler_ref",
    new ivm.Reference(async (opJson: string): Promise<string> => {
      const op = JSON.parse(opJson) as PlaywrightOperation;
      const result = await effectiveHandler(op);
      return JSON.stringify(result);
    })
  );

  // ========================================================================
  // Injected JavaScript
  // ========================================================================

  // Helper function to invoke handler and handle errors
  context.evalSync(`
(function() {
  globalThis.__pw_invoke_sync = function(type, args, options) {
    const op = JSON.stringify({ type, args, pageId: options?.pageId, contextId: options?.contextId });
    const resultJson = __Playwright_handler_ref.applySyncPromise(undefined, [op]);
    const result = JSON.parse(resultJson);
    if (result.ok) {
      return result.value;
    } else {
      const error = new Error(result.error.message);
      error.name = result.error.name;
      throw error;
    }
  };
  globalThis.__pw_invoke = async function(type, args, options) {
    return globalThis.__pw_invoke_sync(type, args, options);
  };
})();
`);

  // IsolatePage class and page/context/browser globals
  context.evalSync(`
(function() {
  // IsolatePage class - represents a page with a specific pageId
  class IsolatePage {
    #pageId; #contextId;
    constructor(pageId, contextId) {
      this.#pageId = pageId;
      this.#contextId = contextId;
    }
    get __isPage() { return true; }
    get __pageId() { return this.#pageId; }
    get __contextId() { return this.#contextId; }

    async goto(url, options) {
      await __pw_invoke("goto", [url, options?.waitUntil || null], { pageId: this.#pageId });
    }
    async reload() {
      await __pw_invoke("reload", [], { pageId: this.#pageId });
    }
    url() { return __pw_invoke_sync("url", [], { pageId: this.#pageId }); }
    async title() { return __pw_invoke("title", [], { pageId: this.#pageId }); }
    async content() { return __pw_invoke("content", [], { pageId: this.#pageId }); }
    async waitForSelector(selector, options) {
      return __pw_invoke("waitForSelector", [selector, options ? JSON.stringify(options) : null], { pageId: this.#pageId });
    }
    async waitForTimeout(ms) { return __pw_invoke("waitForTimeout", [ms], { pageId: this.#pageId }); }
    async waitForLoadState(state) { return __pw_invoke("waitForLoadState", [state || null], { pageId: this.#pageId }); }
    async evaluate(script, arg) {
      const hasArg = arguments.length > 1;
      if (hasArg) {
        const serialized = typeof script === "function" ? script.toString() : script;
        return __pw_invoke("evaluate", [serialized, arg], { pageId: this.#pageId });
      }
      const serialized = typeof script === "function" ? "(" + script.toString() + ")()" : script;
      return __pw_invoke("evaluate", [serialized], { pageId: this.#pageId });
    }
    locator(selector) { return new Locator("css", selector, null, this.#pageId); }
    getByRole(role, options) {
      if (options) {
        const serialized = { ...options };
        const name = options.name;
        if (name && typeof name === 'object' && typeof name.source === 'string' && typeof name.flags === 'string') {
          serialized.name = { $regex: name.source, $flags: name.flags };
        }
        return new Locator("role", role, JSON.stringify(serialized), this.#pageId);
      }
      return new Locator("role", role, null, this.#pageId);
    }
    getByText(text) { return new Locator("text", text, null, this.#pageId); }
    getByLabel(label) { return new Locator("label", label, null, this.#pageId); }
    getByPlaceholder(p) { return new Locator("placeholder", p, null, this.#pageId); }
    getByTestId(id) { return new Locator("testId", id, null, this.#pageId); }
    getByAltText(alt) { return new Locator("altText", alt, null, this.#pageId); }
    getByTitle(title) { return new Locator("title", title, null, this.#pageId); }
    frameLocator(selector) {
      const pageId = this.#pageId;
      return {
        locator(innerSelector) { return new Locator("frame", JSON.stringify([["css", selector, null], ["css", innerSelector, null]]), null, pageId); },
        getByRole(role, options) { return new Locator("frame", JSON.stringify([["css", selector, null], ["role", role, options ? JSON.stringify(options) : null]]), null, pageId); },
        getByText(text) { return new Locator("frame", JSON.stringify([["css", selector, null], ["text", text, null]]), null, pageId); },
        getByLabel(label) { return new Locator("frame", JSON.stringify([["css", selector, null], ["label", label, null]]), null, pageId); },
        getByPlaceholder(placeholder) { return new Locator("frame", JSON.stringify([["css", selector, null], ["placeholder", placeholder, null]]), null, pageId); },
        getByTestId(testId) { return new Locator("frame", JSON.stringify([["css", selector, null], ["testId", testId, null]]), null, pageId); },
        getByAltText(alt) { return new Locator("frame", JSON.stringify([["css", selector, null], ["altText", alt, null]]), null, pageId); },
        getByTitle(title) { return new Locator("frame", JSON.stringify([["css", selector, null], ["title", title, null]]), null, pageId); },
      };
    }
    async goBack(options) {
      await __pw_invoke("goBack", [options?.waitUntil || null], { pageId: this.#pageId });
    }
    async goForward(options) {
      await __pw_invoke("goForward", [options?.waitUntil || null], { pageId: this.#pageId });
    }
    async waitForURL(url, options) {
      let serializedUrl = url;
      if (url && typeof url === 'object' && typeof url.source === 'string' && typeof url.flags === 'string') {
        serializedUrl = { $regex: url.source, $flags: url.flags };
      }
      return __pw_invoke("waitForURL", [serializedUrl, options?.timeout || null, options?.waitUntil || null], { pageId: this.#pageId });
    }
    waitForResponse(urlOrPredicate, options) {
      // Serialize the matcher
      let serializedMatcher;
      if (typeof urlOrPredicate === 'string') {
        serializedMatcher = { type: 'string', value: urlOrPredicate };
      } else if (urlOrPredicate && typeof urlOrPredicate === 'object'
                 && typeof urlOrPredicate.source === 'string'
                 && typeof urlOrPredicate.flags === 'string') {
        serializedMatcher = { type: 'regex', value: { $regex: urlOrPredicate.source, $flags: urlOrPredicate.flags } };
      } else if (typeof urlOrPredicate === 'function') {
        serializedMatcher = { type: 'predicate', value: urlOrPredicate.toString() };
      } else {
        throw new Error('waitForResponse requires a URL string, RegExp, or predicate function');
      }

      // Step 1: Start listening (blocks briefly, host returns listenerId immediately)
      const startResult = __pw_invoke_sync("waitForResponseStart", [serializedMatcher, options?.timeout || null], { pageId: this.#pageId });
      const listenerId = startResult.listenerId;
      const pageId = this.#pageId;

      // Step 2: Return thenable — when awaited, blocks until response arrives
      return {
        then(resolve, reject) {
          try {
            const r = __pw_invoke_sync("waitForResponseFinish", [listenerId], { pageId });
            resolve({
              url: () => r.url,
              status: () => r.status,
              statusText: () => r.statusText,
              headers: () => r.headers,
              headersArray: () => r.headersArray,
              ok: () => r.ok,
              json: async () => r.json,
              text: async () => r.text,
              body: async () => r.body,
            });
          } catch(e) {
            reject(e);
          }
        }
      };
    }
    context() {
      const contextId = this.#contextId;
      return new IsolateContext(contextId);
    }
    async click(selector) { return this.locator(selector).click(); }
    async fill(selector, value) { return this.locator(selector).fill(value); }
    async textContent(selector) { return this.locator(selector).textContent(); }
    async innerText(selector) { return this.locator(selector).innerText(); }
    async innerHTML(selector) { return this.locator(selector).innerHTML(); }
    async getAttribute(selector, name) { return this.locator(selector).getAttribute(name); }
    async inputValue(selector) { return this.locator(selector).inputValue(); }
    async isVisible(selector) { return this.locator(selector).isVisible(); }
    async isEnabled(selector) { return this.locator(selector).isEnabled(); }
    async isChecked(selector) { return this.locator(selector).isChecked(); }
    async isHidden(selector) { return this.locator(selector).isHidden(); }
    async isDisabled(selector) { return this.locator(selector).isDisabled(); }
    async screenshot(options) { return __pw_invoke("screenshot", [options || {}], { pageId: this.#pageId }); }
    async setViewportSize(size) { return __pw_invoke("setViewportSize", [size], { pageId: this.#pageId }); }
    async viewportSize() { return __pw_invoke("viewportSize", [], { pageId: this.#pageId }); }
    async emulateMedia(options) { return __pw_invoke("emulateMedia", [options], { pageId: this.#pageId }); }
    async setExtraHTTPHeaders(headers) { return __pw_invoke("setExtraHTTPHeaders", [headers], { pageId: this.#pageId }); }
    async bringToFront() { return __pw_invoke("bringToFront", [], { pageId: this.#pageId }); }
    async close() { return __pw_invoke("close", [], { pageId: this.#pageId }); }
    async isClosed() { return __pw_invoke("isClosed", [], { pageId: this.#pageId }); }
    async pdf(options) { return __pw_invoke("pdf", [options || {}], { pageId: this.#pageId }); }
    async pause() { return __pw_invoke("pause", [], { pageId: this.#pageId }); }
    async frames() { return __pw_invoke("frames", [], { pageId: this.#pageId }); }
    async mainFrame() { return __pw_invoke("mainFrame", [], { pageId: this.#pageId }); }
    get keyboard() {
      const pageId = this.#pageId;
      return {
        async type(text, options) { return __pw_invoke("keyboardType", [text, options], { pageId }); },
        async press(key, options) { return __pw_invoke("keyboardPress", [key, options], { pageId }); },
        async down(key) { return __pw_invoke("keyboardDown", [key], { pageId }); },
        async up(key) { return __pw_invoke("keyboardUp", [key], { pageId }); },
        async insertText(text) { return __pw_invoke("keyboardInsertText", [text], { pageId }); }
      };
    }
    get mouse() {
      const pageId = this.#pageId;
      return {
        async move(x, y, options) { return __pw_invoke("mouseMove", [x, y, options], { pageId }); },
        async click(x, y, options) { return __pw_invoke("mouseClick", [x, y, options], { pageId }); },
        async down(options) { return __pw_invoke("mouseDown", [options], { pageId }); },
        async up(options) { return __pw_invoke("mouseUp", [options], { pageId }); },
        async wheel(deltaX, deltaY) { return __pw_invoke("mouseWheel", [deltaX, deltaY], { pageId }); }
      };
    }
    get request() {
      const pageId = this.#pageId;
      return {
        async fetch(url, options) {
          const result = await __pw_invoke("request", [url, options?.method || "GET", options?.data, options?.headers], { pageId });
          return {
            status: () => result.status,
            ok: () => result.ok,
            headers: () => result.headers,
            json: async () => result.json,
            text: async () => result.text,
            body: async () => result.body,
          };
        },
        async get(url, options) { return this.fetch(url, { ...options, method: "GET" }); },
        async post(url, options) { return this.fetch(url, { ...options, method: "POST" }); },
        async put(url, options) { return this.fetch(url, { ...options, method: "PUT" }); },
        async delete(url, options) { return this.fetch(url, { ...options, method: "DELETE" }); },
      };
    }
  }
  globalThis.IsolatePage = IsolatePage;

  // IsolateContext class - represents a browser context with a specific contextId
  class IsolateContext {
    #contextId;
    constructor(contextId) { this.#contextId = contextId; }
    get __contextId() { return this.#contextId; }

    async newPage() {
      const result = await __pw_invoke("newPage", [], { contextId: this.#contextId });
      return new IsolatePage(result.pageId, this.#contextId);
    }
    async close() { return __pw_invoke("closeContext", [], { contextId: this.#contextId }); }
    async clearCookies() { return __pw_invoke("clearCookies", [], { contextId: this.#contextId }); }
    async addCookies(cookies) { return __pw_invoke("addCookies", [cookies], { contextId: this.#contextId }); }
    async cookies(urls) { return __pw_invoke("cookies", [urls], { contextId: this.#contextId }); }
  }
  globalThis.IsolateContext = IsolateContext;

  // browser global - for creating new contexts
  globalThis.browser = {
    async newContext(options) {
      const result = await __pw_invoke("newContext", [options || null]);
      return new IsolateContext(result.contextId);
    }
  };

  // context global - represents the default context
  globalThis.context = new IsolateContext("ctx_0");

  // page global - represents the default page
  globalThis.page = new IsolatePage("page_0", "ctx_0");
})();
`);

  // Locator class with pageId support
  context.evalSync(`
(function() {
  // Helper to serialize options including RegExp
  function serializeOptions(options) {
    if (!options) return null;
    const serialized = { ...options };
    if (options.name && typeof options.name === 'object' && typeof options.name.source === 'string' && typeof options.name.flags === 'string') {
      serialized.name = { $regex: options.name.source, $flags: options.name.flags };
    }
    return JSON.stringify(serialized);
  }

  const INPUT_FILES_VALIDATION_ERROR =
    "setInputFiles() expects a file path string, an array of file path strings, " +
    "a single inline file object ({ name, mimeType, buffer }), or an array of inline file objects.";

  function isInlineFileObject(value) {
    return !!value
      && typeof value === 'object'
      && typeof value.name === 'string'
      && typeof value.mimeType === 'string'
      && 'buffer' in value;
  }

  function encodeInlineFileBuffer(buffer) {
    if (typeof buffer === 'string') {
      return buffer;
    }
    let bytes;
    if (buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(buffer);
    } else if (ArrayBuffer.isView(buffer)) {
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      throw new Error(
        "setInputFiles() inline file buffer must be a base64 string, ArrayBuffer, or TypedArray."
      );
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function serializeInlineFile(file) {
    return {
      name: file.name,
      mimeType: file.mimeType,
      buffer: encodeInlineFileBuffer(file.buffer),
    };
  }

  function normalizeSetInputFilesArg(files) {
    if (typeof files === 'string') {
      return files;
    }
    if (isInlineFileObject(files)) {
      return serializeInlineFile(files);
    }
    if (!Array.isArray(files)) {
      throw new Error(INPUT_FILES_VALIDATION_ERROR);
    }
    if (files.length === 0) {
      return [];
    }

    let hasPaths = false;
    let hasInline = false;
    const inlineFiles = [];

    for (const file of files) {
      if (typeof file === 'string') {
        hasPaths = true;
        continue;
      }
      if (isInlineFileObject(file)) {
        hasInline = true;
        inlineFiles.push(serializeInlineFile(file));
        continue;
      }
      throw new Error(INPUT_FILES_VALIDATION_ERROR);
    }

    if (hasPaths && hasInline) {
      throw new Error(
        "setInputFiles() does not support mixing file paths and inline file objects in the same array."
      );
    }
    return hasInline ? inlineFiles : files;
  }

  class Locator {
    #type; #value; #options; #pageId;
    constructor(type, value, options, pageId) {
      this.#type = type;
      this.#value = value;
      this.#options = options;
      this.#pageId = pageId || "page_0";
    }

    _getInfo() { return [this.#type, this.#value, this.#options]; }
    _getPageId() { return this.#pageId; }

    // Helper to create a chained locator
    _chain(childType, childValue, childOptions) {
      const parentInfo = this._getInfo();
      const childInfo = [childType, childValue, childOptions];
      return new Locator("chained", JSON.stringify([parentInfo, childInfo]), null, this.#pageId);
    }

    async click() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "click", null], { pageId: this.#pageId });
    }
    async dblclick() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "dblclick", null], { pageId: this.#pageId });
    }
    async fill(text) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "fill", text], { pageId: this.#pageId });
    }
    async type(text) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "type", text], { pageId: this.#pageId });
    }
    async check() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "check", null], { pageId: this.#pageId });
    }
    async uncheck() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "uncheck", null], { pageId: this.#pageId });
    }
    async selectOption(value) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "selectOption", value], { pageId: this.#pageId });
    }
    async clear() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "clear", null], { pageId: this.#pageId });
    }
    async press(key) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "press", key], { pageId: this.#pageId });
    }
    async hover() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "hover", null], { pageId: this.#pageId });
    }
    async focus() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "focus", null], { pageId: this.#pageId });
    }
    async textContent() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getText", null], { pageId: this.#pageId });
    }
    async inputValue() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getValue", null], { pageId: this.#pageId });
    }
    async isVisible() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isVisible", null], { pageId: this.#pageId });
    }
    async isEnabled() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isEnabled", null], { pageId: this.#pageId });
    }
    async isChecked() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isChecked", null], { pageId: this.#pageId });
    }
    async count() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "count", null], { pageId: this.#pageId });
    }
    async getAttribute(name) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getAttribute", name], { pageId: this.#pageId });
    }
    async isDisabled() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isDisabled", null], { pageId: this.#pageId });
    }
    async isHidden() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isHidden", null], { pageId: this.#pageId });
    }
    async innerHTML() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "innerHTML", null], { pageId: this.#pageId });
    }
    async innerText() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "innerText", null], { pageId: this.#pageId });
    }
    async allTextContents() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "allTextContents", null], { pageId: this.#pageId });
    }
    async allInnerTexts() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "allInnerTexts", null], { pageId: this.#pageId });
    }
    async waitFor(options) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "waitFor", options || {}], { pageId: this.#pageId });
    }
    async boundingBox() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "boundingBox", null], { pageId: this.#pageId });
    }
    async setInputFiles(files) {
      const serializedFiles = normalizeSetInputFilesArg(files);
      return __pw_invoke("locatorAction", [...this._getInfo(), "setInputFiles", serializedFiles], { pageId: this.#pageId });
    }
    async screenshot(options) {
      const base64 = await __pw_invoke("locatorAction", [...this._getInfo(), "screenshot", options || {}], { pageId: this.#pageId });
      return base64;
    }
    async dragTo(target) {
      const targetInfo = target._getInfo();
      return __pw_invoke("locatorAction", [...this._getInfo(), "dragTo", targetInfo], { pageId: this.#pageId });
    }
    async scrollIntoViewIfNeeded() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "scrollIntoViewIfNeeded", null], { pageId: this.#pageId });
    }
    async highlight() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "highlight", null], { pageId: this.#pageId });
    }
    async evaluate(fn, arg) {
      const fnString = typeof fn === 'function' ? fn.toString() : fn;
      return __pw_invoke("locatorAction", [...this._getInfo(), "evaluate", [fnString, arg]], { pageId: this.#pageId });
    }
    async evaluateAll(fn, arg) {
      const fnString = typeof fn === 'function' ? fn.toString() : fn;
      return __pw_invoke("locatorAction", [...this._getInfo(), "evaluateAll", [fnString, arg]], { pageId: this.#pageId });
    }
    locator(selector) {
      return this._chain("css", selector, null);
    }
    // Chaining: getBy* methods within a locator
    getByRole(role, options) {
      return this._chain("role", role, serializeOptions(options));
    }
    getByText(text) {
      return this._chain("text", text, null);
    }
    getByLabel(label) {
      return this._chain("label", label, null);
    }
    getByPlaceholder(placeholder) {
      return this._chain("placeholder", placeholder, null);
    }
    getByTestId(testId) {
      return this._chain("testId", testId, null);
    }
    getByAltText(altText) {
      return this._chain("altText", altText, null);
    }
    getByTitle(title) {
      return this._chain("title", title, null);
    }
    async all() {
      const n = await this.count();
      const result = [];
      for (let i = 0; i < n; i++) {
        result.push(this.nth(i));
      }
      return result;
    }
    nth(index) {
      const existingOpts = this.#options ? JSON.parse(this.#options) : {};
      return new Locator(this.#type, this.#value, JSON.stringify({ ...existingOpts, nth: index }), this.#pageId);
    }
    first() {
      return this.nth(0);
    }
    last() {
      return this.nth(-1);
    }
    filter(options) {
      const existingOpts = this.#options ? JSON.parse(this.#options) : {};
      const serializedFilter = { ...options };
      // Use duck-typing RegExp detection (instanceof fails across isolated-vm boundary)
      const hasText = options.hasText;
      if (hasText && typeof hasText === 'object' && typeof hasText.source === 'string' && typeof hasText.flags === 'string') {
        serializedFilter.hasText = { $regex: hasText.source, $flags: hasText.flags };
      }
      const hasNotText = options.hasNotText;
      if (hasNotText && typeof hasNotText === 'object' && typeof hasNotText.source === 'string' && typeof hasNotText.flags === 'string') {
        serializedFilter.hasNotText = { $regex: hasNotText.source, $flags: hasNotText.flags };
      }
      // Serialize has/hasNot locators using duck-typing
      const has = options.has;
      if (has && typeof has === 'object' && typeof has._getInfo === 'function') {
        serializedFilter.has = { $locator: has._getInfo() };
      }
      const hasNot = options.hasNot;
      if (hasNot && typeof hasNot === 'object' && typeof hasNot._getInfo === 'function') {
        serializedFilter.hasNot = { $locator: hasNot._getInfo() };
      }
      return new Locator(this.#type, this.#value, JSON.stringify({ ...existingOpts, filter: serializedFilter }), this.#pageId);
    }
    or(other) {
      // Create a composite locator that matches either this or other
      const thisInfo = this._getInfo();
      const otherInfo = other._getInfo();
      return new Locator("or", JSON.stringify([thisInfo, otherInfo]), null, this.#pageId);
    }
    and(other) {
      // Create a composite locator that matches both this and other
      const thisInfo = this._getInfo();
      const otherInfo = other._getInfo();
      return new Locator("and", JSON.stringify([thisInfo, otherInfo]), null, this.#pageId);
    }
  }
  globalThis.Locator = Locator;
})();
`);

  // Extend expect with locator matchers (only if test-environment already defined expect)
  context.evalSync(`
(function() {
  // Helper to create locator matchers
  function createLocatorMatchers(locator, baseMatchers) {
    const info = locator._getInfo();
    const pageId = locator._getPageId ? locator._getPageId() : "page_0";

    // Helper for serializing regex values
    function serializeExpected(expected) {
      if (expected instanceof RegExp) {
        return { $regex: expected.source, $flags: expected.flags };
      }
      return expected;
    }

    const locatorMatchers = {
      async toBeVisible(options) {
        return __pw_invoke("expectLocator", [...info, "toBeVisible", null, false, options?.timeout], { pageId });
      },
      async toContainText(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toContainText", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toHaveValue(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, false, options?.timeout], { pageId });
      },
      async toBeEnabled(options) {
        return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, false, options?.timeout], { pageId });
      },
      async toBeChecked(options) {
        return __pw_invoke("expectLocator", [...info, "toBeChecked", null, false, options?.timeout], { pageId });
      },
      async toHaveAttribute(name, value, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveAttribute", { name, value: serializeExpected(value) }, false, options?.timeout], { pageId });
      },
      async toHaveText(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveText", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toHaveCount(count, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveCount", count, false, options?.timeout], { pageId });
      },
      async toBeHidden(options) {
        return __pw_invoke("expectLocator", [...info, "toBeHidden", null, false, options?.timeout], { pageId });
      },
      async toBeDisabled(options) {
        return __pw_invoke("expectLocator", [...info, "toBeDisabled", null, false, options?.timeout], { pageId });
      },
      async toBeFocused(options) {
        return __pw_invoke("expectLocator", [...info, "toBeFocused", null, false, options?.timeout], { pageId });
      },
      async toBeEmpty(options) {
        return __pw_invoke("expectLocator", [...info, "toBeEmpty", null, false, options?.timeout], { pageId });
      },
      // New matchers
      async toBeAttached(options) {
        return __pw_invoke("expectLocator", [...info, "toBeAttached", null, false, options?.timeout], { pageId });
      },
      async toBeEditable(options) {
        return __pw_invoke("expectLocator", [...info, "toBeEditable", null, false, options?.timeout], { pageId });
      },
      async toHaveClass(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveClass", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toContainClass(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toContainClass", expected, false, options?.timeout], { pageId });
      },
      async toHaveId(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveId", expected, false, options?.timeout], { pageId });
      },
      async toBeInViewport(options) {
        return __pw_invoke("expectLocator", [...info, "toBeInViewport", null, false, options?.timeout], { pageId });
      },
      async toHaveCSS(name, value, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveCSS", { name, value: serializeExpected(value) }, false, options?.timeout], { pageId });
      },
      async toHaveJSProperty(name, value, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveJSProperty", { name, value }, false, options?.timeout], { pageId });
      },
      async toHaveAccessibleName(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveAccessibleName", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toHaveAccessibleDescription(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveAccessibleDescription", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toHaveRole(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveRole", expected, false, options?.timeout], { pageId });
      },
      not: {
        async toBeVisible(options) {
          return __pw_invoke("expectLocator", [...info, "toBeVisible", null, true, options?.timeout], { pageId });
        },
        async toContainText(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toContainText", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toHaveValue(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, true, options?.timeout], { pageId });
        },
        async toBeEnabled(options) {
          return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, true, options?.timeout], { pageId });
        },
        async toBeChecked(options) {
          return __pw_invoke("expectLocator", [...info, "toBeChecked", null, true, options?.timeout], { pageId });
        },
        async toHaveAttribute(name, value, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveAttribute", { name, value: serializeExpected(value) }, true, options?.timeout], { pageId });
        },
        async toHaveText(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveText", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toHaveCount(count, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveCount", count, true, options?.timeout], { pageId });
        },
        async toBeHidden(options) {
          return __pw_invoke("expectLocator", [...info, "toBeHidden", null, true, options?.timeout], { pageId });
        },
        async toBeDisabled(options) {
          return __pw_invoke("expectLocator", [...info, "toBeDisabled", null, true, options?.timeout], { pageId });
        },
        async toBeFocused(options) {
          return __pw_invoke("expectLocator", [...info, "toBeFocused", null, true, options?.timeout], { pageId });
        },
        async toBeEmpty(options) {
          return __pw_invoke("expectLocator", [...info, "toBeEmpty", null, true, options?.timeout], { pageId });
        },
        // New negated matchers
        async toBeAttached(options) {
          return __pw_invoke("expectLocator", [...info, "toBeAttached", null, true, options?.timeout], { pageId });
        },
        async toBeEditable(options) {
          return __pw_invoke("expectLocator", [...info, "toBeEditable", null, true, options?.timeout], { pageId });
        },
        async toHaveClass(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveClass", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toContainClass(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toContainClass", expected, true, options?.timeout], { pageId });
        },
        async toHaveId(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveId", expected, true, options?.timeout], { pageId });
        },
        async toBeInViewport(options) {
          return __pw_invoke("expectLocator", [...info, "toBeInViewport", null, true, options?.timeout], { pageId });
        },
        async toHaveCSS(name, value, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveCSS", { name, value: serializeExpected(value) }, true, options?.timeout], { pageId });
        },
        async toHaveJSProperty(name, value, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveJSProperty", { name, value }, true, options?.timeout], { pageId });
        },
        async toHaveAccessibleName(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveAccessibleName", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toHaveAccessibleDescription(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveAccessibleDescription", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toHaveRole(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveRole", expected, true, options?.timeout], { pageId });
        },
      }
    };

    // Merge locator matchers with base matchers from test-environment
    if (baseMatchers) {
      return {
        ...baseMatchers,
        ...locatorMatchers,
        not: { ...baseMatchers.not, ...locatorMatchers.not }
      };
    }
    return locatorMatchers;
  }

  // Helper to create page matchers
  function createPageMatchers(page, baseMatchers) {
    const pageId = page.__pageId || "page_0";

    function serializeExpected(expected) {
      if (expected instanceof RegExp) {
        return { $regex: expected.source, $flags: expected.flags };
      }
      return expected;
    }

    const pageMatchers = {
      async toHaveURL(expected, options) {
        return __pw_invoke("expectPage", ["toHaveURL", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      async toHaveTitle(expected, options) {
        return __pw_invoke("expectPage", ["toHaveTitle", serializeExpected(expected), false, options?.timeout], { pageId });
      },
      not: {
        async toHaveURL(expected, options) {
          return __pw_invoke("expectPage", ["toHaveURL", serializeExpected(expected), true, options?.timeout], { pageId });
        },
        async toHaveTitle(expected, options) {
          return __pw_invoke("expectPage", ["toHaveTitle", serializeExpected(expected), true, options?.timeout], { pageId });
        },
      }
    };

    if (baseMatchers) {
      return {
        ...baseMatchers,
        ...pageMatchers,
        not: { ...baseMatchers.not, ...pageMatchers.not }
      };
    }
    return pageMatchers;
  }

  // Only extend expect if test-environment already defined it
  if (typeof globalThis.expect === 'function') {
    const originalExpect = globalThis.expect;
    globalThis.expect = function(actual) {
      const baseMatchers = originalExpect(actual);
      // If actual is a Locator, add locator-specific matchers
      if (actual && actual.constructor && actual.constructor.name === 'Locator') {
        return createLocatorMatchers(actual, baseMatchers);
      }
      // If actual is the page object (IsolatePage), add page-specific matchers
      if (actual && actual.__isPage === true) {
        return createPageMatchers(actual, baseMatchers);
      }
      return baseMatchers;
    };
  }
  // If test-environment not loaded, expect remains undefined
})();
`);

  // ========================================================================
  // Return Handle
  // ========================================================================

  return {
    dispose() {
      // Only remove listeners if page was provided directly
      if (page && requestHandler && responseHandler && consoleHandler) {
        page.off("request", requestHandler);
        page.off("response", responseHandler);
        page.off("console", consoleHandler);
      }
      browserConsoleLogs.length = 0;
      networkRequests.length = 0;
      networkResponses.length = 0;
    },
    getBrowserConsoleLogs() {
      return [...browserConsoleLogs];
    },
    getNetworkRequests() {
      return [...networkRequests];
    },
    getNetworkResponses() {
      return [...networkResponses];
    },
    clearCollected() {
      browserConsoleLogs.length = 0;
      networkRequests.length = 0;
      networkResponses.length = 0;
    },
  };
}
