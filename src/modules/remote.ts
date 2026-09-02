import { rollup, type Plugin } from "rollup";
import { isTypeScriptFile, processTypeScript } from "../internal/module-loader/strip-types.ts";
import type { HostCallContext, ModuleSource, RemoteModuleResolverOptions } from "../types.ts";

const DEFAULT_ALLOWED_HOSTS = ["esm.sh", "jsr.io"] as const;
const DEFAULT_MAX_MODULE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_MODULES = 256;
const JSR_PREFIX = "jsr:";
const NPM_PREFIX = "npm:";

interface LoadedRemoteModule {
  source: string;
  url: string;
  contentType: string;
}

function normalizeRemoteSpecifier(specifier: string, importer?: string): string | null {
  if (specifier.startsWith(JSR_PREFIX)) {
    const packageSpecifier = specifier.slice(JSR_PREFIX.length);
    if (!packageSpecifier) {
      throw new Error("Invalid JSR module specifier: expected a package after jsr:.");
    }
    return `https://esm.sh/jsr/${packageSpecifier}`;
  }

  if (specifier.startsWith(NPM_PREFIX)) {
    const packageSpecifier = specifier.slice(NPM_PREFIX.length);
    if (!packageSpecifier) {
      throw new Error("Invalid npm module specifier: expected a package after npm:.");
    }
    return `https://esm.sh/${packageSpecifier}`;
  }

  if (/^https?:\/\//i.test(specifier)) {
    return new URL(specifier).href;
  }

  if (importer && /^https?:\/\//i.test(importer)) {
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("//")) {
      return new URL(specifier, importer).href;
    }
  }

  return null;
}

function isJsonModule(url: string, contentType: string): boolean {
  return new URL(url).pathname.toLowerCase().endsWith(".json") || /(?:^|\s|;)application\/(?:[^;]+\+)?json(?:\s|;|$)/i.test(contentType);
}

function getAllowedHostPredicate(options: RemoteModuleResolverOptions): (url: URL) => boolean {
  if (typeof options.allowedHosts === "function") {
    return options.allowedHosts;
  }

  const allowedHosts = new Set(options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS);
  return (url) => allowedHosts.has(url.hostname);
}

function assertRemoteUrlAllowed(url: URL, options: RemoteModuleResolverOptions, isAllowedHost: (url: URL) => boolean): void {
  if (url.protocol !== "https:" && !(options.allowHttp === true && url.protocol === "http:")) {
    throw new Error(`Remote module URL must use HTTPS: ${url.href}`);
  }

  if (!isAllowedHost(url)) {
    throw new Error(
      `Remote module host is not allowed: ${url.hostname}. ` +
        "Pass allowedHosts to createModuleResolver().remote() to explicitly trust it.",
    );
  }
}

class RemoteModuleBundler {
  private readonly fetcher: typeof fetch;
  private readonly maxModuleBytes: number;
  private readonly maxModules: number;
  private readonly isAllowedHost: (url: URL) => boolean;
  private readonly loadedModules = new Map<string, Promise<LoadedRemoteModule>>();
  private readonly bundledModules = new Map<string, Promise<ModuleSource>>();
  private readonly options: RemoteModuleResolverOptions;

  constructor(options: RemoteModuleResolverOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.maxModuleBytes = options.maxModuleBytes ?? DEFAULT_MAX_MODULE_BYTES;
    this.maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
    this.isAllowedHost = getAllowedHostPredicate(options);
  }

  canResolve(specifier: string): boolean {
    return specifier.startsWith(JSR_PREFIX) || specifier.startsWith(NPM_PREFIX) || /^https?:\/\//i.test(specifier);
  }

  async resolve(specifier: string, context: HostCallContext): Promise<ModuleSource> {
    const entryUrl = normalizeRemoteSpecifier(specifier);
    if (!entryUrl) {
      throw new Error(`Unsupported remote module specifier: ${specifier}`);
    }

    const canonicalEntryUrl = new URL(entryUrl).href;
    const cached = this.bundledModules.get(canonicalEntryUrl);
    if (cached) {
      return cached;
    }

    const bundlePromise = this.bundle(canonicalEntryUrl, context.signal);
    this.bundledModules.set(canonicalEntryUrl, bundlePromise);

    try {
      return await bundlePromise;
    } catch (error) {
      this.bundledModules.delete(canonicalEntryUrl);
      throw error;
    }
  }

