import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test, type TestContext } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createTestHost, createTestId } from "../testing/integration-helpers.ts";
import type {
  BrowserRuntime,
  ConsoleEntry,
  HostCallContext,
  IsolateHost,
  PlaywrightEvent,
} from "../types.ts";

async function createBrowserServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((request, response) => {
    if (request.url === "/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("slow");
      }, 100);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <html>
        <body>
          <div id="ready">ready</div>
          <script>
            console.log("browser ready");
          </script>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine browser test server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function launchChromiumOrSkip(testContext: TestContext): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
  } catch (error) {
    testContext.skip(
      `Playwright Chromium is unavailable in this environment: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

describe("BrowserRuntime integration", () => {
  let host: IsolateHost;
  let cleanup: (() => Promise<void>) | undefined;

  before(async () => {
    const testHost = await createTestHost("browser-runtime-integration");
    host = testHost.host;
    cleanup = testHost.cleanup;
  });

  after(async () => {
    await cleanup?.();
  });

  test("runs Playwright test suites and records browser diagnostics", async (testContext) => {
    const browserHarness = await launchChromiumOrSkip(testContext);
    const browserServer = await createBrowserServer();
    const consoleEntries: ConsoleEntry[] = [];
    const browserEvents: PlaywrightEvent[] = [];
    let runtime: BrowserRuntime | undefined;

    try {
      runtime = await host.createBrowserRuntime({
        key: createTestId("browser-suite"),
        bindings: {
          console: {
            onEntry(entry) {
              consoleEntries.push(entry);
            },
          },
        },
        features: {
          tests: true,
        },
        browser: {
          page: browserHarness.page,
          captureConsole: true,
          onEvent(event) {
            browserEvents.push(event);
          },
        },
      });

      const result = await runtime.run(
        `
          test("loads the page", async () => {
            await page.goto(${JSON.stringify(browserServer.url)});
            await expect(page.locator("#ready")).toContainText("ready");
          });
        `,
        {
          filename: "/browser-test.ts",
          asTestSuite: true,
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.tests?.passed, 1);
      assert.equal(result.tests?.failed, 0);

      const diagnostics = await runtime.diagnostics();
      assert.ok(diagnostics.browserConsoleLogs > 0);
      assert.ok(diagnostics.networkRequests > 0);
      assert.ok(diagnostics.networkResponses > 0);
      const browserConsoleLogs = diagnostics.collectedData.browserConsoleLogs as Array<{ stdout: string }>;
      assert.ok(
        browserConsoleLogs.some((entry) => entry.stdout.includes("browser ready")),
        "expected browser console logs to include the page log",
      );
      assert.ok(
        browserEvents.some((event) => event.type === "browserConsoleLog" && event.stdout.includes("browser ready")),
        "expected onEvent to receive browser console log events",
      );
      assert.ok(browserEvents.some((event) => event.type === "networkRequest"));
      assert.ok(browserEvents.some((event) => event.type === "networkResponse"));
      assert.ok(
        consoleEntries.some((entry) => entry.type === "browserOutput" && entry.stdout.includes("browser ready")),
        "expected captureConsole to forward browser logs into host console bindings",
      );
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("uses browser.readFile for Playwright file uploads", async (testContext) => {
    const browserHarness = await launchChromiumOrSkip(testContext);
    const readFileCalls: string[] = [];
    let runtime: BrowserRuntime | undefined;

    try {
      runtime = await host.createBrowserRuntime({
        key: createTestId("browser-file-upload"),
        bindings: {},
        features: {
          tests: true,
        },
        browser: {
          page: browserHarness.page,
          readFile: async (filePath: string) => {
            readFileCalls.push(filePath);
            return Buffer.from("Hello from browser runtime");
          },
        },
      });

      const result = await runtime.run(
        `
          test("uploads a file via host callback", async () => {
            await page.goto('data:text/html,<input type="file" id="upload" />');

            const input = page.locator("#upload");
            await input.setInputFiles("/fixtures/upload.txt");

            const files = await page.evaluate(() => {
              const input = document.getElementById("upload");
              if (!(input instanceof HTMLInputElement)) {
                throw new Error("missing input");
              }
              return Array.from(input.files || []).map((file) => ({
                name: file.name,
                size: file.size,
              }));
            });

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("upload.txt");
            expect(files[0].size).toBe(26);
          });
        `,
        {
          filename: "/browser-upload-test.ts",
          asTestSuite: true,
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.tests?.passed, 1);
      assert.equal(result.tests?.failed, 0);
      assert.deepEqual(readFileCalls, ["/fixtures/upload.txt"]);
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
    }
  });

  test("starts Playwright waiters without blocking later isolate work", async (testContext) => {
    const browserHarness = await launchChromiumOrSkip(testContext);
    const browserServer = await createBrowserServer();
    const marks: string[] = [];
    let runtime: BrowserRuntime | undefined;

    try {
      runtime = await host.createBrowserRuntime({
        key: createTestId("browser-async-waiters"),
        bindings: {
          tools: {
            mark: async (...args: [...unknown[], HostCallContext]) => {
              const value = args[0] as string;
              marks.push(value);
              return value;
            },
          },
        },
        features: {
          tests: true,
        },
        browser: {
          page: browserHarness.page,
        },
      });

      const result = await runtime.run(
        `
          test("waitForResponse yields before the response arrives", async () => {
            await page.goto(${JSON.stringify(browserServer.url)});

            const pendingResponse = page.waitForResponse(/\\/slow$/);
            const marker = await mark("started");
            expect(marker).toBe("started");

            await page.evaluate(() => fetch("/slow"));

            const response = await pendingResponse;
            expect(await response.text()).toBe("slow");
            expect(await page.url()).toContain(${JSON.stringify(browserServer.url)});
          });
        `,
        {
          filename: "/browser-async-waiters.test.ts",
          asTestSuite: true,
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.tests?.passed, 1);
      assert.equal(result.tests?.failed, 0);
      assert.deepEqual(marks, ["started"]);
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("injects a browser factory into script runtimes and supports nested browser runtimes", async (testContext) => {
    const browserHarness = await launchChromiumOrSkip(testContext);
    const browserServer = await createBrowserServer();
    const consoleEntries: ConsoleEntry[] = [];
    let runtime: Awaited<ReturnType<IsolateHost["createRuntime"]>> | undefined;

    try {
      runtime = await host.createRuntime({
        bindings: {
          console: {
            onEntry(entry) {
              consoleEntries.push(entry);
            },
          },
          browser: {
            createContext: async (options) => await browserHarness.browser.newContext(options as never),
            createPage: async (context) => await (context as BrowserContext).newPage(),
          },
        },
      });

      await runtime.eval(`
        import { createIsolateHost } from "@ricsam/isolate";

        const nestedHost = createIsolateHost();
        const childEntries = [];

        const contextInstance = await browser.newContext();
        const pageInstance = await contextInstance.newPage();
        await pageInstance.goto(${JSON.stringify(browserServer.url)});
        const text = await pageInstance.locator("#ready").textContent();

        const child = await nestedHost.createBrowserRuntime({
          browser,
          bindings: {
            console: {
              onEntry(entry) {
                if (entry.type === "output") {
                  childEntries.push(entry.stdout);
                }
              },
            },
          },
        });

        await child.run(\`
          await page.goto(${JSON.stringify(browserServer.url)});
          console.log(await page.locator("#ready").textContent());
        \`, {
          filename: "/nested-browser-runtime.ts",
        });

        const diagnostics = await child.diagnostics();
        await child.dispose();
        await nestedHost.close();
        await pageInstance.close();
        await contextInstance.close();

        console.log(JSON.stringify({
          childEntries,
          diagnostics: {
            browserConsoleLogs: diagnostics.browserConsoleLogs,
            networkRequests: diagnostics.networkRequests,
            networkResponses: diagnostics.networkResponses,
          },
          hasBrowser: typeof browser === "object",
          hasBrowserClose: typeof browser.close,
          hasContextGlobal: typeof context,
          hasPageGlobal: typeof page,
          text,
        }));
      `, { executionTimeout: 20_000 });
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
      await browserServer.close();
    }

    assert.equal(consoleEntries.length, 1);
    const outputEntry = consoleEntries[0];
    assert.equal(outputEntry?.type, "output");
    const result = JSON.parse(outputEntry.stdout) as {
      childEntries: string[];
      diagnostics: {
        browserConsoleLogs: number;
        networkRequests: number;
        networkResponses: number;
      };
      hasBrowser: boolean;
      hasBrowserClose: string;
      hasContextGlobal: string;
      hasPageGlobal: string;
      text: string | null;
    };

    assert.equal(result.hasBrowser, true);
    assert.equal(result.hasBrowserClose, "undefined");
    assert.equal(result.hasContextGlobal, "undefined");
    assert.equal(result.hasPageGlobal, "undefined");
    assert.equal(result.text, "ready");
    assert.deepEqual(result.childEntries, ["ready"]);
    assert.ok(result.diagnostics.browserConsoleLogs > 0);
    assert.ok(result.diagnostics.networkRequests > 0);
    assert.ok(result.diagnostics.networkResponses > 0);
  });
});
