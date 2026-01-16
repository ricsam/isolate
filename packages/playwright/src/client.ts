/**
 * Client-safe exports for @ricsam/isolate-playwright
 * This module can be imported without loading isolated-vm
 */

import type { Page, Locator as PlaywrightLocator } from "playwright";
import type {
  PlaywrightOperation,
  PlaywrightResult,
} from "@ricsam/isolate-protocol";

// Re-export types
export type {
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  PlaywrightSetupOptions,
  PlaywrightOptions,
  PlaywrightHandle,
} from "./types.ts";

// Import PlaywrightCallback for use in function return type
import type { PlaywrightCallback } from "./types.ts";
export type { PlaywrightCallback };

export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent } from "@ricsam/isolate-protocol";

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
        default:
          return { ok: false, error: { name: "Error", message: `Unknown operation: ${(op as PlaywrightOperation).type}` } };
      }
    } catch (err) {
      const error = err as Error;
      return { ok: false, error: { name: error.name, message: error.message } };
    }
  };
}
