import ivm from "isolated-vm";
import { setupCore, clearAllInstanceState } from "@ricsam/isolate-core";

export { clearAllInstanceState };

// ============================================================================
// FileSystemHandler Interface
// ============================================================================

export interface FileSystemHandler {
  /** Get or create a file handle at the given path */
  getFileHandle(
    path: string,
    options?: { create?: boolean }
  ): Promise<void>;

  /** Get or create a directory handle at the given path */
  getDirectoryHandle(
    path: string,
    options?: { create?: boolean }
  ): Promise<void>;

  /** Remove a file or directory at the given path */
  removeEntry(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<void>;

  /** List contents of a directory */
  readDirectory(
    path: string
  ): Promise<Array<{ name: string; kind: "file" | "directory" }>>;

  /** Read file content */
  readFile(
    path: string
  ): Promise<{ data: Uint8Array; size: number; lastModified: number; type: string }>;

  /** Write data to a file */
  writeFile(
    path: string,
    data: Uint8Array,
    position?: number
  ): Promise<void>;

  /** Truncate a file to a specific size */
  truncateFile(path: string, size: number): Promise<void>;

  /** Get file metadata without reading content */
  getFileMetadata(
    path: string
  ): Promise<{ size: number; lastModified: number; type: string }>;
}

export interface FsOptions {
  /** Get a file system handler for the given path */
  getDirectory(path: string): Promise<FileSystemHandler>;
}

export interface FsHandle {
  dispose(): void;
}

// ============================================================================
// Instance State Management
// ============================================================================

const instanceStateMap = new WeakMap<ivm.Context, Map<number, unknown>>();
let nextInstanceId = 1;

function getInstanceStateMapForContext(
  context: ivm.Context
): Map<number, unknown> {
  let map = instanceStateMap.get(context);
  if (!map) {
    map = new Map();
    instanceStateMap.set(context, map);
  }
  return map;
}

// ============================================================================
// State Types
// ============================================================================

interface DirectoryHandleState {
  instanceId: number;
  path: string; // Path within handler's root, e.g., "/" or "/subdir"
  name: string; // Directory name, e.g., "" for root or "subdir"
  handler: FileSystemHandler; // Handler for this directory tree
}

interface FileHandleState {
  instanceId: number;
  path: string; // Path within handler's root, e.g., "/file.txt"
  name: string; // File name, e.g., "file.txt"
  handler: FileSystemHandler; // Handler for this file
}

interface WritableStreamState {
  instanceId: number;
  filePath: string; // Path to the file being written
  position: number; // Current write position (for seek)
  buffer: Uint8Array[]; // Buffered writes before close
  closed: boolean; // Whether stream has been closed
  handler: FileSystemHandler; // Handler for this stream
}

// ============================================================================
// FileSystemDirectoryHandle Implementation
// ============================================================================

function setupFileSystemDirectoryHandle(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): void {
  const global = context.global;

  // Property getters
  global.setSync(
    "__FileSystemDirectoryHandle_get_name",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      return state?.name ?? "";
    })
  );

  global.setSync(
    "__FileSystemDirectoryHandle_get_path",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      return state?.path ?? "/";
    })
  );

  // getFileHandle - async reference
  const getFileHandleRef = new ivm.Reference(
    async (instanceId: number, name: string, optionsJson: string) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      if (!state) {
        throw new Error("[NotFoundError]Directory handle not found");
      }

      const options = JSON.parse(optionsJson) as { create?: boolean };
      const childPath = state.path === "/" ? `/${name}` : `${state.path}/${name}`;

      try {
        await state.handler.getFileHandle(childPath, options);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(err.message);
        }
        throw err;
      }

      // Create file handle state with parent's handler
      const fileInstanceId = nextInstanceId++;
      const fileState: FileHandleState = {
        instanceId: fileInstanceId,
        path: childPath,
        name,
        handler: state.handler,
      };
      stateMap.set(fileInstanceId, fileState);

      return JSON.stringify({ instanceId: fileInstanceId });
    }
  );
  global.setSync("__FileSystemDirectoryHandle_getFileHandle_ref", getFileHandleRef);

  // getDirectoryHandle - async reference
  const getDirectoryHandleRef = new ivm.Reference(
    async (instanceId: number, name: string, optionsJson: string) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      if (!state) {
        throw new Error("[NotFoundError]Directory handle not found");
      }

      const options = JSON.parse(optionsJson) as { create?: boolean };
      const childPath = state.path === "/" ? `/${name}` : `${state.path}/${name}`;

      try {
        await state.handler.getDirectoryHandle(childPath, options);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(err.message);
        }
        throw err;
      }

      // Create directory handle state with parent's handler
      const dirInstanceId = nextInstanceId++;
      const dirState: DirectoryHandleState = {
        instanceId: dirInstanceId,
        path: childPath,
        name,
        handler: state.handler,
      };
      stateMap.set(dirInstanceId, dirState);

      return JSON.stringify({ instanceId: dirInstanceId });
    }
  );
  global.setSync("__FileSystemDirectoryHandle_getDirectoryHandle_ref", getDirectoryHandleRef);

  // removeEntry - async reference
  const removeEntryRef = new ivm.Reference(
    async (instanceId: number, name: string, optionsJson: string) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      if (!state) {
        throw new Error("[NotFoundError]Directory handle not found");
      }

      const options = JSON.parse(optionsJson) as { recursive?: boolean };
      const childPath = state.path === "/" ? `/${name}` : `${state.path}/${name}`;

      try {
        await state.handler.removeEntry(childPath, options);
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(err.message);
        }
        throw err;
      }
    }
  );
  global.setSync("__FileSystemDirectoryHandle_removeEntry_ref", removeEntryRef);

  // readDirectory - async reference (for entries/keys/values)
  const readDirectoryRef = new ivm.Reference(async (instanceId: number) => {
    const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
    if (!state) {
      throw new Error("[NotFoundError]Directory handle not found");
    }

    try {
      const entries = await state.handler.readDirectory(state.path);

      // Create handle states for each entry and return with instance IDs
      const result = entries.map((entry) => {
        const entryId = nextInstanceId++;
        const entryPath = state.path === "/" ? `/${entry.name}` : `${state.path}/${entry.name}`;

        if (entry.kind === "file") {
          const fileState: FileHandleState = {
            instanceId: entryId,
            path: entryPath,
            name: entry.name,
            handler: state.handler,
          };
          stateMap.set(entryId, fileState);
        } else {
          const dirState: DirectoryHandleState = {
            instanceId: entryId,
            path: entryPath,
            name: entry.name,
            handler: state.handler,
          };
          stateMap.set(entryId, dirState);
        }

        return {
          name: entry.name,
          kind: entry.kind,
          instanceId: entryId,
        };
      });

      return JSON.stringify(result);
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(err.message);
      }
      throw err;
    }
  });
  global.setSync("__FileSystemDirectoryHandle_readDirectory_ref", readDirectoryRef);

  // isSameEntry - sync callback
  global.setSync(
    "__FileSystemDirectoryHandle_isSameEntry",
    new ivm.Callback((id1: number, id2: number) => {
      const state1 = stateMap.get(id1) as DirectoryHandleState | undefined;
      const state2 = stateMap.get(id2) as DirectoryHandleState | undefined;
      if (!state1 || !state2) return false;
      return state1.path === state2.path;
    })
  );

  // resolve - async reference
  const resolveRef = new ivm.Reference(
    async (instanceId: number, descendantId: number) => {
      const state = stateMap.get(instanceId) as DirectoryHandleState | undefined;
      const descendantState = stateMap.get(descendantId) as
        | DirectoryHandleState
        | FileHandleState
        | undefined;

      if (!state || !descendantState) {
        return "null";
      }

      // Check if descendant is actually a descendant
      const basePath = state.path === "/" ? "" : state.path;
      if (!descendantState.path.startsWith(basePath + "/") && descendantState.path !== state.path) {
        return "null";
      }

      // Build path components
      const relativePath = descendantState.path.slice(basePath.length);
      const components = relativePath.split("/").filter((c) => c.length > 0);

      return JSON.stringify(components);
    }
  );
  global.setSync("__FileSystemDirectoryHandle_resolve_ref", resolveRef);

  // Inject FileSystemDirectoryHandle class
  const directoryHandleCode = `
(function() {
  const _directoryHandleInstanceIds = new WeakMap();

  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|NotFoundError|TypeMismatchError|InvalidModificationError|Error)\\](.*)$/);
    if (match) {
      if (['NotFoundError', 'TypeMismatchError', 'InvalidModificationError'].includes(match[1])) {
        return new DOMException(match[2], match[1]);
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  class FileSystemDirectoryHandle {
    constructor(path, name) {
      // Internal construction from instance ID
      if (typeof path === 'number' && name === null) {
        _directoryHandleInstanceIds.set(this, path);
        return;
      }
      const instanceId = __FileSystemDirectoryHandle_construct(path, name);
      _directoryHandleInstanceIds.set(this, instanceId);
    }

    static _fromInstanceId(instanceId) {
      return new FileSystemDirectoryHandle(instanceId, null);
    }

    _getInstanceId() {
      return _directoryHandleInstanceIds.get(this);
    }

    get kind() {
      return 'directory';
    }

    get name() {
      return __FileSystemDirectoryHandle_get_name(this._getInstanceId());
    }

    getFileHandle(name, options = {}) {
      try {
        const resultJson = __FileSystemDirectoryHandle_getFileHandle_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), name, JSON.stringify(options)]
        );
        const result = JSON.parse(resultJson);
        return FileSystemFileHandle._fromInstanceId(result.instanceId);
      } catch (err) {
        throw __decodeError(err);
      }
    }

    getDirectoryHandle(name, options = {}) {
      try {
        const resultJson = __FileSystemDirectoryHandle_getDirectoryHandle_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), name, JSON.stringify(options)]
        );
        const result = JSON.parse(resultJson);
        return FileSystemDirectoryHandle._fromInstanceId(result.instanceId);
      } catch (err) {
        throw __decodeError(err);
      }
    }

    removeEntry(name, options = {}) {
      try {
        __FileSystemDirectoryHandle_removeEntry_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), name, JSON.stringify(options)]
        );
      } catch (err) {
        throw __decodeError(err);
      }
    }

    async *entries() {
      let entriesJson;
      try {
        entriesJson = __FileSystemDirectoryHandle_readDirectory_ref.applySyncPromise(
          undefined,
          [this._getInstanceId()]
        );
      } catch (err) {
        throw __decodeError(err);
      }
      const entries = JSON.parse(entriesJson);
      for (const entry of entries) {
        if (entry.kind === 'file') {
          yield [entry.name, FileSystemFileHandle._fromInstanceId(entry.instanceId)];
        } else {
          yield [entry.name, FileSystemDirectoryHandle._fromInstanceId(entry.instanceId)];
        }
      }
    }

    async *keys() {
      for await (const [name] of this.entries()) {
        yield name;
      }
    }

    async *values() {
      for await (const [, handle] of this.entries()) {
        yield handle;
      }
    }

    [Symbol.asyncIterator]() {
      return this.entries();
    }

    isSameEntry(other) {
      if (!(other instanceof FileSystemDirectoryHandle)) {
        return false;
      }
      return __FileSystemDirectoryHandle_isSameEntry(
        this._getInstanceId(),
        other._getInstanceId()
      );
    }

    resolve(possibleDescendant) {
      try {
        const resultJson = __FileSystemDirectoryHandle_resolve_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), possibleDescendant._getInstanceId()]
        );
        return resultJson === 'null' ? null : JSON.parse(resultJson);
      } catch (err) {
        throw __decodeError(err);
      }
    }
  }

  globalThis.FileSystemDirectoryHandle = FileSystemDirectoryHandle;
})();
`;

  context.evalSync(directoryHandleCode);
}

