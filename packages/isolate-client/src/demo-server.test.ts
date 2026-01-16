/**
 * Tests that run against the demo webserver at localhost:6421.
 * This tests the isolate-client's playwright bridge against a real web application.
 *
 * These tests mirror the e2e tests in /demo/e2e/ to ensure the playwright bridge
 * works correctly with real-world scenarios.
 *
 * IMPORTANT: Our page.evaluate() only accepts string scripts, not functions.
 * Use IIFE syntax for async operations: page.evaluate(`(async () => { ... })()`)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { connect } from "./connection.ts";
import { startDaemon, type DaemonHandle } from "@ricsam/isolate-daemon";
import { chromium, type Browser, type Page } from "playwright";
import type { DaemonConnection } from "./types.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

const TEST_SOCKET = "/tmp/isolate-demo-server-test.sock";
const DEMO_SERVER_URL = "http://localhost:6421";
const DEMO_SERVER_PORT = 6421;

/**
 * Wait for the demo server to be ready by polling the URL
 */
async function waitForServer(url: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return; // Server is up
      }
    } catch {
      // Server not ready yet
    }
    await delay(200);
  }
  throw new Error(`Server at ${url} did not start within ${timeout}ms`);
}

describe("demo server tests", () => {
  let daemon: DaemonHandle;
  let client: DaemonConnection;
  let browser: Browser;
  let demoServer: ChildProcess;

  before(async () => {
    // Start isolate daemon
    daemon = await startDaemon({ socketPath: TEST_SOCKET });

    // Connect client to daemon
    client = await connect({ socket: TEST_SOCKET });

    // Launch browser
    browser = await chromium.launch({ headless: true });

    // Start demo server - use absolute path with CWD in demo/ folder
    // so it can find the dist/ folder for static files
    const projectRoot = path.resolve(import.meta.dirname, "../../..");
    const demoRoot = path.join(projectRoot, "demo");
    const serverPath = path.join(demoRoot, "src/server.ts");
    demoServer = spawn("node", ["--experimental-strip-types", serverPath], {
      cwd: demoRoot,
      env: { ...process.env, PORT: String(DEMO_SERVER_PORT) },
      stdio: "pipe",
    });

    // Log server output for debugging
    // Always log stdout in CI so we can see server startup progress
    demoServer.stdout?.on("data", (data) => {
      console.log(`[demo-server] ${data.toString().trim()}`);
    });
    // Always log stderr to see errors
    demoServer.stderr?.on("data", (data) => {
      console.error(`[demo-server-err] ${data.toString().trim()}`);
    });

    // Wait for server to be ready (60s timeout for slow CI environments)
    await waitForServer(DEMO_SERVER_URL, 60000);
  });

  after(async () => {
    // Kill demo server
    if (demoServer) {
      demoServer.kill("SIGTERM");
      await delay(500);
    }

    // Clean up
    await browser.close();
    await client.close();
    await daemon.close();
  });

  /**
   * HTTP API Tests (mirrors demo/e2e/api.e2e.ts)
   */
  describe("HTTP API Tests", () => {
    it("GET /api/hello returns JSON from QuickJS", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /api/hello returns JSON from QuickJS", async () => {
              const response = await page.request.get("/api/hello");
              const data = await response.json();

              expect(response.ok()).toBe(true);
              expect(response.status()).toBe(200);
              expect(data.message).toBe("Hello from QuickJS!");
              expect(data.timestamp).toBeDefined();
              expect(typeof data.timestamp).toBe("number");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Expected 1 passed. Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("POST /api/echo echoes body with timestamp", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("POST /api/echo echoes body with timestamp", async () => {
              const testBody = {
                name: "test",
                value: 42,
                nested: { foo: "bar" }
              };

              const response = await page.request.post("/api/echo", {
                data: testBody,
                headers: { "Content-Type": "application/json" }
              });
              const data = await response.json();

              expect(response.ok()).toBe(true);
              expect(response.status()).toBe(200);
              expect(data.echo).toEqual(testBody);
              expect(data.timestamp).toBeDefined();
              expect(typeof data.timestamp).toBe("number");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("Unknown endpoint returns 404", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Unknown endpoint returns 404", async () => {
              const response = await page.request.get("/api/nonexistent");
              expect(response.status()).toBe(404);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  /**
   * File Upload/Download Tests (mirrors demo/e2e/files.e2e.ts)
   */
  describe("File Upload/Download Tests", () => {
    it("List files via /api/files", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("List files via /api/files", async () => {
              const response = await page.request.get("/api/files");
              const data = await response.json();

              expect(response.ok()).toBe(true);
              expect(response.status()).toBe(200);
              expect(data.files).toBeDefined();
              expect(Array.isArray(data.files)).toBe(true);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("Download nonexistent file returns 404", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Download nonexistent file returns 404", async () => {
              const response = await page.request.get("/api/files/nonexistent-file.txt");
              const data = await response.json();

              expect(response.status()).toBe(404);
              expect(data.error).toBe("File not found");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  /**
   * richie-rpc Standard CRUD Endpoints (mirrors demo/e2e/richie-rpc.e2e.ts)
   */
  describe("richie-rpc Standard CRUD Endpoints", () => {
    it("GET /rpc/items returns list", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /rpc/items returns list", async () => {
              const response = await page.request.get("/rpc/items");
              const data = await response.json();

              expect(response.ok()).toBe(true);
              expect(response.status()).toBe(200);
              expect(data.items).toBeDefined();
              expect(Array.isArray(data.items)).toBe(true);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("POST /rpc/items creates a new item", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("POST /rpc/items creates a new item", async () => {
              const newItem = {
                name: "Test Item",
                description: "A test item created by E2E tests"
              };

              const response = await page.request.post("/rpc/items", {
                data: newItem,
                headers: { "Content-Type": "application/json" }
              });
              const data = await response.json();

              expect(response.status()).toBe(201);
              expect(data.id).toBeDefined();
              expect(data.name).toBe("Test Item");
              expect(data.description).toBe("A test item created by E2E tests");
              expect(data.createdAt).toBeDefined();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("GET /rpc/items/:id returns 404 for non-existent item", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /rpc/items/:id returns 404 for non-existent item", async () => {
              const response = await page.request.get("/rpc/items/nonexistent-id");
              const data = await response.json();

              expect(response.status()).toBe(404);
              expect(data.error).toBeDefined();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("Full CRUD workflow", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Full CRUD workflow", async () => {
              // 1. Create
              const createResponse = await page.request.post("/rpc/items", {
                data: { name: "Workflow Item", description: "Testing full workflow" },
                headers: { "Content-Type": "application/json" }
              });
              const createData = await createResponse.json();

              expect(createResponse.status()).toBe(201);
              const itemId = createData.id;

              // 2. Read
              const readResponse = await page.request.get("/rpc/items/" + itemId);
              const readData = await readResponse.json();

              expect(readResponse.status()).toBe(200);
              expect(readData.name).toBe("Workflow Item");

              // 3. Update
              const updateResponse = await page.request.put("/rpc/items/" + itemId, {
                data: { name: "Updated Workflow Item" },
                headers: { "Content-Type": "application/json" }
              });
              const updateData = await updateResponse.json();

              expect(updateResponse.status()).toBe(200);
              expect(updateData.name).toBe("Updated Workflow Item");

              // 4. List (verify it's in the list)
              const listResponse = await page.request.get("/rpc/items");
              const listData = await listResponse.json();

              expect(listResponse.status()).toBe(200);
              const found = listData.items.find(item => item.id === itemId);
              expect(found).toBeDefined();
              expect(found.name).toBe("Updated Workflow Item");

              // 5. Delete
              const deleteResponse = await page.request.delete("/rpc/items/" + itemId);

              expect(deleteResponse.status()).toBe(200);

              // 6. Verify deleted
              const verifyResponse = await page.request.get("/rpc/items/" + itemId);

              expect(verifyResponse.status()).toBe(404);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  /**
   * Streaming Tests (mirrors demo/e2e/richie-rpc.e2e.ts streaming section)
   */
  describe("Streaming Tests", () => {
    it("GET /api/stream returns streaming response", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /api/stream returns streaming response", async () => {
              await page.goto("/api/hello");

              const result = await page.evaluate(\`(async () => {
                const response = await fetch("/api/stream");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const chunks = [];

                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  chunks.push(decoder.decode(value, { stream: true }));
                }

                return {
                  status: response.status,
                  contentType: response.headers.get("content-type"),
                  chunks: chunks,
                  fullText: chunks.join("")
                };
              })()\`);

              expect(result.status).toBe(200);
              expect(result.contentType).toBe("text/plain");
              expect(result.fullText).toContain("chunk 0");
              expect(result.fullText).toContain("chunk 4");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("GET /api/stream-json returns NDJSON streaming response", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /api/stream-json returns NDJSON streaming response", async () => {
              await page.goto("/api/hello");

              const result = await page.evaluate(\`(async () => {
                const response = await fetch("/api/stream-json");
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                const chunks = [];
                let buffer = "";

                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  const text = decoder.decode(value, { stream: true });
                  chunks.push(text);
                  buffer += text;
                }

                const lines = buffer.trim().split("\\\\n");
                const parsed = lines.map(line => JSON.parse(line));

                return {
                  status: response.status,
                  contentType: response.headers.get("content-type"),
                  chunkCount: chunks.length,
                  parsed: parsed,
                  lineCount: lines.length
                };
              })()\`);

              expect(result.status).toBe(200);
              expect(result.contentType).toBe("application/x-ndjson");
              expect(result.chunkCount >= 1).toBe(true);
              expect(result.lineCount >= 3).toBe(true);
              expect(result.parsed[0]).toHaveProperty("index");
              expect(result.parsed[0]).toHaveProperty("message");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("GET /api/events returns SSE stream", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("GET /api/events returns SSE stream", async () => {
              await page.goto("/api/hello");

              const result = await page.evaluate(\`(async () => {
                return new Promise((resolve, reject) => {
                  const events = [];
                  let connectionOpened = false;
                  const timeout = setTimeout(() => {
                    es.close();
                    resolve({ events, connectionOpened });
                  }, 10000);

                  const es = new EventSource("/api/events");

                  es.onopen = () => {
                    connectionOpened = true;
                  };

                  es.addEventListener("message", (e) => {
                    events.push({ type: "message", data: JSON.parse(e.data) });
                    if (events.length >= 3) {
                      clearTimeout(timeout);
                      es.close();
                      resolve({ events, connectionOpened });
                    }
                  });

                  es.addEventListener("heartbeat", (e) => {
                    events.push({ type: "heartbeat", data: JSON.parse(e.data) });
                  });

                  es.onerror = () => {
                    clearTimeout(timeout);
                    es.close();
                    resolve({ events, connectionOpened });
                  };
                });
              })()\`);

              expect(result.connectionOpened).toBe(true);
              expect(result.events.length >= 3).toBe(true);

              const messageEvents = result.events.filter(e => e.type === "message");
              expect(messageEvents.length > 0).toBe(true);
              expect(messageEvents[0].data).toHaveProperty("count");
              expect(messageEvents[0].data).toHaveProperty("timestamp");
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  /**
   * WebSocket Tests (mirrors demo/e2e/0-websocket.e2e.ts)
   */
  describe("WebSocket Tests", () => {
    it("Connect and receive welcome message", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Connect and receive welcome message", async () => {
              await page.goto("/api/hello");

              const welcomeMessage = await page.evaluate(\`(async () => {
                return new Promise((resolve, reject) => {
                  const ws = new WebSocket("ws://localhost:6421/ws");
                  const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                  ws.onmessage = (event) => {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(event.data);
                  };

                  ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error("WebSocket error"));
                  };
                });
              })()\`);

              const data = JSON.parse(welcomeMessage);
              expect(data.type).toBe("connected");
              expect(data.message).toBe("Welcome to QuickJS WebSocket!");
              expect(data.data).toBeDefined();
              expect(data.data.connectedAt).toBeDefined();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("Send message and receive echo", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Send message and receive echo", async () => {
              await page.goto("/api/hello");

              const testMessage = "Hello from Playwright!";

              const echoResponse = await page.evaluate(\`(async () => {
                return new Promise((resolve, reject) => {
                  const ws = new WebSocket("ws://localhost:6421/ws");
                  let receivedWelcome = false;
                  const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                  ws.onopen = () => {
                    setTimeout(() => ws.send("Hello from Playwright!"), 100);
                  };

                  ws.onmessage = (event) => {
                    if (!receivedWelcome) {
                      receivedWelcome = true;
                      return;
                    }
                    clearTimeout(timeout);
                    ws.close();
                    resolve(event.data);
                  };

                  ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error("WebSocket error"));
                  };
                });
              })()\`);

              const data = JSON.parse(echoResponse);
              expect(data.type).toBe("echo");
              expect(data.original).toBe("Hello from Playwright!");
              expect(data.timestamp).toBeDefined();
              expect(data.connectionData).toBeDefined();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("Clean disconnect", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("Clean disconnect", async () => {
              await page.goto("/api/hello");

              const result = await page.evaluate(\`(async () => {
                return new Promise((resolve, reject) => {
                  const ws = new WebSocket("ws://localhost:6421/ws");
                  let wasOpen = false;
                  const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                  ws.onopen = () => {
                    wasOpen = true;
                    setTimeout(() => ws.close(1000, "Test disconnect"), 200);
                  };

                  ws.onclose = (event) => {
                    clearTimeout(timeout);
                    resolve({ code: event.code, wasOpen });
                  };

                  ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error("WebSocket error"));
                  };
                });
              })()\`);

              expect(result.wasOpen).toBe(true);
              expect(result.code).toBe(1000);
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("UI WebSocket tester works", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL, timeout: 30000 },
        });

        try {
          await runtime.eval(`
            test("UI WebSocket tester works", async () => {
              await page.goto("/websocket");
              await page.waitForLoadState("networkidle");

              // Check initial state
              await expect(page.locator(".status .disconnected")).toBeVisible();
              await expect(page.locator(".connect-button")).toBeVisible();

              // Connect
              await page.locator(".connect-button").click();

              // Wait for connection - use waitForSelector for explicit wait
              await page.waitForSelector(".status .connected");
              await expect(page.locator(".status .connected")).toBeVisible();

              // Check welcome message appeared
              await page.waitForSelector(".message-received");
              await expect(page.locator(".message-received")).toBeVisible();

              // Send a message
              await page.locator(".message-input").fill("Test message from UI");
              await page.locator(".send-button").click();

              // Should see sent message
              await page.waitForSelector(".message-sent");
              await expect(page.locator(".message-sent")).toBeVisible();

              // Disconnect
              await page.locator(".disconnect-button").click();

              // Wait for disconnect state
              await page.waitForSelector(".status .disconnected");
              await expect(page.locator(".status .disconnected")).toBeVisible();
            });
          `);

          const results = await runtime.testEnvironment.runTests(60000);
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });

  /**
   * richie-rpc WebSocket Tests (mirrors demo/e2e/richie-rpc-websocket.e2e.ts)
   */
  describe("richie-rpc WebSocket Tests", () => {
    describe("Chat Room (/rpc/ws/chat)", () => {
      it("join and receive userJoined", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("join and receive userJoined", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/chat");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "join",
                        payload: { username: "TestUser" }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "userJoined") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.type).toBe("userJoined");
                expect(result.payload.username).toBe("TestUser");
                expect(result.payload.userCount).toBe(1);
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });

      it("validation error for invalid message", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("validation error for invalid message", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/chat");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "message",
                        payload: { text: "Unauthorized message" }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "error") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.type).toBe("error");
                expect(result.payload.message).toContain("Must join before sending messages");
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });
    });

    describe("RPC Style (/rpc/ws/rpc)", () => {
      it("echo request/response", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("echo request/response", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "request",
                        payload: {
                          id: "test-1",
                          method: "echo",
                          params: { hello: "world" }
                        }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "response" && data.payload.id === "test-1") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data.payload);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.id).toBe("test-1");
                expect(result.result).toEqual({ echo: { hello: "world" } });
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });

      it("getItems returns items list", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("getItems returns items list", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "request",
                        payload: {
                          id: "test-2",
                          method: "getItems"
                        }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "response" && data.payload.id === "test-2") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data.payload);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.id).toBe("test-2");
                expect(result.result).toHaveProperty("items");
                expect(Array.isArray(result.result.items)).toBe(true);
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });

      it("createItem creates a new item", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("createItem creates a new item", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "request",
                        payload: {
                          id: "test-3",
                          method: "createItem",
                          params: { name: "WS Created Item", description: "Created via WebSocket RPC" }
                        }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "response" && data.payload.id === "test-3") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data.payload);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.id).toBe("test-3");
                expect(result.result.name).toBe("WS Created Item");
                expect(result.result.description).toBe("Created via WebSocket RPC");
                expect(result.result.id).toBeDefined();
                expect(result.result.createdAt).toBeDefined();
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });

      it("error response for unknown method", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("error response for unknown method", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "request",
                        payload: {
                          id: "test-4",
                          method: "unknownMethod",
                          params: {}
                        }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "response" && data.payload.id === "test-4") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data.payload);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.id).toBe("test-4");
                expect(result.error).toBeDefined();
                expect(result.error.code).toBe(-32601);
                expect(result.error.message).toContain("Method not found");
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });

      it("getItem returns error for non-existent item", async () => {
        const page = await browser.newPage();
        try {
          const runtime = await client.createRuntime({
            testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
          });

          try {
            await runtime.eval(`
              test("getItem returns error for non-existent item", async () => {
                await page.goto("/api/hello");

                const result = await page.evaluate(\`(async () => {
                  return new Promise((resolve, reject) => {
                    const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");
                    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

                    ws.onopen = () => {
                      ws.send(JSON.stringify({
                        type: "request",
                        payload: {
                          id: "test-6",
                          method: "getItem",
                          params: { id: "non-existent-999" }
                        }
                      }));
                    };

                    ws.onmessage = (event) => {
                      const data = JSON.parse(event.data);
                      if (data.type === "response" && data.payload.id === "test-6") {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(data.payload);
                      }
                    };

                    ws.onerror = () => {
                      clearTimeout(timeout);
                      reject(new Error("WebSocket error"));
                    };
                  });
                })()\`);

                expect(result.id).toBe("test-6");
                expect(result.error).toBeDefined();
                expect(result.error.code).toBe(404);
                expect(result.error.message).toContain("not found");
              });
            `);

            const results = await runtime.testEnvironment.runTests();
            assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
          } finally {
            await runtime.dispose();
          }
        } finally {
          await page.close();
        }
      });
    });
  });

  /**
   * File Download Tests (mirrors demo/e2e/richie-rpc.e2e.ts)
   */
  describe("File Download Tests", () => {
    it("should download PNG file with correct content-type", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("should download PNG file with correct content-type", async () => {
              await page.goto("/api/hello");

              const result = await page.evaluate(\`(async () => {
                const response = await fetch("/rpc/files/test-image");
                const arrayBuffer = await response.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                return {
                  status: response.status,
                  contentType: response.headers.get("content-type"),
                  contentDisposition: response.headers.get("content-disposition"),
                  firstFourBytes: [bytes[0], bytes[1], bytes[2], bytes[3]]
                };
              })()\`);

              expect(result.status).toBe(200);
              expect(result.contentType).toContain("image/png");
              expect(result.contentDisposition).toContain("test-image.png");

              // Verify PNG magic bytes (89 50 4E 47 = 0x89PNG)
              expect(result.firstFourBytes[0]).toBe(0x89);
              expect(result.firstFourBytes[1]).toBe(0x50); // P
              expect(result.firstFourBytes[2]).toBe(0x4E); // N
              expect(result.firstFourBytes[3]).toBe(0x47); // G
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1, `Results: ${JSON.stringify(results.tests)}`);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });

    it("should return 404 for non-existent file", async () => {
      const page = await browser.newPage();
      try {
        const runtime = await client.createRuntime({
          testEnvironment: true, playwright: { page, baseUrl: DEMO_SERVER_URL },
        });

        try {
          await runtime.eval(`
            test("should return 404 for non-existent file", async () => {
              const response = await page.request.get("/rpc/files/nonexistent-file");
              const data = await response.json();

              expect(response.status()).toBe(404);
              expect(data.error).toBeDefined();
            });
          `);

          const results = await runtime.testEnvironment.runTests();
          assert.strictEqual(results.passed, 1);
        } finally {
          await runtime.dispose();
        }
      } finally {
        await page.close();
      }
    });
  });
});
