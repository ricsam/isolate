# Plan 05: Multipart FormData

## Status: ✅ Done

## Overview

Implement multipart/form-data parsing (incoming) and serialization (outgoing) with proper File object support.

## Implementation Notes

**Completed:** All planned functionality has been implemented.

**Key difference from original plan:** Instead of adding new `__Blob_getBytes` and `__File_getBytes` callbacks, we reused the existing `__Blob_bytes` callback from `@ricsam/isolate-core` which already provides the required functionality via `ivm.ExternalCopy`.

**Tests added:** 10 new tests in `packages/fetch/src/form-data.test.ts`:
- Parsing multipart with text fields only
- Parsing multipart with file fields (returns File instances)
- File.text() works on parsed files
- Parsing multipart with mixed text and file fields
- Serializing FormData with File as multipart
- Request with FormData + File uses multipart Content-Type
- Request with string-only FormData uses url-encoded
- Round-trip: serialize then parse recovers original data
- Handles Blob entries in FormData

## Problem

1. **Parsing**: `formData()` throws for `multipart/form-data` content type
2. **Serialization**: `FormData` with `File` objects only serializes string values
3. **Files**: Parsed files should be actual `File` instances with working methods

## Solution

Implement:
1. `__parseMultipartFormData()` - Parse multipart body into FormData with Files
2. `__serializeFormData()` - Serialize FormData (including Files) to multipart format
3. Update `formData()` methods in Request/Response
4. Update `__prepareBody()` for outgoing FormData

## Implementation

### 1. Multipart Parsing (Pure JS in Isolate)

Add to a new code block in `packages/fetch/src/index.ts`:

```javascript
const multipartCode = `
(function() {
  /**
   * Find a byte sequence in a Uint8Array
   */
  function findSequence(haystack, needle, start = 0) {
    outer: for (let i = start; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * Parse header lines into object
   */
  function parseHeaders(text) {
    const headers = {};
    for (const line of text.split(/\\r?\\n/)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const name = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[name] = value;
      }
    }
    return headers;
  }

  /**
   * Parse multipart/form-data body into FormData
   */
  globalThis.__parseMultipartFormData = function(bodyBytes, contentType) {
    const formData = new FormData();

    // Extract boundary
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) return formData;

    // Remove quotes from boundary if present
    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const boundaryBytes = encoder.encode('--' + boundary);

    // Find first boundary
    let pos = findSequence(bodyBytes, boundaryBytes, 0);
    if (pos === -1) return formData;
    pos += boundaryBytes.length;

    while (pos < bodyBytes.length) {
      // Skip CRLF or LF after boundary
      if (bodyBytes[pos] === 0x0d && bodyBytes[pos + 1] === 0x0a) {
        pos += 2;
      } else if (bodyBytes[pos] === 0x0a) {
        pos += 1;
      }

      // Check for closing boundary (--)
      if (pos + 1 < bodyBytes.length &&
          bodyBytes[pos] === 0x2d &&
          bodyBytes[pos + 1] === 0x2d) {
        break;
      }

      // Find header/body separator (CRLFCRLF)
      const crlfcrlf = encoder.encode('\\r\\n\\r\\n');
      const headersEnd = findSequence(bodyBytes, crlfcrlf, pos);
      if (headersEnd === -1) break;

      // Parse headers
      const headersText = decoder.decode(bodyBytes.slice(pos, headersEnd));
      const headers = parseHeaders(headersText);
      pos = headersEnd + 4;

      // Find next boundary
      const nextBoundary = findSequence(bodyBytes, boundaryBytes, pos);
      if (nextBoundary === -1) break;

      // Extract content (minus trailing CRLF before boundary)
      let contentEnd = nextBoundary;
      if (contentEnd > 0 && bodyBytes[contentEnd - 1] === 0x0a) contentEnd--;
      if (contentEnd > 0 && bodyBytes[contentEnd - 1] === 0x0d) contentEnd--;
      const content = bodyBytes.slice(pos, contentEnd);

      // Parse Content-Disposition
      const disposition = headers['content-disposition'] || '';
      const nameMatch = disposition.match(/name="([^"]+)"/);
      const filenameMatch = disposition.match(/filename="([^"]+)"/);

      if (nameMatch) {
        const name = nameMatch[1];
        if (filenameMatch) {
          // File entry
          const filename = filenameMatch[1];
          const mimeType = headers['content-type'] || 'application/octet-stream';
          const file = new File([content], filename, { type: mimeType });
          formData.append(name, file);
        } else {
          // String entry
          formData.append(name, decoder.decode(content));
        }
      }

      pos = nextBoundary + boundaryBytes.length;
    }

    return formData;
  };

  /**
   * Serialize FormData to multipart/form-data format
   * Returns { body: Uint8Array, contentType: string }
   */
  globalThis.__serializeFormData = function(formData) {
    const boundary = '----FormDataBoundary' + Math.random().toString(36).slice(2) +
                     Math.random().toString(36).slice(2);
    const encoder = new TextEncoder();
    const parts = [];

    for (const [name, value] of formData.entries()) {
      if (value instanceof File) {
        // File entry
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"; filename="' + value.name + '"',
          'Content-Type: ' + (value.type || 'application/octet-stream'),
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));

        // Get file bytes (sync via host callback if available)
        if (typeof __File_getBytes === 'function' && value._getInstanceId) {
          parts.push(new Uint8Array(__File_getBytes(value._getInstanceId())));
        } else {
          // Fallback: use internal state if accessible
          // This might not work for all File implementations
          throw new TypeError('Cannot serialize File without host support');
        }

        parts.push(encoder.encode('\\r\\n'));
      } else if (value instanceof Blob) {
        // Blob entry (treated as file with default name)
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"; filename="blob"',
          'Content-Type: ' + (value.type || 'application/octet-stream'),
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));

        if (typeof __Blob_getBytes === 'function' && value._getInstanceId) {
          parts.push(new Uint8Array(__Blob_getBytes(value._getInstanceId())));
        } else {
          throw new TypeError('Cannot serialize Blob without host support');
        }

        parts.push(encoder.encode('\\r\\n'));
      } else {
        // String entry
        const header = [
          '--' + boundary,
          'Content-Disposition: form-data; name="' + name + '"',
          '',
          ''
        ].join('\\r\\n');
        parts.push(encoder.encode(header));
        parts.push(encoder.encode(String(value)));
        parts.push(encoder.encode('\\r\\n'));
      }
    }

    // Closing boundary
    parts.push(encoder.encode('--' + boundary + '--\\r\\n'));

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.length;
    }

    return {
      body: body,
      contentType: 'multipart/form-data; boundary=' + boundary
    };
  };
})();
`;
```

