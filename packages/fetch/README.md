# @ricsam/isolate-fetch

Fetch API and HTTP server handler for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-fetch
```

## Usage

```typescript
import { setupFetch } from "@ricsam/isolate-fetch";

const handle = await setupFetch(context, {
  onFetch: async (request) => {
    // Handle outbound fetch() calls from the isolate
    console.log(`Fetching: ${request.url}`);
    return fetch(request);
  },
});
```

## Injected Globals

- `fetch`, `Request`, `Response`, `Headers`
- `FormData`, `AbortController`, `AbortSignal`
- `serve` (HTTP server handler)

## Usage in Isolate

```javascript
// Outbound fetch
const response = await fetch("https://api.example.com/data");
const data = await response.json();

// Request/Response
const request = new Request("https://example.com", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "test" }),
});

const response = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

// Static methods
Response.json({ message: "hello" });
Response.redirect("https://example.com", 302);

// AbortController
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await fetch(url, { signal: controller.signal });

// FormData
const formData = new FormData();
formData.append("name", "John");
formData.append("file", new File(["content"], "file.txt"));
```

## HTTP Server (`serve`)

The `serve()` function registers a request handler in the isolate that can receive HTTP requests dispatched from the host. It uses a Bun-compatible API.

### Basic Usage

```javascript
// In isolate code
serve({
  fetch(request, server) {
    const url = new URL(request.url);
    return Response.json({ path: url.pathname, method: request.method });
  }
});
```

### The `fetch` Handler

The `fetch` handler receives two arguments:

- `request` - A standard `Request` object
- `server` - A server object with WebSocket upgrade capability

```javascript
serve({
  fetch(request, server) {
    // Access request properties
    const url = new URL(request.url);
    const method = request.method;
    const headers = request.headers;
    const body = await request.json(); // for POST/PUT

    // Return a Response
    return new Response("Hello World");
  }
});
```

### The `server` Object

The `server` argument provides WebSocket upgrade functionality:

```javascript
serve({
  fetch(request, server) {
    // Check for WebSocket upgrade request
    if (request.headers.get("Upgrade") === "websocket") {
      // Upgrade the connection, optionally passing data
      server.upgrade(request, { data: { userId: "123" } });
      return new Response(null, { status: 101 });
    }

    return new Response("Not a WebSocket request", { status: 400 });
  }
});
```

## WebSocket Support

The `serve()` function supports WebSocket connections through a `websocket` handler object.

### WebSocket Handlers

```javascript
serve({
  fetch(request, server) {
    if (request.headers.get("Upgrade") === "websocket") {
      server.upgrade(request, { data: { userId: "123" } });
      return new Response(null, { status: 101 });
    }
    return new Response("OK");
  },
  websocket: {
    open(ws) {
      // Called when a WebSocket connection is opened
      console.log("Connected:", ws.data.userId);
      ws.send("Welcome!");
    },
    message(ws, message) {
      // Called when a message is received from the client
      console.log("Received:", message);
      ws.send("Echo: " + message);
    },
    close(ws, code, reason) {
      // Called when the connection is closed
      console.log("Closed:", code, reason);
    },
    error(ws, error) {
      // Called when an error occurs
      console.error("Error:", error);
    }
  }
});
```

### The `ws` Object

Each WebSocket handler receives a `ws` object with the following properties and methods:

| Property/Method | Description |
|-----------------|-------------|
| `ws.data` | Custom data passed during `server.upgrade()` |
| `ws.send(message)` | Send a message to the client (string or ArrayBuffer) |
| `ws.close(code?, reason?)` | Close the connection with optional code and reason |
| `ws.readyState` | Current state: 1 (OPEN), 2 (CLOSING), 3 (CLOSED) |

### Optional Handlers

All WebSocket handlers are optional. You can define only the handlers you need:

```javascript
// Only handle messages - no open/close/error handlers needed
serve({
  fetch(request, server) { /* ... */ },
  websocket: {
    message(ws, message) {
      ws.send("Echo: " + message);
    }
  }
});

// Only handle open and close
serve({
  fetch(request, server) { /* ... */ },
  websocket: {
    open(ws) {
      console.log("Connected");
    },
    close(ws, code, reason) {
      console.log("Disconnected");
    }
  }
});
```

## Host-Side API

The host dispatches requests and WebSocket events to the isolate.

### Dispatching HTTP Requests

```typescript
// From host code
const response = await handle.dispatchRequest(
  new Request("http://localhost/api/users", {
    method: "POST",
    body: JSON.stringify({ name: "Alice" }),
  })
);

