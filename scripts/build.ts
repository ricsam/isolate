import fs from "node:fs/promises";
import path from "node:path";
import { $, Glob } from "bun";

const ROOT_DIR = path.join(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT_DIR, "src");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const TEMP_TSCONFIG_PATH = path.join(ROOT_DIR, ".tsconfig.build.tmp.json");

interface PackageJson {
  name: string;
  version: string;
}

async function createTempTsconfig(): Promise<void> {
  await Bun.write(
    TEMP_TSCONFIG_PATH,
    JSON.stringify(
      {
        extends: "./tsconfig.base.json",
        compilerOptions: {
          rootDir: "./src",
          module: "ESNext",
          moduleResolution: "bundler",
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          outDir: "./dist/types",
          declarationDir: "./dist/types",
        },
        include: ["src/**/*.ts"],
        exclude: ["node_modules", "dist", "src/**/*.test.ts"],
      },
      null,
      2,
    ),
  );
}

async function runTsc(): Promise<void> {
  const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p ${TEMP_TSCONFIG_PATH}`
    .cwd(ROOT_DIR)
    .nothrow();

  if (exitCode !== 0) {
    console.error(stderr.toString());
    console.log(stdout.toString());
    throw new Error("Failed to generate type declarations");
  }

  const output = stdout.toString().trim();
  if (output) {
    console.log(output);
  }
  console.log("  Types ready");
}

async function bundleFile(
  entrypoint: string,
  relativeDir: string,
  format: "cjs" | "mjs",
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: path.join(DIST_DIR, format, relativeDir),
    sourcemap: "external",
    format: format === "mjs" ? "esm" : "cjs",
    packages: "external",
    external: ["*"],
    naming: `[name].${format}`,
    target: "node",
    plugins: [
      {
        name: "extension-plugin",
        setup(build) {
          build.onLoad({ filter: /\.tsx?$/, namespace: "file" }, async (args) => {
            let content = await Bun.file(args.path).text();

            content = content.replace(
              /((?:im|ex)port\s[\w{}/*\s,]+from\s['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
              `$1.${format}`,
            );
            content = content.replace(
              /(import\(['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
              `$1.${format}`,
            );

            return {
              contents: content,
              loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
            };
          });
        },
      },
    ],
  });

  for (const log of result.logs) {
    console.log(`  [${log.level}] ${log.message}`);
  }

  if (!result.success) {
    throw new Error(`Failed to bundle ${path.relative(ROOT_DIR, entrypoint)} as ${format}`);
  }
}

async function bundleFormat(format: "cjs" | "mjs"): Promise<void> {
  const tsGlob = new Glob("**/*.ts");

  for await (const file of tsGlob.scan({ cwd: SRC_DIR })) {
    if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) {
      continue;
    }

    await bundleFile(path.join(SRC_DIR, file), path.dirname(file), format);
  }
}

async function writeFormatPackageJsons(pkg: PackageJson): Promise<void> {
  for (const [folder, type] of [
    ["cjs", "commonjs"],
    ["mjs", "module"],
  ] as const) {
    await Bun.write(
      path.join(DIST_DIR, folder, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          type,
        },
        null,
        2,
      ),
    );
  }
}

async function main() {
  console.log("Building @ricsam/isolate...");

  const pkg = await Bun.file(path.join(ROOT_DIR, "package.json")).json() as PackageJson;

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await createTempTsconfig();

  try {
    await Promise.all([
      bundleFormat("mjs"),
      bundleFormat("cjs"),
      runTsc(),
    ]);

    await writeFormatPackageJsons(pkg);
  } finally {
    await fs.rm(TEMP_TSCONFIG_PATH, { force: true });
  }

  console.log("Build finished.");
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
