/**
 * Client-safe exports for @ricsam/isolate-playwright
 * This module can be imported without loading isolated-vm
 */

import type { Page, Locator as PlaywrightLocator, BrowserContext, BrowserContextOptions } from "playwright";
import type {
  PlaywrightOperation,
  PlaywrightResult,
} from "@ricsam/isolate-protocol";

// Re-export types
export type {
  NetworkRequestInfo,
  NetworkResponseInfo,
  BrowserConsoleLogEntry,
  DefaultPlaywrightHandler,
  DefaultPlaywrightHandlerMetadata,
  DefaultPlaywrightHandlerOptions,
  PlaywrightSetupOptions,
  PlaywrightHandle,
} from "./types.ts";

// Import PlaywrightCallback for use in function return type
import {
  DEFAULT_PLAYWRIGHT_HANDLER_META,
  type DefaultPlaywrightHandler,
  type DefaultPlaywrightHandlerMetadata,
  type DefaultPlaywrightHandlerOptions,
  type PlaywrightCallback,
  type PlaywrightSetupOptions,
} from "./types.ts";
export type { PlaywrightCallback };

export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent, PlaywrightFileData } from "@ricsam/isolate-protocol";

// ============================================================================
// Types for file I/O callbacks
// ============================================================================

type ReadFileCallback = NonNullable<PlaywrightSetupOptions['readFile']>;
type WriteFileCallback = NonNullable<PlaywrightSetupOptions['writeFile']>;

