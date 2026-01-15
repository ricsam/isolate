import ivm from "isolated-vm";
import type { Page, Locator as PlaywrightLocator } from "playwright";
import type {
  PlaywrightOperation,
  PlaywrightResult,
} from "@ricsam/isolate-protocol";

// Re-export protocol types
export type { PlaywrightOperation, PlaywrightResult } from "@ricsam/isolate-protocol";

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

export interface ConsoleLogEntry {
  level: string;
  args: string[];
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
  /** Callback for console log events */
  onConsoleLog?: (entry: ConsoleLogEntry) => void;
  /** Callback for network request events */
  onNetworkRequest?: (info: NetworkRequestInfo) => void;
  /** Callback for network response events */
  onNetworkResponse?: (info: NetworkResponseInfo) => void;
}

/**
 * @deprecated Use PlaywrightSetupOptions instead
 */
export interface PlaywrightOptions {
  page: Page;
  timeout?: number;
  baseUrl?: string;
  onConsoleLog?: (level: string, ...args: unknown[]) => void;
  onNetworkRequest?: (info: NetworkRequestInfo) => void;
  onNetworkResponse?: (info: NetworkResponseInfo) => void;
}

export interface PlaywrightHandle {
  dispose(): void;
  getConsoleLogs(): ConsoleLogEntry[];
  getNetworkRequests(): NetworkRequestInfo[];
  getNetworkResponses(): NetworkResponseInfo[];
  clearCollected(): void;
}

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export interface PlaywrightExecutionResult {
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
}

// ============================================================================
// Helper: Get locator from selector info
// ============================================================================

