import ivm from "isolated-vm";
import type { Page, Locator as PlaywrightLocator } from "playwright";

// ============================================================================
// Types and Interfaces (Pattern 2, 3)
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
// Error Encoding Helpers (Pattern 8)
// ============================================================================

const KNOWN_ERROR_TYPES = [
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "TimeoutError",
] as const;

function getErrorConstructorName(errorType: string): string {
  return (KNOWN_ERROR_TYPES as readonly string[]).includes(errorType)
    ? errorType
    : "Error";
}

function encodeErrorForTransfer(err: Error): Error {
  const errorType = getErrorConstructorName(err.name);
  return new Error(`[${errorType}]${err.message}`);
}

const DECODE_ERROR_JS = `
function __decodeError(err) {
  if (!(err instanceof Error)) return err;
  const match = err.message.match(/^\\[(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError|TimeoutError|Error)\\](.*)$/);
  if (match) {
    const ErrorType = globalThis[match[1]] || Error;
    return new ErrorType(match[2]);
  }
  return err;
}
`.trim();

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
// Setup Playwright (Pattern 2)
// ============================================================================

export async function setupPlaywright(
  context: ivm.Context,
  options: PlaywrightOptions
): Promise<PlaywrightHandle> {
  const { page, timeout = 30000, baseUrl } = options;

  // State for collected data
  const consoleLogs: ConsoleLogEntry[] = [];
  const networkRequests: NetworkRequestInfo[] = [];
  const networkResponses: NetworkResponseInfo[] = [];

  const global = context.global;

  // ========================================================================
  // Event Capture
  // ========================================================================

  const requestHandler = (request: import("playwright").Request) => {
    const info: NetworkRequestInfo = {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData() ?? undefined,
      resourceType: request.resourceType(),
      timestamp: Date.now(),
    };
    networkRequests.push(info);
    options.onNetworkRequest?.(info);
  };

  const responseHandler = (response: import("playwright").Response) => {
    const info: NetworkResponseInfo = {
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      headers: response.headers(),
      timestamp: Date.now(),
    };
    networkResponses.push(info);
    options.onNetworkResponse?.(info);
  };

  const consoleHandler = (msg: import("playwright").ConsoleMessage) => {
    const entry: ConsoleLogEntry = {
      level: msg.type(),
      args: msg.args().map((arg) => String(arg)),
      timestamp: Date.now(),
    };
    consoleLogs.push(entry);
    options.onConsoleLog?.(entry.level, ...entry.args);
  };

  page.on("request", requestHandler);
  page.on("response", responseHandler);
  page.on("console", consoleHandler);

  // ========================================================================
  // Page Operations - Async References (Pattern 6, 10)
  // ========================================================================

  // goto
  global.setSync(
    "__Playwright_goto_ref",
    new ivm.Reference(async (url: string, waitUntil?: string) => {
      try {
        const targetUrl = baseUrl && !url.startsWith("http") ? `${baseUrl}${url}` : url;
        await page.goto(targetUrl, {
          timeout,
          waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
        });
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // reload
  global.setSync(
    "__Playwright_reload_ref",
    new ivm.Reference(async () => {
      try {
        await page.reload({ timeout });
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // url (sync callback)
  global.setSync(
    "__Playwright_url",
    new ivm.Callback(() => {
      return page.url();
    })
  );

  // title
  global.setSync(
    "__Playwright_title_ref",
    new ivm.Reference(async () => {
      try {
        return await page.title();
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // content
  global.setSync(
    "__Playwright_content_ref",
    new ivm.Reference(async () => {
      try {
        return await page.content();
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // waitForSelector
  global.setSync(
    "__Playwright_waitForSelector_ref",
    new ivm.Reference(async (selector: string, optionsJson?: string) => {
      try {
        const opts = optionsJson ? JSON.parse(optionsJson) : {};
        await page.waitForSelector(selector, { timeout, ...opts });
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // waitForTimeout
  global.setSync(
    "__Playwright_waitForTimeout_ref",
    new ivm.Reference(async (ms: number) => {
      try {
        await page.waitForTimeout(ms);
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // waitForLoadState
  global.setSync(
    "__Playwright_waitForLoadState_ref",
    new ivm.Reference(async (state?: string) => {
      try {
        await page.waitForLoadState(
          (state as "load" | "domcontentloaded" | "networkidle") ?? "load",
          { timeout }
        );
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // evaluate
  global.setSync(
    "__Playwright_evaluate_ref",
    new ivm.Reference(async (script: string) => {
      try {
        const result = await page.evaluate(script);
        // Only return serializable values
        return JSON.stringify(result);
      } catch (err) {
        if (err instanceof Error) {
          throw encodeErrorForTransfer(err);
        }
        throw err;
      }
    })
  );

  // ========================================================================
  // Locator Operations (Pattern 14 - JSON serialization)
  // ========================================================================

  global.setSync(
    "__Playwright_locatorAction_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        action: string,
        actionArg: string | null
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);

          switch (action) {
            case "click":
              await locator.click({ timeout });
              return null;
            case "dblclick":
              await locator.dblclick({ timeout });
              return null;
            case "fill":
              await locator.fill(actionArg ?? "", { timeout });
              return null;
            case "type":
              await locator.pressSequentially(actionArg ?? "", { timeout });
              return null;
            case "check":
              await locator.check({ timeout });
              return null;
            case "uncheck":
              await locator.uncheck({ timeout });
              return null;
            case "selectOption":
              await locator.selectOption(actionArg ?? "", { timeout });
              return null;
            case "clear":
              await locator.clear({ timeout });
              return null;
            case "press":
              await locator.press(actionArg ?? "", { timeout });
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
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  // ========================================================================
  // Expect Operations
  // ========================================================================

  global.setSync(
    "__Playwright_expectVisible_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        not: boolean
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);
          const isVisible = await locator.isVisible();
          if (not) {
            if (isVisible) {
              throw new Error(`Expected element to not be visible, but it was visible`);
            }
          } else {
            if (!isVisible) {
              throw new Error(`Expected element to be visible, but it was not`);
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  global.setSync(
    "__Playwright_expectText_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        expected: string,
        not: boolean
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);
          const text = await locator.textContent({ timeout });
          const matches = text?.includes(expected) ?? false;
          if (not) {
            if (matches) {
              throw new Error(`Expected text to not contain "${expected}", but got "${text}"`);
            }
          } else {
            if (!matches) {
              throw new Error(`Expected text to contain "${expected}", but got "${text}"`);
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  global.setSync(
    "__Playwright_expectValue_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        expected: string,
        not: boolean
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);
          const value = await locator.inputValue({ timeout });
          const matches = value === expected;
          if (not) {
            if (matches) {
              throw new Error(`Expected value to not be "${expected}", but it was`);
            }
          } else {
            if (!matches) {
              throw new Error(`Expected value to be "${expected}", but got "${value}"`);
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  global.setSync(
    "__Playwright_expectEnabled_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        not: boolean
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);
          const isEnabled = await locator.isEnabled();
          if (not) {
            if (isEnabled) {
              throw new Error(`Expected element to be disabled, but it was enabled`);
            }
          } else {
            if (!isEnabled) {
              throw new Error(`Expected element to be enabled, but it was disabled`);
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  global.setSync(
    "__Playwright_expectChecked_ref",
    new ivm.Reference(
      async (
        selectorType: string,
        selectorValue: string,
        roleOptionsJson: string | null,
        not: boolean
      ) => {
        try {
          const locator = getLocator(page, selectorType, selectorValue, roleOptionsJson);
          const isChecked = await locator.isChecked();
          if (not) {
            if (isChecked) {
              throw new Error(`Expected element to not be checked, but it was checked`);
            }
          } else {
            if (!isChecked) {
              throw new Error(`Expected element to be checked, but it was not`);
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            throw encodeErrorForTransfer(err);
          }
          throw err;
        }
      }
    )
  );

  // ========================================================================
  // Injected JavaScript (Pattern 7, 21)
  // ========================================================================

  // Error decoder helper
  context.evalSync(DECODE_ERROR_JS);

  // Test framework (Pattern 21)
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
      try {
        return __Playwright_goto_ref.applySyncPromise(undefined, [url, options?.waitUntil || null]);
      } catch (err) { throw __decodeError(err); }
    },
    async reload() {
      try {
        return __Playwright_reload_ref.applySyncPromise(undefined, []);
      } catch (err) { throw __decodeError(err); }
    },
    url() { return __Playwright_url(); },
    async title() {
      try {
        return __Playwright_title_ref.applySyncPromise(undefined, []);
      } catch (err) { throw __decodeError(err); }
    },
    async content() {
      try {
        return __Playwright_content_ref.applySyncPromise(undefined, []);
      } catch (err) { throw __decodeError(err); }
    },
    async waitForSelector(selector, options) {
      try {
        return __Playwright_waitForSelector_ref.applySyncPromise(undefined, [selector, options ? JSON.stringify(options) : null]);
      } catch (err) { throw __decodeError(err); }
    },
    async waitForTimeout(ms) {
      try {
        return __Playwright_waitForTimeout_ref.applySyncPromise(undefined, [ms]);
      } catch (err) { throw __decodeError(err); }
    },
    async waitForLoadState(state) {
      try {
        return __Playwright_waitForLoadState_ref.applySyncPromise(undefined, [state]);
      } catch (err) { throw __decodeError(err); }
    },
    async evaluate(script) {
      try {
        const resultJson = __Playwright_evaluate_ref.applySyncPromise(undefined, [script]);
        return resultJson ? JSON.parse(resultJson) : undefined;
      } catch (err) { throw __decodeError(err); }
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

  // Locator class (Pure JS with private fields - stays in isolate)
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
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "click", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async dblclick() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "dblclick", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async fill(text) {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "fill", text]);
      } catch (err) { throw __decodeError(err); }
    }

    async type(text) {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "type", text]);
      } catch (err) { throw __decodeError(err); }
    }

    async check() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "check", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async uncheck() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "uncheck", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async selectOption(value) {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "selectOption", value]);
      } catch (err) { throw __decodeError(err); }
    }

    async clear() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "clear", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async press(key) {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "press", key]);
      } catch (err) { throw __decodeError(err); }
    }

    async hover() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "hover", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async focus() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "focus", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async textContent() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "getText", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async inputValue() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "getValue", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async isVisible() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "isVisible", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async isEnabled() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "isEnabled", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async isChecked() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "isChecked", null]);
      } catch (err) { throw __decodeError(err); }
    }

    async count() {
      try {
        return __Playwright_locatorAction_ref.applySyncPromise(undefined, [...this._getInfo(), "count", null]);
      } catch (err) { throw __decodeError(err); }
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
          try {
            await __Playwright_expectVisible_ref.applySyncPromise(undefined, [...info, false]);
          } catch (err) { throw __decodeError(err); }
        },
        async toContainText(expected) {
          try {
            await __Playwright_expectText_ref.applySyncPromise(undefined, [...info, expected, false]);
          } catch (err) { throw __decodeError(err); }
        },
        async toHaveValue(expected) {
          try {
            await __Playwright_expectValue_ref.applySyncPromise(undefined, [...info, expected, false]);
          } catch (err) { throw __decodeError(err); }
        },
        async toBeEnabled() {
          try {
            await __Playwright_expectEnabled_ref.applySyncPromise(undefined, [...info, false]);
          } catch (err) { throw __decodeError(err); }
        },
        async toBeChecked() {
          try {
            await __Playwright_expectChecked_ref.applySyncPromise(undefined, [...info, false]);
          } catch (err) { throw __decodeError(err); }
        },
        not: {
          async toBeVisible() {
            try {
              await __Playwright_expectVisible_ref.applySyncPromise(undefined, [...info, true]);
            } catch (err) { throw __decodeError(err); }
          },
          async toContainText(expected) {
            try {
              await __Playwright_expectText_ref.applySyncPromise(undefined, [...info, expected, true]);
            } catch (err) { throw __decodeError(err); }
          },
          async toHaveValue(expected) {
            try {
              await __Playwright_expectValue_ref.applySyncPromise(undefined, [...info, expected, true]);
            } catch (err) { throw __decodeError(err); }
          },
          async toBeEnabled() {
            try {
              await __Playwright_expectEnabled_ref.applySyncPromise(undefined, [...info, true]);
            } catch (err) { throw __decodeError(err); }
          },
          async toBeChecked() {
            try {
              await __Playwright_expectChecked_ref.applySyncPromise(undefined, [...info, true]);
            } catch (err) { throw __decodeError(err); }
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
  // Return Handle (Pattern 3)
  // ========================================================================

  return {
    dispose() {
      page.off("request", requestHandler);
      page.off("response", responseHandler);
      page.off("console", consoleHandler);
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