interface FileIOCallbacks {
  readFile?: ReadFileCallback;
  writeFile?: WriteFileCallback;
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
    case "or": {
      // Composite locator: selectorValue is JSON array of [firstInfo, secondInfo]
      const [firstInfo, secondInfo] = JSON.parse(selectorValue) as [[string, string, string | null], [string, string, string | null]];
      const first = getLocator(page, firstInfo[0], firstInfo[1], firstInfo[2]);
      const second = getLocator(page, secondInfo[0], secondInfo[1], secondInfo[2]);
      locator = first.or(second);
      break;
    }
    case "and": {
      // Composite locator: selectorValue is JSON array of [firstInfo, secondInfo]
      const [firstInfo, secondInfo] = JSON.parse(selectorValue) as [[string, string, string | null], [string, string, string | null]];
      const first = getLocator(page, firstInfo[0], firstInfo[1], firstInfo[2]);
      const second = getLocator(page, secondInfo[0], secondInfo[1], secondInfo[2]);
      locator = first.and(second);
      break;
    }
    case "chained": {
      // Chained locator: selectorValue is JSON array of [parentInfo, childInfo]
      const [parentInfo, childInfo] = JSON.parse(selectorValue) as [[string, string, string | null], [string, string, string | null]];
      const parent = getLocator(page, parentInfo[0], parentInfo[1], parentInfo[2]);
      // Resolve child relative to parent
      const childType = childInfo[0];
      const childValue = childInfo[1];
      const childOptionsJson = childInfo[2];
      const childOptions = childOptionsJson ? JSON.parse(childOptionsJson) : undefined;

      // For chained locators, we need to get a locator within the parent
      switch (childType) {
        case "css":
          locator = parent.locator(childValue);
          break;
        case "role": {
          const roleOpts = childOptions ? { ...childOptions } : undefined;
          if (roleOpts) {
            delete roleOpts.nth;
            delete roleOpts.filter;
            if (roleOpts.name && typeof roleOpts.name === 'object' && roleOpts.name.$regex) {
              roleOpts.name = new RegExp(roleOpts.name.$regex, roleOpts.name.$flags);
            }
          }
          locator = parent.getByRole(
            childValue as Parameters<PlaywrightLocator["getByRole"]>[0],
            roleOpts && Object.keys(roleOpts).length > 0 ? roleOpts : undefined
          );
          break;
        }
        case "text":
          locator = parent.getByText(childValue);
          break;
        case "label":
          locator = parent.getByLabel(childValue);
          break;
        case "placeholder":
          locator = parent.getByPlaceholder(childValue);
          break;
        case "testId":
          locator = parent.getByTestId(childValue);
          break;
        case "altText":
          locator = parent.getByAltText(childValue);
          break;
        case "title":
          locator = parent.getByTitle(childValue);
          break;
        default:
          locator = parent.locator(childValue);
      }

      // Apply nth to the child if specified
      if (childOptions?.nth !== undefined) {
        locator = locator.nth(childOptions.nth);
      }
      // Apply filter to the child if specified
      if (childOptions?.filter) {
        const filterOpts = { ...childOptions.filter };
        if (filterOpts.hasText && typeof filterOpts.hasText === 'object' && filterOpts.hasText.$regex) {
          filterOpts.hasText = new RegExp(filterOpts.hasText.$regex, filterOpts.hasText.$flags);
        }
        if (filterOpts.hasNotText && typeof filterOpts.hasNotText === 'object' && filterOpts.hasNotText.$regex) {
          filterOpts.hasNotText = new RegExp(filterOpts.hasNotText.$regex, filterOpts.hasNotText.$flags);
        }
        // Deserialize has/hasNot locators
        if (filterOpts.has && typeof filterOpts.has === 'object' && filterOpts.has.$locator) {
          const [type, value, opts] = filterOpts.has.$locator;
          filterOpts.has = getLocator(page, type, value, opts);
        }
        if (filterOpts.hasNot && typeof filterOpts.hasNot === 'object' && filterOpts.hasNot.$locator) {
          const [type, value, opts] = filterOpts.hasNot.$locator;
          filterOpts.hasNot = getLocator(page, type, value, opts);
        }
        locator = locator.filter(filterOpts);
      }
      break;
    }
    case "altText":
      locator = page.getByAltText(selectorValue);
      break;
    case "title":
      locator = page.getByTitle(selectorValue);
      break;
    case "frame": {
      // Frame locator: selectorValue is JSON [frameSelectorInfo, innerLocatorInfo]
      const [frameSelectorInfo, innerLocatorInfo] = JSON.parse(selectorValue) as [[string, string, string | null], [string, string, string | null]];
      const frameSelector = frameSelectorInfo[1]; // CSS selector for the iframe
      const frame = page.frameLocator(frameSelector);
      // Get the inner locator
      const innerType = innerLocatorInfo[0];
      const innerValue = innerLocatorInfo[1];
      const innerOptionsJson = innerLocatorInfo[2];
      const innerOptions = innerOptionsJson ? JSON.parse(innerOptionsJson) : undefined;

      switch (innerType) {
        case "css":
          locator = frame.locator(innerValue);
          break;
        case "role": {
          const roleOpts = innerOptions ? { ...innerOptions } : undefined;
          if (roleOpts) {
            delete roleOpts.nth;
            delete roleOpts.filter;
            if (roleOpts.name && typeof roleOpts.name === 'object' && roleOpts.name.$regex) {
              roleOpts.name = new RegExp(roleOpts.name.$regex, roleOpts.name.$flags);
            }
          }
          locator = frame.getByRole(
            innerValue as Parameters<PlaywrightLocator["getByRole"]>[0],
            roleOpts && Object.keys(roleOpts).length > 0 ? roleOpts : undefined
          );
          break;
        }
        case "text":
          locator = frame.getByText(innerValue);
          break;
        case "label":
          locator = frame.getByLabel(innerValue);
          break;
        case "placeholder":
          locator = frame.getByPlaceholder(innerValue);
          break;
        case "testId":
          locator = frame.getByTestId(innerValue);
          break;
        case "altText":
          locator = frame.getByAltText(innerValue);
          break;
        case "title":
          locator = frame.getByTitle(innerValue);
          break;
        default:
          locator = frame.locator(innerValue);
      }

      // Apply nth to the inner locator if specified
      if (innerOptions?.nth !== undefined) {
        locator = locator.nth(innerOptions.nth);
      }
      // Apply filter to the inner locator if specified
      if (innerOptions?.filter) {
        const filterOpts = { ...innerOptions.filter };
        if (filterOpts.hasText && typeof filterOpts.hasText === 'object' && filterOpts.hasText.$regex) {
          filterOpts.hasText = new RegExp(filterOpts.hasText.$regex, filterOpts.hasText.$flags);
        }
        if (filterOpts.hasNotText && typeof filterOpts.hasNotText === 'object' && filterOpts.hasNotText.$regex) {
          filterOpts.hasNotText = new RegExp(filterOpts.hasNotText.$regex, filterOpts.hasNotText.$flags);
        }
        locator = locator.filter(filterOpts);
      }
      break;
    }
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
    // Deserialize has/hasNot locators
    if (filterOpts.has && typeof filterOpts.has === 'object' && filterOpts.has.$locator) {
      const [type, value, opts] = filterOpts.has.$locator;
      filterOpts.has = getLocator(page, type, value, opts);
    }
    if (filterOpts.hasNot && typeof filterOpts.hasNot === 'object' && filterOpts.hasNot.$locator) {
      const [type, value, opts] = filterOpts.hasNot.$locator;
      filterOpts.hasNot = getLocator(page, type, value, opts);
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
  timeout: number,
  fileIO?: FileIOCallbacks
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
    case "setInputFiles": {
      const files = actionArg as string | string[] | { name: string; mimeType: string; buffer: string }[];
      // Handle empty array - clear files
      if (Array.isArray(files) && files.length === 0) {
        await locator.setInputFiles([], { timeout });
        return null;
      }
      // Handle base64 buffer format - already have the file data
      if (Array.isArray(files) && files.length > 0 && typeof files[0] === 'object' && 'buffer' in files[0]) {
        const fileBuffers = (files as { name: string; mimeType: string; buffer: string }[]).map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          buffer: Buffer.from(f.buffer, 'base64'),
        }));
        await locator.setInputFiles(fileBuffers, { timeout });
        return null;
      }
      // File paths - need readFile callback
      const filePaths = Array.isArray(files) ? files : [files];
      if (!fileIO?.readFile) {
        throw new Error(
          "setInputFiles() with file paths requires a readFile callback to be provided. " +
          "Either provide a readFile callback in defaultPlaywrightHandler options, or pass file data directly " +
          "as { name, mimeType, buffer } objects."
        );
      }
      // Read files through callback
      const fileBuffers = await Promise.all(
        (filePaths as string[]).map(async (filePath) => {
          const fileData = await fileIO.readFile!(filePath);
          return {
            name: fileData.name,
            mimeType: fileData.mimeType,
            buffer: fileData.buffer,
          };
        })
      );
      await locator.setInputFiles(fileBuffers, { timeout });
      return null;
    }
    case "screenshot": {
      const opts = actionArg as { type?: 'png' | 'jpeg'; quality?: number; path?: string } | undefined;
      // Don't pass path to Playwright - we handle file writing through callback
      const buffer = await locator.screenshot({
        timeout,
        type: opts?.type,
        quality: opts?.quality,
      });
      // If path is specified, use writeFile callback
      if (opts?.path) {
        if (!fileIO?.writeFile) {
          throw new Error(
            "screenshot() with path option requires a writeFile callback to be provided. " +
            "Either provide a writeFile callback in defaultPlaywrightHandler options, or omit the path option " +
            "and handle the returned base64 data yourself."
          );
        }
        await fileIO.writeFile(opts.path, buffer);
      }
      return buffer.toString('base64');
    }
    case "dragTo": {
      const targetInfo = actionArg as [string, string, string | null];
      // We need to resolve the target locator on the page
      // The target info is passed as selector info tuple
      const targetLocator = getLocator(locator.page(), targetInfo[0], targetInfo[1], targetInfo[2]);
      await locator.dragTo(targetLocator, { timeout });
      return null;
    }
    case "scrollIntoViewIfNeeded":
      await locator.scrollIntoViewIfNeeded({ timeout });
      return null;
    case "highlight":
      await locator.highlight();
      return null;
    case "evaluate": {
      const [fnString, arg] = actionArg as [string, unknown];
      const fn = new Function('return (' + fnString + ')')();
      return await locator.evaluate(fn, arg);
    }
    case "evaluateAll": {
      const [fnString, arg] = actionArg as [string, unknown];
      const fn = new Function('return (' + fnString + ')')();
      return await locator.evaluateAll(fn, arg);
    }
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
    case "toBeAttached": {
      const count = await locator.count();
      const isAttached = count > 0;
      if (negated) {
        if (isAttached) throw new Error("Expected element to not be attached to DOM, but it was");
      } else {
        if (!isAttached) throw new Error("Expected element to be attached to DOM, but it was not");
      }
      break;
    }
    case "toBeEditable": {
      const isEditable = await locator.isEditable({ timeout });
      if (negated) {
        if (isEditable) throw new Error("Expected element to not be editable, but it was");
      } else {
        if (!isEditable) throw new Error("Expected element to be editable, but it was not");
      }
      break;
    }
    case "toHaveClass": {
      const classAttr = await locator.getAttribute('class', { timeout }) ?? '';
      const classes = classAttr.split(/\s+/).filter(Boolean);
      let matches: boolean;
      let expectedDisplay: string;
      if (expected && typeof expected === 'object' && (expected as any).$regex) {
        const regex = new RegExp((expected as any).$regex, (expected as any).$flags);
        matches = regex.test(classAttr);
        expectedDisplay = String(regex);
      } else if (Array.isArray(expected)) {
        matches = expected.every(c => classes.includes(c));
        expectedDisplay = JSON.stringify(expected);
      } else {
        // Exact match for string
        matches = classAttr === String(expected) || classes.includes(String(expected));
        expectedDisplay = String(expected);
      }
      if (negated) {
        if (matches) throw new Error(`Expected class to not match ${expectedDisplay}, but got "${classAttr}"`);
      } else {
        if (!matches) throw new Error(`Expected class to match ${expectedDisplay}, but got "${classAttr}"`);
      }
      break;
    }
    case "toContainClass": {
      const classAttr = await locator.getAttribute('class', { timeout }) ?? '';
      const classes = classAttr.split(/\s+/).filter(Boolean);
      const expectedClass = String(expected);
      const hasClass = classes.includes(expectedClass);
      if (negated) {
        if (hasClass) throw new Error(`Expected element to not contain class "${expectedClass}", but it does`);
      } else {
        if (!hasClass) throw new Error(`Expected element to contain class "${expectedClass}", but classes are "${classAttr}"`);
      }
      break;
    }
    case "toHaveId": {
      const id = await locator.getAttribute('id', { timeout });
      const matches = id === String(expected);
      if (negated) {
        if (matches) throw new Error(`Expected id to not be "${expected}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected id to be "${expected}", but got "${id}"`);
      }
      break;
    }
    case "toBeInViewport": {
      // Use Intersection Observer API via evaluate to check if element is in viewport
      const isInViewport = await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.top < window.innerHeight &&
          rect.bottom > 0 &&
          rect.left < window.innerWidth &&
          rect.right > 0
        );
      });
      if (negated) {
        if (isInViewport) throw new Error("Expected element to not be in viewport, but it was");
      } else {
        if (!isInViewport) throw new Error("Expected element to be in viewport, but it was not");
      }
      break;
    }
    case "toHaveCSS": {
      const { name, value } = expected as { name: string; value: unknown };
      const actual = await locator.evaluate((el, propName) => {
        return getComputedStyle(el).getPropertyValue(propName);
      }, name);
      let matches: boolean;
      if (value && typeof value === 'object' && (value as any).$regex) {
        const regex = new RegExp((value as any).$regex, (value as any).$flags);
        matches = regex.test(actual);
      } else {
        matches = actual === String(value);
      }
      if (negated) {
        if (matches) throw new Error(`Expected CSS "${name}" to not be "${value}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected CSS "${name}" to be "${value}", but got "${actual}"`);
      }
      break;
    }
    case "toHaveJSProperty": {
      const { name, value } = expected as { name: string; value: unknown };
      const actual = await locator.evaluate((el, propName) => {
        return (el as any)[propName];
      }, name);
      const matches = JSON.stringify(actual) === JSON.stringify(value);
      if (negated) {
        if (matches) throw new Error(`Expected JS property "${name}" to not be ${JSON.stringify(value)}, but it was`);
      } else {
        if (!matches) throw new Error(`Expected JS property "${name}" to be ${JSON.stringify(value)}, but got ${JSON.stringify(actual)}`);
      }
      break;
    }
    case "toHaveAccessibleName": {
      const accessibleName = await locator.evaluate((el) => {
        return el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLElement).innerText || '';
      });
      let matches: boolean;
      if (expected && typeof expected === 'object' && (expected as any).$regex) {
        const regex = new RegExp((expected as any).$regex, (expected as any).$flags);
        matches = regex.test(accessibleName);
      } else {
        matches = accessibleName === String(expected);
      }
      if (negated) {
        if (matches) throw new Error(`Expected accessible name to not be "${expected}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected accessible name to be "${expected}", but got "${accessibleName}"`);
      }
      break;
    }
    case "toHaveAccessibleDescription": {
      const accessibleDesc = await locator.evaluate((el) => {
        const describedby = el.getAttribute('aria-describedby');
        if (describedby) {
          const descEl = document.getElementById(describedby);
          return descEl?.textContent || '';
        }
        return el.getAttribute('aria-description') || '';
      });
      let matches: boolean;
      if (expected && typeof expected === 'object' && (expected as any).$regex) {
        const regex = new RegExp((expected as any).$regex, (expected as any).$flags);
        matches = regex.test(accessibleDesc);
      } else {
        matches = accessibleDesc === String(expected);
      }
      if (negated) {
        if (matches) throw new Error(`Expected accessible description to not be "${expected}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected accessible description to be "${expected}", but got "${accessibleDesc}"`);
      }
      break;
    }
    case "toHaveRole": {
      const role = await locator.evaluate((el) => {
        return el.getAttribute('role') || el.tagName.toLowerCase();
      });
      const matches = role === String(expected);
      if (negated) {
        if (matches) throw new Error(`Expected role to not be "${expected}", but it was`);
      } else {
        if (!matches) throw new Error(`Expected role to be "${expected}", but got "${role}"`);
      }
      break;
    }
    default:
      throw new Error(`Unknown matcher: ${matcher}`);
  }
}

