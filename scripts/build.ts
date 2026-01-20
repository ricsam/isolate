import path from 'node:path';
import { $, Glob } from 'bun';
import { TYPE_DEFINITIONS } from '../packages/isolate-types/src/isolate-types.ts';

if (!process.env.CI) {
  throw new Error('This script is only meant to be run in CI');
}

// Packages to build (in dependency order: core first, then new packages, then fetch/fs, then runtime, then test-environment, then standalone packages, then daemon/client)
const PACKAGES = [
  'core',
  'isolate-types',
  'console',
  'crypto',
  'encoding',
  'path',
  'timers',
  'fetch',
  'fs',
  'runtime',
  'test-environment',
  'playwright',
  'isolate-protocol',
  'isolate-daemon',
  'isolate-client',
];

// Mapping from package names to TYPE_DEFINITIONS keys for isolate.d.ts generation
const ISOLATE_TYPE_MAPPING: Record<string, keyof typeof TYPE_DEFINITIONS | undefined> = {
  'core': 'core',
  'console': 'console',
  'crypto': 'crypto',
  'encoding': 'encoding',
  'fetch': 'fetch',
  'fs': 'fs',
  'path': 'path',
  'test-environment': 'testEnvironment',
  'timers': 'timers',
};

interface RootMetadata {
  author: string;
  license: string;
  repository: { type: string; url: string };
  bugs?: { url: string };
  homepage?: string;
  keywords: string[];
  description: string;
}

// Helper to get the full npm package name from directory name
const getNpmPackageName = (packageName: string): string => {
  // If package already starts with 'isolate-', use it as-is
  if (packageName.startsWith('isolate-')) {
    return `@ricsam/${packageName}`;
  }
  return `@ricsam/isolate-${packageName}`;
};

