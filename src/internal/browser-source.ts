import type {
  FileBindings,
  HostBrowserBindings,
} from "../types.ts";

export const ISOLATE_BROWSER_DESCRIPTOR_PROPERTY = "__isolateBrowserBinding";
export const ISOLATE_BROWSER_DESCRIPTOR_VALUE = "default";

export type BrowserSource = HostBrowserBindings & {
  __profileFiles?: FileBindings;
};

export function isBrowserBindingLike(value: unknown): value is HostBrowserBindings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.handler === "function" ||
    typeof candidate.createContext === "function" ||
    typeof candidate.createPersistentContext === "function" ||
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
  profileFiles?: FileBindings,
): BrowserSource | undefined {
  if (!browser) {
    return undefined;
  }

  if ("handler" in browser && typeof browser.handler === "function") {
    return {
      handler: browser.handler,
      captureConsole: browser.captureConsole,
      onEvent: browser.onEvent,
    };
  }

  return {
    createContext: browser.createContext,
    createPersistentContext: browser.createPersistentContext,
    createPage: browser.createPage,
    captureConsole: browser.captureConsole,
    onEvent: browser.onEvent,
    readFile: browser.readFile,
    writeFile: browser.writeFile,
    profiles: browser.profiles,
    __profileFiles: browser.profiles ? profileFiles : undefined,
  };
}

export function createBrowserSourceFromUnknown(
  browser: unknown,
): BrowserSource | undefined {
  if (!isBrowserBindingLike(browser)) {
    return undefined;
  }

  return createBrowserSourceFromBindings(
    browser,
    (browser as BrowserSource).__profileFiles,
  );
}

export function requireBrowserSource(
  source: BrowserSource | undefined,
  operation: string,
): BrowserSource {
  if (!source) {
    throw new Error(
      `${operation} requires a browser binding.`,
    );
  }
  return source;
}

export function cloneBrowserDescriptor(): Record<string, string> {
  return {
    [ISOLATE_BROWSER_DESCRIPTOR_PROPERTY]: ISOLATE_BROWSER_DESCRIPTOR_VALUE,
  };
}
