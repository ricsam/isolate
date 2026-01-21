# WHATWG Inconsistencies

This document tracks known inconsistencies between the isolate implementation and the WHATWG specifications for web platform APIs.

## Fixed Issues

### 1. Blob Constructor Doesn't Handle Blob/File Parts (FIXED)

**Status:** Fixed
**Spec:** [WHATWG File API - Blob Constructor](https://w3c.github.io/FileAPI/#constructorBlob)

The Blob and File constructors now properly handle Blob/File parts by extracting their bytes.

```javascript
const original = new Blob(['hello']);
const copy = new Blob([original]);
await copy.text(); // Returns "hello"
copy.size;         // Returns 5
```

---

### 2. File.webkitRelativePath Property Missing (FIXED)

**Status:** Fixed
**Spec:** [WHATWG File API - File Interface](https://w3c.github.io/FileAPI/#file-attrs)

The `webkitRelativePath` property now exists on File objects and returns an empty string:

```javascript
const file = new File(['test'], 'test.txt');
file.webkitRelativePath; // Returns ""
'webkitRelativePath' in file; // Returns true
```

---

### 3. Request Body Not Transferred to serve() Handler (FIXED)

**Status:** Fixed
**Spec:** [WHATWG Fetch - Request Body](https://fetch.spec.whatwg.org/#concept-body)

Request bodies are now properly transferred to serve() handlers:

```javascript
serve({
  fetch(request) {
    const body = await request.text(); // Returns "posted content"
    return new Response('ok');
  }
});
```

---

### 4. Response.body from fetch() Is Not a Proper ReadableStream (FIXED)

**Status:** Fixed
**Spec:** [WHATWG Streams - ReadableStream](https://streams.spec.whatwg.org/#rs-class)

`Response.body` now properly extends `ReadableStream` with all standard methods:

```javascript
const response = await fetch('http://example.com');
response.body instanceof ReadableStream; // true
response.body.constructor.name;          // "ReadableStream"
typeof response.body.tee;                // "function"
typeof response.body.pipeThrough;        // "function"
typeof response.body.pipeTo;             // "function"
typeof response.body.values;             // "function"
```

---

## Remaining Issues

### FormData Blob Content Size

**Severity:** Low
**Status:** Open

When appending a Blob to FormData, the size calculation may not match the original blob content size in all cases.

**Test File:** `formdata-consistency.test.ts`

---

## Summary Table

| Issue | Severity | Spec Area | Status |
|-------|----------|-----------|--------|
| Blob from Blob/File | High | File API | Fixed |
| File.webkitRelativePath | Low | File API | Fixed |
| Request body in serve() | High | Fetch | Fixed |
| Response.body stream | High | Streams | Fixed |
| FormData Blob size | Low | File API | Open |
