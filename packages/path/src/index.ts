import type ivm from "isolated-vm";

export interface PathHandle {
  dispose(): void;
}

const pathCode = `
(function() {
  const sep = '/';
  const delimiter = ':';

  /**
   * Normalize a path by resolving '.' and '..' segments and removing redundant separators
   */
  function normalize(p) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    if (p.length === 0) {
      return '.';
    }

    const isAbsolutePath = p.charCodeAt(0) === 47; // '/'
    const trailingSlash = p.charCodeAt(p.length - 1) === 47; // '/'

    // Split by separator and filter empty segments
    const segments = p.split('/');
    const result = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Skip empty segments (from consecutive slashes) and '.'
      if (segment === '' || segment === '.') {
        continue;
      }

      if (segment === '..') {
        // For absolute paths, don't go above root
        // For relative paths, keep '..' if we can't go up further
        if (result.length > 0 && result[result.length - 1] !== '..') {
          result.pop();
        } else if (!isAbsolutePath) {
          result.push('..');
        }
      } else {
        result.push(segment);
      }
    }

    let normalized = result.join('/');

    if (isAbsolutePath) {
      normalized = '/' + normalized;
    }

    if (trailingSlash && normalized.length > 1 && !normalized.endsWith('/')) {
      normalized += '/';
    }

    if (!normalized) {
      return isAbsolutePath ? '/' : '.';
    }

    return normalized;
  }

  /**
   * Join path segments together and normalize the result
   */
  function join(...segments) {
    if (segments.length === 0) {
      return '.';
    }

    let joined = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (typeof segment !== 'string') {
        throw new TypeError('Path must be a string. Received ' + typeof segment);
      }
      if (segment.length > 0) {
        if (joined.length === 0) {
          joined = segment;
        } else {
          joined += '/' + segment;
        }
      }
    }

    if (joined.length === 0) {
      return '.';
    }

    return normalize(joined);
  }

  /**
   * Get the directory name of a path
   */
  function dirname(p) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    if (p.length === 0) {
      return '.';
    }

    const isAbsolutePath = p.charCodeAt(0) === 47;
    let end = -1;
    let matchedSlash = true;

    for (let i = p.length - 1; i >= 1; i--) {
      if (p.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        matchedSlash = false;
      }
    }

    if (end === -1) {
      return isAbsolutePath ? '/' : '.';
    }

    if (isAbsolutePath && end === 1) {
      return '/';
    }

    return p.slice(0, end);
  }

  /**
   * Get the last portion of a path, optionally removing a suffix
   */
  function basename(p, ext) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    if (ext !== undefined && typeof ext !== 'string') {
      throw new TypeError('ext must be a string');
    }

    let start = 0;
    let end = -1;
    let matchedSlash = true;

    for (let i = p.length - 1; i >= 0; i--) {
      if (p.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (matchedSlash) {
          end = i + 1;
          matchedSlash = false;
        }
      }
    }

    if (end === -1) {
      return '';
    }

    const base = p.slice(start, end);

    if (ext !== undefined && base.endsWith(ext)) {
      return base.slice(0, base.length - ext.length);
    }

    return base;
  }

  /**
   * Get the extension of a path
   */
  function extname(p) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let preDotState = 0;

    for (let i = p.length - 1; i >= 0; i--) {
      const code = p.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }

      if (end === -1) {
        matchedSlash = false;
        end = i + 1;
      }

      if (code === 46) { // '.'
        if (startDot === -1) {
          startDot = i;
        } else if (preDotState !== 1) {
          preDotState = 1;
        }
      } else if (startDot !== -1) {
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
        preDotState === 0 ||
        (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) {
      return '';
    }

    return p.slice(startDot, end);
  }

  /**
   * Check if a path is absolute
   */
  function isAbsolute(p) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    return p.length > 0 && p.charCodeAt(0) === 47;
  }

  /**
   * Resolve a sequence of paths to an absolute path
   */
  function resolve(...segments) {
    let resolvedPath = '';
    let resolvedAbsolute = false;

    for (let i = segments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      let path;
      if (i >= 0) {
        path = segments[i];
        if (typeof path !== 'string') {
          throw new TypeError('Path must be a string. Received ' + typeof path);
        }
      } else {
        // Use '/' as the cwd since we don't have access to actual cwd in isolate
        path = '/';
      }

      if (path.length === 0) {
        continue;
      }

      if (resolvedPath.length > 0) {
        resolvedPath = path + '/' + resolvedPath;
      } else {
        resolvedPath = path;
      }
      resolvedAbsolute = path.charCodeAt(0) === 47;
    }

    resolvedPath = normalize(resolvedPath);

    // Remove trailing slash unless it's just root
    if (resolvedPath.length > 1 && resolvedPath.endsWith('/')) {
      resolvedPath = resolvedPath.slice(0, -1);
    }

    if (resolvedAbsolute) {
      return resolvedPath.length > 0 ? resolvedPath : '/';
    }

    return resolvedPath.length > 0 ? resolvedPath : '.';
  }

  /**
   * Get the relative path from 'from' to 'to'
   */
  function relative(from, to) {
    if (typeof from !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof from);
    }
    if (typeof to !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof to);
    }

    if (from === to) {
      return '';
    }

    from = resolve(from);
    to = resolve(to);

    if (from === to) {
      return '';
    }

    const fromParts = from.split('/').filter(Boolean);
    const toParts = to.split('/').filter(Boolean);

    // Find common prefix
    let commonLength = 0;
    const minLength = Math.min(fromParts.length, toParts.length);
    for (let i = 0; i < minLength; i++) {
      if (fromParts[i] !== toParts[i]) {
        break;
      }
      commonLength++;
    }

    // Build relative path
    const upCount = fromParts.length - commonLength;
    const result = [];

    for (let i = 0; i < upCount; i++) {
      result.push('..');
    }

    for (let i = commonLength; i < toParts.length; i++) {
      result.push(toParts[i]);
    }

    return result.join('/');
  }

  /**
   * Parse a path into its components
   */
  function parse(p) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string. Received ' + typeof p);
    }

    const ret = { root: '', dir: '', base: '', ext: '', name: '' };

    if (p.length === 0) {
      return ret;
    }

    const isAbsolutePath = p.charCodeAt(0) === 47;
    if (isAbsolutePath) {
      ret.root = '/';
    }

    let start = isAbsolutePath ? 1 : 0;
    let end = -1;
    let matchedSlash = true;
    let startDot = -1;
    let preDotState = 0;

    // Get base and dir
    for (let i = p.length - 1; i >= start; i--) {
      const code = p.charCodeAt(i);
      if (code === 47) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (matchedSlash) {
          end = i + 1;
          matchedSlash = false;
        }

        if (code === 46) { // '.'
          if (startDot === -1) {
            startDot = i;
          } else if (preDotState !== 1) {
            preDotState = 1;
          }
        } else if (startDot !== -1) {
          preDotState = -1;
        }
      }
    }

    if (end !== -1) {
      ret.base = p.slice(start, end);

      // Determine extension
      if (startDot !== -1 && startDot >= start &&
          preDotState !== 0 &&
          !(preDotState === 1 && startDot === end - 1 && startDot === start + 1)) {
        ret.ext = p.slice(startDot, end);
        ret.name = p.slice(start, startDot);
      } else {
        ret.name = ret.base;
      }
    }

    if (start > (isAbsolutePath ? 1 : 0)) {
      ret.dir = p.slice(0, start - 1);
    } else if (isAbsolutePath) {
      ret.dir = '/';
    }

    return ret;
  }

  /**
   * Format a path object into a path string
   */
  function format(pathObject) {
    if (pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError("Parameter 'pathObject' must be an object, not " + typeof pathObject);
    }

    const dir = pathObject.dir || pathObject.root || '';
    const base = pathObject.base ||
      ((pathObject.name || '') + (pathObject.ext || ''));

    if (!dir) {
      return base;
    }

    if (dir === pathObject.root) {
      return dir + base;
    }

    return dir + '/' + base;
  }

  // Create path object with posix namespace (for compatibility)
  const pathModule = {
    sep,
    delimiter,
    normalize,
    join,
    dirname,
    basename,
    extname,
    isAbsolute,
    resolve,
    relative,
    parse,
    format,
  };

  // posix is the same as the main module since we only support POSIX
  pathModule.posix = pathModule;

  globalThis.path = pathModule;
})();
`;

/**
 * Setup path utilities in an isolated-vm context
 *
 * Provides path manipulation utilities similar to Node.js path module
 * Uses POSIX-style paths only (always uses '/' as separator)
 *
 * @example
 * const handle = await setupPath(context);
 * await context.eval(\`
 *   const joined = path.join("/foo", "bar", "baz");
 *   const dir = path.dirname("/foo/bar/baz.txt");
 * \`);
 */
export async function setupPath(context: ivm.Context): Promise<PathHandle> {
  context.evalSync(pathCode);
  return {
    dispose() {
      // No resources to cleanup for pure JS injection
    },
  };
}
