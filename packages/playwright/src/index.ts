import ivm from "isolated-vm";
import type { Page, Locator as PlaywrightLocator, BrowserContext, BrowserContextOptions } from "playwright";
import type {
  PlaywrightOperation,
  PlaywrightResult,
  PlaywrightEvent,
  PlaywrightFileData,
} from "@ricsam/isolate-protocol";

// Re-export protocol types
export type { PlaywrightOperation, PlaywrightResult, PlaywrightEvent, PlaywrightFileData } from "@ricsam/isolate-protocol";

// ============================================================================
// File I/O Callback Types (for secure file access)
// ============================================================================

export type ReadFileCallback = (filePath: string) => Promise<PlaywrightFileData> | PlaywrightFileData;
export type WriteFileCallback = (filePath: string, data: Buffer) => Promise<void> | void;

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
  /** If true, browser console logs are printed to stdout */
  console?: boolean;
  /** Unified event callback for all playwright events */
  onEvent?: (event: PlaywrightEvent) => void;
  /**
   * Callback invoked when context.newPage() is called from within the isolate.
   * Host creates/configures the new page. If not provided, newPage() will throw an error.
   * Receives the BrowserContext so you can call context.newPage().
   * @param context - The BrowserContext that requested the new page
   * @returns The new Page object
   */
  createPage?: (context: BrowserContext) => Promise<Page> | Page;
  /**
   * Callback invoked when browser.newContext() is called from within the isolate.
   * Host creates/configures the new context. If not provided, newContext() will throw an error.
   * @param options - Browser context options passed from the isolate
   * @returns The new BrowserContext object
   */
  createContext?: (options?: BrowserContextOptions) => Promise<BrowserContext> | BrowserContext;
}

/**
 * @deprecated Use PlaywrightSetupOptions instead
 */
export interface PlaywrightOptions {
  page: Page;
  timeout?: number;
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
    locator = locator.filter(filterOpts);
  }

  return locator;
}

// ============================================================================
// Helper: Execute locator action
// ============================================================================