// ============================================================================
// Helper: Execute page expect assertion
// ============================================================================

async function executePageExpectAssertion(
  page: Page,
  matcher: string,
  expected: unknown,
  negated: boolean,
  timeout: number
): Promise<void> {
  // Deserialize regex if needed
  let expectedValue = expected;
  if (expected && typeof expected === 'object' && (expected as { $regex?: string }).$regex) {
    expectedValue = new RegExp(
      (expected as { $regex: string }).$regex,
      (expected as { $flags?: string }).$flags
    );
  }

  switch (matcher) {
    case "toHaveURL": {
      const expectedUrl = expectedValue as string | RegExp;
      const startTime = Date.now();
      let lastUrl = "";
      while (Date.now() - startTime < timeout) {
        lastUrl = page.url();
        const matches = expectedUrl instanceof RegExp
          ? expectedUrl.test(lastUrl)
          : lastUrl === expectedUrl;
        if (negated ? !matches : matches) return;
        await new Promise(r => setTimeout(r, 100));
      }
      if (negated) {
        throw new Error(`Expected URL to not match "${expectedUrl}", but got "${lastUrl}"`);
      } else {
        throw new Error(`Expected URL to be "${expectedUrl}", but got "${lastUrl}"`);
      }
    }
    case "toHaveTitle": {
      const expectedTitle = expectedValue as string | RegExp;
      const startTime = Date.now();
      let lastTitle = "";
      while (Date.now() - startTime < timeout) {
        lastTitle = await page.title();
        const matches = expectedTitle instanceof RegExp
          ? expectedTitle.test(lastTitle)
          : lastTitle === expectedTitle;
        if (negated ? !matches : matches) return;
        await new Promise(r => setTimeout(r, 100));
      }
      if (negated) {
        throw new Error(`Expected title to not match "${expectedTitle}", but got "${lastTitle}"`);
      } else {
        throw new Error(`Expected title to be "${expectedTitle}", but got "${lastTitle}"`);
      }
    }
    default:
      throw new Error(`Unknown page matcher: ${matcher}`);
  }
}