// ============================================================================
// FileSystemFileHandle Implementation
// ============================================================================

function setupFileSystemFileHandle(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): void {
  const global = context.global;

  // Property getters
  global.setSync(
    "__FileSystemFileHandle_get_name",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as FileHandleState | undefined;
      return state?.name ?? "";
    })
  );

  global.setSync(
    "__FileSystemFileHandle_get_path",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as FileHandleState | undefined;
      return state?.path ?? "";
    })
  );

  // getFile - async reference
  const getFileRef = new ivm.Reference(async (instanceId: number) => {
    const state = stateMap.get(instanceId) as FileHandleState | undefined;
    if (!state) {
      throw new Error("[NotFoundError]File handle not found");
    }

    try {
      const fileData = await state.handler.readFile(state.path);
      return JSON.stringify({
        name: state.name,
        data: Array.from(fileData.data),
        size: fileData.size,
        lastModified: fileData.lastModified,
        type: fileData.type,
      });
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(err.message);
      }
      throw err;
    }
  });
  global.setSync("__FileSystemFileHandle_getFile_ref", getFileRef);

  // createWritable - async reference
  const createWritableRef = new ivm.Reference(
    async (instanceId: number, _optionsJson: string) => {
      const state = stateMap.get(instanceId) as FileHandleState | undefined;
      if (!state) {
        throw new Error("[NotFoundError]File handle not found");
      }

      // Create writable stream state with handler reference
      const streamInstanceId = nextInstanceId++;
      const streamState: WritableStreamState = {
        instanceId: streamInstanceId,
        filePath: state.path,
        position: 0,
        buffer: [],
        closed: false,
        handler: state.handler,
      };
      stateMap.set(streamInstanceId, streamState);

      return streamInstanceId;
    }
  );
  global.setSync("__FileSystemFileHandle_createWritable_ref", createWritableRef);

  // isSameEntry - sync callback
  global.setSync(
    "__FileSystemFileHandle_isSameEntry",
    new ivm.Callback((id1: number, id2: number) => {
      const state1 = stateMap.get(id1) as FileHandleState | undefined;
      const state2 = stateMap.get(id2) as FileHandleState | undefined;
      if (!state1 || !state2) return false;
      return state1.path === state2.path;
    })
  );

  // Inject FileSystemFileHandle class
  const fileHandleCode = `
(function() {
  const _fileHandleInstanceIds = new WeakMap();

  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|NotFoundError|TypeMismatchError|InvalidModificationError|Error)\\](.*)$/);
    if (match) {
      if (['NotFoundError', 'TypeMismatchError', 'InvalidModificationError'].includes(match[1])) {
        return new DOMException(match[2], match[1]);
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  class FileSystemFileHandle {
    constructor(path, name) {
      // Internal construction from instance ID
      if (typeof path === 'number' && name === null) {
        _fileHandleInstanceIds.set(this, path);
        return;
      }
      const instanceId = __FileSystemFileHandle_construct(path, name);
      _fileHandleInstanceIds.set(this, instanceId);
    }

    static _fromInstanceId(instanceId) {
      return new FileSystemFileHandle(instanceId, null);
    }

    _getInstanceId() {
      return _fileHandleInstanceIds.get(this);
    }

    get kind() {
      return 'file';
    }

    get name() {
      return __FileSystemFileHandle_get_name(this._getInstanceId());
    }

    getFile() {
      try {
        const metadataJson = __FileSystemFileHandle_getFile_ref.applySyncPromise(
          undefined,
          [this._getInstanceId()]
        );
        const metadata = JSON.parse(metadataJson);
        // Create File object from metadata and content
        const content = new Uint8Array(metadata.data);
        return new File([content], metadata.name, {
          type: metadata.type,
          lastModified: metadata.lastModified
        });
      } catch (err) {
        throw __decodeError(err);
      }
    }

    createWritable(options = {}) {
      try {
        const streamId = __FileSystemFileHandle_createWritable_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), JSON.stringify(options)]
        );
        return FileSystemWritableFileStream._fromInstanceId(streamId);
      } catch (err) {
        throw __decodeError(err);
      }
    }

    isSameEntry(other) {
      if (!(other instanceof FileSystemFileHandle)) {
        return false;
      }
      return __FileSystemFileHandle_isSameEntry(
        this._getInstanceId(),
        other._getInstanceId()
      );
    }
  }

  globalThis.FileSystemFileHandle = FileSystemFileHandle;
})();
`;

  context.evalSync(fileHandleCode);
}

