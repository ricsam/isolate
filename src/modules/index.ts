import fs from "node:fs";
import path from "node:path";
import { defaultModuleLoader } from "../internal/module-loader/index.ts";
import { normalizeExplicitModuleResult } from "../bridge/legacy-adapters.ts";
import type { HostCallContext, ModuleResolveResult, ModuleResolver, ModuleResolverFallback, ModuleResolverSourceLoader, ModuleSource } from "../types.ts";

class ModuleResolverBuilder implements ModuleResolver {
  private readonly nodeModuleMappings: Array<{ from: string; to: string }> = [];
  private readonly virtualEntries = new Map<string, { source: ModuleResolveResult | (() => ModuleResolveResult); options?: Partial<ModuleSource> }>();
  private readonly virtualFiles = new Map<string, { filePath: string; options?: Partial<ModuleSource> }>();
  private readonly sourceTrees: Array<{ prefix: string; loader: ModuleResolverSourceLoader }> = [];
  private fallbackLoader?: ModuleResolverFallback;
  private nodeModulesLoader?: ReturnType<typeof defaultModuleLoader>;

  mountNodeModules(virtualMount: string, hostPath: string): ModuleResolver {
    this.nodeModuleMappings.push({ from: hostPath, to: virtualMount });
    this.nodeModulesLoader = undefined;
    return this;
  }

  virtual(specifier: string, source: ModuleResolveResult | (() => ModuleResolveResult), options?: Partial<ModuleSource>): ModuleResolver {
    this.virtualEntries.set(specifier, { source, options });
    return this;
  }

  virtualFile(specifier: string, filePath: string, options?: Partial<ModuleSource>): ModuleResolver {
    this.virtualFiles.set(specifier, { filePath, options });
    return this;
  }

  sourceTree(prefix: string, loader: ModuleResolverSourceLoader): ModuleResolver {
    this.sourceTrees.push({ prefix, loader });
    return this;
  }

  fallback(loader: ModuleResolverFallback): ModuleResolver {
    this.fallbackLoader = loader;
    return this;
  }

  async resolve(specifier: string, importer: { path: string; resolveDir: string }, context: HostCallContext): Promise<ModuleSource> {
    let nodeModulesError: unknown;

    const explicit = this.virtualEntries.get(specifier);
    if (explicit) {
      const raw = typeof explicit.source === "function" ? await explicit.source() : await explicit.source;
      const normalized = await normalizeExplicitModuleResult(specifier, raw, importer.resolveDir);
      if (!normalized) {
        throw new Error(`Virtual module ${specifier} returned no source.`);
      }
      return {
        ...normalized,
        ...explicit.options,
      };
    }

    const virtualFile = this.virtualFiles.get(specifier);
    if (virtualFile) {
      const code = fs.readFileSync(virtualFile.filePath, "utf-8");
      const fallback = await normalizeExplicitModuleResult(
        specifier,
        {
          code,
          filename: virtualFile.options?.filename ?? path.basename(virtualFile.filePath),
          resolveDir: virtualFile.options?.resolveDir ?? path.posix.dirname(specifier.startsWith("/") ? specifier : `/${specifier}`),
          static: virtualFile.options?.static,
        },
        importer.resolveDir,
      );
      if (!fallback) {
        throw new Error(`Virtual file module ${specifier} returned no source.`);
      }
      return fallback;
    }

    for (const sourceTree of this.sourceTrees) {
      if (!specifier.startsWith(sourceTree.prefix)) {
        continue;
      }
      const relativePath = specifier.slice(sourceTree.prefix.length);
      const normalized = await normalizeExplicitModuleResult(specifier, sourceTree.loader(relativePath, context), importer.resolveDir);
      if (normalized) {
        return normalized;
      }
    }

    if (this.nodeModuleMappings.length > 0) {
      try {
        return await this.getNodeModulesLoader()(specifier, importer);
      } catch (error) {
        nodeModulesError = error;
        if (!this.fallbackLoader) {
          throw error;
        }
      }
    }

    if (this.fallbackLoader) {
      const normalized = await normalizeExplicitModuleResult(specifier, this.fallbackLoader(specifier, importer, context), importer.resolveDir);
      if (normalized) {
        return normalized;
      }
    }

    if (nodeModulesError) {
      throw nodeModulesError;
    }

    throw new Error(`Unable to resolve module: ${specifier}`);
  }

  private getNodeModulesLoader(): ReturnType<typeof defaultModuleLoader> {
    if (!this.nodeModulesLoader) {
      this.nodeModulesLoader = defaultModuleLoader(...this.nodeModuleMappings);
    }
    return this.nodeModulesLoader;
  }
}

export function createModuleResolver(): ModuleResolver {
  return new ModuleResolverBuilder();
}
