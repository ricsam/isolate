# @ricsam/isolate-fs

File System Access API (OPFS-compatible) for isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-fs
```

## Usage

```typescript
import { setupFs } from "@ricsam/isolate-fs";

const handle = await setupFs(context, {
  // Return a FileSystemHandler for the given directory path
  getDirectory: async (path) => {
    // Validate path access
    if (!path.startsWith("/allowed")) {
      throw new Error("Access denied");
    }
    return createNodeFileSystemHandler(`./sandbox${path}`);
  },
});
```

## Injected Globals

- `getDirectory(path)` - Entry point for file system access
- `FileSystemDirectoryHandle`, `FileSystemFileHandle`
- `FileSystemWritableFileStream`

## Usage in Isolate

```javascript
// Get directory handle
const root = await getDirectory("/data");

// Read a file
const fileHandle = await root.getFileHandle("config.json");
const file = await fileHandle.getFile();
const text = await file.text();
const config = JSON.parse(text);

// Write a file
const outputHandle = await root.getFileHandle("output.txt", { create: true });
const writable = await outputHandle.createWritable();
await writable.write("Hello, World!");
await writable.close();

// Directory operations
const subDir = await root.getDirectoryHandle("subdir", { create: true });
await root.removeEntry("old-file.txt");
await root.removeEntry("old-dir", { recursive: true });

// Iterate directory
for await (const [name, handle] of root.entries()) {
  console.log(name, handle.kind); // "file" or "directory"
}
```

## License

MIT