// ============================================================================
// FileSystemWritableFileStream Implementation
// ============================================================================

function setupFileSystemWritableFileStream(
  context: ivm.Context,
  stateMap: Map<number, unknown>
): void {
  const global = context.global;

  // write - async reference
  const writeRef = new ivm.Reference(
    async (instanceId: number, bytesJson: string, position: number | null) => {
      const state = stateMap.get(instanceId) as WritableStreamState | undefined;
      if (!state) {
        throw new Error("[InvalidStateError]Stream not found");
      }
      if (state.closed) {
        throw new Error("[InvalidStateError]Stream is closed");
      }

      const bytes = JSON.parse(bytesJson) as number[];
      const data = new Uint8Array(bytes);

      // Update position if specified
      if (position !== null) {
        state.position = position;
      }

      // Write to handler
      try {
        await state.handler.writeFile(state.filePath, data, state.position);
        state.position += data.length;
      } catch (err) {
        if (err instanceof Error) {
          throw new Error(err.message);
        }
        throw err;
      }
    }
  );
  global.setSync("__FileSystemWritableFileStream_write_ref", writeRef);

  // seek - sync callback
  global.setSync(
    "__FileSystemWritableFileStream_seek",
    new ivm.Callback((instanceId: number, position: number) => {
      const state = stateMap.get(instanceId) as WritableStreamState | undefined;
      if (!state) {
        throw new Error("[InvalidStateError]Stream not found");
      }
      if (state.closed) {
        throw new Error("[InvalidStateError]Stream is closed");
      }
      state.position = position;
    })
  );

  // truncate - async reference
  const truncateRef = new ivm.Reference(async (instanceId: number, size: number) => {
    const state = stateMap.get(instanceId) as WritableStreamState | undefined;
    if (!state) {
      throw new Error("[InvalidStateError]Stream not found");
    }
    if (state.closed) {
      throw new Error("[InvalidStateError]Stream is closed");
    }

    try {
      await state.handler.truncateFile(state.filePath, size);
      // Adjust position if it's beyond the new size
      if (state.position > size) {
        state.position = size;
      }
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(err.message);
      }
      throw err;
    }
  });
  global.setSync("__FileSystemWritableFileStream_truncate_ref", truncateRef);

  // close - async reference
  const closeRef = new ivm.Reference(async (instanceId: number) => {
    const state = stateMap.get(instanceId) as WritableStreamState | undefined;
    if (!state) {
      throw new Error("[InvalidStateError]Stream not found");
    }
    if (state.closed) {
      throw new Error("[InvalidStateError]Stream is already closed");
    }

    state.closed = true;
  });
  global.setSync("__FileSystemWritableFileStream_close_ref", closeRef);

  // abort - async reference
  const abortRef = new ivm.Reference(async (instanceId: number, _reason: string | null) => {
    const state = stateMap.get(instanceId) as WritableStreamState | undefined;
    if (!state) {
      throw new Error("[InvalidStateError]Stream not found");
    }

    state.closed = true;
    state.buffer = []; // Discard any buffered data
  });
  global.setSync("__FileSystemWritableFileStream_abort_ref", abortRef);

  // locked - sync callback
  global.setSync(
    "__FileSystemWritableFileStream_get_locked",
    new ivm.Callback((instanceId: number) => {
      const state = stateMap.get(instanceId) as WritableStreamState | undefined;
      return state ? !state.closed : false;
    })
  );

  // Inject FileSystemWritableFileStream class
  const writableStreamCode = `
(function() {
  const _writableStreamInstanceIds = new WeakMap();

  function __decodeError(err) {
    if (!(err instanceof Error)) return err;
    const match = err.message.match(/^\\[(TypeError|RangeError|InvalidStateError|NotFoundError|Error)\\](.*)$/);
    if (match) {
      if (['InvalidStateError', 'NotFoundError'].includes(match[1])) {
        return new DOMException(match[2], match[1]);
      }
      const ErrorType = globalThis[match[1]] || Error;
      return new ErrorType(match[2]);
    }
    return err;
  }

  class FileSystemWritableFileStream {
    constructor(instanceId) {
      _writableStreamInstanceIds.set(this, instanceId);
    }

    static _fromInstanceId(instanceId) {
      return new FileSystemWritableFileStream(instanceId);
    }

    _getInstanceId() {
      return _writableStreamInstanceIds.get(this);
    }

    write(data) {
      try {
        // Handle different data types
        let writeData;
        let position = null;
        let type = 'write';

        if (data && typeof data === 'object' && !ArrayBuffer.isView(data) &&
            !(data instanceof Blob) && !(data instanceof ArrayBuffer) &&
            !Array.isArray(data) && typeof data.type === 'string') {
          // WriteParams object: { type, data, position, size }
          type = data.type || 'write';
          if (type === 'seek') {
            return this.seek(data.position);
          }
          if (type === 'truncate') {
            return this.truncate(data.size);
          }
          writeData = data.data;
          position = data.position ?? null;
        } else {
          writeData = data;
        }

        // Convert data to bytes array for transfer
        let bytes;
        if (typeof writeData === 'string') {
          bytes = Array.from(new TextEncoder().encode(writeData));
        } else if (writeData instanceof Blob) {
          // Synchronously get blob bytes - use the internal callback
          const blobText = writeData.text ? writeData.text() : '';
          bytes = Array.from(new TextEncoder().encode(blobText));
        } else if (writeData instanceof ArrayBuffer) {
          bytes = Array.from(new Uint8Array(writeData));
        } else if (ArrayBuffer.isView(writeData)) {
          bytes = Array.from(new Uint8Array(writeData.buffer, writeData.byteOffset, writeData.byteLength));
        } else if (Array.isArray(writeData)) {
          bytes = writeData;
        } else {
          throw new TypeError('Invalid data type for write');
        }

        __FileSystemWritableFileStream_write_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), JSON.stringify(bytes), position]
        );
      } catch (err) {
        throw __decodeError(err);
      }
    }

    seek(position) {
      try {
        __FileSystemWritableFileStream_seek(this._getInstanceId(), position);
      } catch (err) {
        throw __decodeError(err);
      }
    }

    truncate(size) {
      try {
        __FileSystemWritableFileStream_truncate_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), size]
        );
      } catch (err) {
        throw __decodeError(err);
      }
    }

    close() {
      try {
        __FileSystemWritableFileStream_close_ref.applySyncPromise(
          undefined,
          [this._getInstanceId()]
        );
      } catch (err) {
        throw __decodeError(err);
      }
    }

    abort(reason) {
      try {
        __FileSystemWritableFileStream_abort_ref.applySyncPromise(
          undefined,
          [this._getInstanceId(), reason ? String(reason) : null]
        );
      } catch (err) {
        throw __decodeError(err);
      }
    }

    get locked() {
      return __FileSystemWritableFileStream_get_locked(this._getInstanceId());
    }

    getWriter() {
      const stream = this;
      let released = false;
      let closedResolve;
      let closedReject;
      const closedPromise = new Promise((resolve, reject) => {
        closedResolve = resolve;
        closedReject = reject;
      });

      return {
        get closed() {
          return closedPromise;
        },
        get desiredSize() {
          return 1;
        },
        get ready() {
          return Promise.resolve();
        },
        write(chunk) {
          if (released) {
            return Promise.reject(new TypeError('Writer has been released'));
          }
          try {
            stream.write(chunk);
            return Promise.resolve();
          } catch (err) {
            return Promise.reject(err);
          }
        },
        close() {
          if (released) {
            return Promise.reject(new TypeError('Writer has been released'));
          }
          try {
            stream.close();
            closedResolve();
            return Promise.resolve();
          } catch (err) {
            closedReject(err);
            return Promise.reject(err);
          }
        },
        abort(reason) {
          if (released) {
            return Promise.reject(new TypeError('Writer has been released'));
          }
          try {
            stream.abort(reason);
            closedReject(reason || new Error('Stream aborted'));
            return Promise.resolve();
          } catch (err) {
            return Promise.reject(err);
          }
        },
        releaseLock() {
          released = true;
        }
      };
    }
  }

  globalThis.FileSystemWritableFileStream = FileSystemWritableFileStream;
})();
`;

  context.evalSync(writableStreamCode);
}

