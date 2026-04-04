import { TYPE_DEFINITIONS, formatTypecheckErrors as formatLegacyTypecheckErrors, typecheckIsolateCode } from "../internal/typecheck/index.ts";
import type { TypeCapability, TypeProfile, TypeProfileName, TypecheckRequest } from "../types.ts";

type IncludedType =
  | "core"
  | "sandboxIsolate"
  | "fetch"
  | "fs"
  | "console"
  | "encoding"
  | "timers"
  | "testEnvironment"
  | "playwright";

const CAPABILITY_MAP: Record<TypeCapability, IncludedType[]> = {
  fetch: ["fetch"],
  files: ["fs"],
  tests: ["testEnvironment"],
  browser: ["playwright"],
  tools: [],
  console: ["console"],
  encoding: ["encoding"],
  timers: ["timers"],
};

const PROFILE_DEFAULTS: Record<TypeProfileName, TypeCapability[]> = {
  backend: ["console", "encoding", "fetch", "files", "timers"],
  agent: ["console", "encoding", "fetch", "files", "timers"],
  "browser-test": ["console", "encoding", "fetch", "tests", "browser", "timers"],
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function getTypeProfile(input?: {
  profile?: TypeProfileName;
  capabilities?: TypeCapability[];
}): TypeProfile {
  const profile = input?.profile ?? "backend";
  const capabilities = unique([...(PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.backend), ...(input?.capabilities ?? [])]);
  const include: IncludedType[] = unique([
    "core",
    "sandboxIsolate",
    ...capabilities.flatMap((capability) => CAPABILITY_MAP[capability]),
  ]) as IncludedType[];

  return {
    profile,
    capabilities,
    include,
    files: include
      .map((key) => ({
        name: `isolate-${key}.d.ts`,
        content: TYPE_DEFINITIONS[key as keyof typeof TYPE_DEFINITIONS],
      }))
      .filter((entry) => Boolean(entry.content)) as Array<{ name: string; content: string }>,
  };
}

export function typecheck(request: TypecheckRequest) {
  const profile = getTypeProfile({
    profile: request.profile,
    capabilities: request.capabilities,
  });

  return typecheckIsolateCode(request.code, {
    include: profile.include,
    libraryTypes: request.libraryTypes,
    compilerOptions: request.compilerOptions as never,
  });
}

export const formatTypecheckErrors = formatLegacyTypecheckErrors;
