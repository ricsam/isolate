import ivm from "isolated-vm";
import type { Page, Locator as PlaywrightLocator } from "playwright";
import type {
  PlaywrightOperation,
  PlaywrightResult,
  PlaywrightEvent,
} from "@ricsam/isolate-protocol";

// Re-export protocol types
export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent } from "@ricsam/isolate-protocol";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface NetworkRequestInfo {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
}

export interface NetworkResponseInfo {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  timestamp: number;
}

/**
 * Browser console log entry - logs from the page context (not sandbox).
 */
export interface BrowserConsoleLogEntry {
  level: string;
  stdout: string;
  timestamp: number;
}

/**
 * Callback type for handling playwright operations.
 * Used for remote execution where the page lives on the client.
 */
export type PlaywrightCallback = (
  op: PlaywrightOperation
) => Promise<PlaywrightResult>;

/**
 * Options for setting up playwright in an isolate.
 */
export interface PlaywrightSetupOptions {
  /** Direct page object (for local use) */
  page?: Page;
  /** Handler callback (for remote use - daemon invokes this) */
  handler?: PlaywrightCallback;
  /** Default timeout for operations */
  timeout?: number;
  /** Base URL for relative navigation */
  baseUrl?: string;
  /** If true, browser console logs are printed to stdout */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
}

/**
 * @deprecated Use PlaywrightSetupOptions instead
 */
export interface PlaywrightOptions {
  page: Page;
  timeout?: number;
  baseUrl?: string;
  onNetworkRequest?: (info: NetworkRequestInfo) => void;
  onNetworkResponse?: (info: NetworkResponseInfo) => void;
}

export interface PlaywrightHandle {
  dispose(): void;
  /** Get browser console logs (from the page, not sandbox) */
  getBrowserConsoleLogs(): BrowserConsoleLogEntry[];
  getNetworkRequests(): NetworkRequestInfo[];
  getNetworkResponses(): NetworkResponseInfo[];
  clearCollected(): void;
}

// ============================================================================
// Helper: Get locator from selector info
// ============================================================================

function getLocator(
  page: Page,
  selectorType: string,
  selectorValue: string,
  optionsJson: string | null
): PlaywrightLocator {
  // Parse options and extract nth if present
  const options = optionsJson ? JSON.parse(optionsJson) : undefined;
  const nthIndex = options?.nth;

  // For role selectors, pass options (excluding nth) to getByRole
  const roleOptions = options ? { ...options } : undefined;
  if (roleOptions) {
    delete roleOptions.nth;
    delete roleOptions.filter;
    // Deserialize regex name
    if (roleOptions.name && typeof roleOptions.name === 'object' && roleOptions.name.$regex) {
      roleOptions.name = new RegExp(roleOptions.name.$regex, roleOptions.name.$flags);
    }
  }

  let locator: PlaywrightLocator;
  switch (selectorType) {
    case "css":
      locator = page.locator(selectorValue);
      break;
    case "role":
      locator = page.getByRole(
        selectorValue as Parameters<Page["getByRole"]>[0],
        roleOptions && Object.keys(roleOptions).length > 0 ? roleOptions : undefined
      );
      break;
    case "text":
      locator = page.getByText(selectorValue);
      break;
    case "label":
      locator = page.getByLabel(selectorValue);
      break;
    case "placeholder":
      locator = page.getByPlaceholder(selectorValue);
      break;
    case "testId":
      locator = page.getByTestId(selectorValue);
      break;
    default:
      locator = page.locator(selectorValue);
  }

  // Apply nth if specified
  if (nthIndex !== undefined) {
    locator = locator.nth(nthIndex);
  }

  // Apply filter if specified
  if (options?.filter) {
    const filterOpts = { ...options.filter };
    if (filterOpts.hasText && typeof filterOpts.hasText === 'object' && filterOpts.hasText.$regex) {
      filterOpts.hasText = new RegExp(filterOpts.hasText.$regex, filterOpts.hasText.$flags);
    }
    if (filterOpts.hasNotText && typeof filterOpts.hasNotText === 'object' && filterOpts.hasNotText.$regex) {
      filterOpts.hasNotText = new RegExp(filterOpts.hasNotText.$regex, filterOpts.hasNotText.$flags);
    }
    locator = locator.filter(filterOpts);
  }

  return locator;
}

