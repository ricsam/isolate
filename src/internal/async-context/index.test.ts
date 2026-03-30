import assert from "node:assert/strict";
import { test } from "node:test";
import ivm from "@ricsam/isolated-vm";
import { setupAsyncContext } from "./index.ts";

test("setupAsyncContext rejects contexts without async context intrinsics", async () => {
  const isolate = new ivm.Isolate();
  const context = await isolate.createContext();

  try {
    await assert.rejects(
      async () => await setupAsyncContext(context),
      /does not support AsyncContext/i,
    );
  } finally {
    context.release();
    isolate.dispose();
  }
});

test("setupAsyncContext bootstraps AsyncContext globals for enabled contexts", async () => {
  const isolate = new ivm.Isolate();
  const context = await isolate.createContext({
    asyncContext: true,
  } as any);

  try {
    const hasAsyncContextBeforeSetup = context.evalSync(`
      typeof AsyncContext === "object"
        && typeof AsyncContext?.Variable === "function"
        && typeof AsyncContext?.Snapshot === "function"
    `) as boolean;

    await setupAsyncContext(context);

    const values = await context.eval(`
      (async () => {
        const variable = new AsyncContext.Variable({
          name: "unit-test",
          defaultValue: "unset",
        });

        return {
          hasAsyncContext: typeof AsyncContext === "object",
          defaultValue: variable.get(),
          asyncValue: await variable.run("value", async () => {
            await Promise.resolve();
            return variable.get();
          }),
        };
      })()
    `, {
      copy: true,
      promise: true,
    } as any) as {
      hasAsyncContext: boolean;
      defaultValue: string;
      asyncValue: string;
    };

    assert.deepEqual(values, {
      hasAsyncContext: true,
      defaultValue: "unset",
      asyncValue: "value",
    });
    assert.equal(hasAsyncContextBeforeSetup, true);
  } finally {
    context.release();
    isolate.dispose();
  }
});
