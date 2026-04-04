import type {
  HostBrowserBindings,
} from "../types.ts";

export const ISOLATE_BROWSER_DESCRIPTOR_PROPERTY = "__isolateBrowserBinding";
export const ISOLATE_BROWSER_DESCRIPTOR_VALUE = "default";

export interface BrowserSource extends HostBrowserBindings {}

export function isBrowserBindingLike(value: unknown): value is HostBrowserBindings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.createContext === "function" ||
    typeof candidate.createPage === "function"
  );
}

export function isDefaultBrowserDescriptor(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<string, unknown>)[ISOLATE_BROWSER_DESCRIPTOR_PROPERTY] ===
        ISOLATE_BROWSER_DESCRIPTOR_VALUE,
  );
}

export function createBrowserSourceFromBindings(
  browser: HostBrowserBindings | undefined,
): BrowserSource | undefined {
  if (!browser) {
    return undefined;
  }

  return {
    createContext: browser.createContext,
    createPage: browser.createPage,
  };
}

export function createBrowserSourceFromUnknown(
  browser: unknown,
): BrowserSource | undefined {
  if (!isBrowserBindingLike(browser)) {
    return undefined;
  }

  return createBrowserSourceFromBindings(browser);
}

export function requireBrowserSource(
  source: BrowserSource | undefined,
  operation: string,
): BrowserSource {
  if (!source?.createContext || !source.createPage) {
    throw new Error(
      `${operation} requires a browser binding with createContext() and createPage().`,
    );
  }
  return source;
}

export function cloneBrowserDescriptor(): Record<string, string> {
  return {
    [ISOLATE_BROWSER_DESCRIPTOR_PROPERTY]: ISOLATE_BROWSER_DESCRIPTOR_VALUE,
  };
}
