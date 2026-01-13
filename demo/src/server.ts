import {
  formatTypecheckErrors,
  typecheckIsolateCode,
} from "@ricsam/isolate-test-utils";
import express from 'express'
import { createServerAdapter } from "@whatwg-node/server";
import {
  createRuntime,
  createNodeFileSystemHandler,
  type WebSocketCommand,
} from "@ricsam/isolate-runtime";
import { setupTimers } from "@ricsam/isolate-timers";
import { quickjsHandlerCode } from "./quickjs-handlers.ts";
import { richieRpcHandlerCode } from "./richie-rpc-handlers.ts";
import { bundleAllModules } from "./bundler.ts";
import { LIBRARY_TYPES } from "./library-types.ts";
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 6422 });

wss.on('connection', function connection(ws) {
  ws.on('error', console.error);

  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.send('something');
});



interface WsData {
  connectionId: string;
  url: string;
}

//#region typecheck the quickjs-handlers.ts code
const typeCheckResult = typecheckIsolateCode(quickjsHandlerCode, {
  include: ["core", "fetch", "fs"],
  libraryTypes: {
    zod: LIBRARY_TYPES.zod!,
    "@richie-rpc/core": LIBRARY_TYPES["@richie-rpc/core"]!,
    "@richie-rpc/server": LIBRARY_TYPES["@richie-rpc/server"]!,
  },
});
if (!typeCheckResult.success) {
  console.error(formatTypecheckErrors(typeCheckResult));
  throw new Error("Type check failed");
}
//#endregion

// Initialize QuickJS
console.log("Initializing QuickJS runtime...");

// Bundle modules for QuickJS
console.log("Bundling modules for QuickJS...");
const bundledModules = await bundleAllModules();

const runtime = QuickJS.newRuntime();

// Set up module loader to resolve bundled packages
runtime.setModuleLoader((moduleName) => {
  const code = bundledModules.get(moduleName);
  if (code) {
    console.log(`[ModuleLoader] Loading module: ${moduleName}`);
    return code;
  }
  throw new Error(`Module not found: ${moduleName}`);
});

const context = runtime.newContext();

// Setup runtime with fetch + fs
const handle = await createRuntime({
  fetch: {
    onFetch: async (req: Request) => fetch(req),
  },
  fs: {
    getDirectory: async (path: string) => {
      // All paths map to demo-data directory (relative to cwd which is demo/)
      return createNodeFileSystemHandler(`./demo-data${path}`);
    },
  },
});

// Setup timer APIs (setTimeout, setInterval, etc.)
const timersHandle = setupTimers(context);

// Track WebSocket connections for bidirectional communication
const wsConnections = new Map<string, ServerWebSocket<WsData>>();

// Handle outgoing WS commands from QuickJS
handle.fetch!.onWebSocketCommand((cmd: WebSocketCommand) => {
  const ws = wsConnections.get(cmd.connectionId);
  if (!ws) return;

  if (cmd.type === "message") {
    ws.send(cmd.data);
  } else if (cmd.type === "close") {
    ws.close(cmd.code, cmd.reason);
  }
});

// Load richie-rpc handlers (includes existing functionality)
console.log("Loading richie-rpc handlers...");
// use rollup instead or esbuild
const transpiler = new Bun.Transpiler({
  loader: "ts",
});

// Evaluate the richie-rpc handler code as a module
const result = context.evalCode(
  transpiler.transformSync(richieRpcHandlerCode),
  "richie-rpc-handlers.js",
  { type: "module" }
);
if (result.error) {
  const error = context.dump(result.error);
  result.error.dispose();
  throw new Error(
    `Failed to evaluate richie-rpc handlers: ${JSON.stringify(error)}`
  );
}
result.value.dispose();

console.log("richie-rpc handlers loaded successfully");

// Start server
const port = parseInt(process.env.PORT || "6421", 10);

// OLD CODE
/*
import type { ServerWebSocket } from "bun";
import index from "./index.html";
const server = Bun.serve<WsData>({
  port,
  routes: {
    "/": index,
    "/api": index,
    "/files": index,
    "/websocket": index,
    "/chat": index,
    "/ai": index,
    "/logs": index,
    "/downloads": index,
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // Forward /api/*, /rpc/*, and /ws/* to QuickJS
    if (
      url.pathname.startsWith("/api") ||
      url.pathname.startsWith("/rpc/") ||
      url.pathname.startsWith("/ws")
    ) {
      try {
        const response = await handle.fetch!.dispatchRequest(req);

        // Check for WebSocket upgrade
        const upgrade = handle.fetch!.getUpgradeRequest();
        if (upgrade?.requested) {
          // Use connectionId from QuickJS - data is stored in internal registry
          const success = server.upgrade(req, {
            data: {
              connectionId: upgrade.connectionId,
              url: url.pathname,
            },
          });
          if (success) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 500 });
        }

        return response;
      } catch (error) {
        console.error("Request handling error:", error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    // Let routes handle non-API requests (returns 404 for unmatched)
    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const { connectionId } = ws.data;
      wsConnections.set(connectionId, ws);
      // Data is looked up from internal registry in QuickJS using connectionId
      handle.fetch!.dispatchWebSocketOpen(connectionId);
    },
    message(ws, msg) {
      const message = typeof msg === "string" ? msg : msg.buffer;
      handle.fetch!.dispatchWebSocketMessage(
        ws.data.connectionId,
        message as string | ArrayBuffer
      );
    },
    close(ws, code, reason) {
      handle.fetch!.dispatchWebSocketClose(ws.data.connectionId, code, reason);
      wsConnections.delete(ws.data.connectionId);
    },
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});
*/

// NEW CODE
const app = express()

const whatwgAdapter = createServerAdapter((request: Request) => {
  return new Response(`Hello World!`, { status: 200 })
})

app.use('/', whatwgAdapter)
app.use(express.static('dist'))

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