  private async bundle(entryUrl: string, signal: AbortSignal): Promise<ModuleSource> {
    const remotePlugin = this.createRollupPlugin(signal);
    let bundle: Awaited<ReturnType<typeof rollup>> | undefined;

    try {
      bundle = await rollup({
        input: entryUrl,
        treeshake: false,
        plugins: [remotePlugin],
        onwarn(warning, warn) {
          if (warning.code === "CIRCULAR_DEPENDENCY" || warning.code === "THIS_IS_UNDEFINED") {
            return;
          }
          warn(warning);
        },
      });

      const { output } = await bundle.generate({
        format: "es",
        inlineDynamicImports: true,
        sourcemap: "inline",
      });
      const chunk = output.find((item) => item.type === "chunk");
      if (!chunk || chunk.type !== "chunk") {
        throw new Error(`Remote module produced no JavaScript output: ${entryUrl}`);
      }

      return {
        code: chunk.code,
        filename: "remote-module.js",
        resolveDir: "/remote-modules",
      };
    } finally {
      await bundle?.close();
    }
  }

  private createRollupPlugin(signal: AbortSignal): Plugin {
    return {
      name: "remote-modules",
      resolveId: async (source, importer) => {
        const resolvedUrl = normalizeRemoteSpecifier(source, importer);
        if (!resolvedUrl) {
          throw new Error(
            `Remote module ${importer ?? "entry"} imports unsupported bare specifier ${JSON.stringify(source)}. ` +
              "Use a jsr:, npm:, or full HTTPS import.",
          );
        }

        const loaded = await this.fetchModule(resolvedUrl, signal);
        return loaded.url;
      },
      load: async (id) => {
        if (!/^https?:\/\//i.test(id)) {
          return null;
        }

        const loaded = await this.fetchModule(id, signal);
        if (isJsonModule(loaded.url, loaded.contentType)) {
          const value = JSON.parse(loaded.source) as unknown;
          return `export default ${JSON.stringify(value)};\n`;
        }
        return loaded.source;
      },
      transform: (code, id) => {
        const cleanPath = new URL(id).pathname;
        if (isTypeScriptFile(cleanPath)) {
          return { code: processTypeScript(code, cleanPath), map: null };
        }
        return null;
      },
    };
  }

  private fetchModule(rawUrl: string, signal: AbortSignal): Promise<LoadedRemoteModule> {
    const url = new URL(rawUrl);
    assertRemoteUrlAllowed(url, this.options, this.isAllowedHost);

    const key = url.href;
    const cached = this.loadedModules.get(key);
    if (cached) {
      return cached;
    }

    if (this.loadedModules.size >= this.maxModules) {
      throw new Error(`Remote module graph exceeds the ${this.maxModules}-module limit.`);
    }

    const promise = this.fetchAndReadModule(url, signal);
    this.loadedModules.set(key, promise);
    promise.catch(() => {
      if (this.loadedModules.get(key) === promise) {
        this.loadedModules.delete(key);
      }
    });
    return promise;
  }

  private async fetchAndReadModule(url: URL, signal: AbortSignal): Promise<LoadedRemoteModule> {
    signal.throwIfAborted();
    const response = await this.fetcher(url.href, {
      headers: {
        Accept: "application/javascript, text/javascript, application/typescript, text/typescript, application/json;q=0.9, text/plain;q=0.8",
      },
      redirect: "follow",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch remote module ${url.href}: ${response.status} ${response.statusText}`);
    }

    const finalUrl = new URL(response.url || url.href);
    assertRemoteUrlAllowed(finalUrl, this.options, this.isAllowedHost);

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > this.maxModuleBytes) {
      throw new Error(`Remote module exceeds the ${this.maxModuleBytes}-byte limit: ${finalUrl.href}`);
    }

    const source = await response.text();
    if (new TextEncoder().encode(source).byteLength > this.maxModuleBytes) {
      throw new Error(`Remote module exceeds the ${this.maxModuleBytes}-byte limit: ${finalUrl.href}`);
    }

    const loaded = {
      source,
      url: finalUrl.href,
      contentType: response.headers.get("content-type") ?? "",
    };
    this.loadedModules.set(finalUrl.href, Promise.resolve(loaded));
    return loaded;
  }
}

export function createRemoteModuleBundler(options: RemoteModuleResolverOptions = {}): RemoteModuleBundler {
  return new RemoteModuleBundler(options);
}
