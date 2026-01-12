import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockServerResponse {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface IntegrationServer {
  /** The base URL of the server (e.g., "http://localhost:3000") */
  url: string;
  /** The port the server is listening on */
  port: number;
  /** Close the server */
  close(): Promise<void>;
  /** Set the response for a specific path */
  setResponse(path: string, response: MockServerResponse): void;
  /** Set a default response for any unmatched path */
  setDefaultResponse(response: MockServerResponse): void;
  /** Get all recorded requests */
  getRequests(): RecordedRequest[];
  /** Clear all recorded requests */
  clearRequests(): void;
  /** Clear all configured responses */
  clearResponses(): void;
}

/**
 * Start an HTTP server for integration tests.
 * Useful for testing fetch operations against a real server.
 *
 * @example
 * const server = await startIntegrationServer();
 *
 * server.setResponse("/api/data", {
 *   status: 200,
 *   body: JSON.stringify({ message: "Hello" }),
 *   headers: { "Content-Type": "application/json" }
 * });
 *
 * // In your test
 * const response = await fetch(`${server.url}/api/data`);
 * const data = await response.json();
 *
 * // Check what requests were made
 * const requests = server.getRequests();
 * console.log(requests[0].path); // "/api/data"
 *
 * await server.close();
 */
export async function startIntegrationServer(
  port?: number
): Promise<IntegrationServer> {
  const responses = new Map<string, MockServerResponse>();
  const requests: RecordedRequest[] = [];
  let defaultResponse: MockServerResponse = { status: 404, body: "Not Found" };

  const server: Server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const path = req.url ?? "/";
      const method = req.method ?? "GET";

      // Read request body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks).toString() : undefined;

      // Record the request
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value.join(", ");
        }
      }
      requests.push({ method, path, headers, body });

      // Find and send response
      const mockResponse = responses.get(path) ?? defaultResponse;

      res.statusCode = mockResponse.status ?? 200;

      if (mockResponse.headers) {
        for (const [key, value] of Object.entries(mockResponse.headers)) {
          res.setHeader(key, value);
        }
      }

      res.end(mockResponse.body ?? "");
    }
  );

  // Find an available port
  const actualPort = await new Promise<number>((resolve, reject) => {
    server.listen(port ?? 0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });

  return {
    url: `http://localhost:${actualPort}`,
    port: actualPort,

    async close() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    setResponse(path: string, response: MockServerResponse) {
      responses.set(path, response);
    },

    setDefaultResponse(response: MockServerResponse) {
      defaultResponse = response;
    },

    getRequests() {
      return [...requests];
    },

    clearRequests() {
      requests.length = 0;
    },

    clearResponses() {
      responses.clear();
      defaultResponse = { status: 404, body: "Not Found" };
    },
  };
}