// ============================================================================
// Helper: Execute locator action
// ============================================================================

async function executeLocatorAction(
  locator: PlaywrightLocator,
  action: string,
  actionArg: unknown,
  timeout: number
): Promise<unknown> {
  switch (action) {
    case "click":
      await locator.click({ timeout });
      return null;
    case "dblclick":
      await locator.dblclick({ timeout });
      return null;
    case "fill":
      await locator.fill(String(actionArg ?? ""), { timeout });
      return null;
    case "type":
      await locator.pressSequentially(String(actionArg ?? ""), { timeout });
      return null;
    case "check":
      await locator.check({ timeout });
      return null;
    case "uncheck":
      await locator.uncheck({ timeout });
      return null;
    case "selectOption":
      await locator.selectOption(String(actionArg ?? ""), { timeout });
      return null;
    case "clear":
      await locator.clear({ timeout });
      return null;
    case "press":
      await locator.press(String(actionArg ?? ""), { timeout });
      return null;
    case "hover":
      await locator.hover({ timeout });
      return null;
    case "focus":
      await locator.focus({ timeout });
      return null;
    case "getText":
      return await locator.textContent({ timeout });
    case "getValue":
      return await locator.inputValue({ timeout });
    case "isVisible":
      return await locator.isVisible();
    case "isEnabled":
      return await locator.isEnabled();
    case "isChecked":
      return await locator.isChecked();
    case "count":
      return await locator.count();
    case "getAttribute":
      return await locator.getAttribute(String(actionArg ?? ""), { timeout });
    case "isDisabled":
      return await locator.isDisabled();
    case "isHidden":
      return await locator.isHidden();
    case "innerHTML":
      return await locator.innerHTML({ timeout });
    case "innerText":
      return await locator.innerText({ timeout });
    case "allTextContents":
      return await locator.allTextContents();
    case "allInnerTexts":
      return await locator.allInnerTexts();
    case "waitFor": {
      const opts = actionArg && typeof actionArg === 'object' ? actionArg as Record<string, unknown> : {};
      await locator.waitFor({ state: opts.state as any, timeout: (opts.timeout as number) ?? timeout });
      return null;
    }
    case "boundingBox":
      return await locator.boundingBox({ timeout });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ============================================================================
// Helper: Execute expect assertion
// ============================================================================

async function executeExpectAssertion(
  locator: PlaywrightLocator,
  matcher: string,
  expected: unknown,
  negated: boolean,
  timeout: number
): Promise<void> {
  switch (matcher) {
    case "toBeVisible": {
      const isVisible = await locator.isVisible();
      if (negated) {
        if (isVisible) throw new Error("Expected element to not be visible, but it was visible");
      } else {
        if (!isVisible) throw new Error("Expected element to be visible, but it was not");
      }
      break;
    }
    case "toContainText": {
      const text = await locator.textContent({ timeout });
      let matches: boolean;
      let expectedDisplay: string;
      if (expected && typeof expected === 'object' && (expected as any).$regex) {
        const regex = new RegExp((expected as any).$regex, (expected as any).$flags);
        matches = regex.test(text ?? '');
        expectedDisplay = String(regex);
      } else {
        matches = text?.includes(String(expected)) ?? false;
        expectedDisplay = String(expected);
      }
      if (negated) {
        if (matches) throw new Error(`Expected text to not contain ${expectedDisplay}, but got "${text}"`);
      } else {
        if (!matches) throw new Error(`Expected text to contain ${expectedDisplay}, but got "${text}"`);
      }
      break;
    }
    case "toHaveValue": {
      const value = await locator.inputValue({ timeout });
      const matches = value === String(expected);
      if (negated) {
        if (matches) throw new Error(`Expected value to not be "${expected}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected value to be "${expected}", but got "${value}"`);
      }
      break;
    }
    case "toBeEnabled": {
      const isEnabled = await locator.isEnabled();
      if (negated) {
        if (isEnabled) throw new Error("Expected element to be disabled, but it was enabled");
      } else {
        if (!isEnabled) throw new Error("Expected element to be enabled, but it was disabled");
      }
      break;
    }
    case "toBeChecked": {
      const isChecked = await locator.isChecked();
      if (negated) {
        if (isChecked) throw new Error("Expected element to not be checked, but it was checked");
      } else {
        if (!isChecked) throw new Error("Expected element to be checked, but it was not");
      }
      break;
    }
    case "toHaveAttribute": {
      const { name, value } = expected as { name: string; value: unknown };
      const actual = await locator.getAttribute(name, { timeout });
      if (value instanceof RegExp || (value && typeof value === 'object' && (value as any).$regex)) {
        const regex = (value as any).$regex ? new RegExp((value as any).$regex, (value as any).$flags) : value as RegExp;
        const matches = regex.test(actual ?? '');
        if (negated) {
          if (matches) throw new Error(`Expected attribute "${name}" to not match ${regex}, but got "${actual}"`);
        } else {
          if (!matches) throw new Error(`Expected attribute "${name}" to match ${regex}, but got "${actual}"`);
        }
      } else {
        const matches = actual === String(value);
        if (negated) {
          if (matches) throw new Error(`Expected attribute "${name}" to not be "${value}", but it was`);
        } else {
          if (!matches) throw new Error(`Expected attribute "${name}" to be "${value}", but got "${actual}"`);
        }
      }
      break;
    }
    case "toHaveText": {
      const text = (await locator.textContent({ timeout })) ?? '';
      let matches: boolean;
      let expectedDisplay: string;
      if (expected && typeof expected === 'object' && (expected as any).$regex) {
        const regex = new RegExp((expected as any).$regex, (expected as any).$flags);
        matches = regex.test(text);
        expectedDisplay = String(regex);
      } else {
        matches = text === String(expected);
        expectedDisplay = JSON.stringify(expected);
      }
      if (negated) {
        if (matches) throw new Error(`Expected text to not be ${expectedDisplay}, but got "${text}"`);
      } else {
        if (!matches) throw new Error(`Expected text to be ${expectedDisplay}, but got "${text}"`);
      }
      break;
    }
    case "toHaveCount": {
      const count = await locator.count();
      const expectedCount = Number(expected);
      if (negated) {
        if (count === expectedCount) throw new Error(`Expected count to not be ${expectedCount}, but it was`);
      } else {
        if (count !== expectedCount) throw new Error(`Expected count to be ${expectedCount}, but got ${count}`);
      }
      break;
    }
    case "toBeHidden": {
      const isHidden = await locator.isHidden();
      if (negated) {
        if (isHidden) throw new Error("Expected element to not be hidden, but it was hidden");
      } else {
        if (!isHidden) throw new Error("Expected element to be hidden, but it was not");
      }
      break;
    }
    case "toBeDisabled": {
      const isDisabled = await locator.isDisabled();
      if (negated) {
        if (isDisabled) throw new Error("Expected element to not be disabled, but it was disabled");
      } else {
        if (!isDisabled) throw new Error("Expected element to be disabled, but it was not");
      }
      break;
    }
    case "toBeFocused": {
      const isFocused = await locator.evaluate((el) => document.activeElement === el).catch(() => false);
      if (negated) {
        if (isFocused) throw new Error("Expected element to not be focused, but it was focused");
      } else {
        if (!isFocused) throw new Error("Expected element to be focused, but it was not");
      }
      break;
    }
    case "toBeEmpty": {
      const text = await locator.textContent({ timeout });
      const value = await locator.inputValue({ timeout }).catch(() => null);
      const isEmpty = (value !== null ? value === '' : (text ?? '') === '');
      if (negated) {
        if (isEmpty) throw new Error("Expected element to not be empty, but it was");
      } else {
        if (!isEmpty) throw new Error("Expected element to be empty, but it was not");
      }
      break;
    }
    default:
      throw new Error(`Unknown matcher: ${matcher}`);
  }
}

// ============================================================================
// Create Playwright Handler (for remote use)
// ============================================================================

/**
 * Create a playwright handler from a Page object.
 * This handler is called by the daemon (via callback) when sandbox needs page operations.
 * Used for remote runtime where the browser runs on the client.
 */
export function createPlaywrightHandler(
  page: Page,
  options?: { timeout?: number; baseUrl?: string }
): PlaywrightCallback {
  const timeout = options?.timeout ?? 30000;
  const baseUrl = options?.baseUrl;

  return async (op: PlaywrightOperation): Promise<PlaywrightResult> => {
    try {
      switch (op.type) {
        case "goto": {
          const [url, waitUntil] = op.args as [string, string?];
          const targetUrl = baseUrl && !url.startsWith("http") ? `${baseUrl}${url}` : url;
          await page.goto(targetUrl, {
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "reload":
          await page.reload({ timeout });
          return { ok: true };
        case "url":
          return { ok: true, value: page.url() };
        case "title":
          return { ok: true, value: await page.title() };
        case "content":
          return { ok: true, value: await page.content() };
        case "waitForSelector": {
          const [selector, optionsJson] = op.args as [string, string?];
          const opts = optionsJson ? JSON.parse(optionsJson) : {};
          await page.waitForSelector(selector, { timeout, ...opts });
          return { ok: true };
        }
        case "waitForTimeout": {
          const [ms] = op.args as [number];
          await page.waitForTimeout(ms);
          return { ok: true };
        }
        case "waitForLoadState": {
          const [state] = op.args as [string?];
          await page.waitForLoadState(
            (state as "load" | "domcontentloaded" | "networkidle") ?? "load",
            { timeout }
          );
          return { ok: true };
        }
        case "evaluate": {
          const [script] = op.args as [string];
          const result = await page.evaluate(script);
          return { ok: true, value: result };
        }
        case "locatorAction": {
          const [selectorType, selectorValue, roleOptions, action, actionArg] = op.args as [
            string,
            string,
            string | null,
            string,
            unknown
          ];
          const locator = getLocator(page, selectorType, selectorValue, roleOptions);
          const result = await executeLocatorAction(locator, action, actionArg, timeout);
          return { ok: true, value: result };
        }
        case "expectLocator": {
          const [selectorType, selectorValue, roleOptions, matcher, expected, negated, customTimeout] = op.args as [
            string,
            string,
            string | null,
            string,
            unknown,
            boolean,
            number?
          ];
          const locator = getLocator(page, selectorType, selectorValue, roleOptions);
          const effectiveTimeout = customTimeout ?? timeout;
          await executeExpectAssertion(locator, matcher, expected, negated ?? false, effectiveTimeout);
          return { ok: true };
        }
        case "request": {
          const [url, method, data, headers] = op.args as [
            string,
            string,
            unknown,
            Record<string, string>?
          ];
          const targetUrl = baseUrl && !url.startsWith("http") ? `${baseUrl}${url}` : url;
          const requestOptions: {
            method?: string;
            data?: unknown;
            headers?: Record<string, string>;
            timeout?: number;
          } = {
            timeout,
          };
          if (headers) {
            requestOptions.headers = headers;
          }
          if (data !== undefined && data !== null) {
            requestOptions.data = data;
          }

          const response = await page.request.fetch(targetUrl, {
            method: method as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS",
            ...requestOptions,
          });

          // Get response data - try to parse as JSON, fall back to text
          const text = await response.text();
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Not valid JSON, that's ok
          }

          return {
            ok: true,
            value: {
              status: response.status(),
              ok: response.ok(),
              headers: response.headers(),
              text,
              json,
              body: null, // ArrayBuffer not easily serializable, use text/json instead
            },
          };
        }
        case "goBack": {
          const [waitUntil] = op.args as [string?];
          await page.goBack({
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "goForward": {
          const [waitUntil] = op.args as [string?];
          await page.goForward({
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "waitForURL": {
          const [url, customTimeout, waitUntil] = op.args as [string, number?, string?];
          await page.waitForURL(url, {
            timeout: customTimeout ?? timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? undefined,
          });
          return { ok: true };
        }
        case "clearCookies": {
          await page.context().clearCookies();
          return { ok: true };
        }
        default:
          return { ok: false, error: { name: "Error", message: `Unknown operation: ${(op as PlaywrightOperation).type}` } };
      }
    } catch (err) {
      const error = err as Error;
      return { ok: false, error: { name: error.name, message: error.message } };
    }
  };
}

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
  options: PlaywrightSetupOptions | PlaywrightOptions
): Promise<PlaywrightHandle> {
  const timeout = options.timeout ?? 30000;
  const baseUrl = options.baseUrl;

  // Determine if we have a page or handler
  const page = "page" in options ? options.page : undefined;
  const handler = "handler" in options ? options.handler : undefined;

  // Create handler from page if needed
  const effectiveHandler = handler ?? (page ? createPlaywrightHandler(page, { timeout, baseUrl }) : undefined);

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
  globalThis.__pw_invoke = async function(type, args) {
    const op = JSON.stringify({ type, args });
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
})();
`);

  // Page object
  context.evalSync(`
(function() {
  let __pw_currentUrl = '';
  globalThis.page = {
    async goto(url, options) {
      const result = await __pw_invoke("goto", [url, options?.waitUntil || null]);
      const resolvedUrl = await __pw_invoke("url", []);
      __pw_currentUrl = resolvedUrl || url;
      return result;
    },
    async reload() {
      const result = await __pw_invoke("reload", []);
      const resolvedUrl = await __pw_invoke("url", []);
      if (resolvedUrl) __pw_currentUrl = resolvedUrl;
      return result;
    },
    url() {
      return __pw_currentUrl;
    },
    async title() {
      return __pw_invoke("title", []);
    },
    async content() {
      return __pw_invoke("content", []);
    },
    async waitForSelector(selector, options) {
      return __pw_invoke("waitForSelector", [selector, options ? JSON.stringify(options) : null]);
    },
    async waitForTimeout(ms) {
      return __pw_invoke("waitForTimeout", [ms]);
    },
    async waitForLoadState(state) {
      return __pw_invoke("waitForLoadState", [state || null]);
    },
    async evaluate(script) {
      const serialized = typeof script === "function" ? "(" + script.toString() + ")()" : script;
      return __pw_invoke("evaluate", [serialized]);
    },
    locator(selector) { return new Locator("css", selector, null); },
    getByRole(role, options) {
      if (options) {
        const serialized = { ...options };
        if (options.name instanceof RegExp) {
          serialized.name = { $regex: options.name.source, $flags: options.name.flags };
        }
        return new Locator("role", role, JSON.stringify(serialized));
      }
      return new Locator("role", role, null);
    },
    getByText(text) { return new Locator("text", text, null); },
    getByLabel(label) { return new Locator("label", label, null); },
    getByPlaceholder(p) { return new Locator("placeholder", p, null); },
    getByTestId(id) { return new Locator("testId", id, null); },
    async goBack(options) {
      await __pw_invoke("goBack", [options?.waitUntil || null]);
      const resolvedUrl = await __pw_invoke("url", []);
      if (resolvedUrl) __pw_currentUrl = resolvedUrl;
    },
    async goForward(options) {
      await __pw_invoke("goForward", [options?.waitUntil || null]);
      const resolvedUrl = await __pw_invoke("url", []);
      if (resolvedUrl) __pw_currentUrl = resolvedUrl;
    },
    async waitForURL(url, options) {
      return __pw_invoke("waitForURL", [url, options?.timeout || null, options?.waitUntil || null]);
    },
    context() {
      return {
        async clearCookies() {
          return __pw_invoke("clearCookies", []);
        }
      };
    },
    async click(selector) { return this.locator(selector).click(); },
    async fill(selector, value) { return this.locator(selector).fill(value); },
    request: {
      async fetch(url, options) {
        const result = await __pw_invoke("request", [url, options?.method || "GET", options?.data, options?.headers]);
        return {
          status: () => result.status,
          ok: () => result.ok,
          headers: () => result.headers,
          json: async () => result.json,
          text: async () => result.text,
          body: async () => result.body,
        };
      },
      async get(url, options) {
        return this.fetch(url, { ...options, method: "GET" });
      },
      async post(url, options) {
        return this.fetch(url, { ...options, method: "POST" });
      },
      async put(url, options) {
        return this.fetch(url, { ...options, method: "PUT" });
      },
      async delete(url, options) {
        return this.fetch(url, { ...options, method: "DELETE" });
      },
    },
  };
})();
`);

  // Locator class
  context.evalSync(`
(function() {
  class Locator {
    #type; #value; #options;
    constructor(type, value, options) {
      this.#type = type;
      this.#value = value;
      this.#options = options;
    }

    _getInfo() { return [this.#type, this.#value, this.#options]; }

    async click() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "click", null]);
    }
    async dblclick() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "dblclick", null]);
    }
    async fill(text) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "fill", text]);
    }
    async type(text) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "type", text]);
    }
    async check() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "check", null]);
    }
    async uncheck() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "uncheck", null]);
    }
    async selectOption(value) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "selectOption", value]);
    }
    async clear() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "clear", null]);
    }
    async press(key) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "press", key]);
    }
    async hover() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "hover", null]);
    }
    async focus() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "focus", null]);
    }
    async textContent() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getText", null]);
    }
    async inputValue() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getValue", null]);
    }
    async isVisible() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isVisible", null]);
    }
    async isEnabled() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isEnabled", null]);
    }
    async isChecked() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isChecked", null]);
    }
    async count() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "count", null]);
    }
    async getAttribute(name) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "getAttribute", name]);
    }
    async isDisabled() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isDisabled", null]);
    }
    async isHidden() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "isHidden", null]);
    }
    async innerHTML() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "innerHTML", null]);
    }
    async innerText() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "innerText", null]);
    }
    async allTextContents() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "allTextContents", null]);
    }
    async allInnerTexts() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "allInnerTexts", null]);
    }
    async waitFor(options) {
      return __pw_invoke("locatorAction", [...this._getInfo(), "waitFor", options || {}]);
    }
    async boundingBox() {
      return __pw_invoke("locatorAction", [...this._getInfo(), "boundingBox", null]);
    }
    locator(selector) {
      const parentSelector = this.#type === 'css' ? this.#value : null;
      if (parentSelector) {
        return new Locator("css", parentSelector + " " + selector, this.#options);
      }
      // For non-css locators, use css with the combined approach
      return new Locator("css", selector, this.#options);
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
      return new Locator(this.#type, this.#value, JSON.stringify({ ...existingOpts, nth: index }));
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
      if (options.hasText instanceof RegExp) {
        serializedFilter.hasText = { $regex: options.hasText.source, $flags: options.hasText.flags };
      }
      if (options.hasNotText instanceof RegExp) {
        serializedFilter.hasNotText = { $regex: options.hasNotText.source, $flags: options.hasNotText.flags };
      }
      return new Locator(this.#type, this.#value, JSON.stringify({ ...existingOpts, filter: serializedFilter }));
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

    const locatorMatchers = {
      async toBeVisible(options) {
        return __pw_invoke("expectLocator", [...info, "toBeVisible", null, false, options?.timeout]);
      },
      async toContainText(expected, options) {
        const serialized = expected instanceof RegExp ? { $regex: expected.source, $flags: expected.flags } : expected;
        return __pw_invoke("expectLocator", [...info, "toContainText", serialized, false, options?.timeout]);
      },
      async toHaveValue(expected, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, false, options?.timeout]);
      },
      async toBeEnabled(options) {
        return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, false, options?.timeout]);
      },
      async toBeChecked(options) {
        return __pw_invoke("expectLocator", [...info, "toBeChecked", null, false, options?.timeout]);
      },
      async toHaveAttribute(name, value, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveAttribute", { name, value }, false, options?.timeout]);
      },
      async toHaveText(expected, options) {
        const serialized = expected instanceof RegExp ? { $regex: expected.source, $flags: expected.flags } : expected;
        return __pw_invoke("expectLocator", [...info, "toHaveText", serialized, false, options?.timeout]);
      },
      async toHaveCount(count, options) {
        return __pw_invoke("expectLocator", [...info, "toHaveCount", count, false, options?.timeout]);
      },
      async toBeHidden(options) {
        return __pw_invoke("expectLocator", [...info, "toBeHidden", null, false, options?.timeout]);
      },
      async toBeDisabled(options) {
        return __pw_invoke("expectLocator", [...info, "toBeDisabled", null, false, options?.timeout]);
      },
      async toBeFocused(options) {
        return __pw_invoke("expectLocator", [...info, "toBeFocused", null, false, options?.timeout]);
      },
      async toBeEmpty(options) {
        return __pw_invoke("expectLocator", [...info, "toBeEmpty", null, false, options?.timeout]);
      },
      not: {
        async toBeVisible(options) {
          return __pw_invoke("expectLocator", [...info, "toBeVisible", null, true, options?.timeout]);
        },
        async toContainText(expected, options) {
          const serialized = expected instanceof RegExp ? { $regex: expected.source, $flags: expected.flags } : expected;
          return __pw_invoke("expectLocator", [...info, "toContainText", serialized, true, options?.timeout]);
        },
        async toHaveValue(expected, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, true, options?.timeout]);
        },
        async toBeEnabled(options) {
          return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, true, options?.timeout]);
        },
        async toBeChecked(options) {
          return __pw_invoke("expectLocator", [...info, "toBeChecked", null, true, options?.timeout]);
        },
        async toHaveAttribute(name, value, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveAttribute", { name, value }, true, options?.timeout]);
        },
        async toHaveText(expected, options) {
          const serialized = expected instanceof RegExp ? { $regex: expected.source, $flags: expected.flags } : expected;
          return __pw_invoke("expectLocator", [...info, "toHaveText", serialized, true, options?.timeout]);
        },
        async toHaveCount(count, options) {
          return __pw_invoke("expectLocator", [...info, "toHaveCount", count, true, options?.timeout]);
        },
        async toBeHidden(options) {
          return __pw_invoke("expectLocator", [...info, "toBeHidden", null, true, options?.timeout]);
        },
        async toBeDisabled(options) {
          return __pw_invoke("expectLocator", [...info, "toBeDisabled", null, true, options?.timeout]);
        },
        async toBeFocused(options) {
          return __pw_invoke("expectLocator", [...info, "toBeFocused", null, true, options?.timeout]);
        },
        async toBeEmpty(options) {
          return __pw_invoke("expectLocator", [...info, "toBeEmpty", null, true, options?.timeout]);
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

  // Only extend expect if test-environment already defined it
  if (typeof globalThis.expect === 'function') {
    const originalExpect = globalThis.expect;
    globalThis.expect = function(actual) {
      const baseMatchers = originalExpect(actual);
      // If actual is a Locator, add locator-specific matchers
      if (actual && actual.constructor && actual.constructor.name === 'Locator') {
        return createLocatorMatchers(actual, baseMatchers);
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
