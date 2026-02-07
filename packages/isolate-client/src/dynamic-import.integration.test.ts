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
});
