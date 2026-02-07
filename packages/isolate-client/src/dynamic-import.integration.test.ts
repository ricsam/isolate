/**
 * Integration tests for dynamic import() and require() support.
 * Runs identical scenarios against:
 * 1) direct runtime adapter (createRuntime from @ricsam/isolate-runtime)
 * 2) client/daemon adapter (connect().createRuntime())
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { createRuntime as createDirectRuntime } from "@ricsam/isolate-runtime";
import { connect } from "./connection.ts";
import type {
  DaemonConnection,
  RemoteRuntime,
  RuntimeOptions as ClientRuntimeOptions,
} from "./types.ts";
import type {
  RuntimeHandle as DirectRuntime,
  RuntimeOptions as DirectRuntimeOptions,
} from "@ricsam/isolate-runtime";

const TEST_SOCKET = "/tmp/isolate-dynamic-import-test.sock";

type SharedRuntimeOptions = DirectRuntimeOptions & ClientRuntimeOptions;
type RuntimeAdapter = {
  name: "direct" | "daemon";
  createRuntime(
    options: SharedRuntimeOptions
  ): Promise<DirectRuntime | RemoteRuntime>;
};

describe("dynamic import/require", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let adapters: RuntimeAdapter[];

  before(async () => {
    daemon = await startDaemon({ socketPath: TEST_SOCKET });
    client = await connect({ socket: TEST_SOCKET });

    adapters = [
      {
        name: "direct",
        createRuntime: (options) => createDirectRuntime(options),
      },
      {
        name: "daemon",
        createRuntime: (options) => client.createRuntime(options),
      },
    ];
  });

  after(async () => {
    await client.close();
    await daemon.close();
  });

  it("basic dynamic import()", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/math") {
            return {
              code: `export const add = (a, b) => a + b; export const mul = (a, b) => a * b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const math = await import("@/math");
          console.log("add", math.add(2, 3));
          console.log("mul", math.mul(4, 5));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["add 5", "mul 20"]);
  });

  it("basic require()", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/utils") {
            return {
              code: `export const greet = (name) => "Hello, " + name + "!"; export default "utils-default";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const utils = require("@/utils");
          console.log(utils.greet("World"));
          console.log("default:", utils.default);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, [
      "Hello, World!",
      "default: utils-default",
    ]);
  });

  it("dynamic import with static imports in the imported module", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/calc") {
            return {
              code: `import { add } from "@/math"; export const sum = add(10, 20);`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/math") {
            return {
              code: `export const add = (a, b) => a + b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const calc = await import("@/calc");
          console.log("sum", calc.sum);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["sum 30"]);
  });

  it("nested dynamic imports: module A dynamically imports module B which dynamically imports module C", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/a") {
            return {
              code: `const b = await import("@/b"); export const value = "A+" + b.value;`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/b") {
            return {
              code: `const c = await import("@/c"); export const value = "B+" + c.value;`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/c") {
            return {
              code: `export const value = "C";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const a = await import("@/a");
          console.log(a.value);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["A+B+C"]);
  });

  it("cache sharing: statically imported module available via dynamic import", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      let loadCount = 0;
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/shared") {
            loadCount++;
            return {
              code: `export const token = "shared-value";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import { token } from "@/shared";
          const dynamicMod = await import("@/shared");
          console.log("static:", token);
          console.log("dynamic:", dynamicMod.token);
          console.log("same:", token === dynamicMod.token);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
        // Module loader should only be called once since cache is shared
        assert.strictEqual(loadCount, 1, `${adapter.name}: module loaded more than once`);
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, [
      "static: shared-value",
      "dynamic: shared-value",
      "same: true",
    ]);
  });

  it("dynamic import with no module loader throws", async () => {
    for (const adapter of adapters) {
      const runtime = await adapter.createRuntime({});

      try {
        await assert.rejects(
          async () => {
            await runtime.eval(
              `const m = await import("@/missing");`,
              { filename: "/entry.ts" }
            );
          },
          /No module loader registered/,
          `${adapter.name}: should throw when no module loader`
        );
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("dynamic import propagates module loader errors", async () => {
    for (const adapter of adapters) {
      const runtime = await adapter.createRuntime({
        moduleLoader: async (moduleName) => {
          throw new Error(`Cannot find module: ${moduleName}`);
        },
      });

      try {
        await assert.rejects(
          async () => {
            await runtime.eval(
              `const m = await import("@/nonexistent");`,
              { filename: "/entry.ts" }
            );
          },
          /Cannot find module/,
          `${adapter.name}: should propagate module loader error`
        );
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("require() propagates module loader errors", async () => {
    for (const adapter of adapters) {
      const runtime = await adapter.createRuntime({
        moduleLoader: async (moduleName) => {
          throw new Error(`Cannot find module: ${moduleName}`);
        },
      });

      try {
        await assert.rejects(
          async () => {
            await runtime.eval(
              `const m = require("@/nonexistent");`,
              { filename: "/entry.ts" }
            );
          },
          /Cannot find module/,
          `${adapter.name}: should propagate module loader error`
        );
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("dynamic import in module code (not just entry)", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/loader") {
            return {
              code: `export async function load(name) { const mod = await import(name); return mod; }`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/data") {
            return {
              code: `export const items = [1, 2, 3];`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import { load } from "@/loader";
          const data = await load("@/data");
          console.log(JSON.stringify(data.items));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["[1,2,3]"]);
  });

  it("conditional dynamic import based on runtime value", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/en") {
            return {
              code: `export const greeting = "Hello";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/es") {
            return {
              code: `export const greeting = "Hola";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const lang = "es";
          const mod = await import("@/" + lang);
          console.log(mod.greeting);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["Hola"]);
  });

  it("require() returns module namespace with default export", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/config") {
            return {
              code: `export default { port: 3000, host: "localhost" }; export const debug = true;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const config = require("@/config");
          console.log("port:", config.default.port);
          console.log("host:", config.default.host);
          console.log("debug:", config.debug);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, [
      "port: 3000",
      "host: localhost",
      "debug: true",
    ]);
  });

  it("multiple dynamic imports in same eval", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/a") {
            return {
              code: `export const name = "module-a";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/b") {
            return {
              code: `export const name = "module-b";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/c") {
            return {
              code: `export const name = "module-c";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const [a, b, c] = await Promise.all([
            import("@/a"),
            import("@/b"),
            import("@/c"),
          ]);
          console.log(a.name, b.name, c.name);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["module-a module-b module-c"]);
  });

  it("CJS module.exports object via import()", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/cjs-lib") {
            return {
              code: `module.exports = { hello: "world", num: 42 };`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const lib = await import("@/cjs-lib");
          console.log("hello:", lib.hello);
          console.log("num:", lib.num);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["hello: world", "num: 42"]);
  });

  it("CJS module.exports object via require()", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/cjs-lib") {
            return {
              code: `module.exports = { greet: (name) => "Hi " + name };`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const lib = require("@/cjs-lib");
          console.log(lib.greet("Alice"));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["Hi Alice"]);
  });

  it("CJS exports.foo incremental assignment", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/helpers") {
            return {
              code: `exports.greet = (name) => "Hello, " + name;\nexports.farewell = (name) => "Bye, " + name;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const helpers = await import("@/helpers");
          console.log(helpers.greet("Bob"));
          console.log(helpers.farewell("Bob"));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["Hello, Bob", "Bye, Bob"]);
  });

  it("CJS module.exports = function", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/fn-module") {
            return {
              code: `module.exports = function(x) { return x * 2; };`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const double = await import("@/fn-module");
          console.log("result:", double(21));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["result: 42"]);
  });

  it("export { name } list syntax via dynamic import", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/lib") {
            return {
              code: `function createRandomStringGenerator() { return () => "random"; }\nexport { createRandomStringGenerator };`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const lib = await import("@/lib");
          const gen = lib.createRandomStringGenerator();
          console.log(gen());
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["random"]);
  });

  it("export { name } list syntax via static import", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/lib") {
            return {
              code: `function createRandomStringGenerator() { return () => "random"; }\nexport { createRandomStringGenerator };`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import { createRandomStringGenerator } from "@/lib";
          const gen = createRandomStringGenerator();
          console.log(gen());
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["random"]);
  });

  it("export { name } from 'mod' re-export", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/barrel") {
            return {
              code: `export { greet } from "@/impl";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/impl") {
            return {
              code: `export const greet = (name) => "Hello, " + name;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const barrel = await import("@/barrel");
          console.log(barrel.greet("World"));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["Hello, World"]);
  });

  it("export { a as b } from 'mod' renamed re-export", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/barrel") {
            return {
              code: `export { add as sum } from "@/math";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/math") {
            return {
              code: `export const add = (a, b) => a + b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const barrel = await import("@/barrel");
          console.log("sum:", barrel.sum(3, 4));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["sum: 7"]);
  });

  it("export * from 'mod' star re-export", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/barrel") {
            return {
              code: `export * from "@/math";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/math") {
            return {
              code: `export const add = (a, b) => a + b; export const mul = (a, b) => a * b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const barrel = await import("@/barrel");
          console.log("add:", barrel.add(1, 2));
          console.log("mul:", barrel.mul(3, 4));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["add: 3", "mul: 12"]);
  });

  it("export * as ns from 'mod' namespace re-export", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/barrel") {
            return {
              code: `export * as math from "@/math";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/math") {
            return {
              code: `export const add = (a, b) => a + b; export const mul = (a, b) => a * b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const barrel = await import("@/barrel");
          console.log("add:", barrel.math.add(5, 6));
          console.log("mul:", barrel.math.mul(7, 8));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["add: 11", "mul: 56"]);
  });

  it("re-export chain: A re-exports from B which re-exports from C", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/a") {
            return {
              code: `export { value } from "@/b";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/b") {
            return {
              code: `export { value } from "@/c";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/c") {
            return {
              code: `export const value = "deep";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const a = await import("@/a");
          console.log(a.value);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["deep"]);
  });

  it("mixed local exports and re-exports", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/mixed") {
            return {
              code: `export const local = "local-value";\nexport { remote } from "@/dep";`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/dep") {
            return {
              code: `export const remote = "remote-value";`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const mixed = await import("@/mixed");
          console.log("local:", mixed.local);
          console.log("remote:", mixed.remote);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, [
      "local: local-value",
      "remote: remote-value",
    ]);
  });

  it("CJS exports.NAME via static import (better-auth pattern)", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@better-auth/utils/random") {
            // Simulates the actual .cjs file content that require.resolve returns
            return {
              code: `'use strict';\nfunction createRandomStringGenerator() { return () => "random-string"; }\nexports.createRandomStringGenerator = createRandomStringGenerator;`,
              resolveDir: "/node_modules/@better-auth/utils/dist",
              static: true,
            };
          }
          if (moduleName === "@/id") {
            return {
              code: `import { createRandomStringGenerator } from "@better-auth/utils/random";\nexport const generateId = () => createRandomStringGenerator()();`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import { generateId } from "@/id";
          console.log(generateId());
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["random-string"]);
  });

  it("CJS module.exports = {...} via static import", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/cjs-mod") {
            return {
              code: `module.exports = { value: 42, label: "hello" };`,
              resolveDir: importer.resolveDir,
              static: true,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import cjsMod from "@/cjs-mod";
          console.log("value:", cjsMod.value);
          console.log("label:", cjsMod.label);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["value: 42", "label: hello"]);
  });

  it("CJS exports.NAME via static import with named imports", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/cjs-named") {
            return {
              code: `exports.greet = (name) => "Hello, " + name;\nexports.farewell = (name) => "Bye, " + name;`,
              resolveDir: importer.resolveDir,
              static: true,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          import { greet, farewell } from "@/cjs-named";
          console.log(greet("Alice"));
          console.log(farewell("Bob"));
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["Hello, Alice", "Bye, Bob"]);
  });

  it("CJS module that uses require() internally", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
        moduleLoader: async (moduleName, importer) => {
          if (moduleName === "@/cjs-main") {
            return {
              code: `const utils = require("@/cjs-utils");\nmodule.exports = { result: utils.add(10, 20) };`,
              resolveDir: importer.resolveDir,
            };
          }
          if (moduleName === "@/cjs-utils") {
            return {
              code: `exports.add = (a, b) => a + b;`,
              resolveDir: importer.resolveDir,
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(
          `
          const main = require("@/cjs-main");
          console.log("result:", main.result);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["result: 30"]);
  });
});
