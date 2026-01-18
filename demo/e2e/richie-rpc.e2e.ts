import { test, expect } from "@playwright/test";

/**
 * E2E tests for richie-rpc CRUD endpoints and streaming features running inside QuickJS.
 */
test.describe("richie-rpc Standard CRUD Endpoints", () => {
  // Clean up any leftover items from previous tests
  test.beforeAll(async ({ request }) => {
    const listResponse = await request.get("/rpc/items");
    if (listResponse.ok()) {
      const data = await listResponse.json();
      for (const item of data.items || []) {
        await request.delete(`/rpc/items/${item.id}`);
      }
    }
  });

  test("GET /rpc/items returns empty list initially", async ({ request }) => {
    const response = await request.get("/rpc/items");

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.items).toBeDefined();
    expect(Array.isArray(data.items)).toBe(true);
  });

  test("POST /rpc/items creates a new item", async ({ request }) => {
    const newItem = {
      name: "Test Item",
      description: "A test item created by E2E tests",
    };

    const response = await request.post("/rpc/items", {
      data: newItem,
    });

    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.name).toBe(newItem.name);
    expect(data.description).toBe(newItem.description);
    expect(data.createdAt).toBeDefined();
  });

  test("GET /rpc/items/:id returns the created item", async ({ request }) => {
    // First create an item
    const createResponse = await request.post("/rpc/items", {
      data: { name: "Get Test Item" },
    });
    const created = await createResponse.json();

    // Then fetch it
    const response = await request.get(`/rpc/items/${created.id}`);

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.id).toBe(created.id);
    expect(data.name).toBe("Get Test Item");
  });

  test("GET /rpc/items/:id returns 404 for non-existent item", async ({
    request,
  }) => {
    const response = await request.get("/rpc/items/nonexistent-id");

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test("PUT /rpc/items/:id updates an item", async ({ request }) => {
    // Create an item
    const createResponse = await request.post("/rpc/items", {
      data: { name: "Update Test Item", description: "Original" },
    });
    const created = await createResponse.json();

    // Update it
    const response = await request.put(`/rpc/items/${created.id}`, {
      data: { name: "Updated Name", description: "Updated description" },
    });

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.id).toBe(created.id);
    expect(data.name).toBe("Updated Name");
    expect(data.description).toBe("Updated description");
  });

  test("DELETE /rpc/items/:id deletes an item", async ({ request }) => {
    // Create an item
    const createResponse = await request.post("/rpc/items", {
      data: { name: "Delete Test Item" },
    });
    const created = await createResponse.json();

    // Delete it
    const deleteResponse = await request.delete(`/rpc/items/${created.id}`);

    expect(deleteResponse.ok()).toBe(true);
    expect(deleteResponse.status()).toBe(200);

    const data = await deleteResponse.json();
    expect(data.success).toBe(true);
    expect(data.deleted).toBe(created.id);

    // Verify it's gone
    const getResponse = await request.get(`/rpc/items/${created.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test("POST /rpc/items validates request body", async ({ request }) => {
    // Try to create without required name field
    const response = await request.post("/rpc/items", {
      data: { description: "Missing name" },
    });

    // Should fail validation (400 Bad Request)
    expect(response.ok()).toBe(false);
  });

  test("Full CRUD workflow", async ({ request }) => {
    // 1. Create
    const createResponse = await request.post("/rpc/items", {
      data: { name: "Workflow Item", description: "Testing full workflow" },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const itemId = created.id;

    // 2. Read
    const readResponse = await request.get(`/rpc/items/${itemId}`);
    expect(readResponse.status()).toBe(200);
    const read = await readResponse.json();
    expect(read.name).toBe("Workflow Item");

    // 3. Update
    const updateResponse = await request.put(`/rpc/items/${itemId}`, {
      data: { name: "Updated Workflow Item" },
    });
    expect(updateResponse.status()).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.name).toBe("Updated Workflow Item");

    // 4. List (verify it's in the list)
    const listResponse = await request.get("/rpc/items");
    expect(listResponse.status()).toBe(200);
    const list = await listResponse.json();
    const found = list.items.find((item: any) => item.id === itemId);
    expect(found).toBeDefined();
    expect(found.name).toBe("Updated Workflow Item");

    // 5. Delete
    const deleteResponse = await request.delete(`/rpc/items/${itemId}`);
    expect(deleteResponse.status()).toBe(200);

    // 6. Verify deleted
    const verifyResponse = await request.get(`/rpc/items/${itemId}`);
    expect(verifyResponse.status()).toBe(404);
  });
});

/**
 * Streaming tests for QuickJS - testing ReadableStream, SSE, and NDJSON streaming
 */
test.describe("Streaming Tests", () => {
  test("GET /api/stream returns streaming response", async ({ page }) => {
    // Navigate to app first to establish base URL context
    await page.goto("/");

    // Use page.evaluate to run fetch in browser context for proper streaming
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/stream");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }

      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        chunks,
        fullText: chunks.join(""),
      };
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/plain");
    // Verify we received the expected content
    expect(result.fullText).toContain("chunk 0");
    expect(result.fullText).toContain("chunk 4");
  });

  test("GET /api/stream-json returns NDJSON streaming response", async ({
    page,
  }) => {
    // Navigate to app first to establish base URL context
    await page.goto("/");

    // Use page.evaluate to run fetch in browser context for proper streaming
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/stream-json");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        chunks.push(text);
        buffer += text;
      }

      // Parse NDJSON lines
      const lines = buffer.trim().split("\n");
      const parsed = lines.map((line) => JSON.parse(line));

      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        chunkCount: chunks.length,
        parsed,
        lineCount: lines.length,
      };
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/x-ndjson");
    // Should have received multiple chunks (streamed progressively)
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    // Should have multiple JSON lines
    expect(result.lineCount).toBeGreaterThanOrEqual(3);
    // Verify structure of parsed data
    expect(result.parsed[0]).toHaveProperty("index");
    expect(result.parsed[0]).toHaveProperty("message");
  });

  test("GET /api/events returns SSE stream", async ({ page }) => {
    test.setTimeout(15000); // SSE tests need more time

    // Navigate to app first to establish base URL context
    await page.goto("/");

    const result = await page.evaluate(async () => {
      return new Promise<{
        events: { type: string; data: any }[];
        connectionOpened: boolean;
      }>((resolve, reject) => {
        const events: { type: string; data: any }[] = [];
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

        es.onerror = (e) => {
          clearTimeout(timeout);
          es.close();
          // Don't reject on connection close, that's normal
          resolve({ events, connectionOpened });
        };
      });
    });

    expect(result.connectionOpened).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(3);
    // Verify event structure
    const messageEvents = result.events.filter((e) => e.type === "message");
    expect(messageEvents.length).toBeGreaterThan(0);
    expect(messageEvents[0]!.data).toHaveProperty("count");
    expect(messageEvents[0]!.data).toHaveProperty("timestamp");
  });

  test("SSE connection can be cleanly closed", async ({ page }) => {
    // Navigate to app first to establish base URL context
    await page.goto("/");

    const result = await page.evaluate(async () => {
      return new Promise<{ opened: boolean; closed: boolean }>(
        (resolve, reject) => {
          let opened = false;
          let closed = false;
          const timeout = setTimeout(() => {
            resolve({ opened, closed });
          }, 5000);

          const es = new EventSource("/api/events");

          es.onopen = () => {
            opened = true;
            // Close immediately after opening
            es.close();
            closed = true;
            clearTimeout(timeout);
            resolve({ opened, closed });
          };

          es.onerror = () => {
            clearTimeout(timeout);
            resolve({ opened, closed });
          };
        }
      );
    });

    expect(result.opened).toBe(true);
    expect(result.closed).toBe(true);
  });
});

/**
 * File Download tests for richie-rpc download endpoint
 */
test.describe("File Download Tests", () => {
  test("should download PNG file with correct content-type", async ({
    request,
  }) => {
    const response = await request.get("/rpc/files/test-image");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    expect(response.headers()["content-disposition"]).toContain(
      "test-image.png"
    );

    // Verify PNG magic bytes (89 50 4E 47 = \x89PNG)
    const body = await response.body();
    expect(body[0]).toBe(0x89);
    expect(body[1]).toBe(0x50); // P
    expect(body[2]).toBe(0x4e); // N
    expect(body[3]).toBe(0x47); // G
  });

  test("should return 404 for non-existent file", async ({ request }) => {
    const response = await request.get("/rpc/files/nonexistent-file");

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});
