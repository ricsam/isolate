/**
 * Isolate type definitions as string constants.
 *
 * These are the canonical source for isolated-vm global type definitions.
 * The .d.ts files in each package are generated from these strings during build.
 *
 * @example
 * import { TYPE_DEFINITIONS } from "@ricsam/isolate-types";
 *
 * // Use with ts-morph for type checking code strings
 * project.createSourceFile("types.d.ts", TYPE_DEFINITIONS.fetch);
 */

/**
 * Type definitions for @ricsam/isolate-core globals.
 *
 * Includes: ReadableStream, WritableStream, TransformStream, Blob, File, URL, URLSearchParams, DOMException
 */
export const CORE_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-core
 *
 * These types define the globals injected by setupCore() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * // In your tsconfig.isolate.json
 * {
 *   "compilerOptions": {
 *     "lib": ["ESNext", "DOM"]
 *   }
 * }
 *
 * // Then reference this file or use ts-morph for code strings
 */

export {};

declare global {
  // ============================================
  // Web Streams API
  // ============================================

  /**
   * A readable stream of data.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream
   */
  const ReadableStream: typeof globalThis.ReadableStream;

  /**
   * A writable stream of data.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WritableStream
   */
  const WritableStream: typeof globalThis.WritableStream;

  /**
   * A transform stream that can be used to pipe data through a transformer.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/TransformStream
   */
  const TransformStream: typeof globalThis.TransformStream;

  /**
   * Default reader for ReadableStream
   * @see https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader
   */
  const ReadableStreamDefaultReader: typeof globalThis.ReadableStreamDefaultReader;

  /**
   * Default writer for WritableStream
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultWriter
   */
  const WritableStreamDefaultWriter: typeof globalThis.WritableStreamDefaultWriter;

  // ============================================
  // Blob and File APIs
  // ============================================

  /**
   * A file-like object of immutable, raw data.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Blob
   */
  const Blob: typeof globalThis.Blob;

  /**
   * A file object representing a file.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/File
   */
  const File: typeof globalThis.File;

  // ============================================
  // URL APIs
  // ============================================

  /**
   * Interface for URL manipulation.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/URL
   */
  const URL: typeof globalThis.URL;

  /**
   * Utility for working with URL query strings.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
   */
  const URLSearchParams: typeof globalThis.URLSearchParams;

  // ============================================
  // Error Handling
  // ============================================

  /**
   * Exception type for DOM operations.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMException
   */
  const DOMException: typeof globalThis.DOMException;
}
`;

/**
 * Type definitions for @ricsam/isolate-fetch globals.
 *
 * Includes: Headers, Request, Response, AbortController, AbortSignal, FormData, fetch, serve, Server, ServerWebSocket, WebSocket
 */
export const FETCH_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-fetch
 *
 * These types define the globals injected by setupFetch() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * // Typecheck isolate code with serve()
 * type WebSocketData = { id: number; connectedAt: number };
 *
 * serve({
 *   fetch(request, server) {
 *     if (request.url.includes("/ws")) {
 *       // server.upgrade knows data should be WebSocketData
 *       server.upgrade(request, { data: { id: 123, connectedAt: Date.now() } });
 *       return new Response(null, { status: 101 });
 *     }
 *     return new Response("Hello!");
 *   },
 *   websocket: {
 *     // Type hint - specifies the type of ws.data
 *     data: {} as WebSocketData,
 *     message(ws, message) {
 *       // ws.data is typed as WebSocketData
 *       console.log("User", ws.data.id, "says:", message);
 *       ws.send("Echo: " + message);
 *     }
 *   }
 * });
 */

export {};

declare global {
  // ============================================
  // Standard Fetch API (from lib.dom)
  // ============================================

  /**
   * Headers class for HTTP headers manipulation.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Headers
   */
  const Headers: typeof globalThis.Headers;

  /**
   * Request class for HTTP requests.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Request
   */
  const Request: typeof globalThis.Request;

  /**
   * Response class for HTTP responses.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Response
   */
  const Response: typeof globalThis.Response;

  /**
   * AbortController for cancelling fetch requests.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortController
   */
  const AbortController: typeof globalThis.AbortController;

  /**
   * AbortSignal for listening to abort events.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
   */
  const AbortSignal: typeof globalThis.AbortSignal;

  /**
   * FormData for constructing form data.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/FormData
   */
  const FormData: typeof globalThis.FormData;

  /**
   * Fetch function for making HTTP requests.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/fetch
   */
  function fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response>;

  // ============================================
  // Isolate-specific: serve() API
  // ============================================

  /**
   * Server interface for handling WebSocket upgrades within serve() handlers.
   *
   * @typeParam T - The type of data associated with WebSocket connections
   */
  interface Server<T = unknown> {
    /**
     * Upgrade an HTTP request to a WebSocket connection.
     *
     * @param request - The incoming HTTP request to upgrade
     * @param options - Optional data to associate with the WebSocket connection
     * @returns true if upgrade will proceed, false otherwise
     *
     * @example
     * serve({
     *   fetch(request, server) {
     *     if (server.upgrade(request, { data: { userId: 123 } })) {
     *       return new Response(null, { status: 101 });
     *     }
     *     return new Response("Upgrade failed", { status: 400 });
     *   }
     * });
     */
    upgrade(request: Request, options?: { data?: T }): boolean;
  }

  /**
   * ServerWebSocket interface for WebSocket connections within serve() handlers.
   *
   * @typeParam T - The type of data associated with this WebSocket connection
   */
  interface ServerWebSocket<T = unknown> {
    /**
     * User data associated with this connection.
     * Set via \`server.upgrade(request, { data: ... })\`.
     */
    readonly data: T;

    /**
     * Send a message to the client.
     *
     * @param message - The message to send (string, ArrayBuffer, or Uint8Array)
     */
    send(message: string | ArrayBuffer | Uint8Array): void;

    /**
     * Close the WebSocket connection.
     *
     * @param code - Optional close code (default: 1000)
     * @param reason - Optional close reason
     */
    close(code?: number, reason?: string): void;

    /**
     * WebSocket ready state.
     * - 0: CONNECTING
     * - 1: OPEN
     * - 2: CLOSING
     * - 3: CLOSED
     */
    readonly readyState: number;
  }

  /**
   * Options for the serve() function.
   *
   * @typeParam T - The type of data associated with WebSocket connections
   */
  interface ServeOptions<T = unknown> {
    /**
     * Handler for HTTP requests.
     *
     * @param request - The incoming HTTP request
     * @param server - Server interface for WebSocket upgrades
     * @returns Response or Promise resolving to Response
     */
    fetch(request: Request, server: Server<T>): Response | Promise<Response>;

    /**
     * WebSocket event handlers.
     */
    websocket?: {
      /**
       * Type hint for WebSocket data. The value is not used at runtime.
       * Specifies the type of \`ws.data\` for all handlers and \`server.upgrade()\`.
       *
       * @example
       * websocket: {
       *   data: {} as { userId: string },
       *   message(ws, message) {
       *     // ws.data.userId is typed as string
       *   }
       * }
       */
      data?: T;

      /**
       * Called when a WebSocket connection is opened.
       *
       * @param ws - The WebSocket connection
       */
      open?(ws: ServerWebSocket<T>): void | Promise<void>;

      /**
       * Called when a message is received.
       *
       * @param ws - The WebSocket connection
       * @param message - The received message (string or ArrayBuffer)
       */
      message?(
        ws: ServerWebSocket<T>,
        message: string | ArrayBuffer
      ): void | Promise<void>;

      /**
       * Called when the connection is closed.
       *
       * @param ws - The WebSocket connection
       * @param code - The close code
       * @param reason - The close reason
       */
      close?(
        ws: ServerWebSocket<T>,
        code: number,
        reason: string
      ): void | Promise<void>;

      /**
       * Called when an error occurs.
       *
       * @param ws - The WebSocket connection
       * @param error - The error that occurred
       */
      error?(ws: ServerWebSocket<T>, error: Error): void | Promise<void>;
    };
  }

  /**
   * Register an HTTP server handler in the isolate.
   *
   * Only one serve() handler can be active at a time.
   * Calling serve() again replaces the previous handler.
   *
   * @param options - Server configuration including fetch handler and optional WebSocket handlers
   *
   * @example
   * type WsData = { connectedAt: number };
   *
   * serve({
   *   fetch(request, server) {
   *     const url = new URL(request.url);
   *
   *     if (url.pathname === "/ws") {
   *       if (server.upgrade(request, { data: { connectedAt: Date.now() } })) {
   *         return new Response(null, { status: 101 });
   *       }
   *     }
   *
   *     if (url.pathname === "/api/hello") {
   *       return Response.json({ message: "Hello!" });
   *     }
   *
   *     return new Response("Not Found", { status: 404 });
   *   },
   *   websocket: {
   *     data: {} as WsData,
   *     open(ws) {
   *       console.log("Connected at:", ws.data.connectedAt);
   *     },
   *     message(ws, message) {
   *       ws.send("Echo: " + message);
   *     },
   *     close(ws, code, reason) {
   *       console.log("Closed:", code, reason);
   *     }
   *   }
   * });
   */
  function serve<T = unknown>(options: ServeOptions<T>): void;

  // ============================================
  // Client WebSocket API (outbound connections)
  // ============================================

  /**
   * The type for WebSocket binary data handling.
   */
  type BinaryType = "blob" | "arraybuffer";

  /**
   * Event fired when a WebSocket connection is closed.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
   */
  interface CloseEvent extends Event {
    /**
     * The close code sent by the server.
     */
    readonly code: number;

    /**
     * The close reason sent by the server.
     */
    readonly reason: string;

    /**
     * Whether the connection was closed cleanly.
     */
    readonly wasClean: boolean;
  }

  /**
   * Event fired when a WebSocket receives a message.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
   */
  interface MessageEvent<T = any> extends Event {
    /**
     * The data sent by the message emitter.
     */
    readonly data: T;

    /**
     * The origin of the message emitter.
     */
    readonly origin: string;

    /**
     * The last event ID (for Server-Sent Events).
     */
    readonly lastEventId: string;

    /**
     * The MessagePort array sent with the message (if any).
     */
    readonly ports: ReadonlyArray<MessagePort>;

    /**
     * The source of the message (if applicable).
     */
    readonly source: MessageEventSource | null;
  }

  /**
   * WHATWG WebSocket client for making outbound WebSocket connections.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
   *
   * @example
   * const ws = new WebSocket("wss://echo.websocket.org");
   *
   * ws.onopen = () => {
   *   console.log("Connected!");
   *   ws.send("Hello, server!");
   * };
   *
   * ws.onmessage = (event) => {
   *   console.log("Received:", event.data);
   * };
   *
   * ws.onclose = (event) => {
   *   console.log("Closed:", event.code, event.reason);
   * };
   *
   * ws.onerror = () => {
   *   console.log("Error occurred");
   * };
   */
  interface WebSocket extends EventTarget {
    /**
     * The URL of the WebSocket connection.
     */
    readonly url: string;

    /**
     * The current state of the connection.
     * - 0: CONNECTING
     * - 1: OPEN
     * - 2: CLOSING
     * - 3: CLOSED
     */
    readonly readyState: number;

    /**
     * The number of bytes of data that have been queued but not yet transmitted.
     */
    readonly bufferedAmount: number;

    /**
     * The extensions selected by the server.
     */
    readonly extensions: string;

    /**
     * The subprotocol selected by the server.
     */
    readonly protocol: string;

    /**
     * The type of binary data being transmitted.
     * Can be "blob" or "arraybuffer".
     */
    binaryType: BinaryType;

    /**
     * Send data through the WebSocket connection.
     *
     * @param data - The data to send
     * @throws InvalidStateError if the connection is not open
     *
     * @example
     * ws.send("Hello!");
     * ws.send(new Uint8Array([1, 2, 3]));
     */
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;

    /**
     * Close the WebSocket connection.
     *
     * @param code - The close code (default: 1000)
     * @param reason - The close reason (max 123 bytes UTF-8)
     *
     * @example
     * ws.close();
     * ws.close(1000, "Normal closure");
     */
    close(code?: number, reason?: string): void;

    /**
     * Event handler for when the connection is established.
     */
    onopen: ((this: WebSocket, ev: Event) => any) | null;

    /**
     * Event handler for when a message is received.
     */
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;

    /**
     * Event handler for when an error occurs.
     */
    onerror: ((this: WebSocket, ev: Event) => any) | null;

    /**
     * Event handler for when the connection is closed.
     */
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;

    /**
     * Connection is being established.
     */
    readonly CONNECTING: 0;

    /**
     * Connection is open and ready to communicate.
     */
    readonly OPEN: 1;

    /**
     * Connection is in the process of closing.
     */
    readonly CLOSING: 2;

    /**
     * Connection is closed or couldn't be opened.
     */
    readonly CLOSED: 3;
  }

  /**
   * WebSocket constructor.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
   */
  interface WebSocketConstructor {
    /**
     * Create a new WebSocket connection.
     *
     * @param url - The URL to connect to (must be ws:// or wss://)
     * @param protocols - Optional subprotocol(s) to request
     * @throws SyntaxError if the URL is invalid
     *
     * @example
     * const ws = new WebSocket("wss://example.com/socket");
     * const ws = new WebSocket("wss://example.com/socket", "graphql-ws");
     * const ws = new WebSocket("wss://example.com/socket", ["protocol1", "protocol2"]);
     */
    new (url: string | URL, protocols?: string | string[]): WebSocket;

    readonly prototype: WebSocket;

    /**
     * Connection is being established.
     */
    readonly CONNECTING: 0;

    /**
     * Connection is open and ready to communicate.
     */
    readonly OPEN: 1;

    /**
     * Connection is in the process of closing.
     */
    readonly CLOSING: 2;

    /**
     * Connection is closed or couldn't be opened.
     */
    readonly CLOSED: 3;
  }

  /**
   * WHATWG WebSocket client for making outbound WebSocket connections.
   */
  const WebSocket: WebSocketConstructor;
}
`;

