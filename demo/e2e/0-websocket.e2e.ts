import { test, expect } from "@playwright/test";

test.describe("WebSocket Tests", () => {
  test("Connect and receive welcome message", async ({ page }) => {
    // Navigate to the app first to ensure server is ready
    await page.goto("/");

    // Create WebSocket connection using page.evaluate
    const welcomeMessage = await page.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket("ws://localhost:6421/ws");
        const timeout = setTimeout(
          () => reject(new Error("Timeout")),
          5000
        );

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
    });

    const data = JSON.parse(welcomeMessage);
    expect(data.type).toBe("connected");
    expect(data.message).toBe("Welcome to QuickJS WebSocket!");
    expect(data.data).toBeDefined();
    expect(data.data.connectedAt).toBeDefined();
  });

  test("Send message and receive echo", async ({ page }) => {
    await page.goto("/");

    const testMessage = "Hello from Playwright!";

    const echoResponse = await page.evaluate(async (msg) => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket("ws://localhost:6421/ws");
        let receivedWelcome = false;
        const timeout = setTimeout(
          () => reject(new Error("Timeout")),
          5000
        );

        ws.onopen = () => {
          // Wait a bit for welcome message then send
          setTimeout(() => ws.send(msg), 100);
        };

        ws.onmessage = (event) => {
          if (!receivedWelcome) {
            receivedWelcome = true;
            return; // Skip welcome message
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
    }, testMessage);

    const data = JSON.parse(echoResponse);
    expect(data.type).toBe("echo");
    expect(data.original).toBe(testMessage);
    expect(data.timestamp).toBeDefined();
    expect(data.connectionData).toBeDefined();
  });

  test("Clean disconnect", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      return new Promise<{ code: number; wasOpen: boolean }>((resolve, reject) => {
        const ws = new WebSocket("ws://localhost:6421/ws");
        let wasOpen = false;
        const timeout = setTimeout(
          () => reject(new Error("Timeout")),
          5000
        );

        ws.onopen = () => {
          wasOpen = true;
          // Close cleanly after receiving welcome
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
    });

    expect(result.wasOpen).toBe(true);
    expect(result.code).toBe(1000);
  });

  test("UI WebSocket tester works", async ({ page }) => {
    await page.goto("/websocket");

    // Check initial state
    await expect(page.locator(".status .disconnected")).toBeVisible();
    await expect(page.locator(".connect-button")).toBeVisible();

    // Connect
    await page.click(".connect-button");

    // Wait for connection
    await expect(page.locator(".status .connected")).toBeVisible({ timeout: 5000 });

    // Check welcome message appeared
    await expect(page.locator(".message-received")).toBeVisible({ timeout: 5000 });

    // Send a message
    await page.fill(".message-input", "Test message from UI");
    await page.click(".send-button");

    // Should see sent message
    await expect(page.locator(".message-sent")).toBeVisible();

    // Should receive echo
    await expect(page.locator(".message-received").nth(1)).toBeVisible({ timeout: 5000 });

    // Disconnect
    await page.click(".disconnect-button");
    await expect(page.locator(".status .disconnected")).toBeVisible();
  });
});
