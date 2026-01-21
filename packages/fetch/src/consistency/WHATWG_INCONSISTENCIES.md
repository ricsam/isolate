# WHATWG Inconsistencies

This document tracks known inconsistencies between the isolate implementation and the WHATWG specifications for web platform APIs.

---

## Open Issues

### 5. URL Marshalling Returns String Instead of URL Object

**Status:** Open
**Severity:** Medium
**Spec:** [WHATWG URL - URL Class](https://url.spec.whatwg.org/#url-class)

When URL objects are passed through custom functions (crossing the marshal/unmarshal boundary), they are serialized via `URLRef` which only preserves the `href` string. The returned value is a plain string, not a URL object:

```javascript
// In custom function context
__setURL(new URL("https://example.com/path?query=1"));
const url = __getURL();

url instanceof URL;        // false - it's a string!
typeof url;                // "string"
url.searchParams;          // undefined
url.pathname;              // undefined
String(url);               // "https://example.com/path?query=1" - href is preserved
```

---

### 6. URLSearchParams.size Property Missing

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams size](https://url.spec.whatwg.org/#dom-urlsearchparams-size)

The `size` property on URLSearchParams is not implemented:

```javascript
const params = new URLSearchParams("a=1&b=2&c=3");
params.size;              // undefined (should be 3)
'size' in params;         // false
```

---

### 7. URLSearchParams has() and delete() Two-Argument Forms Not Supported

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams](https://url.spec.whatwg.org/#interface-urlsearchparams)

The two-argument forms of `has(name, value)` and `delete(name, value)` are not fully supported:

```javascript
const params = new URLSearchParams("a=1&a=2&a=3");

// has() with value - may not filter by value
params.has("a", "2");     // Behavior may vary

// delete() with value - removes all entries with key, not just matching value
params.delete("a", "2");
params.getAll("a");       // [] instead of ["1", "3"]
```

---

### 8. URLSearchParams toString() Uses %20 Instead of + for Spaces

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG URL - application/x-www-form-urlencoded serializer](https://url.spec.whatwg.org/#concept-urlencoded-serializer)

Per the WHATWG spec, spaces should be encoded as `+` in `application/x-www-form-urlencoded` format:

```javascript
const params = new URLSearchParams();
params.set("key", "value with spaces");
params.toString();        // "key=value%20with%20spaces" (should be "key=value+with+spaces")
```

Both encodings are valid and will be decoded correctly, but the spec specifically requires `+` for spaces.

---

### 9. URLSearchParams Constructor Doesn't Accept URLSearchParams

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams Constructor](https://url.spec.whatwg.org/#dom-urlsearchparams-urlsearchparams)

Creating URLSearchParams from another URLSearchParams instance does not work:

```javascript
const original = new URLSearchParams("a=1&b=2");
const copy = new URLSearchParams(original);
copy.get("a");            // null (should be "1")
```

---

### 10. URL.canParse() Static Method Missing

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG URL - URL.canParse](https://url.spec.whatwg.org/#dom-url-canparse)

The static `URL.canParse()` method is not implemented:

```javascript
URL.canParse("https://example.com");  // TypeError: URL.canParse is not a function
```

---

### 11. URLSearchParams-URL Live Binding Not Maintained

**Status:** Open
**Severity:** Medium
**Spec:** [WHATWG URL - URLSearchParams update](https://url.spec.whatwg.org/#concept-urlsearchparams-update)

Per the WHATWG spec, mutating `url.searchParams` should update `url.search` and `url.href` in real-time. The current implementation creates a disconnected URLSearchParams:

```javascript
const url = new URL("https://example.com?a=1");
url.searchParams.set("b", "2");

// WHATWG spec behavior:
url.search;               // Should be "?a=1&b=2"
url.href;                 // Should be "https://example.com?a=1&b=2"

// Actual behavior:
url.search;               // "?a=1" - not updated!
url.href;                 // "https://example.com?a=1" - not updated!
url.searchParams.toString(); // "a=1&b=2" - params are updated internally
```

---

## Summary Table

| Issue | Severity | Spec Area | Status |
|-------|----------|-----------|--------|
| Blob from Blob/File | High | File API | Fixed |
| File.webkitRelativePath | Low | File API | Fixed |
| Request body in serve() | High | Fetch | Fixed |
| Response.body stream | High | Streams | Fixed |
| URL marshalling returns string | Medium | URL | Open |
| URLSearchParams.size missing | Low | URL | Open |
| URLSearchParams has/delete with value | Low | URL | Open |
| URLSearchParams toString() space encoding | Low | URL | Open |
| URLSearchParams copy constructor | Low | URL | Open |
| URL.canParse() missing | Low | URL | Open |
| URLSearchParams-URL live binding | Medium | URL | Open |
