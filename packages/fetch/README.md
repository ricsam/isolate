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

## HTTP Server

Register a server handler in the isolate and dispatch requests from the host:

```typescript
// In isolate
await context.eval(`
  serve({
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/ws") {
        if (server.upgrade(request, { data: { userId: "123" } })) {
          return new Response(null, { status: 101 });
        }
      }

      return Response.json({ path: url.pathname });
    },
    websocket: {
      open(ws) {
        console.log("Connected:", ws.data.userId);
      },
      message(ws, message) {
        ws.send("Echo: " + message);
      },
      close(ws, code, reason) {
        console.log("Closed:", code, reason);
      }
    }
  });
`, { promise: true });

// From host - dispatch HTTP request
const response = await handle.dispatchRequest(
  new Request("http://localhost/api/users")
);
```

## License

MIT