// ============================================================================
// Create Playwright Handler (for remote use)
// ============================================================================

/**
 * Registry for tracking multiple pages and contexts.
 */
interface PlaywrightRegistry {
  pages: Map<string, Page>;
  contexts: Map<string, BrowserContext>;
  nextPageId: number;
  nextContextId: number;
}

/**
 * Create a playwright handler from a Page object.
 * This handler is called by the daemon (via callback) when sandbox needs page operations.
 * Used for remote runtime where the browser runs on the client.
 */
export function createPlaywrightHandler(
  page: Page,
  options?: DefaultPlaywrightHandlerOptions
): PlaywrightCallback {
  const timeout = options?.timeout ?? 30000;
  const fileIO: FileIOCallbacks = {
    readFile: options?.readFile,
    writeFile: options?.writeFile,
  };

  // Registry for tracking multiple pages and contexts
  const registry: PlaywrightRegistry = {
    pages: new Map<string, Page>([["page_0", page]]),
    contexts: new Map<string, BrowserContext>([["ctx_0", page.context()]]),
    nextPageId: 1,
    nextContextId: 1,
  };

  return async (op: PlaywrightOperation): Promise<PlaywrightResult> => {
    try {
      // Handle lifecycle operations first (they don't require existing page)
      switch (op.type) {
        case "newContext": {
          if (!options?.createContext) {
            return { ok: false, error: { name: "Error", message: "createContext callback not provided. Configure createContext in playwright options to enable browser.newContext()." } };
          }
          const [contextOptions] = op.args as [BrowserContextOptions?];
          const newContext = await options.createContext(contextOptions);
          const contextId = `ctx_${registry.nextContextId++}`;
          registry.contexts.set(contextId, newContext);
          return { ok: true, value: { contextId } };
        }

        case "newPage": {
          if (!options?.createPage) {
            return { ok: false, error: { name: "Error", message: "createPage callback not provided. Configure createPage in playwright options to enable context.newPage()." } };
          }
          const contextId = op.contextId ?? "ctx_0";
          const targetContext = registry.contexts.get(contextId);
          if (!targetContext) {
            return { ok: false, error: { name: "Error", message: `Context ${contextId} not found` } };
          }
          const newPage = await options.createPage(targetContext);
          const pageId = `page_${registry.nextPageId++}`;
          registry.pages.set(pageId, newPage);
          return { ok: true, value: { pageId } };
        }

        case "closeContext": {
          const contextId = op.contextId ?? "ctx_0";
          const context = registry.contexts.get(contextId);
          if (!context) {
            return { ok: false, error: { name: "Error", message: `Context ${contextId} not found` } };
          }
          await context.close();
          registry.contexts.delete(contextId);
          // Remove pages belonging to this context
          for (const [pid, p] of registry.pages) {
            if (p.context() === context) {
              registry.pages.delete(pid);
            }
          }
          return { ok: true };
        }
      }

      // Resolve page from pageId for page-specific operations
      const pageId = op.pageId ?? "page_0";
      const targetPage = registry.pages.get(pageId);
      if (!targetPage) {
        return { ok: false, error: { name: "Error", message: `Page ${pageId} not found` } };
      }

      // Resolve context from contextId for context-specific operations
      const contextId = op.contextId ?? "ctx_0";
      const targetContext = registry.contexts.get(contextId);

      switch (op.type) {
        case "goto": {
          const [url, waitUntil] = op.args as [string, string?];
          await targetPage.goto(url, {
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "reload":
          await targetPage.reload({ timeout });
          return { ok: true };
        case "url":
          return { ok: true, value: targetPage.url() };
        case "title":
          return { ok: true, value: await targetPage.title() };
        case "content":
          return { ok: true, value: await targetPage.content() };
        case "waitForSelector": {
          const [selector, optionsJson] = op.args as [string, string?];
          const opts = optionsJson ? JSON.parse(optionsJson) : {};
          await targetPage.waitForSelector(selector, { timeout, ...opts });
          return { ok: true };
        }
        case "waitForTimeout": {
          const [ms] = op.args as [number];
          await targetPage.waitForTimeout(ms);
          return { ok: true };
        }
        case "waitForLoadState": {
          const [state] = op.args as [string?];
          await targetPage.waitForLoadState(
            (state as "load" | "domcontentloaded" | "networkidle") ?? "load",
            { timeout }
          );
          return { ok: true };
        }
        case "evaluate": {
          const [script, arg] = op.args as [string, unknown];
          if (op.args.length > 1) {
            const fn = new Function('return (' + script + ')')();
            const result = await targetPage.evaluate(fn, arg);
            return { ok: true, value: result };
          }
          const result = await targetPage.evaluate(script);
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
          const locator = getLocator(targetPage, selectorType, selectorValue, roleOptions);
          const result = await executeLocatorAction(locator, action, actionArg, timeout, fileIO);
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
          const locator = getLocator(targetPage, selectorType, selectorValue, roleOptions);
          const effectiveTimeout = customTimeout ?? timeout;
          await executeExpectAssertion(locator, matcher, expected, negated ?? false, effectiveTimeout);
          return { ok: true };
        }
        case "expectPage": {
          const [matcher, expected, negated, customTimeout] = op.args as [
            string,
            unknown,
            boolean,
            number?
          ];
          const effectiveTimeout = customTimeout ?? timeout;
          await executePageExpectAssertion(targetPage, matcher, expected, negated ?? false, effectiveTimeout);
          return { ok: true };
        }
        case "request": {
          const [url, method, data, headers] = op.args as [
            string,
            string,
            unknown,
            Record<string, string>?
          ];
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

          const response = await targetPage.request.fetch(url, {
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
          await targetPage.goBack({
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "goForward": {
          const [waitUntil] = op.args as [string?];
          await targetPage.goForward({
            timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? "load",
          });
          return { ok: true };
        }
        case "waitForURL": {
          const [urlArg, customTimeout, waitUntil] = op.args as [
            string | { $regex: string; $flags: string },
            number?,
            string?
          ];
          // Deserialize regex URL pattern
          const url = urlArg && typeof urlArg === 'object' && '$regex' in urlArg
            ? new RegExp(urlArg.$regex, urlArg.$flags)
            : urlArg;
          await targetPage.waitForURL(url, {
            timeout: customTimeout ?? timeout,
            waitUntil: (waitUntil as "load" | "domcontentloaded" | "networkidle") ?? undefined,
          });
          return { ok: true };
        }
        case "clearCookies": {
          // Use contextId for cookie operations
          const ctx = targetContext ?? targetPage.context();
          await ctx.clearCookies();
          return { ok: true };
        }
        case "screenshot": {
          const [screenshotOptions] = op.args as [{
            path?: string;
            type?: 'png' | 'jpeg';
            quality?: number;
            fullPage?: boolean;
            clip?: { x: number; y: number; width: number; height: number };
          }?];
          // Don't pass path to Playwright - we handle file writing through callback
          const buffer = await targetPage.screenshot({
            type: screenshotOptions?.type,
            quality: screenshotOptions?.quality,
            fullPage: screenshotOptions?.fullPage,
            clip: screenshotOptions?.clip,
          });
          // If path is specified, use writeFile callback
          if (screenshotOptions?.path) {
            if (!fileIO.writeFile) {
              throw new Error(
                "screenshot() with path option requires a writeFile callback to be provided. " +
                "Either provide a writeFile callback in defaultPlaywrightHandler options, or omit the path option " +
                "and handle the returned base64 data yourself."
              );
            }
            await fileIO.writeFile(screenshotOptions.path, buffer);
          }
          return { ok: true, value: buffer.toString('base64') };
        }
        case "setViewportSize": {
          const [size] = op.args as [{ width: number; height: number }];
          await targetPage.setViewportSize(size);
          return { ok: true };
        }
        case "viewportSize": {
          return { ok: true, value: targetPage.viewportSize() };
        }
        case "keyboardType": {
          const [text, typeOptions] = op.args as [string, { delay?: number }?];
          await targetPage.keyboard.type(text, typeOptions);
          return { ok: true };
        }
        case "keyboardPress": {
          const [key, pressOptions] = op.args as [string, { delay?: number }?];
          await targetPage.keyboard.press(key, pressOptions);
          return { ok: true };
        }
        case "keyboardDown": {
          const [key] = op.args as [string];
          await targetPage.keyboard.down(key);
          return { ok: true };
        }
        case "keyboardUp": {
          const [key] = op.args as [string];
          await targetPage.keyboard.up(key);
          return { ok: true };
        }
        case "keyboardInsertText": {
          const [text] = op.args as [string];
          await targetPage.keyboard.insertText(text);
          return { ok: true };
        }
        case "mouseMove": {
          const [x, y, moveOptions] = op.args as [number, number, { steps?: number }?];
          await targetPage.mouse.move(x, y, moveOptions);
          return { ok: true };
        }
        case "mouseClick": {
          const [x, y, clickOptions] = op.args as [number, number, { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number }?];
          await targetPage.mouse.click(x, y, clickOptions);
          return { ok: true };
        }
        case "mouseDown": {
          const [downOptions] = op.args as [{ button?: 'left' | 'right' | 'middle'; clickCount?: number }?];
          if (downOptions) {
            await targetPage.mouse.down(downOptions);
          } else {
            await targetPage.mouse.down();
          }
          return { ok: true };
        }
        case "mouseUp": {
          const [upOptions] = op.args as [{ button?: 'left' | 'right' | 'middle'; clickCount?: number }?];
          if (upOptions) {
            await targetPage.mouse.up(upOptions);
          } else {
            await targetPage.mouse.up();
          }
          return { ok: true };
        }
        case "mouseWheel": {
          const [deltaX, deltaY] = op.args as [number, number];
          await targetPage.mouse.wheel(deltaX, deltaY);
          return { ok: true };
        }
        case "frames": {
          const frames = targetPage.frames();
          return { ok: true, value: frames.map(f => ({ name: f.name(), url: f.url() })) };
        }
        case "mainFrame": {
          const mainFrame = targetPage.mainFrame();
          return { ok: true, value: { name: mainFrame.name(), url: mainFrame.url() } };
        }
        case "bringToFront": {
          await targetPage.bringToFront();
          return { ok: true };
        }
        case "close": {
          await targetPage.close();
          // Remove from registry
          registry.pages.delete(pageId);
          return { ok: true };
        }
        case "isClosed": {
          return { ok: true, value: targetPage.isClosed() };
        }
        case "pdf": {
          const [pdfOptions] = op.args as [{
            path?: string;
            scale?: number;
            displayHeaderFooter?: boolean;
            headerTemplate?: string;
            footerTemplate?: string;
            printBackground?: boolean;
            landscape?: boolean;
            pageRanges?: string;
            format?: string;
            width?: string | number;
            height?: string | number;
            margin?: { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number };
          }?];
          // Don't pass path to Playwright - we handle file writing through callback
          const { path: pdfPath, ...restPdfOptions } = pdfOptions ?? {};
          const buffer = await targetPage.pdf(restPdfOptions);
          // If path is specified, use writeFile callback
          if (pdfPath) {
            if (!fileIO.writeFile) {
              throw new Error(
                "pdf() with path option requires a writeFile callback to be provided. " +
                "Either provide a writeFile callback in defaultPlaywrightHandler options, or omit the path option " +
                "and handle the returned base64 data yourself."
              );
            }
            await fileIO.writeFile(pdfPath, buffer);
          }
          return { ok: true, value: buffer.toString('base64') };
        }
        case "emulateMedia": {
          const [mediaOptions] = op.args as [{ media?: 'screen' | 'print' | null; colorScheme?: 'light' | 'dark' | 'no-preference' | null; reducedMotion?: 'reduce' | 'no-preference' | null; forcedColors?: 'active' | 'none' | null }?];
          await targetPage.emulateMedia(mediaOptions);
          return { ok: true };
        }
        case "addCookies": {
          const [cookies] = op.args as [Array<{
            name: string;
            value: string;
            domain?: string;
            path?: string;
            expires?: number;
            httpOnly?: boolean;
            secure?: boolean;
            sameSite?: 'Strict' | 'Lax' | 'None';
          }>];
          // Use contextId for cookie operations
          const ctx = targetContext ?? targetPage.context();
          await ctx.addCookies(cookies);
          return { ok: true };
        }
        case "cookies": {
          const [urls] = op.args as [string[]?];
          // Use contextId for cookie operations
          const ctx = targetContext ?? targetPage.context();
          const cookies = await ctx.cookies(urls);
          return { ok: true, value: cookies };
        }
        case "setExtraHTTPHeaders": {
          const [headers] = op.args as [Record<string, string>];
          await targetPage.setExtraHTTPHeaders(headers);
          return { ok: true };
        }
        case "pause": {
          await targetPage.pause();
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

/**
 * Public helper for handler-first runtime options.
 * Adds metadata used by adapters for local event capture and collected data.
 */
export function defaultPlaywrightHandler(
  page: Page,
  options?: DefaultPlaywrightHandlerOptions
): PlaywrightCallback {
  const handler = createPlaywrightHandler(page, options) as DefaultPlaywrightHandler;
  handler[DEFAULT_PLAYWRIGHT_HANDLER_META] = { page, options };
  return handler;
}

/**
 * Extract metadata from handlers created by defaultPlaywrightHandler().
 */
export function getDefaultPlaywrightHandlerMetadata(
  handler: PlaywrightCallback
): DefaultPlaywrightHandlerMetadata | undefined {
  return (handler as DefaultPlaywrightHandler)[DEFAULT_PLAYWRIGHT_HANDLER_META];
}
