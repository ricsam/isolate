# WHATWG Inconsistencies

This document tracks known inconsistencies between the isolate implementation and the WHATWG specifications for web platform APIs.

## 1. Blob Constructor Doesn't Handle Blob/File Parts

**Severity:** High
**Spec:** [WHATWG File API - Blob Constructor](https://w3c.github.io/FileAPI/#constructorBlob)

### Expected Behavior
When a Blob or File is passed as a part to the Blob constructor, its content should be read and concatenated:

```javascript
const original = new Blob(['hello']);
const copy = new Blob([original]);
await copy.text(); // Should return "hello"
copy.size;         // Should be 5
```

### Actual Behavior
The Blob/File part is converted to string using `toString()`:

```javascript
const original = new Blob(['hello']);
const copy = new Blob([original]);
await copy.text(); // Returns "[object Object]"
copy.size;         // Returns 15
```

### Affected APIs
- `new Blob([blob])`
- `new Blob([file])`
- `new File([blob], name)`
- `new File([file], name)`
- `FormData.append(name, blob)` (when blob content is read)

### Test File
`blob-consistency.test.ts`, `file-consistency.test.ts`

---

## 2. File.webkitRelativePath Property Missing

**Severity:** Low
**Spec:** [WHATWG File API - File Interface](https://w3c.github.io/FileAPI/#file-attrs)

### Expected Behavior
The `webkitRelativePath` property should always exist on File objects and return an empty string for files created via constructor:

```javascript
const file = new File(['test'], 'test.txt');
file.webkitRelativePath; // Should return ""
'webkitRelativePath' in file; // Should be true
```

### Actual Behavior
The property doesn't exist:

```javascript
const file = new File(['test'], 'test.txt');
file.webkitRelativePath; // Returns undefined
'webkitRelativePath' in file; // Returns false
```

### Test File
`file-consistency.test.ts`

---

## 3. Request Body Not Transferred to serve() Handler

**Severity:** High
**Spec:** [WHATWG Fetch - Request Body](https://fetch.spec.whatwg.org/#concept-body)

### Expected Behavior
When a Request with a body is dispatched to a serve() handler, the body should be accessible:

```javascript
serve({
  fetch(request) {
    const body = await request.text(); // Should return "posted content"
    return new Response('ok');
  }
});

// From host:
dispatchRequest(new Request('http://test', {
  method: 'POST',
  body: 'posted content'
}));
```

### Actual Behavior
The request body is empty or not transferred:

```javascript
serve({
  fetch(request) {
    const body = await request.text(); // Returns ""
    return new Response('ok');
  }
});
```

### Test File
`request-consistency.test.ts`

---

## 4. Response.body from fetch() Is Not a Proper ReadableStream

**Severity:** High
**Spec:** [WHATWG Streams - ReadableStream](https://streams.spec.whatwg.org/#rs-class)

### Expected Behavior
`Response.body` should be a `ReadableStream` instance with all standard methods:

```javascript
const response = await fetch('http://example.com');
response.body instanceof ReadableStream; // Should be true
response.body.constructor.name;          // Should be "ReadableStream"
typeof response.body.tee;                // Should be "function"
typeof response.body.pipeThrough;        // Should be "function"
typeof response.body.pipeTo;             // Should be "function"
```

### Actual Behavior
`Response.body` is a `HostBackedReadableStream` that doesn't implement the full spec:

```javascript
const response = await fetch('http://example.com');
response.body instanceof ReadableStream; // false
response.body.constructor.name;          // "HostBackedReadableStream"
typeof response.body.tee;                // "undefined"
typeof response.body.pipeThrough;        // "undefined"
typeof response.body.pipeTo;             // "undefined"
```

### Missing Methods/Properties
| Method/Property | Status |
|-----------------|--------|
| `tee()` | Missing |
| `pipeThrough()` | Missing |
| `pipeTo()` | Missing |
| `values()` | Missing |
| `instanceof ReadableStream` | Returns false |

### Working Methods
- `getReader()` - Works
- `cancel()` - Works
- `[Symbol.asyncIterator]` - Works

### Test File
`response-consistency.test.ts`

---

## Summary Table

| Issue | Severity | Spec Area | Status |
|-------|----------|-----------|--------|
| Blob from Blob/File | High | File API | Failing test |
| File.webkitRelativePath | Low | File API | Failing test |
| Request body in serve() | High | Fetch | Failing test |
| Response.body stream | High | Streams | Failing test |