### 2. Host Callbacks for Blob/File Bytes

Add to `setupFetch()`:

```typescript
// Import core state access (if not already available)
import { getCoreStateMap } from "@ricsam/isolate-core";

// In setupFetch():
const coreStateMap = getCoreStateMap(context);

// Get Blob bytes synchronously
global.setSync(
  "__Blob_getBytes",
  new ivm.Callback((instanceId: number) => {
    const state = coreStateMap.get(instanceId) as { parts?: Uint8Array[] } | undefined;
    if (!state?.parts) return [];

    const total = state.parts.reduce((s, p) => s + p.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of state.parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return Array.from(result);
  })
);

// Get File bytes (same as Blob - File extends Blob)
global.setSync(
  "__File_getBytes",
  new ivm.Callback((instanceId: number) => {
    const state = coreStateMap.get(instanceId) as { parts?: Uint8Array[] } | undefined;
    if (!state?.parts) return [];

    const total = state.parts.reduce((s, p) => s + p.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const part of state.parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return Array.from(result);
  })
);
```

### 3. Update Response.formData()

```javascript
// In responseCode, replace formData():
async formData() {
  const contentType = this.headers.get('content-type') || '';

  // Parse multipart/form-data
  if (contentType.includes('multipart/form-data')) {
    const buffer = await this.arrayBuffer();
    return __parseMultipartFormData(new Uint8Array(buffer), contentType);
  }

  // Parse application/x-www-form-urlencoded
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await this.text();
    const formData = new FormData();
    const params = new URLSearchParams(text);
    for (const [key, value] of params) {
      formData.append(key, value);
    }
    return formData;
  }

  throw new TypeError('Unsupported content type for formData()');
}
```

