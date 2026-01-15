# @ricsam/isolate-path

Node.js-compatible path utilities for POSIX paths in isolated-vm V8 sandbox.

## Installation

```bash
npm add @ricsam/isolate-path
```

## Usage

```typescript
import { setupPath } from "@ricsam/isolate-path";

// Default: uses "/" as working directory
const handle = await setupPath(context);

// Custom working directory for path.resolve()
const handle = await setupPath(context, { cwd: "/home/user/project" });
```

## Options

- `cwd` - Current working directory for `path.resolve()`. Defaults to `"/"`.

## Injected Globals

- `path.join(...paths)` - Join path segments
- `path.resolve(...paths)` - Resolve to absolute path (uses configured `cwd` as base)
- `path.normalize(path)` - Normalize a path
- `path.basename(path, ext?)` - Get file name
- `path.dirname(path)` - Get directory name
- `path.extname(path)` - Get file extension
- `path.isAbsolute(path)` - Check if path is absolute
- `path.parse(path)` - Parse into components
- `path.format(obj)` - Format from components
- `path.relative(from, to)` - Get relative path
- `path.sep` - Path separator (`/`)
- `path.delimiter` - Path delimiter (`:`)
- `path.posix` - Alias to `path` (POSIX-only implementation)

## Usage in Isolate

```javascript
// Join paths
path.join('/foo', 'bar', 'baz'); // "/foo/bar/baz"
path.join('foo', 'bar', '..', 'baz'); // "foo/baz"

// Resolve to absolute (relative paths use configured cwd)
path.resolve('foo/bar'); // Uses cwd + "/foo/bar"
path.resolve('/foo', 'bar'); // "/foo/bar" (absolute paths ignore cwd)

// Parse and format
const parsed = path.parse('/foo/bar/baz.txt');
// { root: "/", dir: "/foo/bar", base: "baz.txt", ext: ".txt", name: "baz" }

path.format({ dir: '/foo/bar', base: 'baz.txt' }); // "/foo/bar/baz.txt"

// Other utilities
path.basename('/foo/bar/baz.txt'); // "baz.txt"
path.dirname('/foo/bar/baz.txt'); // "/foo/bar"
path.extname('file.tar.gz'); // ".gz"
path.isAbsolute('/foo'); // true
```

## License

MIT