function getLocator(
  page: Page,
  selectorType: string,
  selectorValue: string,
  roleOptionsJson: string | null
): PlaywrightLocator {
  switch (selectorType) {
    case "css":
      return page.locator(selectorValue);
    case "role": {
      const roleOptions = roleOptionsJson ? JSON.parse(roleOptionsJson) : undefined;
      return page.getByRole(selectorValue as Parameters<Page["getByRole"]>[0], roleOptions);
    }
    case "text":
      return page.getByText(selectorValue);
    case "label":
      return page.getByLabel(selectorValue);
    case "placeholder":
      return page.getByPlaceholder(selectorValue);
    case "testId":
      return page.getByTestId(selectorValue);
    default:
      return page.locator(selectorValue);
  }
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
      const matches = text?.includes(String(expected)) ?? false;
      if (negated) {
        if (matches) throw new Error(`Expected text to not contain "${expected}", but got "${text}"`);
      } else {
        if (!matches) throw new Error(`Expected text to contain "${expected}", but got "${text}"`);
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
          const [selectorType, selectorValue, roleOptions, matcher, expected, negated] = op.args as [
            string,
            string,
            string | null,
            string,
            unknown,
            boolean
          ];
          const locator = getLocator(page, selectorType, selectorValue, roleOptions);
          await executeExpectAssertion(locator, matcher, expected, negated ?? false, timeout);
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
  const consoleLogs: ConsoleLogEntry[] = [];
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
      if ("onNetworkRequest" in options && options.onNetworkRequest) {
        options.onNetworkRequest(info);
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
      if ("onNetworkResponse" in options && options.onNetworkResponse) {
        options.onNetworkResponse(info);
      }
    };

    consoleHandler = (msg: import("playwright").ConsoleMessage) => {
      const entry: ConsoleLogEntry = {
        level: msg.type(),
        args: msg.args().map((arg) => String(arg)),
        timestamp: Date.now(),
      };
      consoleLogs.push(entry);
      if ("onConsoleLog" in options && options.onConsoleLog) {
        // Handle both old and new signature
        if ("page" in options && options.page && !("handler" in options)) {
          // Old PlaywrightOptions: onConsoleLog(level, ...args)
          (options.onConsoleLog as (level: string, ...args: unknown[]) => void)(entry.level, ...entry.args);
        } else {
          // New PlaywrightSetupOptions: onConsoleLog(entry)
          (options.onConsoleLog as (entry: ConsoleLogEntry) => void)(entry);
        }
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

  // Test framework
  context.evalSync(`
(function() {
  const tests = [];
  globalThis.test = (name, fn) => tests.push({ name, fn });

  globalThis.__runPlaywrightTests = async () => {
    const results = [];
    for (const t of tests) {
      const start = Date.now();
      try {
        await t.fn();
        results.push({ name: t.name, passed: true, duration: Date.now() - start });
      } catch (err) {
        results.push({ name: t.name, passed: false, error: err.message, duration: Date.now() - start });
      }
    }
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    return JSON.stringify({ passed, failed, total: results.length, results });
  };

  globalThis.__resetPlaywrightTests = () => { tests.length = 0; };
})();
`);

  // Page object
  context.evalSync(`
(function() {
  globalThis.page = {
    async goto(url, options) {
      return __pw_invoke("goto", [url, options?.waitUntil || null]);
    },
    async reload() {
      return __pw_invoke("reload", []);
    },
    async url() {
      return __pw_invoke("url", []);
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
      return __pw_invoke("evaluate", [script]);
    },
    locator(selector) { return new Locator("css", selector, null); },
    getByRole(role, options) { return new Locator("role", role, options ? JSON.stringify(options) : null); },
    getByText(text) { return new Locator("text", text, null); },
    getByLabel(label) { return new Locator("label", label, null); },
    getByPlaceholder(p) { return new Locator("placeholder", p, null); },
    getByTestId(id) { return new Locator("testId", id, null); },
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
  }
  globalThis.Locator = Locator;
})();
`);

  // Expect for locators
  context.evalSync(`
(function() {
  globalThis.expect = (actual) => {
    if (actual instanceof Locator) {
      const info = actual._getInfo();
      return {
        async toBeVisible() {
          return __pw_invoke("expectLocator", [...info, "toBeVisible", null, false]);
        },
        async toContainText(expected) {
          return __pw_invoke("expectLocator", [...info, "toContainText", expected, false]);
        },
        async toHaveValue(expected) {
          return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, false]);
        },
        async toBeEnabled() {
          return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, false]);
        },
        async toBeChecked() {
          return __pw_invoke("expectLocator", [...info, "toBeChecked", null, false]);
        },
        not: {
          async toBeVisible() {
            return __pw_invoke("expectLocator", [...info, "toBeVisible", null, true]);
          },
          async toContainText(expected) {
            return __pw_invoke("expectLocator", [...info, "toContainText", expected, true]);
          },
          async toHaveValue(expected) {
            return __pw_invoke("expectLocator", [...info, "toHaveValue", expected, true]);
          },
          async toBeEnabled() {
            return __pw_invoke("expectLocator", [...info, "toBeEnabled", null, true]);
          },
          async toBeChecked() {
            return __pw_invoke("expectLocator", [...info, "toBeChecked", null, true]);
          },
        },
      };
    }
    // Fallback: basic matchers for primitives
    return {
      toBe(expected) {
        if (actual !== expected) throw new Error(\`Expected \${JSON.stringify(actual)} to be \${JSON.stringify(expected)}\`);
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(\`Expected \${JSON.stringify(actual)} to equal \${JSON.stringify(expected)}\`);
        }
      },
      toBeTruthy() {
        if (!actual) throw new Error(\`Expected \${JSON.stringify(actual)} to be truthy\`);
      },
      toBeFalsy() {
        if (actual) throw new Error(\`Expected \${JSON.stringify(actual)} to be falsy\`);
      },
      toContain(expected) {
        if (typeof actual === 'string' && !actual.includes(expected)) {
          throw new Error(\`Expected "\${actual}" to contain "\${expected}"\`);
        }
        if (Array.isArray(actual) && !actual.includes(expected)) {
          throw new Error(\`Expected array to contain \${JSON.stringify(expected)}\`);
        }
      },
      not: {
        toBe(expected) {
          if (actual === expected) throw new Error(\`Expected \${JSON.stringify(actual)} to not be \${JSON.stringify(expected)}\`);
        },
        toEqual(expected) {
          if (JSON.stringify(actual) === JSON.stringify(expected)) {
            throw new Error(\`Expected \${JSON.stringify(actual)} to not equal \${JSON.stringify(expected)}\`);
          }
        },
        toBeTruthy() {
          if (actual) throw new Error(\`Expected \${JSON.stringify(actual)} to not be truthy\`);
        },
        toBeFalsy() {
          if (!actual) throw new Error(\`Expected \${JSON.stringify(actual)} to not be falsy\`);
        },
        toContain(expected) {
          if (typeof actual === 'string' && actual.includes(expected)) {
            throw new Error(\`Expected "\${actual}" to not contain "\${expected}"\`);
          }
          if (Array.isArray(actual) && actual.includes(expected)) {
            throw new Error(\`Expected array to not contain \${JSON.stringify(expected)}\`);
          }
        },
      },
    };
  };
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
      consoleLogs.length = 0;
      networkRequests.length = 0;
      networkResponses.length = 0;
    },
    getConsoleLogs() {
      return [...consoleLogs];
    },
    getNetworkRequests() {
      return [...networkRequests];
    },
    getNetworkResponses() {
      return [...networkResponses];
    },
    clearCollected() {
      consoleLogs.length = 0;
      networkRequests.length = 0;
      networkResponses.length = 0;
    },
  };
}

// ============================================================================
// Run Playwright Tests
// ============================================================================

export async function runPlaywrightTests(
  context: ivm.Context
): Promise<PlaywrightExecutionResult> {
  const runTestsRef = context.global.getSync("__runPlaywrightTests", {
    reference: true,
  }) as ivm.Reference<() => Promise<string>>;

  const resultJson = await runTestsRef.apply(undefined, [], {
    result: { promise: true },
  });

  return JSON.parse(resultJson as string) as PlaywrightExecutionResult;
}

export async function resetPlaywrightTests(context: ivm.Context): Promise<void> {
  context.evalSync("__resetPlaywrightTests()");
}