### 4. Update Request.formData()

Same changes as Response.formData().

### 5. Update __prepareBody() for FormData

```javascript
// In requestCode, update __prepareBody():
function __prepareBody(body) {
  // ... existing checks for null, string, ArrayBuffer, etc. ...

  if (body instanceof FormData) {
    // Check if FormData has any File/Blob entries
    let hasFiles = false;
    for (const [, value] of body.entries()) {
      if (value instanceof File || value instanceof Blob) {
        hasFiles = true;
        break;
      }
    }

    if (hasFiles) {
      // Serialize as multipart/form-data
      const { body: bytes, contentType } = __serializeFormData(body);
      // Store content-type to set on request
      globalThis.__pendingFormDataContentType = contentType;
      return Array.from(bytes);
    }

    // Fallback: URL-encoded for string-only FormData
    const parts = [];
    body.forEach((value, key) => {
      if (typeof value === 'string') {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      }
    });
    return Array.from(new TextEncoder().encode(parts.join('&')));
  }

  // ... rest of __prepareBody ...
}
```

### 6. Update Request Constructor for Content-Type

```javascript
// In Request constructor, after __prepareBody:
const bodyBytes = __prepareBody(body);

// Set Content-Type for FormData with files
if (globalThis.__pendingFormDataContentType) {
  headers.set('content-type', globalThis.__pendingFormDataContentType);
  delete globalThis.__pendingFormDataContentType;
} else if (body instanceof FormData) {
  // URL-encoded FormData
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
}

const headersArray = Array.from(headers.entries());
```

### 7. Inject Multipart Code

In `setupFetch()`, add injection:

```typescript
// After formDataCode injection:
context.evalSync(multipartCode);
```

## Testing

### Unit Tests

```typescript
describe("Multipart FormData Parsing", () => {
  test("parses multipart with text fields", async () => {
    const boundary = "----TestBoundary";
    const body = [
      "------TestBoundary",
      'Content-Disposition: form-data; name="field1"',
      "",
      "value1",
      "------TestBoundary",
      'Content-Disposition: form-data; name="field2"',
      "",
      "value2",
      "------TestBoundary--"
    ].join("\r\n");

    const result = await ctx.context.eval(`
      (async () => {
        const response = new Response(${JSON.stringify(body)}, {
          headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
        });
        const formData = await response.formData();
        return JSON.stringify({
          field1: formData.get('field1'),
          field2: formData.get('field2')
        });
      })()
    `, { promise: true });

    expect(JSON.parse(result)).toEqual({ field1: "value1", field2: "value2" });
  });

  test("parses multipart with file", async () => {
    const result = await ctx.context.eval(`
      (async () => {
        const encoder = new TextEncoder();
        const parts = [
          '------TestBoundary\\r\\n',
          'Content-Disposition: form-data; name="file"; filename="test.txt"\\r\\n',
          'Content-Type: text/plain\\r\\n',
          '\\r\\n',
          'Hello World',
          '\\r\\n------TestBoundary--\\r\\n'
        ];
        const body = encoder.encode(parts.join(''));

        const response = new Response(body, {
          headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
        });
        const formData = await response.formData();
        const file = formData.get('file');

        return JSON.stringify({
          isFile: file instanceof File,
          name: file.name,
          type: file.type,
          size: file.size
        });
      })()
    `, { promise: true });

    const data = JSON.parse(result);
    expect(data.isFile).toBe(true);
    expect(data.name).toBe("test.txt");
    expect(data.type).toBe("text/plain");
    expect(data.size).toBe(11);
  });

  test("File.text() works on parsed file", async () => {
    const result = await ctx.context.eval(`
      (async () => {
        const encoder = new TextEncoder();
        const parts = [
          '------TestBoundary\\r\\n',
          'Content-Disposition: form-data; name="file"; filename="test.txt"\\r\\n',
          'Content-Type: text/plain\\r\\n',
          '\\r\\n',
          'File content here',
          '\\r\\n------TestBoundary--\\r\\n'
        ];
        const body = encoder.encode(parts.join(''));

        const response = new Response(body, {
          headers: { 'Content-Type': 'multipart/form-data; boundary=----TestBoundary' }
        });
        const formData = await response.formData();
        const file = formData.get('file');
        return await file.text();
      })()
    `, { promise: true });

    expect(result).toBe("File content here");
  });
});

describe("FormData Serialization", () => {
  test("serializes FormData with File as multipart", async () => {
    const result = await ctx.context.eval(`
      (async () => {
        const file = new File(["test content"], "test.txt", { type: "text/plain" });
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", "John");

        const { body, contentType } = __serializeFormData(formData);

        // Check content-type has boundary
        const hasBoundary = contentType.includes('boundary=');

        // Decode body to check structure
        const text = new TextDecoder().decode(body);
        const hasFilename = text.includes('filename="test.txt"');
        const hasFileContent = text.includes('test content');
        const hasName = text.includes('name="name"');
        const hasJohn = text.includes('John');

        return JSON.stringify({
          hasBoundary,
          hasFilename,
          hasFileContent,
          hasName,
          hasJohn
        });
      })()
    `, { promise: true });

    const data = JSON.parse(result);
    expect(data.hasBoundary).toBe(true);
    expect(data.hasFilename).toBe(true);
    expect(data.hasFileContent).toBe(true);
    expect(data.hasName).toBe(true);
    expect(data.hasJohn).toBe(true);
  });

  test("Request with FormData + File uses multipart", async () => {
    // Setup echo handler
    ctx.context.evalSync(`
      serve({
        async fetch(request) {
          const contentType = request.headers.get('content-type');
          const formData = await request.formData();
          const file = formData.get('file');
          return Response.json({
            contentType,
            isFile: file instanceof File,
            filename: file?.name,
            content: file ? await file.text() : null
          });
        }
      });
    `);

    // Create Request in isolate with FormData + File
    const result = await ctx.context.eval(`
      (async () => {
        const file = new File(["uploaded content"], "upload.txt", { type: "text/plain" });
        const formData = new FormData();
        formData.append("file", file);

        const request = new Request("http://test/upload", {
          method: "POST",
          body: formData
        });

        return request.headers.get('content-type');
      })()
    `, { promise: true });

    expect(result).toContain("multipart/form-data");
    expect(result).toContain("boundary=");
  });
});
```