// ============================================================================
// Global getDirectory(path) Implementation
// ============================================================================

function setupGetDirectoryGlobal(
  context: ivm.Context,
  stateMap: Map<number, unknown>,
  options: FsOptions
): void {
  const global = context.global;

  // getDirectory - async reference that creates directory handle at specified path
  const getDirectoryRef = new ivm.Reference(async (path: string) => {
    // Get handler for this path from the options factory
    const handler = await options.getDirectory(path);

    const instanceId = nextInstanceId++;
    // Path is "/" since handler is rooted at the requested path
    const state: DirectoryHandleState = {
      instanceId,
      path: "/",
      name: path.split("/").filter(Boolean).pop() || "",
      handler,
    };
    stateMap.set(instanceId, state);
    return instanceId;
  });
  global.setSync("__getDirectory_ref", getDirectoryRef);

  // Inject global getDirectory (async)
  const getDirectoryCode = `
(function() {
  globalThis.getDirectory = async function(path) {
    const instanceId = await __getDirectory_ref.applySyncPromise(undefined, [path]);
    return FileSystemDirectoryHandle._fromInstanceId(instanceId);
  };
})();
`;
  context.evalSync(getDirectoryCode);
}

// ============================================================================
// Main Setup Function
// ============================================================================

/**
 * Setup File System Access API in an isolated-vm context
 *
 * Provides an OPFS-compatible FileSystemDirectoryHandle API
 *
 * @example
 * const handle = await setupFs(context, {
 *   getDirectory: async (path) => {
 *     // Return a FileSystemHandler rooted at the given path
 *     return createNodeFileSystemHandler(`./data${path}`);
 *   }
 * });
 *
 * await context.eval(`
 *   const root = await getDirectory("/uploads");
 *   const fileHandle = await root.getFileHandle("test.txt", { create: true });
 *   const writable = await fileHandle.createWritable();
 *   await writable.write("hello world");
 *   await writable.close();
 * `);
 */
export async function setupFs(
  context: ivm.Context,
  options: FsOptions
): Promise<FsHandle> {
  // Setup core APIs first (Blob, File, AbortController, Streams, etc.)
  await setupCore(context);

  const stateMap = getInstanceStateMapForContext(context);

  // Setup FileSystemDirectoryHandle
  setupFileSystemDirectoryHandle(context, stateMap);

  // Setup FileSystemFileHandle
  setupFileSystemFileHandle(context, stateMap);

  // Setup FileSystemWritableFileStream
  setupFileSystemWritableFileStream(context, stateMap);

  // Setup global getDirectory(path)
  setupGetDirectoryGlobal(context, stateMap, options);

  return {
    dispose() {
      // Clear state for this context
      stateMap.clear();
    },
  };
}

// Export node adapter
export { createNodeFileSystemHandler } from "./node-adapter.ts";
export type { NodeFileSystemHandlerOptions } from "./node-adapter.ts";
