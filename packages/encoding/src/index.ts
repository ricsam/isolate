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
})();
`;

/**
 * Setup encoding APIs in an isolated-vm context
 *
 * Injects atob and btoa for Base64 encoding/decoding
 *
 * @example
 * const handle = await setupEncoding(context);
 * await context.eval(`
 *   const encoded = btoa("hello");
 *   const decoded = atob(encoded);
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