/**
 * Type definitions for @ricsam/isolate-fs globals.
 *
 * Includes: fs namespace, FileSystemHandle, FileSystemFileHandle, FileSystemDirectoryHandle, FileSystemWritableFileStream
 */
export const FS_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-fs
 *
 * These types define the globals injected by setupFs() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * // Typecheck isolate code with file system access
 * const root = await getDirectory("/data");
 * const fileHandle = await root.getFileHandle("config.json");
 * const file = await fileHandle.getFile();
 * const content = await file.text();
 */

export {};

declare global {
  // ============================================
  // getDirectory - Isolate-specific entry point
  // ============================================

  /**
   * Get a directory handle for the given path.
   *
   * The host controls which paths are accessible. Invalid or unauthorized
   * paths will throw an error.
   *
   * @param path - The path to request from the host
   * @returns A promise resolving to a directory handle
   * @throws If the path is not allowed or doesn't exist
   *
   * @example
   * const root = await getDirectory("/");
   * const dataDir = await getDirectory("/data");
   */
  function getDirectory(path: string): Promise<FileSystemDirectoryHandle>;

  // ============================================
  // File System Access API
  // ============================================

  /**
   * Base interface for file system handles.
   */
  interface FileSystemHandle {
    /**
     * The kind of handle: "file" or "directory".
     */
    readonly kind: "file" | "directory";

    /**
     * The name of the file or directory.
     */
    readonly name: string;

    /**
     * Compare two handles to check if they reference the same entry.
     *
     * @param other - Another FileSystemHandle to compare against
     * @returns true if both handles reference the same entry
     */
    isSameEntry(other: FileSystemHandle): Promise<boolean>;
  }

  /**
   * Handle for a file in the file system.
   */
  interface FileSystemFileHandle extends FileSystemHandle {
    /**
     * Always "file" for file handles.
     */
    readonly kind: "file";

    /**
     * Get the file contents as a File object.
     *
     * @returns A promise resolving to a File object
     *
     * @example
     * const file = await fileHandle.getFile();
     * const text = await file.text();
     */
    getFile(): Promise<File>;

    /**
     * Create a writable stream for writing to the file.
     *
     * @param options - Options for the writable stream
     * @returns A promise resolving to a writable stream
     *
     * @example
     * const writable = await fileHandle.createWritable();
     * await writable.write("Hello, World!");
     * await writable.close();
     */
    createWritable(options?: {
      /**
       * If true, keeps existing file data. Otherwise, truncates the file.
       */
      keepExistingData?: boolean;
    }): Promise<FileSystemWritableFileStream>;
  }

  /**
   * Handle for a directory in the file system.
   */
  interface FileSystemDirectoryHandle extends FileSystemHandle {
    /**
     * Always "directory" for directory handles.
     */
    readonly kind: "directory";

    /**
     * Get a file handle within this directory.
     *
     * @param name - The name of the file
     * @param options - Options for getting the file handle
     * @returns A promise resolving to a file handle
     * @throws If the file doesn't exist and create is not true
     *
     * @example
     * const file = await dir.getFileHandle("data.json");
     * const newFile = await dir.getFileHandle("output.txt", { create: true });
     */
    getFileHandle(
      name: string,
      options?: {
        /**
         * If true, creates the file if it doesn't exist.
         */
        create?: boolean;
      }
    ): Promise<FileSystemFileHandle>;

    /**
     * Get a subdirectory handle within this directory.
     *
     * @param name - The name of the subdirectory
     * @param options - Options for getting the directory handle
     * @returns A promise resolving to a directory handle
     * @throws If the directory doesn't exist and create is not true
     *
     * @example
     * const subdir = await dir.getDirectoryHandle("logs");
     * const newDir = await dir.getDirectoryHandle("cache", { create: true });
     */
    getDirectoryHandle(
      name: string,
      options?: {
        /**
         * If true, creates the directory if it doesn't exist.
         */
        create?: boolean;
      }
    ): Promise<FileSystemDirectoryHandle>;

    /**
     * Remove a file or directory within this directory.
     *
     * @param name - The name of the entry to remove
     * @param options - Options for removal
     * @throws If the entry doesn't exist or cannot be removed
     *
     * @example
     * await dir.removeEntry("old-file.txt");
     * await dir.removeEntry("old-dir", { recursive: true });
     */
    removeEntry(
      name: string,
      options?: {
        /**
         * If true, removes directories recursively.
         */
        recursive?: boolean;
      }
    ): Promise<void>;

    /**
     * Resolve the path from this directory to a descendant handle.
     *
     * @param possibleDescendant - A handle that may be a descendant
     * @returns An array of path segments, or null if not a descendant
     *
     * @example
     * const path = await root.resolve(nestedFile);
     * // ["subdir", "file.txt"]
     */
    resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;

    /**
     * Iterate over entries in this directory.
     *
     * @returns An async iterator of [name, handle] pairs
     *
     * @example
     * for await (const [name, handle] of dir.entries()) {
     *   console.log(name, handle.kind);
     * }
     */
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;

    /**
     * Iterate over entry names in this directory.
     *
     * @returns An async iterator of names
     *
     * @example
     * for await (const name of dir.keys()) {
     *   console.log(name);
     * }
     */
    keys(): AsyncIterableIterator<string>;

    /**
     * Iterate over handles in this directory.
     *
     * @returns An async iterator of handles
     *
     * @example
     * for await (const handle of dir.values()) {
     *   console.log(handle.name, handle.kind);
     * }
     */
    values(): AsyncIterableIterator<FileSystemHandle>;

    /**
     * Async iterator support for directory entries.
     *
     * @example
     * for await (const [name, handle] of dir) {
     *   console.log(name, handle.kind);
     * }
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
  }

  /**
   * Parameters for write operations on FileSystemWritableFileStream.
   */
  interface WriteParams {
    /**
     * The type of write operation.
     * - "write": Write data at the current position or specified position
     * - "seek": Move the file position
     * - "truncate": Truncate the file to a specific size
     */
    type: "write" | "seek" | "truncate";

    /**
     * The data to write (for "write" type).
     */
    data?: string | ArrayBuffer | Uint8Array | Blob;

    /**
     * The position to write at or seek to.
     */
    position?: number;

    /**
     * The size to truncate to (for "truncate" type).
     */
    size?: number;
  }

  /**
   * Writable stream for writing to a file.
   * Extends WritableStream with file-specific operations.
   */
  interface FileSystemWritableFileStream extends WritableStream<Uint8Array> {
    /**
     * Write data to the file.
     *
     * @param data - The data to write
     * @returns A promise that resolves when the write completes
     *
     * @example
     * await writable.write("Hello, World!");
     * await writable.write(new Uint8Array([1, 2, 3]));
     * await writable.write({ type: "write", data: "text", position: 0 });
     */
    write(
      data: string | ArrayBuffer | Uint8Array | Blob | WriteParams
    ): Promise<void>;

    /**
     * Seek to a position in the file.
     *
     * @param position - The byte position to seek to
     * @returns A promise that resolves when the seek completes
     *
     * @example
     * await writable.seek(0); // Seek to beginning
     * await writable.write("Overwrite");
     */
    seek(position: number): Promise<void>;

    /**
     * Truncate the file to a specific size.
     *
     * @param size - The size to truncate to
     * @returns A promise that resolves when the truncation completes
     *
     * @example
     * await writable.truncate(100); // Keep only first 100 bytes
     */
    truncate(size: number): Promise<void>;
  }
}
`;

/**
 * Type definitions for @ricsam/isolate-test-environment globals.
 *
 * Includes: describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach
 */
export const TEST_ENV_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-test-environment
 *
 * These types define the globals injected by setupTestEnvironment() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * describe("Math operations", () => {
 *   it("should add numbers", () => {
 *     expect(1 + 1).toBe(2);
 *   });
 * });
 */

export {};

declare global {
  // ============================================
  // Test Structure
  // ============================================

  /**
   * Define a test suite.
   *
   * @param name - The name of the test suite
   * @param fn - Function containing tests and nested suites
   *
   * @example
   * describe("Calculator", () => {
   *   it("adds numbers", () => {
   *     expect(1 + 1).toBe(2);
   *   });
   * });
   */
  function describe(name: string, fn: () => void): void;

  namespace describe {
    /**
     * Skip this suite and all its tests.
     */
    function skip(name: string, fn: () => void): void;

    /**
     * Only run this suite (and other .only suites).
     */
    function only(name: string, fn: () => void): void;

    /**
     * Mark suite as todo (skipped with different status).
     */
    function todo(name: string, fn?: () => void): void;
  }

  /**
   * Define a test case.
   *
   * @param name - The name of the test
   * @param fn - The test function (can be async)
   *
   * @example
   * it("should work", () => {
   *   expect(true).toBe(true);
   * });
   *
   * it("should work async", async () => {
   *   const result = await Promise.resolve(42);
   *   expect(result).toBe(42);
   * });
   */
  function it(name: string, fn: () => void | Promise<void>): void;

  namespace it {
    /**
     * Skip this test.
     */
    function skip(name: string, fn?: () => void | Promise<void>): void;

    /**
     * Only run this test (and other .only tests).
     */
    function only(name: string, fn: () => void | Promise<void>): void;

    /**
     * Mark test as todo.
     */
    function todo(name: string, fn?: () => void | Promise<void>): void;
  }

  /**
   * Alias for it().
   */
  function test(name: string, fn: () => void | Promise<void>): void;

  namespace test {
    /**
     * Skip this test.
     */
    function skip(name: string, fn?: () => void | Promise<void>): void;

    /**
     * Only run this test (and other .only tests).
     */
    function only(name: string, fn: () => void | Promise<void>): void;

    /**
     * Mark test as todo.
     */
    function todo(name: string, fn?: () => void | Promise<void>): void;
  }

  // ============================================
  // Lifecycle Hooks
  // ============================================

  /**
   * Run once before all tests in the current suite.
   *
   * @param fn - Setup function (can be async)
   */
  function beforeAll(fn: () => void | Promise<void>): void;

  /**
   * Run once after all tests in the current suite.
   *
   * @param fn - Teardown function (can be async)
   */
  function afterAll(fn: () => void | Promise<void>): void;

  /**
   * Run before each test in the current suite (and nested suites).
   *
   * @param fn - Setup function (can be async)
   */
  function beforeEach(fn: () => void | Promise<void>): void;

  /**
   * Run after each test in the current suite (and nested suites).
   *
   * @param fn - Teardown function (can be async)
   */
  function afterEach(fn: () => void | Promise<void>): void;

  // ============================================
  // Assertions
  // ============================================

  /**
   * Matchers for assertions.
   */
  interface Matchers<T> {
    /**
     * Strict equality (===).
     */
    toBe(expected: T): void;

    /**
     * Deep equality.
     */
    toEqual(expected: unknown): void;

    /**
     * Deep equality with type checking.
     */
    toStrictEqual(expected: unknown): void;

    /**
     * Check if value is truthy.
     */
    toBeTruthy(): void;

    /**
     * Check if value is falsy.
     */
    toBeFalsy(): void;

    /**
     * Check if value is null.
     */
    toBeNull(): void;

    /**
     * Check if value is undefined.
     */
    toBeUndefined(): void;

    /**
     * Check if value is defined (not undefined).
     */
    toBeDefined(): void;

    /**
     * Check if value is NaN.
     */
    toBeNaN(): void;

    /**
     * Check if number is greater than expected.
     */
    toBeGreaterThan(n: number): void;

    /**
     * Check if number is greater than or equal to expected.
     */
    toBeGreaterThanOrEqual(n: number): void;

    /**
     * Check if number is less than expected.
     */
    toBeLessThan(n: number): void;

    /**
     * Check if number is less than or equal to expected.
     */
    toBeLessThanOrEqual(n: number): void;

    /**
     * Check if array/string contains item/substring.
     */
    toContain(item: unknown): void;

    /**
     * Check length of array/string.
     */
    toHaveLength(length: number): void;

    /**
     * Check if object has property (optionally with value).
     */
    toHaveProperty(key: string, value?: unknown): void;

    /**
     * Check if function throws.
     */
    toThrow(expected?: string | RegExp | Error): void;

    /**
     * Check if string matches pattern.
     */
    toMatch(pattern: string | RegExp): void;

    /**
     * Check if object matches subset of properties.
     */
    toMatchObject(object: object): void;

    /**
     * Check if value is instance of class.
     */
    toBeInstanceOf(constructor: Function): void;

    /**
     * Negate the matcher.
     */
    not: Matchers<T>;

    /**
     * Await promise and check resolved value.
     */
    resolves: Matchers<Awaited<T>>;

    /**
     * Await promise and check rejection.
     */
    rejects: Matchers<unknown>;
  }

  /**
   * Create an expectation for a value.
   *
   * @param actual - The value to test
   * @returns Matchers for the value
   *
   * @example
   * expect(1 + 1).toBe(2);
   * expect({ a: 1 }).toEqual({ a: 1 });
   * expect(() => { throw new Error(); }).toThrow();
   * expect(promise).resolves.toBe(42);
   */
  function expect<T>(actual: T): Matchers<T>;
}
`;

/**
 * Type definitions for @ricsam/isolate-console globals.
 *
 * Includes: console.log, warn, error, debug, info, trace, dir, table, time, timeEnd, timeLog, count, countReset, clear, assert, group, groupCollapsed, groupEnd
 */
export const CONSOLE_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-console
 *
 * These types define the globals injected by setupConsole() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 */

export {};

declare global {
  /**
   * Console interface for logging and debugging.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Console
   */
  interface Console {
    /**
     * Log a message to the console.
     * @param data - Values to log
     */
    log(...data: unknown[]): void;

    /**
     * Log a warning message.
     * @param data - Values to log
     */
    warn(...data: unknown[]): void;

    /**
     * Log an error message.
     * @param data - Values to log
     */
    error(...data: unknown[]): void;

    /**
     * Log a debug message.
     * @param data - Values to log
     */
    debug(...data: unknown[]): void;

    /**
     * Log an info message.
     * @param data - Values to log
     */
    info(...data: unknown[]): void;

    /**
     * Log a stack trace.
     * @param data - Values to log with the trace
     */
    trace(...data: unknown[]): void;

    /**
     * Display an object in a formatted way.
     * @param item - Object to display
     * @param options - Display options
     */
    dir(item: unknown, options?: object): void;

    /**
     * Display tabular data.
     * @param tabularData - Data to display as a table
     * @param properties - Optional array of property names to include
     */
    table(tabularData: unknown, properties?: string[]): void;

    /**
     * Start a timer.
     * @param label - Timer label (default: "default")
     */
    time(label?: string): void;

    /**
     * End a timer and log the elapsed time.
     * @param label - Timer label (default: "default")
     */
    timeEnd(label?: string): void;

    /**
     * Log the elapsed time of a timer without ending it.
     * @param label - Timer label (default: "default")
     * @param data - Additional values to log
     */
    timeLog(label?: string, ...data: unknown[]): void;

    /**
     * Log an error if the assertion is false.
     * @param condition - Condition to test
     * @param data - Values to log if assertion fails
     */
    assert(condition?: boolean, ...data: unknown[]): void;

    /**
     * Increment and log a counter.
     * @param label - Counter label (default: "default")
     */
    count(label?: string): void;

    /**
     * Reset a counter.
     * @param label - Counter label (default: "default")
     */
    countReset(label?: string): void;

    /**
     * Clear the console.
     */
    clear(): void;

    /**
     * Start an inline group.
     * @param data - Group label
     */
    group(...data: unknown[]): void;

    /**
     * Start a collapsed inline group.
     * @param data - Group label
     */
    groupCollapsed(...data: unknown[]): void;

    /**
     * End the current inline group.
     */
    groupEnd(): void;
  }

  /**
   * Console object for logging and debugging.
   */
  const console: Console;
}
`;

/**
 * Type definitions for @ricsam/isolate-encoding globals.
 *
 * Includes: atob, btoa
 */
export const ENCODING_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-encoding
 *
 * These types define the globals injected by setupEncoding() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 */

export {};

declare global {
  /**
   * Decodes a Base64-encoded string.
   *
   * @param encodedData - The Base64 string to decode
   * @returns The decoded string
   * @throws DOMException if the input is not valid Base64
   *
   * @example
   * atob("SGVsbG8="); // "Hello"
   */
  function atob(encodedData: string): string;

  /**
   * Encodes a string to Base64.
   *
   * @param stringToEncode - The string to encode (must contain only Latin1 characters)
   * @returns The Base64 encoded string
   * @throws DOMException if the string contains characters outside Latin1 range (0-255)
   *
   * @example
   * btoa("Hello"); // "SGVsbG8="
   */
  function btoa(stringToEncode: string): string;
}
`;

/**
 * Type definitions for @ricsam/isolate-crypto globals.
 *
 * Includes: crypto.subtle, crypto.getRandomValues, crypto.randomUUID, CryptoKey
 */
export const CRYPTO_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-crypto
 *
 * These types define the globals injected by setupCrypto() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * // Generate random bytes
 * const arr = new Uint8Array(16);
 * crypto.getRandomValues(arr);
 *
 * // Generate UUID
 * const uuid = crypto.randomUUID();
 *
 * // Use SubtleCrypto
 * const key = await crypto.subtle.generateKey(
 *   { name: "AES-GCM", length: 256 },
 *   true,
 *   ["encrypt", "decrypt"]
 * );
 */

export {};

declare global {
  /**
   * CryptoKey represents a cryptographic key.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey
   */
  interface CryptoKey {
    /**
     * The type of key: "public", "private", or "secret".
     */
    readonly type: "public" | "private" | "secret";

    /**
     * Whether the key can be exported.
     */
    readonly extractable: boolean;

    /**
     * The algorithm used by this key.
     */
    readonly algorithm: KeyAlgorithm;

    /**
     * The usages allowed for this key.
     */
    readonly usages: ReadonlyArray<KeyUsage>;
  }

  /**
   * CryptoKey constructor (keys cannot be constructed directly).
   */
  const CryptoKey: {
    prototype: CryptoKey;
  };

  /**
   * SubtleCrypto interface for cryptographic operations.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
   */
  interface SubtleCrypto {
    /**
     * Generate a digest (hash) of the given data.
     *
     * @param algorithm - Hash algorithm (e.g., "SHA-256", "SHA-384", "SHA-512")
     * @param data - Data to hash
     * @returns Promise resolving to the hash as ArrayBuffer
     */
    digest(
      algorithm: AlgorithmIdentifier,
      data: BufferSource
    ): Promise<ArrayBuffer>;

    /**
     * Generate a new cryptographic key or key pair.
     *
     * @param algorithm - Key generation algorithm
     * @param extractable - Whether the key can be exported
     * @param keyUsages - Allowed key usages
     * @returns Promise resolving to a CryptoKey or CryptoKeyPair
     */
    generateKey(
      algorithm: RsaHashedKeyGenParams | EcKeyGenParams | AesKeyGenParams | HmacKeyGenParams,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKey | CryptoKeyPair>;

    /**
     * Sign data using a private key.
     *
     * @param algorithm - Signing algorithm
     * @param key - Private key to sign with
     * @param data - Data to sign
     * @returns Promise resolving to the signature as ArrayBuffer
     */
    sign(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      data: BufferSource
    ): Promise<ArrayBuffer>;

    /**
     * Verify a signature.
     *
     * @param algorithm - Signing algorithm
     * @param key - Public key to verify with
     * @param signature - Signature to verify
     * @param data - Data that was signed
     * @returns Promise resolving to true if valid, false otherwise
     */
    verify(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      signature: BufferSource,
      data: BufferSource
    ): Promise<boolean>;

    /**
     * Encrypt data.
     *
     * @param algorithm - Encryption algorithm
     * @param key - Encryption key
     * @param data - Data to encrypt
     * @returns Promise resolving to encrypted data as ArrayBuffer
     */
    encrypt(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      data: BufferSource
    ): Promise<ArrayBuffer>;

    /**
     * Decrypt data.
     *
     * @param algorithm - Decryption algorithm
     * @param key - Decryption key
     * @param data - Data to decrypt
     * @returns Promise resolving to decrypted data as ArrayBuffer
     */
    decrypt(
      algorithm: AlgorithmIdentifier,
      key: CryptoKey,
      data: BufferSource
    ): Promise<ArrayBuffer>;

    /**
     * Import a key from external data.
     *
     * @param format - Key format ("raw", "pkcs8", "spki", "jwk")
     * @param keyData - Key data
     * @param algorithm - Key algorithm
     * @param extractable - Whether the key can be exported
     * @param keyUsages - Allowed key usages
     * @returns Promise resolving to a CryptoKey
     */
    importKey(
      format: "raw" | "pkcs8" | "spki" | "jwk",
      keyData: BufferSource | JsonWebKey,
      algorithm: AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKey>;

    /**
     * Export a key.
     *
     * @param format - Export format ("raw", "pkcs8", "spki", "jwk")
     * @param key - Key to export
     * @returns Promise resolving to ArrayBuffer or JsonWebKey
     */
    exportKey(
      format: "raw" | "pkcs8" | "spki" | "jwk",
      key: CryptoKey
    ): Promise<ArrayBuffer | JsonWebKey>;

    /**
     * Derive bits from a key.
     *
     * @param algorithm - Derivation algorithm
     * @param baseKey - Base key for derivation
     * @param length - Number of bits to derive
     * @returns Promise resolving to derived bits as ArrayBuffer
     */
    deriveBits(
      algorithm: AlgorithmIdentifier,
      baseKey: CryptoKey,
      length: number
    ): Promise<ArrayBuffer>;

    /**
     * Derive a new key from a base key.
     *
     * @param algorithm - Derivation algorithm
     * @param baseKey - Base key for derivation
     * @param derivedKeyType - Type of key to derive
     * @param extractable - Whether the derived key can be exported
     * @param keyUsages - Allowed usages for derived key
     * @returns Promise resolving to a CryptoKey
     */
    deriveKey(
      algorithm: AlgorithmIdentifier,
      baseKey: CryptoKey,
      derivedKeyType: AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKey>;

    /**
     * Wrap a key for secure export.
     *
     * @param format - Key format
     * @param key - Key to wrap
     * @param wrappingKey - Key to wrap with
     * @param wrapAlgorithm - Wrapping algorithm
     * @returns Promise resolving to wrapped key as ArrayBuffer
     */
    wrapKey(
      format: "raw" | "pkcs8" | "spki" | "jwk",
      key: CryptoKey,
      wrappingKey: CryptoKey,
      wrapAlgorithm: AlgorithmIdentifier
    ): Promise<ArrayBuffer>;

    /**
     * Unwrap a wrapped key.
     *
     * @param format - Key format
     * @param wrappedKey - Wrapped key data
     * @param unwrappingKey - Key to unwrap with
     * @param unwrapAlgorithm - Unwrapping algorithm
     * @param unwrappedKeyAlgorithm - Algorithm for the unwrapped key
     * @param extractable - Whether the unwrapped key can be exported
     * @param keyUsages - Allowed usages for unwrapped key
     * @returns Promise resolving to a CryptoKey
     */
    unwrapKey(
      format: "raw" | "pkcs8" | "spki" | "jwk",
      wrappedKey: BufferSource,
      unwrappingKey: CryptoKey,
      unwrapAlgorithm: AlgorithmIdentifier,
      unwrappedKeyAlgorithm: AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[]
    ): Promise<CryptoKey>;
  }

  /**
   * Crypto interface providing cryptographic functionality.
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Crypto
   */
  interface Crypto {
    /**
     * SubtleCrypto interface for cryptographic operations.
     */
    readonly subtle: SubtleCrypto;

    /**
     * Fill a TypedArray with cryptographically random values.
     *
     * @param array - TypedArray to fill (max 65536 bytes)
     * @returns The same array, filled with random values
     *
     * @example
     * const arr = new Uint8Array(16);
     * crypto.getRandomValues(arr);
     */
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;

    /**
     * Generate a random UUID v4.
     *
     * @returns A random UUID string
     *
     * @example
     * const uuid = crypto.randomUUID();
     * // "550e8400-e29b-41d4-a716-446655440000"
     */
    randomUUID(): string;
  }

  /**
   * Crypto object providing cryptographic functionality.
   */
  const crypto: Crypto;
}
`;

/**
 * Type definitions for @ricsam/isolate-path globals.
 *
 * Includes: path.join, path.normalize, path.basename, path.dirname, path.extname,
 *           path.isAbsolute, path.parse, path.format, path.resolve, path.relative,
 *           path.cwd, path.sep, path.delimiter
 */
export const PATH_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-path
 *
 * These types define the globals injected by setupPath() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * // Typecheck isolate code with path operations
 * const joined = path.join('/foo', 'bar', 'baz');
 * const resolved = path.resolve('relative/path');
 * const cwd = path.cwd();
 */

export {};

declare global {
  /**
   * Parsed path object returned by path.parse().
   */
  interface ParsedPath {
    /** The root of the path (e.g., "/" for absolute paths, "" for relative) */
    root: string;
    /** The directory portion of the path */
    dir: string;
    /** The file name including extension */
    base: string;
    /** The file extension (e.g., ".txt") */
    ext: string;
    /** The file name without extension */
    name: string;
  }

  /**
   * Input object for path.format().
   */
  interface FormatInputPathObject {
    root?: string;
    dir?: string;
    base?: string;
    ext?: string;
    name?: string;
  }

  /**
   * Path utilities for POSIX paths.
   * @see https://nodejs.org/api/path.html
   */
  namespace path {
    /**
     * Join path segments with the platform-specific separator.
     *
     * @param paths - Path segments to join
     * @returns The joined path, normalized
     *
     * @example
     * path.join('/foo', 'bar', 'baz'); // "/foo/bar/baz"
     * path.join('foo', 'bar', '..', 'baz'); // "foo/baz"
     */
    function join(...paths: string[]): string;

    /**
     * Normalize a path, resolving '..' and '.' segments.
     *
     * @param p - The path to normalize
     * @returns The normalized path
     *
     * @example
     * path.normalize('/foo/bar/../baz'); // "/foo/baz"
     * path.normalize('/foo//bar'); // "/foo/bar"
     */
    function normalize(p: string): string;

    /**
     * Get the last portion of a path (the file name).
     *
     * @param p - The path
     * @param ext - Optional extension to remove from the result
     * @returns The base name of the path
     *
     * @example
     * path.basename('/foo/bar/baz.txt'); // "baz.txt"
     * path.basename('/foo/bar/baz.txt', '.txt'); // "baz"
     */
    function basename(p: string, ext?: string): string;

    /**
     * Get the directory name of a path.
     *
     * @param p - The path
     * @returns The directory portion of the path
     *
     * @example
     * path.dirname('/foo/bar/baz.txt'); // "/foo/bar"
     * path.dirname('/foo'); // "/"
     */
    function dirname(p: string): string;

    /**
     * Get the extension of a path.
     *
     * @param p - The path
     * @returns The extension including the dot, or empty string
     *
     * @example
     * path.extname('file.txt'); // ".txt"
     * path.extname('file.tar.gz'); // ".gz"
     * path.extname('.bashrc'); // ""
     */
    function extname(p: string): string;

    /**
     * Check if a path is absolute.
     *
     * @param p - The path to check
     * @returns True if the path is absolute
     *
     * @example
     * path.isAbsolute('/foo/bar'); // true
     * path.isAbsolute('foo/bar'); // false
     */
    function isAbsolute(p: string): boolean;

    /**
     * Parse a path into its components.
     *
     * @param p - The path to parse
     * @returns An object with root, dir, base, ext, and name properties
     *
     * @example
     * path.parse('/foo/bar/baz.txt');
     * // { root: "/", dir: "/foo/bar", base: "baz.txt", ext: ".txt", name: "baz" }
     */
    function parse(p: string): ParsedPath;

    /**
     * Build a path from an object.
     *
     * @param pathObject - Object with path components
     * @returns The formatted path string
     *
     * @example
     * path.format({ dir: '/foo/bar', base: 'baz.txt' }); // "/foo/bar/baz.txt"
     * path.format({ root: '/', name: 'file', ext: '.txt' }); // "/file.txt"
     */
    function format(pathObject: FormatInputPathObject): string;

    /**
     * Resolve a sequence of paths to an absolute path.
     * Processes paths from right to left, prepending each until an absolute path is formed.
     * Uses the configured working directory for relative paths.
     *
     * @param paths - Path segments to resolve
     * @returns The resolved absolute path
     *
     * @example
     * // With cwd set to "/home/user"
     * path.resolve('foo/bar'); // "/home/user/foo/bar"
     * path.resolve('/foo', 'bar'); // "/foo/bar"
     * path.resolve('/foo', '/bar', 'baz'); // "/bar/baz"
     */
    function resolve(...paths: string[]): string;

    /**
     * Compute the relative path from one path to another.
     *
     * @param from - The source path
     * @param to - The destination path
     * @returns The relative path from 'from' to 'to'
     *
     * @example
     * path.relative('/foo/bar', '/foo/baz'); // "../baz"
     * path.relative('/foo', '/foo/bar/baz'); // "bar/baz"
     */
    function relative(from: string, to: string): string;

    /**
     * Get the configured working directory.
     *
     * @returns The current working directory
     *
     * @example
     * path.cwd(); // "/home/user" (or whatever was configured)
     */
    function cwd(): string;

    /**
     * The platform-specific path segment separator.
     * Always "/" for POSIX paths.
     */
    const sep: string;

    /**
     * The platform-specific path delimiter.
     * Always ":" for POSIX paths.
     */
    const delimiter: string;
  }
}
`;

/**
 * Type definitions for @ricsam/isolate-timers globals.
 *
 * Includes: setTimeout, setInterval, clearTimeout, clearInterval
 */
export const TIMERS_TYPES = `/**
 * Global Type Definitions for @ricsam/isolate-timers
 *
 * These types define the globals injected by setupTimers() into an isolated-vm context.
 * Use these types to typecheck user code that will run inside the V8 isolate.
 *
 * @example
 * const timeoutId = setTimeout(() => {
 *   console.log("fired!");
 * }, 1000);
 *
 * clearTimeout(timeoutId);
 *
 * const intervalId = setInterval(() => {
 *   console.log("tick");
 * }, 100);
 *
 * clearInterval(intervalId);
 */

export {};

declare global {
  /**
   * Schedule a callback to execute after a delay.
   *
   * @param callback - The function to call after the delay
   * @param ms - The delay in milliseconds (default: 0)
   * @param args - Additional arguments to pass to the callback
   * @returns A timer ID that can be passed to clearTimeout
   *
   * @example
   * const id = setTimeout(() => console.log("done"), 1000);
   * setTimeout((a, b) => console.log(a, b), 100, "hello", "world");
   */
  function setTimeout(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): number;

  /**
   * Schedule a callback to execute repeatedly at a fixed interval.
   *
   * @param callback - The function to call at each interval
   * @param ms - The interval in milliseconds (minimum: 4ms)
   * @param args - Additional arguments to pass to the callback
   * @returns A timer ID that can be passed to clearInterval
   *
   * @example
   * const id = setInterval(() => console.log("tick"), 1000);
   */
  function setInterval(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): number;

  /**
   * Cancel a timeout previously scheduled with setTimeout.
   *
   * @param id - The timer ID returned by setTimeout
   *
   * @example
   * const id = setTimeout(() => {}, 1000);
   * clearTimeout(id);
   */
  function clearTimeout(id: number | undefined): void;

  /**
   * Cancel an interval previously scheduled with setInterval.
   *
   * @param id - The timer ID returned by setInterval
   *
   * @example
   * const id = setInterval(() => {}, 1000);
   * clearInterval(id);
   */
  function clearInterval(id: number | undefined): void;
}
`;

/**
 * Map of package names to their type definitions.
 */
export const TYPE_DEFINITIONS = {
  core: CORE_TYPES,
  console: CONSOLE_TYPES,
  crypto: CRYPTO_TYPES,
  encoding: ENCODING_TYPES,
  fetch: FETCH_TYPES,
  fs: FS_TYPES,
  path: PATH_TYPES,
  testEnvironment: TEST_ENV_TYPES,
  timers: TIMERS_TYPES,
} as const;

/**
 * Type for the keys of TYPE_DEFINITIONS.
 */
export type TypeDefinitionKey = keyof typeof TYPE_DEFINITIONS;
