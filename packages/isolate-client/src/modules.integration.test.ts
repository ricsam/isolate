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

describe("builtinmodules", () => {
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

  it("require('process') returns process object", async () => {
    const outcomes: Record<string, string[]> = {};

    for (const adapter of adapters) {
      const logs: string[] = [];
      const runtime = await adapter.createRuntime({
        cwd: "/app",
        env: { NODE_ENV: "test" },
        console: {
          onEntry: (entry) => {
            if (entry.type === "output" && entry.level === "log") {
              logs.push(entry.stdout);
            }
          },
        },
      });

      try {
        await runtime.eval(
          `
          const proc = require("process");
          console.log(proc.cwd());
          console.log(proc.env.NODE_ENV);
        `,
          { filename: "/entry.ts" }
        );
        outcomes[adapter.name] = logs;
      } finally {
        await runtime.dispose();
      }
    }

    assert.deepStrictEqual(outcomes.direct, outcomes.daemon);
    assert.deepStrictEqual(outcomes.direct, ["/app", "test"]);
  });
});
