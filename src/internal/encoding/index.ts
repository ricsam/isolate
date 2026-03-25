import type ivm from "isolated-vm";

export interface EncodingHandle {
  dispose(): void;
}

const encodingCode = `
(function() {
  // Define DOMException if not available
  if (typeof DOMException === 'undefined') {
    globalThis.DOMException = class DOMException extends Error {
      constructor(message, name) {
        super(message);
        this.name = name || 'DOMException';
      }
    };
  }

  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  // Build reverse lookup table
  const base64Lookup = new Map();
  for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup.set(base64Chars[i], i);
  }

  globalThis.btoa = function btoa(str) {
    if (str === undefined) {
      throw new TypeError("1 argument required, but only 0 present.");
    }

    str = String(str);

    // Check for characters outside Latin-1 range
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 255) {
        throw new DOMException(
          "The string to be encoded contains characters outside of the Latin1 range.",
          "InvalidCharacterError"
        );
      }
    }

    if (str.length === 0) {
      return '';
    }

    let result = '';
    let i = 0;

    while (i < str.length) {
      const a = str.charCodeAt(i++);
      const bExists = i < str.length;
      const b = bExists ? str.charCodeAt(i++) : 0;
      const cExists = i < str.length;
      const c = cExists ? str.charCodeAt(i++) : 0;

      const triplet = (a << 16) | (b << 8) | c;

      result += base64Chars[(triplet >> 18) & 0x3F];
      result += base64Chars[(triplet >> 12) & 0x3F];
      result += bExists ? base64Chars[(triplet >> 6) & 0x3F] : '=';
      result += cExists ? base64Chars[triplet & 0x3F] : '=';
    }

    return result;
  };

  globalThis.atob = function atob(str) {
    if (str === undefined) {
      throw new TypeError("1 argument required, but only 0 present.");
    }

    str = String(str);

    // Remove whitespace
    str = str.replace(/[\\t\\n\\f\\r ]/g, '');

    // Validate characters and length
    if (str.length === 0) {
      return '';
    }

    // Check for invalid characters (before padding normalization)
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c !== '=' && !base64Lookup.has(c)) {
        throw new DOMException(
          "The string to be decoded is not correctly encoded.",
          "InvalidCharacterError"
        );
      }
    }

    // Validate padding position (must be at end)
    const paddingIndex = str.indexOf('=');
    if (paddingIndex !== -1) {
      for (let i = paddingIndex; i < str.length; i++) {
        if (str[i] !== '=') {
          throw new DOMException(
            "The string to be decoded is not correctly encoded.",
            "InvalidCharacterError"
          );
        }
      }
      const paddingLength = str.length - paddingIndex;
      if (paddingLength > 2) {
        throw new DOMException(
          "The string to be decoded is not correctly encoded.",
          "InvalidCharacterError"
        );
      }
    }

    // Length without padding must be valid (can't have remainder of 1)
    const strWithoutPadding = str.replace(/=/g, '');
    if (strWithoutPadding.length % 4 === 1) {
      throw new DOMException(
        "The string to be decoded is not correctly encoded.",
        "InvalidCharacterError"
      );
    }

    // Pad to multiple of 4 if needed (for inputs without explicit padding)
    while (str.length % 4 !== 0) {
      str += '=';
    }

    let result = '';
    let i = 0;

    while (i < str.length) {
      const a = base64Lookup.get(str[i++]) ?? 0;
      const b = base64Lookup.get(str[i++]) ?? 0;
      const c = base64Lookup.get(str[i++]) ?? 0;
      const d = base64Lookup.get(str[i++]) ?? 0;

      const triplet = (a << 18) | (b << 12) | (c << 6) | d;

      result += String.fromCharCode((triplet >> 16) & 0xFF);
      if (str[i - 2] !== '=') {
        result += String.fromCharCode((triplet >> 8) & 0xFF);
      }
      if (str[i - 1] !== '=') {
        result += String.fromCharCode(triplet & 0xFF);
      }
    }

    return result;
  };

  // ============================================
  // Buffer implementation
  // ============================================

  const BUFFER_SYMBOL = Symbol.for('__isBuffer');

  class Buffer extends Uint8Array {
    constructor(arg, encodingOrOffset, length) {
      if (typeof arg === 'number') {
        super(arg);
      } else if (typeof arg === 'string') {
        const bytes = stringToBytes(arg, encodingOrOffset || 'utf8');
        super(bytes);
      } else if (arg instanceof ArrayBuffer) {
        if (typeof encodingOrOffset === 'number') {
          super(arg, encodingOrOffset, length);
        } else {
          super(arg);
        }
      } else if (ArrayBuffer.isView(arg)) {
        super(arg.buffer, arg.byteOffset, arg.byteLength);
      } else if (Array.isArray(arg)) {
        super(arg);
      } else {
        super(arg);
      }
      Object.defineProperty(this, BUFFER_SYMBOL, { value: true, writable: false });
    }

    toString(encoding = 'utf8') {
      encoding = normalizeEncoding(encoding);
      if (encoding === 'utf8') {
        return new TextDecoder('utf-8').decode(this);
      } else if (encoding === 'base64') {
        return bytesToBase64(this);
      } else if (encoding === 'hex') {
        return bytesToHex(this);
      }
      return new TextDecoder('utf-8').decode(this);
    }

    slice(start, end) {
      const sliced = super.slice(start, end);
      return Buffer.from(sliced);
    }

    subarray(start, end) {
      const sub = super.subarray(start, end);
      const buf = new Buffer(sub.length);
      buf.set(sub);
      return buf;
    }

    static from(value, encodingOrOffset, length) {
      if (typeof value === 'string') {
        return new Buffer(value, encodingOrOffset);
      }
      if (value instanceof ArrayBuffer) {
        if (typeof encodingOrOffset === 'number') {
          return new Buffer(value, encodingOrOffset, length);
        }
        return new Buffer(value);
      }
      if (ArrayBuffer.isView(value)) {
        return new Buffer(value);
      }
      if (Array.isArray(value)) {
        return new Buffer(value);
      }
      if (value && typeof value[Symbol.iterator] === 'function') {
        return new Buffer(Array.from(value));
      }
      throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object');
    }

    static alloc(size, fill, encoding) {
      if (typeof size !== 'number' || size < 0) {
        throw new RangeError('Invalid size');
      }
      const buf = new Buffer(size);
      if (fill !== undefined) {
        if (typeof fill === 'number') {
          buf.fill(fill);
        } else if (typeof fill === 'string') {
          const fillBytes = stringToBytes(fill, encoding || 'utf8');
          for (let i = 0; i < size; i++) {
            buf[i] = fillBytes[i % fillBytes.length];
          }
        } else if (Buffer.isBuffer(fill) || fill instanceof Uint8Array) {
          for (let i = 0; i < size; i++) {
            buf[i] = fill[i % fill.length];
          }
        }
      }
      return buf;
    }

    static allocUnsafe(size) {
      if (typeof size !== 'number' || size < 0) {
        throw new RangeError('Invalid size');
      }
      return new Buffer(size);
    }

    static concat(list, totalLength) {
      if (!Array.isArray(list)) {
        throw new TypeError('list argument must be an array');
      }
      if (list.length === 0) {
        return Buffer.alloc(0);
      }
      if (totalLength === undefined) {
        totalLength = 0;
        for (const buf of list) {
          totalLength += buf.length;
        }
      }
      const result = Buffer.alloc(totalLength);
      let offset = 0;
      for (const buf of list) {
        if (offset + buf.length > totalLength) {
          result.set(buf.subarray(0, totalLength - offset), offset);
          break;
        }
        result.set(buf, offset);
        offset += buf.length;
      }
      return result;
    }

    static isBuffer(obj) {
      return obj != null && obj[BUFFER_SYMBOL] === true;
    }

    static byteLength(string, encoding = 'utf8') {
      if (typeof string !== 'string') {
        if (ArrayBuffer.isView(string) || string instanceof ArrayBuffer) {
          return string.byteLength;
        }
        throw new TypeError('First argument must be a string, Buffer, or ArrayBuffer');
      }
      encoding = normalizeEncoding(encoding);
      if (encoding === 'utf8') {
        return new TextEncoder().encode(string).length;
      } else if (encoding === 'base64') {
        const padding = (string.match(/=+$/) || [''])[0].length;
        return Math.floor((string.length * 3) / 4) - padding;
      } else if (encoding === 'hex') {
        return Math.floor(string.length / 2);
      }
      return new TextEncoder().encode(string).length;
    }

    static isEncoding(encoding) {
      return ['utf8', 'utf-8', 'base64', 'hex'].includes(normalizeEncoding(encoding));
    }
  }

  function normalizeEncoding(encoding) {
    if (!encoding) return 'utf8';
    const lower = String(encoding).toLowerCase().replace('-', '');
    if (lower === 'utf8' || lower === 'utf-8') return 'utf8';
    if (lower === 'base64') return 'base64';
    if (lower === 'hex') return 'hex';
    return lower;
  }

  function stringToBytes(str, encoding) {
    encoding = normalizeEncoding(encoding);
    if (encoding === 'utf8') {
      return new TextEncoder().encode(str);
    } else if (encoding === 'base64') {
      return base64ToBytes(str);
    } else if (encoding === 'hex') {
      return hexToBytes(str);
    }
    return new TextEncoder().encode(str);
  }

  function base64ToBytes(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function hexToBytes(str) {
    if (str.length % 2 !== 0) {
      throw new TypeError('Invalid hex string');
    }
    const bytes = new Uint8Array(str.length / 2);
    for (let i = 0; i < str.length; i += 2) {
      const byte = parseInt(str.substr(i, 2), 16);
      if (isNaN(byte)) {
        throw new TypeError('Invalid hex string');
      }
      bytes[i / 2] = byte;
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  globalThis.Buffer = Buffer;
})();
`;

/**
 * Setup encoding APIs in an isolated-vm context
 *
 * Injects:
 * - atob/btoa for Base64 encoding/decoding
 * - Buffer class for binary data handling (utf8, base64, hex)
 *
 * @example
 * const handle = await setupEncoding(context);
 * await context.eval(`
 *   const encoded = btoa("hello");
 *   const decoded = atob(encoded);
 *   const buf = Buffer.from("hello");
 *   const hex = buf.toString("hex");
 * `);
 */
export async function setupEncoding(
  context: ivm.Context
): Promise<EncodingHandle> {
  context.evalSync(encodingCode);
  return {
    dispose() {
      // No resources to cleanup for pure JS injection
    },
  };
}