console.log(await response.json());
```

### WebSocket Flow

The host manages WebSocket connections and dispatches events to the isolate:

```typescript
// 1. Dispatch the upgrade request
await handle.dispatchRequest(
  new Request("http://localhost/ws", {
    headers: { "Upgrade": "websocket" }
  })
);

// 2. Check if isolate requested an upgrade
const upgradeRequest = handle.getUpgradeRequest();
if (upgradeRequest?.requested) {
  const connectionId = upgradeRequest.connectionId;

  // 3. Register callback for commands FROM the isolate
  handle.onWebSocketCommand((cmd) => {
    if (cmd.type === "message") {
      // Isolate called ws.send() - forward to real WebSocket
      realWebSocket.send(cmd.data);
    } else if (cmd.type === "close") {
      // Isolate called ws.close()
      realWebSocket.close(cmd.code, cmd.reason);
    }
  });

  // 4. Notify isolate the connection is open (triggers websocket.open)
  handle.dispatchWebSocketOpen(connectionId);

  // 5. Forward messages TO the isolate (triggers websocket.message)
  realWebSocket.onmessage = (event) => {
    handle.dispatchWebSocketMessage(connectionId, event.data);
  };

  // 6. Forward close events TO the isolate (triggers websocket.close)
  realWebSocket.onclose = (event) => {
    handle.dispatchWebSocketClose(connectionId, event.code, event.reason);
  };
}
```

### Host API Reference

| Method | Description |
|--------|-------------|
| `dispatchRequest(request)` | Dispatch HTTP request to isolate's `serve()` handler |
| `hasServeHandler()` | Check if `serve()` has been called in isolate |
| `hasActiveConnections()` | Check if there are active WebSocket connections |
| `getUpgradeRequest()` | Get pending WebSocket upgrade request info |
| `dispatchWebSocketOpen(id)` | Notify isolate that WebSocket connection opened |
| `dispatchWebSocketMessage(id, data)` | Send message to isolate's `websocket.message` handler |
| `dispatchWebSocketClose(id, code, reason)` | Notify isolate that connection closed |
| `dispatchWebSocketError(id, error)` | Notify isolate of WebSocket error |
| `onWebSocketCommand(callback)` | Register callback for `ws.send()`/`ws.close()` from isolate |

### WebSocket Command Types

Commands received via `onWebSocketCommand`:

```typescript
interface WebSocketCommand {
  type: "message" | "close";
  connectionId: string;
  data?: string | ArrayBuffer;  // For "message" type
  code?: number;                 // For "close" type
  reason?: string;               // For "close" type
}
```

## Complete Example

```typescript
// Host code
import { setupFetch } from "@ricsam/isolate-fetch";

const handle = await setupFetch(context, {
  onFetch: async (request) => fetch(request),
});

// Set up serve handler in isolate
await context.eval(`
  serve({
    fetch(request, server) {
      const url = new URL(request.url);

      // WebSocket upgrade
      if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
        server.upgrade(request, { data: { path: url.pathname } });
        return new Response(null, { status: 101 });
      }

      // Regular HTTP
      return Response.json({ path: url.pathname });
    },
    websocket: {
      open(ws) {
        console.log("WebSocket connected to:", ws.data.path);
        ws.send("Connected!");
      },
      message(ws, message) {
        console.log("Received:", message);
        ws.send("Echo: " + message);
      },
      close(ws, code, reason) {
        console.log("Closed:", code, reason);
      }
    }
  });
`, { promise: true });

// Dispatch HTTP request
const response = await handle.dispatchRequest(
  new Request("http://localhost/api/users")
);
console.log(await response.json()); // { path: "/api/users" }

// Handle WebSocket connection
await handle.dispatchRequest(
  new Request("http://localhost/ws", { headers: { "Upgrade": "websocket" } })
);

const upgrade = handle.getUpgradeRequest();
if (upgrade?.requested) {
  // Listen for commands from isolate
  handle.onWebSocketCommand((cmd) => {
    console.log("Command from isolate:", cmd);
  });

  // Open connection (triggers websocket.open)
  handle.dispatchWebSocketOpen(upgrade.connectionId);

  // Send message (triggers websocket.message)
  handle.dispatchWebSocketMessage(upgrade.connectionId, "Hello!");
}
```

## License

MIT