interface FileIOCallbacks {
  readFile?: ReadFileCallback;
  writeFile?: WriteFileCallback;
}

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

      // Case 1: Already have buffer data (base64 encoded from isolate)
      if (Array.isArray(files) && files.length > 0 && typeof files[0] === 'object' && 'buffer' in files[0]) {
        const fileBuffers = (files as { name: string; mimeType: string; buffer: string }[]).map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          buffer: Buffer.from(f.buffer, 'base64'),
        }));
        await locator.setInputFiles(fileBuffers, { timeout });
        return null;
      }

      // Case 2: File paths - need to use readFile callback for security
      const filePaths = Array.isArray(files) ? files as string[] : [files as string];

      if (!fileIO?.readFile) {
        throw new Error(
          'setInputFiles() with file paths requires a readFile callback in PlaywrightOptions. ' +
          'Either provide file data directly using { name, mimeType, buffer } format, or ' +
          'configure a readFile callback to control file access from the isolate.'
        );
      }

      // Read files through the callback
      const fileBuffers = await Promise.all(
        filePaths.map(async (filePath) => {
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

      // Take screenshot (without path - we handle file writing separately)
      const buffer = await locator.screenshot({
        timeout,
        type: opts?.type,
        quality: opts?.quality,
      });

      // If path is specified, use writeFile callback
      if (opts?.path) {
        if (!fileIO?.writeFile) {
          throw new Error(
            'screenshot() with path option requires a writeFile callback in PlaywrightOptions. ' +
            'Either omit the path option (screenshot returns base64 data), or ' +
            'configure a writeFile callback to control file writing from the isolate.'
          );
        }
        await fileIO.writeFile(opts.path, buffer);
      }

      return buffer.toString('base64');
    }
    case "dragTo": {
      const targetInfo = actionArg as [string, string, string | null];
      // We need to resolve the target locator on the page
      // This is a workaround since we can't pass locator objects directly
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
  options?: {
    timeout?: number;
    /** Callback to read files for setInputFiles() with file paths */
    readFile?: ReadFileCallback;
    /** Callback to write files for screenshot()/pdf() with path option */
    writeFile?: WriteFileCallback;
    /** Callback to create new pages when context.newPage() is called; receives the BrowserContext so you can call context.newPage() */
    createPage?: (context: BrowserContext) => Promise<Page> | Page;
    /** Callback to create new contexts when browser.newContext() is called */
    createContext?: (options?: BrowserContextOptions) => Promise<BrowserContext> | BrowserContext;
  }
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
                "Either provide a writeFile callback in PlaywrightOptions, or omit the path option " +
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
          await targetPage.mouse.down(downOptions);
          return { ok: true };
        }
        case "mouseUp": {
          const [upOptions] = op.args as [{ button?: 'left' | 'right' | 'middle'; clickCount?: number }?];
          await targetPage.mouse.up(upOptions);
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
                "Either provide a writeFile callback in PlaywrightOptions, or omit the path option " +
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

  // Determine if we have a page or handler
  const page = "page" in options ? options.page : undefined;
  const handler = "handler" in options ? options.handler : undefined;

  // Get lifecycle callbacks
  const createPage = "createPage" in options ? options.createPage : undefined;
  const createContext = "createContext" in options ? options.createContext : undefined;

  // Create handler from page if needed
  const effectiveHandler = handler ?? (page ? createPlaywrightHandler(page, {
    timeout,
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
  globalThis.__pw_invoke = async function(type, args, options) {
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
})();
`);

  // IsolatePage class and page/context/browser globals
  context.evalSync(`
(function() {
  // IsolatePage class - represents a page with a specific pageId
  class IsolatePage {
    #pageId; #contextId; #currentUrl = '';
    constructor(pageId, contextId) {
      this.#pageId = pageId;
      this.#contextId = contextId;
    }
    get __isPage() { return true; }
    get __pageId() { return this.#pageId; }
    get __contextId() { return this.#contextId; }

    async goto(url, options) {
      await __pw_invoke("goto", [url, options?.waitUntil || null], { pageId: this.#pageId });
      const resolvedUrl = await __pw_invoke("url", [], { pageId: this.#pageId });
      this.#currentUrl = resolvedUrl || url;
    }
    async reload() {
      await __pw_invoke("reload", [], { pageId: this.#pageId });
      const resolvedUrl = await __pw_invoke("url", [], { pageId: this.#pageId });
      if (resolvedUrl) this.#currentUrl = resolvedUrl;
    }
    url() { return this.#currentUrl; }
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
      const resolvedUrl = await __pw_invoke("url", [], { pageId: this.#pageId });
      if (resolvedUrl) this.#currentUrl = resolvedUrl;
    }
    async goForward(options) {
      await __pw_invoke("goForward", [options?.waitUntil || null], { pageId: this.#pageId });
      const resolvedUrl = await __pw_invoke("url", [], { pageId: this.#pageId });
      if (resolvedUrl) this.#currentUrl = resolvedUrl;
    }
    async waitForURL(url, options) {
      let serializedUrl = url;
      if (url && typeof url === 'object' && typeof url.source === 'string' && typeof url.flags === 'string') {
        serializedUrl = { $regex: url.source, $flags: url.flags };
      }
      return __pw_invoke("waitForURL", [serializedUrl, options?.timeout || null, options?.waitUntil || null], { pageId: this.#pageId });
    }
    context() {
      const contextId = this.#contextId;
      return new IsolateContext(contextId);
    }
    async click(selector) { return this.locator(selector).click(); }
    async fill(selector, value) { return this.locator(selector).fill(value); }
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

  class Locator {
    #type; #value; #options; #pageId;
    constructor(type, value, options, pageId) {
      this.#type = type;
      this.#value = value;
      this.#options = options;
      this.#pageId = pageId || "page_0"; // Default to page_0 for backward compatibility
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
      // Serialize files - if they have buffers, convert to base64
      let serializedFiles = files;
      if (Array.isArray(files) && files.length > 0 && typeof files[0] === 'object' && files[0].buffer) {
        serializedFiles = files.map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          buffer: typeof f.buffer === 'string' ? f.buffer : btoa(String.fromCharCode(...new Uint8Array(f.buffer)))
        }));
      }
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
