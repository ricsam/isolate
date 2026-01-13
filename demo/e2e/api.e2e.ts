import { test, expect } from "@playwright/test";

test.describe("HTTP API Tests", () => {
  test("GET /api/hello returns JSON from QuickJS", async ({ request }) => {
    const response = await request.get("/api/hello");

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.message).toBe("Hello from QuickJS!");
    expect(data.timestamp).toBeDefined();
    expect(typeof data.timestamp).toBe("number");
  });

  test("POST /api/echo echoes body with timestamp", async ({ request }) => {
    const testBody = {
      name: "test",
      value: 42,
      nested: { foo: "bar" },
    };

    const response = await request.post("/api/echo", {
      data: testBody,
    });

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.echo).toEqual(testBody);
    expect(data.timestamp).toBeDefined();
    expect(typeof data.timestamp).toBe("number");
  });

  test("Unknown endpoint returns 404", async ({ request }) => {
    const response = await request.get("/api/nonexistent");

    expect(response.status()).toBe(404);
  });
});
