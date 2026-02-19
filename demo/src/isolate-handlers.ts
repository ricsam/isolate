/**
 * Isolate handler code that runs inside the sandboxed isolate environment.
 * This code is evaluated via context.evalCode() and registers HTTP and WebSocket handlers.
 */
export const isolateHandlerCode = `
serve({
  async fetch(request, server) {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      server.upgrade(request, { data: { connectedAt: Date.now() } });
      return new Response(null, { status: 101 });
    }

    // GET /api/hello - Simple JSON response
    if (url.pathname === "/api/hello" && request.method === "GET") {
      return Response.json({
        message: "Hello from Isolate!",
        timestamp: Date.now()
      });
    }

    // POST /api/echo - Echo JSON body with timestamp
    if (url.pathname === "/api/echo" && request.method === "POST") {
      const body = await request.json();
      return Response.json({
        echo: body,
        timestamp: Date.now()
      });
    }

    // POST /api/upload - Save uploaded file to filesystem
    if (url.pathname === "/api/upload" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file || typeof file === "string") {
          return Response.json({ error: "No file provided" }, { status: 400 });
        }

        const root = await getDirectory("/uploads");
        // FormData file entries are WHATWG File instances with standard properties
        const fileHandle = await root.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        // Use standard WHATWG File.arrayBuffer() method
        await writable.write(await file.arrayBuffer());
        await writable.close();

        return Response.json({
          success: true,
          name: file.name,
          size: file.size,
          type: file.type
        });
      } catch (error) {
        return Response.json({
          error: "Upload failed",
          message: (error as Error).message
        }, { status: 500 });
      }
    }

    // GET /api/files - List uploaded files
    if (url.pathname === "/api/files" && request.method === "GET") {
      try {
        const root = await getDirectory("/uploads");
        const files = [];

        // Use keys() to get filenames, then getFileHandle() to get each file
        const names = await root.keys();
        for await (const name of names) {
          // Skip hidden files
          if (name.startsWith(".")) continue;
          try {
            const handle = await root.getFileHandle(name);
            const file = await handle.getFile();
            files.push({
              name,
              size: file.size,
              type: file.type,
              lastModified: file.lastModified
            });
          } catch {
            // Skip files that can't be read (might be directories)
          }
        }

        return Response.json({ files });
      } catch (error) {
        return Response.json({ files: [] });
      }
    }

    // GET /api/files/:name - Download file
    if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
      try {
        const filename = decodeURIComponent(url.pathname.slice("/api/files/".length));
        const root = await getDirectory("/uploads");
        const fileHandle = await root.getFileHandle(filename);
        const file = await fileHandle.getFile();

        return new Response(await file.arrayBuffer(), {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Content-Disposition": "attachment; filename=\\"" + filename + "\\""
          }
        });
      } catch (error) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }
    }

    // DELETE /api/files/:name - Delete file
    if (url.pathname.startsWith("/api/files/") && request.method === "DELETE") {
      try {
        const filename = decodeURIComponent(url.pathname.slice("/api/files/".length));
        const root = await getDirectory("/uploads");
        await root.removeEntry(filename);

        return Response.json({ success: true, deleted: filename });
      } catch (error) {
        return Response.json({ error: "Delete failed", message: (error as Error).message }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      ws.send(JSON.stringify({
        type: "connected",
        data: ws.data,
        message: "Welcome to Isolate WebSocket!"
      }));
    },

    message(ws, message) {
      // Echo the message back with metadata
      const response = {
        type: "echo",
        original: typeof message === "string" ? message : "[binary data]",
        timestamp: Date.now(),
        connectionData: ws.data
      };
      ws.send(JSON.stringify(response));
    },

    close(ws, code, reason) {
      console.log("WebSocket closed:", code, reason);
    },

    error(ws, error) {
      console.log("WebSocket error:", error.message);
    }
  }
});
`;
