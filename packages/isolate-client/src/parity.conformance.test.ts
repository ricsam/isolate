/**
 * Shared conformance tests that run identical scenarios against:
 * 1) direct runtime adapter (createRuntime from @ricsam/isolate-runtime)
 * 2) client/daemon adapter (connect().createRuntime())
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { chromium } from "playwright";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { createRuntime as createDirectRuntime } from "@ricsam/isolate-runtime";
import { defaultPlaywrightHandler } from "@ricsam/isolate-playwright/client";
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

const TEST_SOCKET = "/tmp/isolate-conformance-daemon.sock";

type SharedRuntimeOptions = DirectRuntimeOptions & ClientRuntimeOptions;
type RuntimeAdapter = {
  name: "direct" | "daemon";
  createRuntime(options: SharedRuntimeOptions): Promise<DirectRuntime | RemoteRuntime>;
};

describe("parity conformance", () => {
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

  it("module loader semantics match", async () => {
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
              code: `export const add = (a, b) => a + b;`,
              resolveDir: importer.resolveDir,
              format: "esm" as const,
              filename: "math",
            };
          }
          if (moduleName === "@/calc") {
            return {
              code: `import { add } from "@/math"; export const result = add(2, 3);`,
              resolveDir: importer.resolveDir,
              format: "esm" as const,
              filename: "calc",
            };
          }
          throw new Error(`Unknown module: ${moduleName}`);
        },
      });

      try {
        await runtime.eval(`
          import { result } from "@/calc";
          console.log("sum", result);
        `, { filename: "/entry.ts" });
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["sum 5"]);
  });

  it("custom function marshalling parity (callbacks/promises/iterators)", async () => {
    const outcomes: Record<string, string> = {};

    for (const adapter of adapters) {
      let lastLog = "";
      const runtime = await adapter.createRuntime({
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              lastLog = entry.stdout;
            }
          },
        },
        customFunctions: {
          getHelpers: {
            type: "sync",
            fn: () => ({
              double: (n: number) => n * 2,
              later: Promise.resolve(7),
              letters: (async function* () {
                yield "a";
                yield "b";
              })(),
            }),
          },
        },
      });

      try {
        await runtime.eval(`
          const helpers = getHelpers();
          const doubled = helpers.double(5);
          const later = await helpers.later;
          const letters = [];
          for await (const ch of helpers.letters) {
            letters.push(ch);
          }
          console.log(JSON.stringify({ doubled, later, letters }));
        `);
        outcomes[adapter.name] = lastLog;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.strictEqual(
      outcomes.direct,
      JSON.stringify({ doubled: 10, later: 7, letters: ["a", "b"] })
    );
  });

  it("runTests(timeout) semantics match", async () => {
    for (const adapter of adapters) {
      const runtime = await adapter.createRuntime({ testEnvironment: true });
      try {
        await runtime.eval(`
          test("slow test", async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
          });
        `);

        await assert.rejects(
          async () => {
            await runtime.testEnvironment.runTests(10);
          },
          /timeout/i,
          `${adapter.name} should reject on timeout`
        );
      } finally {
        await runtime.dispose();
      }
    }
  });

  it("fetch callback error semantics match", async () => {
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
        fetch: async (url) => {
          if (url.endsWith("/ok")) {
            return Response.json({ ok: true });
          }
          throw new Error("boom");
        },
      });

      try {
        await runtime.eval(`
          const ok = await fetch("https://example.com/ok");
          const okJson = await ok.json();
          console.log(JSON.stringify(okJson));

          try {
            await fetch("https://example.com/fail");
          } catch (err) {
            console.log(err.message);
          }
        `);
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.strictEqual(outcomes.direct?.[0], JSON.stringify({ ok: true }));
    assert.ok(outcomes.direct?.[1]?.toLowerCase().includes("boom"));
  });

  it("playwright handler helper works in both adapters", async () => {
    const browser = await chromium.launch({ headless: true });

    try {
      const outcomes: Record<string, { passed: number; failed: number; logs: number }> = {};

      for (const adapter of adapters) {
        const browserContext = await browser.newContext();
        const page = await browserContext.newPage();

        const runtime = await adapter.createRuntime({
          testEnvironment: true,
          playwright: {
            handler: defaultPlaywrightHandler(page),
            console: true,
          },
        });

        try {
          await runtime.eval(`
            test("handler parity", async () => {
              await page.goto("data:text/html,<h1 id='title'>Parity</h1>");
              await expect(page.locator("#title")).toContainText("Parity");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          const collected = runtime.playwright.getCollectedData();
          outcomes[adapter.name] = {
            passed: results.passed,
            failed: results.failed,
            logs: collected.browserConsoleLogs.length,
          };
        } finally {
          await runtime.dispose();
          await browserContext.close();
        }
      }

      assert.deepStrictEqual(outcomes.direct?.passed, 1);
      assert.deepStrictEqual(outcomes.daemon?.passed, 1);
      assert.deepStrictEqual(outcomes.direct?.failed, 0);
      assert.deepStrictEqual(outcomes.daemon?.failed, 0);
    } finally {
      await browser.close();
    }
  });

  it("process.env and process.cwd() parity", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        cwd: "/my/project",
        env: { NODE_ENV: "test", APP_NAME: "isolate" },
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(`
          console.log(process.cwd());
          console.log(process.env.NODE_ENV);
          console.log(process.env.APP_NAME);
        `);
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["/my/project", "test", "isolate"]);
  });
});

