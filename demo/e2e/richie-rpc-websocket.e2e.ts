import { test, expect } from "@playwright/test";

test.describe("richie-rpc WebSocket Tests", () => {
  test.describe("Chat Room (/rpc/ws/chat)", () => {
    // Run tests serially to avoid shared state issues with rpcChatUsers Map
    test.describe.configure({ mode: 'serial' });
    test("join and receive userJoined", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ type: string; payload: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/chat");
          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

          ws.onopen = () => {
            // Send join message
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
      });

      expect(result.type).toBe("userJoined");
      expect(result.payload.username).toBe("TestUser");
      expect(result.payload.userCount).toBe(1);
    });

    test("broadcast message to all connected users", async ({ page, browser }) => {
      await page.goto("/");

      // Create a second browser context for the second user
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();
      await page2.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ messages: any[] }>((resolve, reject) => {
          const messages: any[] = [];
          let ws1Connected = false;
          let ws2Connected = false;
          let ws2Ready = false;

          const ws1 = new WebSocket("ws://localhost:6421/rpc/ws/chat");
          const ws2 = new WebSocket("ws://localhost:6421/rpc/ws/chat");

          const timeout = setTimeout(
            () => reject(new Error("Timeout - messages: " + JSON.stringify(messages))),
            10000
          );

          // Helper to send ws2 join when both ws1 connected AND ws2 is open
          const tryJoinWs2 = () => {
            if (ws1Connected && ws2Ready) {
              ws2.send(JSON.stringify({ type: "join", payload: { username: "User2" } }));
            }
          };

          ws1.onopen = () => {
            ws1.send(JSON.stringify({ type: "join", payload: { username: "User1" } }));
          };

          ws1.onmessage = (event) => {
            const data = JSON.parse(event.data);
            messages.push({ ws: "ws1", ...data });

            if (data.type === "userJoined" && data.payload.username === "User1") {
              ws1Connected = true;
              // Try to connect second user (only if ws2 is already open)
              tryJoinWs2();
            }

            if (data.type === "message" && data.payload.username === "User2") {
              // User1 received User2's message
              clearTimeout(timeout);
              ws1.close();
              ws2.close();
              resolve({ messages });
            }
          };

          ws2.onopen = () => {
            ws2Ready = true;
            // Try to join (only if ws1 already connected)
            tryJoinWs2();
          };

          ws2.onmessage = (event) => {
            const data = JSON.parse(event.data);
            messages.push({ ws: "ws2", ...data });

            if (data.type === "userJoined" && data.payload.username === "User2") {
              ws2Connected = true;
              // Send a message from User2
              ws2.send(JSON.stringify({ type: "message", payload: { text: "Hello from User2!" } }));
            }
          };

          ws1.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 1 error"));
          };

          ws2.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 2 error"));
          };
        });
      });

      // Verify User1 received the message from User2
      const messageFromUser2 = result.messages.find(
        (m) => m.ws === "ws1" && m.type === "message" && m.payload.username === "User2"
      );
      expect(messageFromUser2).toBeDefined();
      expect(messageFromUser2.payload.text).toBe("Hello from User2!");

      await context2.close();
    });

    test("typing indicators", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ typingReceived: boolean }>((resolve, reject) => {
          const ws1 = new WebSocket("ws://localhost:6421/rpc/ws/chat");
          const ws2 = new WebSocket("ws://localhost:6421/rpc/ws/chat");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            10000
          );

          let user1Joined = false;
          let user2Joined = false;

          ws1.onopen = () => {
            ws1.send(JSON.stringify({ type: "join", payload: { username: "Typer1" } }));
          };

          ws1.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "userJoined" && data.payload.username === "Typer1") {
              user1Joined = true;
            }
            if (data.type === "typing" && data.payload.username === "Typer2") {
              clearTimeout(timeout);
              ws1.close();
              ws2.close();
              resolve({ typingReceived: true });
            }
          };

          ws2.onopen = () => {
            // Wait a bit for user1 to join
            setTimeout(() => {
              ws2.send(JSON.stringify({ type: "join", payload: { username: "Typer2" } }));
            }, 200);
          };

          ws2.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "userJoined" && data.payload.username === "Typer2") {
              user2Joined = true;
              // Send typing indicator
              ws2.send(JSON.stringify({ type: "typing", payload: { isTyping: true } }));
            }
          };

          ws1.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 1 error"));
          };

          ws2.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 2 error"));
          };
        });
      });

      expect(result.typingReceived).toBe(true);
    });

    test("user left notification on disconnect", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ userLeftReceived: boolean; username: string }>((resolve, reject) => {
          const ws1 = new WebSocket("ws://localhost:6421/rpc/ws/chat");
          const ws2 = new WebSocket("ws://localhost:6421/rpc/ws/chat");

          let stayerJoined = false;
          let ws2Ready = false;

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            10000
          );

          // Helper to send ws2 join when both conditions met
          const tryJoinLeaver = () => {
            if (stayerJoined && ws2Ready) {
              ws2.send(JSON.stringify({ type: "join", payload: { username: "Leaver" } }));
            }
          };

          ws1.onopen = () => {
            ws1.send(JSON.stringify({ type: "join", payload: { username: "Stayer" } }));
          };

          ws1.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "userJoined" && data.payload.username === "Stayer") {
              stayerJoined = true;
              // Try to connect second user (only if ws2 is open)
              tryJoinLeaver();
            }
            if (data.type === "userJoined" && data.payload.username === "Leaver") {
              // Now disconnect ws2
              ws2.close();
            }
            if (data.type === "userLeft") {
              clearTimeout(timeout);
              ws1.close();
              resolve({ userLeftReceived: true, username: data.payload.username });
            }
          };

          ws2.onopen = () => {
            ws2Ready = true;
            // Try to join (only if stayer already joined)
            tryJoinLeaver();
          };

          ws1.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 1 error"));
          };

          ws2.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 2 error"));
          };
        });
      });

      expect(result.userLeftReceived).toBe(true);
      expect(result.username).toBe("Leaver");
    });

    test("validation error for invalid message", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ type: string; payload: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/chat");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

          ws.onopen = () => {
            // Send message without joining first (should trigger error)
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
      });

      expect(result.type).toBe("error");
      expect(result.payload.message).toContain("Must join before sending messages");
    });

    test("duplicate username error", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ errorReceived: boolean; message: string }>((resolve, reject) => {
          const ws1 = new WebSocket("ws://localhost:6421/rpc/ws/chat");
          const ws2 = new WebSocket("ws://localhost:6421/rpc/ws/chat");

          let ws1Joined = false;
          let ws2Ready = false;

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            10000
          );

          // Helper to try duplicate join when both conditions met
          const tryDuplicateJoin = () => {
            if (ws1Joined && ws2Ready) {
              ws2.send(JSON.stringify({ type: "join", payload: { username: "DuplicateName" } }));
            }
          };

          ws1.onopen = () => {
            ws1.send(JSON.stringify({ type: "join", payload: { username: "DuplicateName" } }));
          };

          ws1.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "userJoined" && data.payload.username === "DuplicateName") {
              ws1Joined = true;
              // Try to join with same username from ws2 (only if ws2 is open)
              tryDuplicateJoin();
            }
          };

          ws2.onopen = () => {
            ws2Ready = true;
            // Try duplicate join (only if ws1 already joined)
            tryDuplicateJoin();
          };

          ws2.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "error") {
              clearTimeout(timeout);
              ws1.close();
              ws2.close();
              resolve({ errorReceived: true, message: data.payload.message });
            }
          };

          ws1.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 1 error"));
          };

          ws2.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket 2 error"));
          };
        });
      });

      expect(result.errorReceived).toBe(true);
      expect(result.message).toContain("already taken");
    });
  });

  test.describe("RPC Style (/rpc/ws/rpc)", () => {
    test("echo request/response", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ id: string; result: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

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
      });

      expect(result.id).toBe("test-1");
      expect(result.result).toEqual({ echo: { hello: "world" } });
    });

    test("getItems returns items list", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ id: string; result: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

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
      });

      expect(result.id).toBe("test-2");
      expect(result.result).toHaveProperty("items");
      expect(Array.isArray(result.result.items)).toBe(true);
    });

    test("createItem creates a new item", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ id: string; result: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

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
      });

      expect(result.id).toBe("test-3");
      expect(result.result.name).toBe("WS Created Item");
      expect(result.result.description).toBe("Created via WebSocket RPC");
      expect(result.result.id).toBeDefined();
      expect(result.result.createdAt).toBeDefined();
    });

    test("error response for unknown method", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ id: string; error: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

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
      });

      expect(result.id).toBe("test-4");
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toContain("Method not found");
    });

    test("getItem returns specific item", async ({ page, request }) => {
      // First create an item via HTTP
      const createResponse = await request.post("/rpc/items", {
        data: { name: "Lookup Item", description: "For getItem test" }
      });
      const created = await createResponse.json();

      await page.goto("/");

      const result = await page.evaluate(async (itemId) => {
        return new Promise<{ id: string; result: any; error: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

          ws.onopen = () => {
            ws.send(JSON.stringify({
              type: "request",
              payload: {
                id: "test-5",
                method: "getItem",
                params: { id: itemId }
              }
            }));
          };

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === "response" && data.payload.id === "test-5") {
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
      }, created.id);

      expect(result.id).toBe("test-5");
      expect(result.result.name).toBe("Lookup Item");
    });

    test("getItem returns error for non-existent item", async ({ page }) => {
      await page.goto("/");

      const result = await page.evaluate(async () => {
        return new Promise<{ id: string; error: any }>((resolve, reject) => {
          const ws = new WebSocket("ws://localhost:6421/rpc/ws/rpc");

          const timeout = setTimeout(
            () => reject(new Error("Timeout")),
            5000
          );

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
      });

      expect(result.id).toBe("test-6");
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe(404);
      expect(result.error.message).toContain("not found");
    });
  });
});