## Verification

1. ✅ Parsing multipart with text fields works
2. ✅ Parsing multipart with file fields returns File instances
3. ✅ File.text(), File.arrayBuffer() work on parsed files
4. ✅ Serializing FormData with Files produces valid multipart
5. ✅ Request with FormData + File sends multipart
6. ⏳ E2E file upload tests (to be verified separately)

## Dependencies

- Plan 01: Stream State Registry (for streaming File bodies)
- Plan 02: Host-Backed ReadableStream (for File.stream())
- Optionally Plans 03-04 for streaming integration

## Files Modified/Created

| File | Action | Status |
|------|--------|--------|
| `packages/fetch/src/index.ts` | Modify - add `multipartCode` (~160 lines) | ✅ Done |
| `packages/fetch/src/index.ts` | Modify - update `Response.formData()` | ✅ Done |
| `packages/fetch/src/index.ts` | Modify - update `Request.formData()` | ✅ Done |
| `packages/fetch/src/index.ts` | Modify - update `__prepareBody()` | ✅ Done |
| `packages/fetch/src/index.ts` | Modify - update Request constructor Content-Type | ✅ Done |
| `packages/fetch/src/form-data.test.ts` | Modify - add multipart tests | ✅ Done |

**Note:** `__Blob_getBytes` and `__File_getBytes` were not added - instead reused existing `__Blob_bytes` from core.

## Notes

### Binary Safety

The parsing uses `Uint8Array` and `TextDecoder` to properly handle binary content in files. This ensures images, PDFs, etc. are parsed correctly.

### Quoted Boundaries

The parser handles both quoted and unquoted boundaries:
- `boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW`
- `boundary="----WebKitFormBoundary7MA4YWxkTrZu0gW"`

### Content-Disposition Parsing

The parser handles:
- `name="field"` - Required
- `filename="file.txt"` - Optional, indicates file
- Both single and double quotes

### Content-Type for Files

When no Content-Type header is present for a file part, `application/octet-stream` is used as default (per HTTP specs).
