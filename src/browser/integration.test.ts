import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createPlaywrightSessionHandler } from "../playwright.ts";
import { createTestHost, createTestId } from "../testing/integration-helpers.ts";
import type {
  ConsoleEntry,
  HostCallContext,
  IsolateHost,
  PlaywrightEvent,
  TestRuntime,
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

async function launchChromium(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

async function closeAllContexts(browser: Browser): Promise<void> {
  for (const context of browser.contexts()) {
    await context.close().catch(() => {});
  }
}

describe("browser-enabled runtimes", () => {
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

  test("runs Playwright test suites, tracks reused contexts, and records browser diagnostics", async () => {
    const browserHarness = await launchChromium();
    const browserServer = await createBrowserServer();
    const consoleEntries: ConsoleEntry[] = [];
    const browserEvents: PlaywrightEvent[] = [];
    const reusedContext = await browserHarness.browser.newContext();
    await reusedContext.newPage();
    let runtime: TestRuntime | undefined;
    let createContextCalls = 0;

    try {
      runtime = await host.createTestRuntime({
        key: createTestId("browser-suite"),
        bindings: {
          console: {
            onEntry(entry) {
              consoleEntries.push(entry);
            },
          },
          browser: {
            captureConsole: true,
            async createContext(options) {
              createContextCalls += 1;
              if (createContextCalls === 1) {
                return reusedContext;
              }
              return await browserHarness.browser.newContext(options as never);
            },
            async createPage(context) {
              return await (context as BrowserContext).newPage();
            },
            onEvent(event) {
              browserEvents.push(event);
            },
          },
        },
      });

      const result = await runtime.run(
        `
          let ctx;
          let page;

          beforeAll(async () => {
            ctx = await browser.newContext();
            const pages = await ctx.pages();
            page = pages[0] || (await ctx.newPage());
          });

          afterAll(async () => {
            await ctx.close();
          });

          test("loads the page", async () => {
            expect((await browser.contexts()).length).toBe(1);
            expect((await ctx.pages()).length).toBe(1);
            await page.goto(${JSON.stringify(browserServer.url)});
            await expect(page.locator("#ready")).toContainText("ready");
          });
        `,
        {
          filename: "/browser-test.ts",
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.passed, 1);
      assert.equal(result.failed, 0);

      const diagnostics = await runtime.diagnostics();
      assert.equal(diagnostics.test.registeredTests, 1);
      assert.ok(diagnostics.browser);
      assert.ok(diagnostics.browser.browserConsoleLogs > 0);
      assert.ok(diagnostics.browser.networkRequests > 0);
      assert.ok(diagnostics.browser.networkResponses > 0);
      const browserConsoleLogs = diagnostics.browser.collectedData.browserConsoleLogs as Array<{
        stdout: string;
        contextId: string;
        pageId: string;
      }>;
      assert.ok(
        browserConsoleLogs.some(
          (entry) =>
            entry.stdout.includes("browser ready") &&
            entry.contextId.length > 0 &&
            entry.pageId.length > 0,
        ),
        "expected browser console logs to include ids and the page log",
      );
      assert.ok(
        browserEvents.some(
          (event) =>
            event.type === "browserConsoleLog" &&
            event.stdout.includes("browser ready") &&
            event.contextId.length > 0 &&
            event.pageId.length > 0,
        ),
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
      await reusedContext.close().catch(() => {});
      await browserHarness.context.close();
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("uses browser.readFile for Playwright file uploads", async () => {
    const browserHarness = await launchChromium();
    const readFileCalls: string[] = [];
    let runtime: TestRuntime | undefined;

    try {
      runtime = await host.createTestRuntime({
        key: createTestId("browser-file-upload"),
        bindings: {
          browser: {
            async createContext(options) {
              return await browserHarness.browser.newContext(options as never);
            },
            async createPage(context) {
              return await (context as BrowserContext).newPage();
            },
            async readFile(filePath: string) {
              readFileCalls.push(filePath);
              return Buffer.from("Hello from browser runtime");
            },
          },
        },
      });

      const result = await runtime.run(
        `
          let ctx;
          let page;

          beforeAll(async () => {
            ctx = await browser.newContext();
            page = await ctx.newPage();
          });

          afterAll(async () => {
            await ctx.close();
          });

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
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.passed, 1);
      assert.equal(result.failed, 0);
      assert.deepEqual(readFileCalls, ["/fixtures/upload.txt"]);
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
    }
  });

  test("routes Playwright screenshots through browser.writeFile and returns undefined", async () => {
    const browserHarness = await launchChromium();
    const screenshotResults: string[] = [];
    const writeFileCalls: Array<{ path: string; size: number }> = [];
    let runtime: Awaited<ReturnType<IsolateHost["createRuntime"]>> | undefined;

    try {
      runtime = await host.createRuntime({
        bindings: {
          tools: {
            recordScreenshotResult: async (...args: [...unknown[], HostCallContext]) => {
              screenshotResults.push(args[0] as string);
            },
          },
          browser: {
            async createContext(options) {
              return await browserHarness.browser.newContext(options as never);
            },
            async createPage(context) {
              return await (context as BrowserContext).newPage();
            },
            async writeFile(filePath, data) {
              writeFileCalls.push({ path: filePath, size: data.byteLength });
            },
          },
        },
      });

      await runtime.eval(`
        const context = await browser.newContext();
        const page = await context.newPage();

        await page.goto(
          'data:text/html,' +
            encodeURIComponent('<div id="ready" style="width:160px;height:90px;background:#f97316;color:white;padding:16px">ready</div>')
        );

        const pageResult = await page.screenshot({
          path: "/tmp/page-screenshot.jpg",
          type: "jpeg",
          quality: 50,
        });
        await recordScreenshotResult(typeof pageResult);

        const locatorResult = await page.locator("#ready").screenshot({
          path: "/tmp/locator-screenshot.jpg",
          type: "jpeg",
          quality: 50,
        });
        await recordScreenshotResult(typeof locatorResult);

        await context.close();
      `, { executionTimeout: 10_000 });

      assert.deepEqual(screenshotResults, ["undefined", "undefined"]);
      assert.deepEqual(
        writeFileCalls.map((call) => call.path),
        ["/tmp/page-screenshot.jpg", "/tmp/locator-screenshot.jpg"],
      );
      assert.ok(writeFileCalls.every((call) => call.size > 0));
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
    }
  });

  test("starts Playwright waiters without blocking later isolate work", async () => {
    const browserHarness = await launchChromium();
    const browserServer = await createBrowserServer();
    const marks: string[] = [];
    let runtime: TestRuntime | undefined;

    try {
      runtime = await host.createTestRuntime({
        key: createTestId("browser-async-waiters"),
        bindings: {
          tools: {
            mark: async (...args: [...unknown[], HostCallContext]) => {
              const value = args[0] as string;
              marks.push(value);
              return value;
            },
          },
          browser: {
            async createContext(options) {
              return await browserHarness.browser.newContext(options as never);
            },
            async createPage(context) {
              return await (context as BrowserContext).newPage();
            },
          },
        },
      });

      const result = await runtime.run(
        `
          let ctx;
          let page;

          beforeAll(async () => {
            ctx = await browser.newContext();
            page = await ctx.newPage();
          });

          afterAll(async () => {
            await ctx.close();
          });

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
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.passed, 1);
      assert.equal(result.failed, 0);
      assert.deepEqual(marks, ["started"]);
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await browserHarness.context.close();
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("preserves browser contexts across soft-disposed namespaced sessions", async () => {
    const browserHarness = await launchChromium();
    const browserServer = await createBrowserServer();
    const key = createTestId("browser-namespaced-session");
    const helper = createPlaywrightSessionHandler<BrowserContext, Page>({
      createContext: async (options) =>
        await browserHarness.browser.newContext(options as never),
      createPage: async (context) => await context.newPage(),
    });
    let runtime:
      | Awaited<ReturnType<IsolateHost["getNamespacedRuntime"]>>
      | undefined;

    try {
      runtime = await host.getNamespacedRuntime(key, {
        bindings: {
          browser: {
            handler: helper.handler,
          },
        },
      });

      await runtime.eval(`
        globalThis.__browserContext = await browser.newContext();
        globalThis.__browserPage = await globalThis.__browserContext.newPage();
        await globalThis.__browserPage.goto(${JSON.stringify(browserServer.url)});
      `);
      await runtime.dispose();

      runtime = await host.getNamespacedRuntime(key, {
        bindings: {
          browser: {
            handler: helper.handler,
          },
        },
      });

      const diagnostics = await runtime.diagnostics();
      assert.equal(diagnostics.runtime.reused, true);

      const results = await runtime.runTests(`
        test("sees the same browser state", async () => {
          const contexts = await browser.contexts();
          expect(contexts.length).toBe(1);

          const ctx = contexts[0];
          const pages = await ctx.pages();
          expect(pages.length).toBe(1);

          const page = pages[0];
          await expect(page.locator("#ready")).toContainText("ready");
        });
      `, { timeoutMs: 10_000 });

      assert.equal(results.success, true, JSON.stringify(results.tests, null, 2));
      assert.equal(results.passed, 1);
    } finally {
      await runtime?.dispose({ hard: true, reason: "test cleanup" }).catch(() => {});
      await closeAllContexts(browserHarness.browser);
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("supports the public Playwright session helper in handler-first mode", async () => {
    const browserHarness = await launchChromium();
    const browserServer = await createBrowserServer();
    const readFileCalls: string[] = [];
    const writtenFiles = new Map<string, Buffer>();
    const helperEvents: PlaywrightEvent[] = [];
    const helper = createPlaywrightSessionHandler<BrowserContext, Page>({
      timeout: 5_000,
      createContext: async (options) =>
        await browserHarness.browser.newContext(options as never),
      createPage: async (context) => await context.newPage(),
      readFile: async (filePath) => {
        readFileCalls.push(filePath);
        return {
          name: path.basename(filePath),
          mimeType: "text/plain",
          buffer: Buffer.from("Hello from public helper"),
        };
      },
      writeFile: async (filePath, data) => {
        writtenFiles.set(filePath, Buffer.from(data));
      },
    });
    const unsubscribe = helper.onEvent((event) => {
      helperEvents.push(event);
    });
    let runtime: TestRuntime | undefined;

    try {
      runtime = await host.createTestRuntime({
        bindings: {
          browser: {
            handler: helper.handler,
            captureConsole: true,
          },
        },
      });

      const result = await runtime.run(
        `
          let ctx;
          let page;

          beforeAll(async () => {
            ctx = await browser.newContext();
            page = await ctx.newPage();
          });

          test("uses uploads and file writes through the helper", async () => {
            await page.goto(${JSON.stringify(browserServer.url)});
            await page.goto('data:text/html,<input type="file" id="upload" />');

            await page.locator("#upload").setInputFiles("/fixtures/helper.txt");
            const files = await page.evaluate(() => Array.from(
              document.querySelector("#upload").files || [],
            ).map((file) => ({ name: file.name, size: file.size })));

            expect(files).toHaveLength(1);
            expect(files[0].name).toBe("helper.txt");

            const screenshotResult = await page.screenshot({
              path: "/tmp/public-helper.png",
            });
            expect(screenshotResult).toBeUndefined();
          });
        `,
        {
          filename: "/browser-public-helper.test.ts",
          timeoutMs: 10_000,
        },
      );

      assert.equal(result.success, true, JSON.stringify(result.tests, null, 2));
      assert.equal(result.passed, 1);

      const tracked = helper.getTrackedResources();
      assert.equal(tracked.contexts.length, 1);
      assert.equal(tracked.pages.length, 1);

      const collectedData = helper.getCollectedData();
      assert.ok(
        collectedData.browserConsoleLogs.some((entry) =>
          entry.stdout.includes("browser ready"),
        ),
      );
      assert.ok(collectedData.networkRequests.length > 0);
      assert.ok(collectedData.networkResponses.length > 0);
      assert.ok(helperEvents.some((event) => event.type === "networkRequest"));
      assert.ok(
        helperEvents.some(
          (event) =>
            event.type === "browserConsoleLog" &&
            event.stdout.includes("browser ready"),
        ),
      );
      assert.deepEqual(readFileCalls, ["/fixtures/helper.txt"]);
      assert.ok(writtenFiles.has("/tmp/public-helper.png"));
      assert.ok((writtenFiles.get("/tmp/public-helper.png")?.byteLength ?? 0) > 0);

      helper.clearCollectedData();
      assert.deepEqual(helper.getCollectedData(), {
        browserConsoleLogs: [],
        pageErrors: [],
        networkRequests: [],
        networkResponses: [],
        requestFailures: [],
      });
    } finally {
      unsubscribe();
      await runtime?.dispose({ hard: true, reason: "test cleanup" });
      await closeAllContexts(browserHarness.browser);
      await browserHarness.browser.close();
      await browserServer.close();
    }
  });

  test("injects a browser factory into script runtimes and supports nested test runtimes", async () => {
    const browserHarness = await launchChromium();
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

        const child = await nestedHost.createTestRuntime({
          bindings: {
            browser,
            console: {
              onEntry(entry) {
                if (entry.type === "output") {
                  childEntries.push(entry.stdout);
                }
              },
            },
          },
        });

        const childResults = await child.run(\`
          let ctx;
          let page;

          beforeAll(async () => {
            ctx = await browser.newContext();
            page = await ctx.newPage();
          });

          afterAll(async () => {
            await ctx.close();
          });

          test("loads a nested page", async () => {
            await page.goto(${JSON.stringify(browserServer.url)});
            console.log(await page.locator("#ready").textContent());
            expect((await browser.contexts()).length).toBe(1);
            expect((await ctx.pages()).length).toBe(1);
          });
        \`, {
          filename: "/nested-test-runtime.ts",
          timeoutMs: 10_000,
        });

        const diagnostics = await child.diagnostics();
        await child.dispose();
        await nestedHost.close();
        const pageCount = (await contextInstance.pages()).length;
        await pageInstance.close();
        await contextInstance.close();

        console.log(JSON.stringify({
          childEntries,
          childResults,
          diagnostics: diagnostics.browser
            ? {
                browserConsoleLogs: diagnostics.browser.browserConsoleLogs,
                networkRequests: diagnostics.browser.networkRequests,
                networkResponses: diagnostics.browser.networkResponses,
              }
            : null,
          hasBrowser: typeof browser === "object",
          hasBrowserClose: typeof browser.close,
          hasContextGlobal: typeof context,
          hasPageGlobal: typeof page,
          pageCount,
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
      childResults: {
        passed: number;
        failed: number;
      };
      diagnostics: {
        browserConsoleLogs: number;
        networkRequests: number;
        networkResponses: number;
      } | null;
      hasBrowser: boolean;
      hasBrowserClose: string;
      hasContextGlobal: string;
      hasPageGlobal: string;
      pageCount: number;
      text: string | null;
    };

    assert.deepEqual(result.childEntries, ["ready"]);
    assert.equal(result.childResults.passed, 1);
    assert.equal(result.childResults.failed, 0);
    assert.equal(result.text, "ready");
    assert.equal(result.hasBrowser, true);
    assert.equal(result.hasBrowserClose, "undefined");
    assert.equal(result.hasContextGlobal, "undefined");
    assert.equal(result.hasPageGlobal, "undefined");
    assert.equal(result.pageCount, 1);
    assert.ok(result.diagnostics);
    assert.ok(result.diagnostics!.browserConsoleLogs > 0);
    assert.ok(result.diagnostics!.networkRequests > 0);
    assert.ok(result.diagnostics!.networkResponses > 0);
  });
});
