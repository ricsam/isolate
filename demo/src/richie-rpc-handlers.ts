/**
 * richie-rpc handler code that runs inside the sandboxed QuickJS environment.
 *
 * Supports: HTTP CRUD endpoints, streaming responses, SSE, and WebSocket.
 */
export const richieRpcHandlerCode = `
import { z } from 'zod';
import { defineContract, defineWebSocketContract, Status } from '@richie-rpc/core';
import { createRouter, createWebSocketRouter } from '@richie-rpc/server';

// ===========================================
// In-memory data store for CRUD operations
// ===========================================
const items = new Map();
let nextId = 1;

// ===========================================
// Chat Room State
// ===========================================
const chatRooms = new Map();
chatRooms.set('general', { users: new Map() });

function handleChatMessage(ws: any, message: string | ArrayBuffer) {
  try {
    const msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    const roomId = 'general';
    const room = chatRooms.get(roomId);

    switch (msg.type) {
      case 'join': {
        const username = msg.payload?.username || 'Anonymous';
        ws.data.username = username;
        ws.data.connectionId = ws.data.connectionId || String(Date.now());

        room.users.set(ws.data.connectionId, { username, typing: false, ws });

        const users = Array.from(room.users.values()).map((u: any) => ({
          username: u.username,
          typing: u.typing
        }));

        ws.send(JSON.stringify({
          type: 'roomState',
          payload: { users, roomId, username }
        }));

        for (const [connId, user] of room.users) {
          if (connId !== ws.data.connectionId && (user as any).ws) {
            (user as any).ws.send(JSON.stringify({
              type: 'userJoined',
              payload: { username, userCount: room.users.size }
            }));
          }
        }
        break;
      }

      case 'message': {
        const username = ws.data.username || 'Anonymous';
        const chatMessage = {
          type: 'message',
          payload: {
            username,
            content: msg.payload?.content || '',
            timestamp: Date.now()
          }
        };

        for (const [, user] of room.users) {
          if ((user as any).ws) {
            (user as any).ws.send(JSON.stringify(chatMessage));
          }
        }
        break;
      }

      case 'typing': {
        const isTyping = !!msg.payload?.typing;
        const user = room.users.get(ws.data.connectionId);
        if (user) {
          (user as any).typing = isTyping;
        }

        for (const [connId, u] of room.users) {
          if (connId !== ws.data.connectionId && (u as any).ws) {
            (u as any).ws.send(JSON.stringify({
              type: 'typing',
              payload: {
                username: ws.data.username,
                typing: isTyping
              }
            }));
          }
        }
        break;
      }
    }
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Invalid message format' }
    }));
  }
}

function handleChatDisconnect(ws: any) {
  const roomId = 'general';
  const room = chatRooms.get(roomId);

  if (room && ws.data?.connectionId) {
    const username = ws.data.username;
    room.users.delete(ws.data.connectionId);

    if (username) {
      for (const [, user] of room.users) {
        if ((user as any).ws) {
          (user as any).ws.send(JSON.stringify({
            type: 'userLeft',
            payload: { username, userCount: room.users.size }
          }));
        }
      }
    }
  }
}

// AI response generator
function generateAIResponse(prompt: string): string[] {
  const responses: Record<string, string> = {
    default: 'I am a simulated AI response running inside QuickJS. This demonstrates streaming capabilities where each word is sent progressively to the client with natural-feeling delays between tokens. Pretty cool, right?',
    hello: 'Hello! Welcome to the QuickJS AI demo. I can stream responses word by word, simulating how large language models generate text incrementally. Try asking me to explain something!',
    code: 'Here is an example of streaming code generation. Each token arrives progressively, allowing you to see the response as it forms, similar to how modern AI assistants work. The server uses ReadableStream with setTimeout for delays.',
    explain: 'Let me explain how this works. The server creates a ReadableStream, then uses setTimeout to emit chunks with variable delays. The client reads these chunks using the Fetch API and displays them progressively as they arrive.'
  };

  const key = prompt.toLowerCase().includes('hello') ? 'hello'
    : prompt.toLowerCase().includes('code') ? 'code'
    : prompt.toLowerCase().includes('explain') ? 'explain'
    : 'default';

  return responses[key].split(' ');
}

// ===========================================
// HTTP Contract Definition (CRUD only)
// ===========================================
const httpContract = defineContract({
  listItems: {
    method: 'GET',
    path: '/items',
    responses: {
      [Status.OK]: z.object({
        items: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          createdAt: z.string(),
        })),
      }),
    },
  },

  getItem: {
    method: 'GET',
    path: '/items/:id',
    params: z.object({ id: z.string() }),
    responses: {
      [Status.OK]: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        createdAt: z.string(),
      }),
      [Status.NotFound]: z.object({ error: z.string() }),
    },
  },

  createItem: {
    method: 'POST',
    path: '/items',
    body: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
    }),
    responses: {
      [Status.Created]: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        createdAt: z.string(),
      }),
    },
  },

  updateItem: {
    method: 'PUT',
    path: '/items/:id',
    params: z.object({ id: z.string() }),
    body: z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    }),
    responses: {
      [Status.OK]: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        createdAt: z.string(),
      }),
      [Status.NotFound]: z.object({ error: z.string() }),
    },
  },

  deleteItem: {
    method: 'DELETE',
    path: '/items/:id',
    params: z.object({ id: z.string() }),
    responses: {
      [Status.OK]: z.object({ success: z.boolean(), deleted: z.string() }),
      [Status.NotFound]: z.object({ error: z.string() }),
    },
  },

  downloadFile: {
    type: 'download',
    method: 'GET',
    path: '/files/:fileId',
    params: z.object({
      fileId: z.string(),
    }),
    errorResponses: {
      [Status.NotFound]: z.object({ error: z.string() }),
    },
  },
});

// ===========================================
// HTTP Router Implementation
// ===========================================
const httpRouter = createRouter(httpContract, {
  listItems: async () => {
    const itemList = Array.from(items.values());
    return { status: Status.OK, body: { items: itemList } };
  },

  getItem: async ({ params }) => {
    const item = items.get(params.id);
    if (!item) {
      return { status: Status.NotFound, body: { error: 'Item not found' } };
    }
    return { status: Status.OK, body: item };
  },

  createItem: async ({ body }) => {
    const id = String(nextId++);
    const item = {
      id,
      name: body.name,
      description: body.description,
      createdAt: new Date().toISOString(),
    };
    items.set(id, item);
    return { status: Status.Created, body: item };
  },

  updateItem: async ({ params, body }) => {
    const item = items.get(params.id);
    if (!item) {
      return { status: Status.NotFound, body: { error: 'Item not found' } };
    }
    if (body.name) item.name = body.name;
    if (body.description !== undefined) item.description = body.description;
    items.set(params.id, item);
    return { status: Status.OK, body: item };
  },

  deleteItem: async ({ params }) => {
    if (!items.has(params.id)) {
      return { status: Status.NotFound, body: { error: 'Item not found' } };
    }
    items.delete(params.id);
    return { status: Status.OK, body: { success: true, deleted: params.id } };
  },

  downloadFile: async ({ params }) => {
    try {
      const root = await fs.getDirectory('/uploads');
      const fileHandle = await root.getFileHandle(params.fileId + '.png', { create: false });
      const file = await fileHandle.getFile();

      return {
        status: 200 as const,
        body: file,
        headers: {
          'Content-Type': file.type || 'image/png',
          'Content-Disposition': \`attachment; filename="\${params.fileId}.png"\`,
        },
      };
    } catch (error) {
      return {
        status: Status.NotFound,
        body: { error: 'File not found' },
      };
    }
  },
}, { basePath: '/rpc' });

// ===========================================
// richie-rpc WebSocket Contract (Chat)
// ===========================================
const rpcChatContract = defineWebSocketContract({
  chat: {
    path: '/rpc/ws/chat',
    clientMessages: {
      join: { payload: z.object({ username: z.string().min(1) }) },
      message: { payload: z.object({ text: z.string().min(1) }) },
      typing: { payload: z.object({ isTyping: z.boolean() }) },
    },
    serverMessages: {
      userJoined: { payload: z.object({ username: z.string(), userCount: z.number() }) },
      userLeft: { payload: z.object({ username: z.string(), userCount: z.number() }) },
      message: { payload: z.object({ username: z.string(), text: z.string(), timestamp: z.string() }) },
      typing: { payload: z.object({ username: z.string(), isTyping: z.boolean() }) },
      error: { payload: z.object({ message: z.string() }) },
    },
  },
});

// ===========================================
// richie-rpc WebSocket Contract (RPC Style)
// ===========================================
const rpcWsContract = defineWebSocketContract({
  rpc: {
    path: '/rpc/ws/rpc',
    clientMessages: {
      request: { payload: z.object({
        id: z.string(),
        method: z.string(),
        params: z.any().optional()
      }) },
    },
    serverMessages: {
      response: { payload: z.object({
        id: z.string(),
        result: z.any().optional(),
        error: z.object({ code: z.number(), message: z.string() }).optional()
      }) },
    },
  },
});

// ===========================================
// richie-rpc WebSocket State
// ===========================================
const rpcChatUsers = new Map<string, { username: string; ws: any }>();

// ===========================================
// richie-rpc WebSocket Router
// ===========================================
const rpcWsRouter = createWebSocketRouter(
  { ...rpcChatContract, ...rpcWsContract },
  {
    chat: {
      open({ ws }: any) {
        // Store connection for later
      },
      message({ ws, message: msg }: any) {
        switch (msg.type) {
          case 'join': {
            const { username } = msg.payload;

            // Check if username taken
            for (const [, user] of rpcChatUsers) {
              if (user.username === username) {
                ws.send('error', { message: 'Username already taken' });
                return;
              }
            }

            // Register user using connection data
            const connId = ws.raw?.data?.connectionId || String(Date.now());
            if (ws.raw?.data) {
              ws.raw.data.connectionId = connId;
              ws.raw.data.username = username;
            }
            rpcChatUsers.set(connId, { username, ws: ws.raw });

            // Broadcast userJoined to all
            for (const [id, user] of rpcChatUsers) {
              if (user.ws && user.ws.readyState === 1) {
                user.ws.send(JSON.stringify({
                  type: 'userJoined',
                  payload: { username, userCount: rpcChatUsers.size }
                }));
              }
            }
            break;
          }

          case 'message': {
            const username = ws.raw?.data?.username;
            if (!username) {
              ws.send('error', { message: 'Must join before sending messages' });
              return;
            }

            const messagePayload = {
              username,
              text: msg.payload.text,
              timestamp: new Date().toISOString()
            };

            // Broadcast to all connected users
            for (const [, user] of rpcChatUsers) {
              if (user.ws && user.ws.readyState === 1) {
                user.ws.send(JSON.stringify({
                  type: 'message',
                  payload: messagePayload
                }));
              }
            }
            break;
          }

          case 'typing': {
            const username = ws.raw?.data?.username;
            if (!username) return;

            const connId = ws.raw?.data?.connectionId;
            // Broadcast to others (not self)
            for (const [id, user] of rpcChatUsers) {
              if (id !== connId && user.ws && user.ws.readyState === 1) {
                user.ws.send(JSON.stringify({
                  type: 'typing',
                  payload: { username, isTyping: msg.payload.isTyping }
                }));
              }
            }
            break;
          }
        }
      },
      close({ ws }: any) {
        const connId = ws.raw?.data?.connectionId;
        const username = ws.raw?.data?.username;

        if (connId && rpcChatUsers.has(connId)) {
          rpcChatUsers.delete(connId);

          if (username) {
            // Broadcast userLeft
            for (const [, user] of rpcChatUsers) {
              if (user.ws && user.ws.readyState === 1) {
                user.ws.send(JSON.stringify({
                  type: 'userLeft',
                  payload: { username, userCount: rpcChatUsers.size }
                }));
              }
            }
          }
        }
      },
      validationError({ ws, error }: any) {
        ws.send('error', { message: error.message });
      }
    },
    rpc: {
      message({ ws, message: msg }: any) {
        if (msg.type === 'request') {
          const { id, method, params } = msg.payload;

          try {
            let result: any;

            switch (method) {
              case 'echo':
                result = { echo: params };
                break;
              case 'getItems':
                result = { items: Array.from(items.values()) };
                break;
              case 'getItem':
                const item = items.get(params?.id);
                if (!item) {
                  ws.send('response', {
                    id,
                    error: { code: 404, message: 'Item not found' }
                  });
                  return;
                }
                result = item;
                break;
              case 'createItem':
                const newId = String(nextId++);
                const newItem = {
                  id: newId,
                  name: params?.name || 'Unnamed',
                  description: params?.description,
                  createdAt: new Date().toISOString()
                };
                items.set(newId, newItem);
                result = newItem;
                break;
              default:
                ws.send('response', {
                  id,
                  error: { code: -32601, message: 'Method not found: ' + method }
                });
                return;
            }

            ws.send('response', { id, result });
          } catch (error: any) {
            ws.send('response', {
              id,
              error: { code: -32603, message: error.message || 'Internal error' }
            });
          }
        }
      },
      validationError({ ws, error }: any) {
        ws.send('response', {
          id: 'unknown',
          error: { code: -32600, message: 'Invalid request: ' + error.message }
        });
      }
    }
  }
);

// ===========================================
// Main serve() handler
// ===========================================
serve({
  async fetch(request, server) {
    const url = new URL(request.url);

    // Try richie-rpc WebSocket upgrade first (for /rpc/ws/*)
    const upgradeData = await rpcWsRouter.matchAndPrepareUpgrade(request);
    if (upgradeData) {
      // Data stays within QuickJS, connectionId is generated by server.upgrade()
      server.upgrade(request, { data: upgradeData });
      return new Response(null, { status: 101 });
    }

    // Handle richie-rpc HTTP routes (/rpc/*)
    if (url.pathname.startsWith('/rpc/')) {
      const response = await httpRouter.handle(request);
      if (response) {
        return response;
      }
    }

    // WebSocket upgrade for /ws and /ws/chat (existing handlers)
    if (url.pathname === '/ws' || url.pathname === '/ws/chat') {
      server.upgrade(request, { data: { connectedAt: Date.now() } });
      return new Response(null, { status: 101 });
    }

    // GET /api/hello - Simple JSON response
    if (url.pathname === '/api/hello' && request.method === 'GET') {
      return Response.json({
        message: 'Hello from QuickJS!',
        timestamp: Date.now()
      });
    }

    // GET /api/stream - Streaming response test
    if (url.pathname === '/api/stream' && request.method === 'GET') {
      // Create a ReadableStream directly with start controller
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('chunk 0\\n'));
          controller.enqueue(encoder.encode('chunk 1\\n'));
          controller.enqueue(encoder.encode('chunk 2\\n'));
          controller.enqueue(encoder.encode('chunk 3\\n'));
          controller.enqueue(encoder.encode('chunk 4\\n'));
          controller.close();
        }
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // GET /api/stream-json - NDJSON streaming response with delays
    if (url.pathname === '/api/stream-json' && request.method === 'GET') {
      const encoder = new TextEncoder();
      const maxCount = 5;
      let currentIndex = 0;
      let timerId: number | null = null;
      let closed = false;

      const stream = new ReadableStream({
        start(controller) {
          // Emit chunks with 50ms delays using setTimeout
          const emitChunk = () => {
            if (closed) return;
            if (currentIndex >= maxCount) {
              closed = true;
              controller.close();
              return;
            }
            const data = {
              index: currentIndex,
              message: 'Streaming chunk ' + currentIndex,
              timestamp: Date.now()
            };
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\\n'));
            currentIndex++;
            timerId = setTimeout(emitChunk, 50);
          };
          emitChunk();
        },
        cancel() {
          closed = true;
          if (timerId !== null) clearTimeout(timerId);
        }
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'application/x-ndjson' }
      });
    }

    // GET /api/events - Server-Sent Events endpoint with intervals
    if (url.pathname === '/api/events' && request.method === 'GET') {
      const encoder = new TextEncoder();
      const maxEvents = 10;
      let count = 0;
      let intervalId: number | null = null;
      let closed = false;

      const stream = new ReadableStream({
        start(controller) {
          // Emit events every 100ms using setInterval
          intervalId = setInterval(() => {
            if (closed) {
              if (intervalId !== null) clearInterval(intervalId);
              return;
            }
            count++;
            const data = {
              count,
              timestamp: Date.now(),
              message: 'Event ' + count
            };
            // SSE format: event: type\\ndata: json\\n\\n
            const event = 'event: message\\ndata: ' + JSON.stringify(data) + '\\n\\n';
            controller.enqueue(encoder.encode(event));

            if (count >= maxEvents) {
              closed = true;
              clearInterval(intervalId);
              intervalId = null;
              controller.close();
            }
          }, 100);
        },
        cancel() {
          closed = true;
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    // POST /api/echo - Echo JSON body with timestamp
    if (url.pathname === '/api/echo' && request.method === 'POST') {
      const body = await request.json();
      return Response.json({
        echo: body,
        timestamp: Date.now()
      });
    }

    // POST /api/upload - Save uploaded file to filesystem
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      try {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || typeof file === 'string') {
          return Response.json({ error: 'No file provided' }, { status: 400 });
        }

        const root = await fs.getDirectory('/uploads');
        const fileHandle = await root.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
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
          error: 'Upload failed',
          message: (error as Error).message
        }, { status: 500 });
      }
    }

    // GET /api/files - List uploaded files
    if (url.pathname === '/api/files' && request.method === 'GET') {
      try {
        const root = await fs.getDirectory('/uploads');
        const files = [];

        const names = await root.keys();
        for await (const name of names) {
          if (name.startsWith('.')) continue;
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
            // Skip files that can't be read
          }
        }

        return Response.json({ files });
      } catch (error) {
        return Response.json({ files: [] });
      }
    }

    // GET /api/files/:name - Download file
    if (url.pathname.startsWith('/api/files/') && request.method === 'GET') {
      try {
        const filename = decodeURIComponent(url.pathname.slice('/api/files/'.length));
        const root = await fs.getDirectory('/uploads');
        const fileHandle = await root.getFileHandle(filename);
        const file = await fileHandle.getFile();

        return new Response(await file.arrayBuffer(), {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="' + filename + '"'
          }
        });
      } catch (error) {
        return Response.json({ error: 'File not found' }, { status: 404 });
      }
    }

    // DELETE /api/files/:name - Delete file
    if (url.pathname.startsWith('/api/files/') && request.method === 'DELETE') {
      try {
        const filename = decodeURIComponent(url.pathname.slice('/api/files/'.length));
        const root = await fs.getDirectory('/uploads');
        await root.removeEntry(filename);

        return Response.json({ success: true, deleted: filename });
      } catch (error) {
        return Response.json({ error: 'Delete failed', message: (error as Error).message }, { status: 500 });
      }
    }

    // POST /api/ai/chat - Simulated AI streaming response
    if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
      const body = await request.json();
      const prompt = body.prompt || 'Hello';
      const responseWords = generateAIResponse(prompt);
      const encoder = new TextEncoder();
      let wordIndex = 0;
      let charCount = 0;
      let timerId: number | null = null;
      let closed = false;
      const startTime = Date.now();

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'start', prompt }) + '\\n'));

          const emitWord = () => {
            if (closed) return;

            if (wordIndex >= responseWords.length) {
              const final = {
                type: 'done',
                stats: {
                  totalWords: responseWords.length,
                  totalChars: charCount,
                  processingTime: Date.now() - startTime
                }
              };
              controller.enqueue(encoder.encode(JSON.stringify(final) + '\\n'));
              closed = true;
              controller.close();
              return;
            }

            const word = responseWords[wordIndex];
            charCount += word.length + 1;

            const chunk = {
              type: 'chunk',
              content: word + ' ',
              index: wordIndex
            };
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\\n'));
            wordIndex++;

            const delay = 30 + Math.random() * 70;
            timerId = setTimeout(emitWord, delay);
          };

          setTimeout(emitWord, 100);
        },
        cancel() {
          closed = true;
          if (timerId !== null) clearTimeout(timerId);
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // GET /api/logs - Server-Sent Events for live logs
    if (url.pathname === '/api/logs' && request.method === 'GET') {
      const level = url.searchParams.get('level') || 'all';
      const encoder = new TextEncoder();
      let eventId = 0;
      let intervalId: number | null = null;
      let heartbeatId: number | null = null;
      let closed = false;

      const logTemplates = [
        { level: 'info', message: 'Request processed successfully' },
        { level: 'info', message: 'Database connection established' },
        { level: 'warn', message: 'High memory usage detected' },
        { level: 'warn', message: 'Slow query detected: 150ms' },
        { level: 'error', message: 'Failed to connect to cache server' },
        { level: 'info', message: 'User authentication successful' },
        { level: 'info', message: 'File upload completed' },
        { level: 'warn', message: 'Rate limit approaching' },
        { level: 'error', message: 'Invalid API key used' },
        { level: 'info', message: 'Scheduled task completed' }
      ];

      const stream = new ReadableStream({
        start(controller) {
          const connectEvent = 'event: connected\\ndata: ' + JSON.stringify({
            message: 'Connected to log stream',
            filter: level
          }) + '\\n\\n';
          controller.enqueue(encoder.encode(connectEvent));

          intervalId = setInterval(() => {
            if (closed) {
              if (intervalId !== null) clearInterval(intervalId);
              return;
            }

            const template = logTemplates[Math.floor(Math.random() * logTemplates.length)];

            if (level !== 'all' && template.level !== level) {
              return;
            }

            eventId++;
            const logEntry = {
              id: eventId,
              level: template.level,
              message: template.message,
              timestamp: new Date().toISOString(),
              source: 'quickjs-demo'
            };

            const event = 'id: ' + eventId + '\\nevent: log\\ndata: ' + JSON.stringify(logEntry) + '\\n\\n';
            controller.enqueue(encoder.encode(event));
          }, 1000 + Math.random() * 2000);

          heartbeatId = setInterval(() => {
            if (closed) return;
            const heartbeat = 'event: heartbeat\\ndata: ' + JSON.stringify({ time: Date.now() }) + '\\n\\n';
            controller.enqueue(encoder.encode(heartbeat));
          }, 15000);
        },
        cancel() {
          closed = true;
          if (intervalId !== null) clearInterval(intervalId);
          if (heartbeatId !== null) clearInterval(heartbeatId);
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    // GET /api/downloads/generate - Generate and stream a file
    if (url.pathname === '/api/downloads/generate' && request.method === 'GET') {
      const type = url.searchParams.get('type') || 'text';
      const size = Math.min(parseInt(url.searchParams.get('size') || '1024'), 10 * 1024 * 1024);

      const encoder = new TextEncoder();
      let bytesWritten = 0;
      let timerId: number | null = null;
      let closed = false;
      let lineNum = 1;

      const stream = new ReadableStream({
        start(controller) {
          const emitChunk = () => {
            if (closed) return;

            if (bytesWritten >= size) {
              controller.close();
              return;
            }

            const chunkSize = Math.min(4096, size - bytesWritten);
            let chunk: Uint8Array;

            if (type === 'random') {
              chunk = new Uint8Array(chunkSize);
              for (let i = 0; i < chunkSize; i++) {
                chunk[i] = Math.floor(Math.random() * 256);
              }
            } else {
              let text = '';
              while (text.length < chunkSize) {
                text += 'Line ' + lineNum + ': Lorem ipsum dolor sit amet, consectetur adipiscing elit.\\n';
                lineNum++;
              }
              chunk = encoder.encode(text.substring(0, chunkSize));
            }

            bytesWritten += chunk.length;
            controller.enqueue(chunk);

            timerId = setTimeout(emitChunk, 10);
          };

          emitChunk();
        },
        cancel() {
          closed = true;
          if (timerId !== null) clearTimeout(timerId);
        }
      });

      const filename = type === 'random' ? 'random-data.bin' : 'generated-text.txt';
      const contentType = type === 'random' ? 'application/octet-stream' : 'text/plain';

      return new Response(stream, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': 'attachment; filename="' + filename + '"',
          'Content-Length': String(size)
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      // Check if richie-rpc WebSocket (match by endpointName from matchAndPrepareUpgrade)
      if (ws.data?.endpointName) {
        return rpcWsRouter.websocketHandler.open({ ws, upgradeData: ws.data });
      }

      // Existing manual handlers
      const url = ws.data?.url;

      if (url === '/ws/chat') {
        ws.send(JSON.stringify({
          type: 'connected',
          message: 'Connected to chat. Send { type: "join", payload: { username: "..." } } to join.'
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'connected',
          data: ws.data,
          message: 'Welcome to QuickJS WebSocket!'
        }));
      }
    },

    message(ws, message) {
      // Check if richie-rpc WebSocket
      if (ws.data?.endpointName) {
        return rpcWsRouter.websocketHandler.message({ ws, rawMessage: message, upgradeData: ws.data });
      }

      // Existing manual handlers
      const url = ws.data?.url;

      if (url === '/ws/chat') {
        handleChatMessage(ws, message);
      } else {
        const response = {
          type: 'echo',
          original: typeof message === 'string' ? message : '[binary data]',
          timestamp: Date.now(),
          connectionData: ws.data
        };
        ws.send(JSON.stringify(response));
      }
    },

    close(ws, code, reason) {
      // Check if richie-rpc WebSocket
      if (ws.data?.endpointName) {
        return rpcWsRouter.websocketHandler.close({ ws, code, reason, upgradeData: ws.data });
      }

      // Existing manual handlers
      const url = ws.data?.url;

      if (url === '/ws/chat') {
        handleChatDisconnect(ws);
      }

      // WebSocket closed - code and reason available if needed
    },

    error(ws, error) {
      // WebSocket error occurred
    }
  }
});
`;