const buildPackage = async (packageName: string, rootMetadata: RootMetadata) => {
  const packageDir = path.join(__dirname, '..', 'packages', packageName);
  const npmPackageName = getNpmPackageName(packageName);
  console.log(`\n📦 Building ${npmPackageName}...`);

  const packageJson = await Bun.file(path.join(packageDir, 'package.json')).json();

  // Create build-specific tsconfig.json
  await Bun.write(
    path.join(packageDir, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          allowSyntheticDefaultImports: true,
          allowImportingTsExtensions: true,
          target: 'ESNext',
          declaration: true,
          esModuleInterop: true,
          inlineSourceMap: false,
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          listEmittedFiles: false,
          listFiles: false,
          moduleResolution: 'bundler',
          noFallthroughCasesInSwitch: true,
          pretty: true,
          resolveJsonModule: true,
          rootDir: './src',
          skipLibCheck: true,
          strict: true,
          traceResolution: false,
        },
        compileOnSave: false,
        exclude: ['node_modules', 'dist', '**/*.test.ts'],
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
  );

  // Create types-specific tsconfig
  await Bun.write(
    path.join(packageDir, 'tsconfig.types.json'),
    JSON.stringify(
      {
        extends: './tsconfig.build.json',
        compilerOptions: {
          declaration: true,
          outDir: 'dist/types',
          emitDeclarationOnly: true,
          declarationDir: 'dist/types',
        },
      },
      null,
      2,
    ),
  );

  // TypeScript compilation for type declarations
  const runTsc = async (tsconfig: string) => {
    const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p ${tsconfig}`
      .cwd(packageDir)
      .nothrow();

    if (exitCode !== 0) {
      console.error(stderr.toString());
      console.log(stdout.toString());
      return false;
    }
    const output = stdout.toString();
    if (output.trim() !== '') {
      console.log(output);
    }
    console.log(`  ✅ Type declarations generated`);
    return true;
  };

  // Build with Bun for both formats
  const bunBuildFile = async (src: string, relativeDir: string, type: 'cjs' | 'mjs') => {
    const result = await Bun.build({
      entrypoints: [src],
      outdir: path.join(packageDir, 'dist', type, relativeDir),
      sourcemap: 'external',
      format: type === 'mjs' ? 'esm' : 'cjs',
      packages: 'external',
      external: ['*'],
      naming: `[name].${type}`,
      target: 'bun',
      plugins: [
        {
          name: 'extension-plugin',
          setup(build) {
            build.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, async (args) => {
              let content = await Bun.file(args.path).text();
              const extension = type;

              // Replace relative imports with extension (handles both extensionless and .ts/.tsx imports)
              content = content.replace(
                /((?:im|ex)port\s[\w{}/*\s,]+from\s['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
                `$1.${extension}`,
              );

              // Replace dynamic imports
              content = content.replace(
                /(import\(['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
                `$1.${extension}`,
              );

              return {
                contents: content,
                loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
              };
            });
          },
        },
      ],
    });

    result.logs.forEach((log) => {
      console.log(`  [${log.level}] ${log.message}`);
    });

    if (!result.success) {
      return false;
    }

    return true;
  };

  // Clean dist directory
  await $`rm -rf dist`.cwd(packageDir).nothrow();

  // Recursive build function for all .ts files
  const runBunBundleRec = async (type: 'cjs' | 'mjs') => {
    const tsGlob = new Glob('**/*.ts');
    for await (const file of tsGlob.scan({
      cwd: path.join(packageDir, 'src'),
    })) {
      // Skip test files and declaration files
      if (file.endsWith('.test.ts') || file.endsWith('.d.ts')) {
        continue;
      }
      // Get the directory part of the relative path to preserve folder structure
      const relativeDir = path.dirname(file);
      await bunBuildFile(path.join(packageDir, 'src', file), relativeDir, type);
    }
    return true;
  };

  // Build all formats in parallel
  const success = (
    await Promise.all([
      runBunBundleRec('mjs'),
      runBunBundleRec('cjs'),
      runTsc('tsconfig.types.json'),
    ])
  ).every((s) => s);

  if (!success) {
    throw new Error(`Failed to build ${npmPackageName}`);
  }

  // Generate isolate.d.ts if this package has type definitions
  const typeDefKey = ISOLATE_TYPE_MAPPING[packageName];
  if (typeDefKey) {
    const typeContent = TYPE_DEFINITIONS[typeDefKey];
    await Bun.write(
      path.join(packageDir, 'dist', 'types', 'isolate.d.ts'),
      typeContent
    );
    console.log(`  ✅ isolate.d.ts generated from TYPE_DEFINITIONS`);
  }

  console.log(`  ✅ CJS bundle created`);
  console.log(`  ✅ MJS bundle created`);

  // Create package.json in dist folders
  const version = packageJson.version;

  for (const [folder, type] of [
    ['dist/cjs', 'commonjs'],
    ['dist/mjs', 'module'],
  ] as const) {
    await Bun.write(
      path.join(packageDir, folder, 'package.json'),
      JSON.stringify(
        {
          name: packageJson.name,
          version,
          type,
        },
        null,
        2,
      ),
    );
  }

  // Update main package.json for publishing
  const publishPackageJson = { ...packageJson };

  // Inject metadata from root package.json
  publishPackageJson.author = rootMetadata.author;
  publishPackageJson.license = rootMetadata.license;
  publishPackageJson.repository = rootMetadata.repository;
  publishPackageJson.bugs = rootMetadata.bugs;
  publishPackageJson.homepage = rootMetadata.homepage;
  publishPackageJson.keywords = rootMetadata.keywords;

  // Add package-specific description if not present
  if (!publishPackageJson.description) {
    const descriptions: Record<string, string> = {
      core: 'Core utilities and class builder for isolated-vm V8 sandbox bindings',
      'isolate-types': 'Type definition strings and type-checking utilities for isolated-vm V8 sandbox APIs',
      console: 'Console API implementation for isolated-vm V8 sandbox',
      crypto: 'Web Crypto API implementation for isolated-vm V8 sandbox',
      encoding: 'Base64 encoding APIs (atob, btoa) for isolated-vm V8 sandbox',
      path: 'POSIX path utilities (join, resolve, dirname, basename, etc.) for isolated-vm V8 sandbox',
      timers: 'Timer APIs (setTimeout, setInterval, clearTimeout, clearInterval) for isolated-vm V8 sandbox',
      fetch: 'Fetch API implementation for isolated-vm V8 sandbox',
      fs: 'File system API implementation for isolated-vm V8 sandbox',
      runtime: 'Complete isolated-vm V8 sandbox runtime with fetch, fs, and core bindings',
      'test-environment': 'Test environment for running tests inside isolated-vm V8 sandbox',
      playwright: 'Playwright bridge for running browser tests in isolated-vm V8 sandbox',
      'isolate-protocol': 'Binary protocol for communication between isolate daemon and client',
      'isolate-daemon': 'Node.js daemon server for running isolated-vm runtimes via IPC',
      'isolate-client': 'Client library for connecting to the isolate daemon from any JavaScript runtime',
    };
    publishPackageJson.description = descriptions[packageName] || rootMetadata.description;
  }

  // Remove dev-only fields
  delete publishPackageJson.devDependencies;

  // Convert workspace dependencies to versioned dependencies
  if (publishPackageJson.dependencies) {
    for (const [dep, ver] of Object.entries(publishPackageJson.dependencies)) {
      if (typeof ver === 'string' && ver.startsWith('workspace:')) {
        // Get the actual version from the dependency's package.json
        const depPackageName = dep.replace('@ricsam/isolate-', '');
        if (PACKAGES.includes(depPackageName)) {
          const depPackageJson = await Bun.file(
            path.join(__dirname, '..', 'packages', depPackageName, 'package.json'),
          ).json();
          publishPackageJson.dependencies[dep] = `^${depPackageJson.version}`;
        }
      }
    }
  }

  // Update peerDependencies to remove workspace protocol
  if (publishPackageJson.peerDependencies) {
    for (const [dep, ver] of Object.entries(publishPackageJson.peerDependencies)) {
      if (typeof ver === 'string' && ver.startsWith('workspace:')) {
        // Get the actual version from the dependency's package.json
        const depPackageName = dep.replace('@ricsam/isolate-', '');
        if (PACKAGES.includes(depPackageName)) {
          const depPackageJson = await Bun.file(
            path.join(__dirname, '..', 'packages', depPackageName, 'package.json'),
          ).json();
          publishPackageJson.peerDependencies[dep] = `^${depPackageJson.version}`;
        }
      }
    }
  }

  // Set module type and exports
  delete publishPackageJson.type;
  publishPackageJson.main = './dist/cjs/index.cjs';
  publishPackageJson.module = './dist/mjs/index.mjs';
  publishPackageJson.types = './dist/types/index.d.ts';

  // Transform exports from source package.json
  function transformExports(originalExports: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(originalExports)) {
      if (typeof value === 'object' && value !== null) {
        const exportEntry = value as Record<string, string>;
        const importPath = exportEntry.import || exportEntry.default;

        if (importPath && importPath.startsWith('./src/') && importPath.endsWith('.ts')) {
          // Transform ./src/foo/bar.ts -> appropriate dist paths
          const relativePath = importPath.replace('./src/', '').replace('.ts', '');
          transformed[key] = {
            types: `./dist/types/${relativePath}.d.ts`,
            require: `./dist/cjs/${relativePath}.cjs`,
            import: `./dist/mjs/${relativePath}.mjs`,
          };
        }
      } else if (typeof value === 'string' && value.startsWith('./src/') && value.endsWith('.ts')) {
        // Simple string export
        const relativePath = value.replace('./src/', '').replace('.ts', '');
        transformed[key] = {
          types: `./dist/types/${relativePath}.d.ts`,
          require: `./dist/cjs/${relativePath}.cjs`,
          import: `./dist/mjs/${relativePath}.mjs`,
        };
      }
    }

    return transformed;
  }

  // Transform bin from source package.json
  function transformBin(originalBin: string | Record<string, string>): string | Record<string, string> {
    if (typeof originalBin === 'string') {
      // Simple string bin path
      if (originalBin.startsWith('./src/') && originalBin.endsWith('.ts')) {
        const relativePath = originalBin.replace('./src/', '').replace('.ts', '.cjs');
        return `./dist/cjs/${relativePath}`;
      }
      return originalBin;
    } else if (typeof originalBin === 'object' && originalBin !== null) {
      // Object with multiple bin entries
      const transformed: Record<string, string> = {};
      for (const [binName, binPath] of Object.entries(originalBin)) {
        if (binPath.startsWith('./src/') && binPath.endsWith('.ts')) {
          const relativePath = binPath.replace('./src/', '').replace('.ts', '.cjs');
          transformed[binName] = `./dist/cjs/${relativePath}`;
        } else {
          transformed[binName] = binPath;
        }
      }
      return transformed;
    }
    return originalBin;
  }

  // Use transformed exports from package.json if available, otherwise default to index
  if (packageJson.exports && Object.keys(packageJson.exports).length > 0) {
    publishPackageJson.exports = transformExports(packageJson.exports);
  } else {
    publishPackageJson.exports = {
      '.': {
        types: './dist/types/index.d.ts',
        require: './dist/cjs/index.cjs',
        import: './dist/mjs/index.mjs',
      },
    };
  }

  // Transform bin field if present
  if (packageJson.bin) {
    publishPackageJson.bin = transformBin(packageJson.bin);
  }

  // Add isolate types export if this package has type definitions
  if (ISOLATE_TYPE_MAPPING[packageName]) {
    publishPackageJson.exports['./isolate'] = {
      types: './dist/types/isolate.d.ts',
    };
  }

  publishPackageJson.publishConfig = {
    access: 'public',
  };
  publishPackageJson.files = ['dist', 'README.md'];

  // Write the publish-ready package.json
  await Bun.write(
    path.join(packageDir, 'package.json'),
    JSON.stringify(publishPackageJson, null, 2),
  );

  console.log(`  ✅ package.json updated for publishing`);

  console.log(`✨ Finished building ${npmPackageName} v${version}`);
};

// Main build process
const main = async () => {
  console.log('🚀 Building @ricsam/isolate packages for npm publishing...');
  console.log('============================================================\n');

  // Load root package.json for metadata
  const rootPackageJson = await Bun.file(path.join(__dirname, '..', 'package.json')).json();
  const rootMetadata = {
    author: rootPackageJson.author,
    license: rootPackageJson.license,
    repository: rootPackageJson.repository,
    bugs: rootPackageJson.bugs,
    homepage: rootPackageJson.homepage,
    keywords: rootPackageJson.keywords,
    description: rootPackageJson.description,
  };

  for (const pkg of PACKAGES) {
    try {
      await buildPackage(pkg, rootMetadata);
    } catch (error) {
      console.error(`❌ Failed to build ${getNpmPackageName(pkg)}:`, error);
      process.exit(1);
    }
  }

  console.log('\n✨ All packages built successfully!');
  console.log('\n📝 Next steps:');
  console.log('  1. Review the built packages in packages/*/dist');
  console.log('  2. Test the packages locally if needed');
  console.log('  3. Publish with: npm publish packages/core');
  console.log('                   npm publish packages/isolate-types');
  console.log('                   npm publish packages/fetch');
  console.log('                   npm publish packages/fs');
  console.log('                   npm publish packages/runtime');
  console.log('                   npm publish packages/test-environment');
  console.log('\n   Or use: bun run publish:all\n');
};

main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
