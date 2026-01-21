# WHATWG Inconsistencies

This document tracks known inconsistencies between the isolate implementation and the WHATWG specifications for web platform APIs.

---

## Open Issues

### 13. AbortSignal.onabort Event Handler Property Missing

**Status:** Open
**Severity:** Low
**Spec:** [WHATWG DOM - AbortSignal interface](https://dom.spec.whatwg.org/#interface-AbortSignal)

The WHATWG spec requires AbortSignal to have an `onabort` event handler property. This is not implemented:

```javascript
const controller = new AbortController();
controller.signal.onabort = () => console.log('aborted');
// TypeError: Cannot set property onabort
```

**Workaround:** Use `addEventListener('abort', handler)` instead.

---

### 14. AbortSignal.any() Static Method Missing

**Status:** Open
**Severity:** Medium
**Spec:** [WHATWG DOM - AbortSignal.any()](https://dom.spec.whatwg.org/#dom-abortsignal-any)

The static `AbortSignal.any(signals)` method for combining multiple abort signals is not implemented:

```javascript
const controller1 = new AbortController();
const controller2 = new AbortController();

// Should create a signal that aborts when any of the input signals abort
const combinedSignal = AbortSignal.any([controller1.signal, controller2.signal]);
// TypeError: AbortSignal.any is not a function
```

**Workaround:** Manually combine signals by listening to each signal and calling abort on a new controller.

---

### 15. AbortController/AbortSignal No Marshalling Support

**Status:** Open (By Design)
**Severity:** Low
**Spec:** N/A (implementation limitation)

AbortController and AbortSignal cannot be passed through custom functions (no marshalling support). They can only be created directly within the isolate.

```javascript
// In custom function - this will not work correctly
const controller = await customFunctionThatCreatesController();
// The controller won't be properly marshalled across the boundary
```

**Note:** Only the boolean `aborted` state crosses boundaries during fetch operations. This is by design due to the complexity of maintaining abort semantics across isolate boundaries.

---

## Fixed Issues

### 12. Response.body Returns New Stream on Each Access

**Status:** Fixed
**Severity:** Medium
**Spec:** [WHATWG Fetch - Body interface](https://fetch.spec.whatwg.org/#body)

Per the WHATWG spec, the `Response.body` getter now returns the same `ReadableStream` object on repeated access:

```javascript
const response = new Response("hello");
response.body === response.body; // true (same object identity)
```

This applies to all Response origins (direct, customFunction, fetchCallback).

---

### 5. URL Marshalling Returns String Instead of URL Object

**Status:** Fixed
**Severity:** Medium
**Spec:** [WHATWG URL - URL Class](https://url.spec.whatwg.org/#url-class)

When URL objects are passed through custom functions (crossing the marshal/unmarshal boundary), they are now properly marshalled via `URLRef` and unmarshalled back to URL objects:

```javascript
// In custom function context
__setURL(new URL("https://example.com/path?query=1"));
const url = __getURL();

url instanceof URL;        // true - properly unmarshalled!
url.searchParams;          // URLSearchParams instance
url.pathname;              // "/path"
```

---

### 6. URLSearchParams.size Property Missing

**Status:** Fixed
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams size](https://url.spec.whatwg.org/#dom-urlsearchparams-size)

The `size` property on URLSearchParams is now implemented:

```javascript
const params = new URLSearchParams("a=1&b=2&c=3");
params.size;              // 3
'size' in params;         // true
```

---

### 7. URLSearchParams has() and delete() Two-Argument Forms Not Supported

**Status:** Fixed
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams](https://url.spec.whatwg.org/#interface-urlsearchparams)

The two-argument forms of `has(name, value)` and `delete(name, value)` are now fully supported:

```javascript
const params = new URLSearchParams("a=1&a=2&a=3");

// has() with value - filters by value
params.has("a", "2");     // true
params.has("a", "4");     // false

// delete() with value - removes only matching entries
params.delete("a", "2");
params.getAll("a");       // ["1", "3"]
```

---

### 8. URLSearchParams toString() Uses %20 Instead of + for Spaces

**Status:** Fixed
**Severity:** Low
**Spec:** [WHATWG URL - application/x-www-form-urlencoded serializer](https://url.spec.whatwg.org/#concept-urlencoded-serializer)

Per the WHATWG spec, spaces are now encoded as `+` in `application/x-www-form-urlencoded` format:

```javascript
const params = new URLSearchParams();
params.set("key", "value with spaces");
params.toString();        // "key=value+with+spaces"
```

The constructor also properly decodes `+` as space when parsing:

```javascript
const params = new URLSearchParams("key=value+with+spaces");
params.get("key");        // "value with spaces"
```

---

### 9. URLSearchParams Constructor Doesn't Accept URLSearchParams

**Status:** Fixed
**Severity:** Low
**Spec:** [WHATWG URL - URLSearchParams Constructor](https://url.spec.whatwg.org/#dom-urlsearchparams-urlsearchparams)

Creating URLSearchParams from another URLSearchParams instance now works correctly:

```javascript
const original = new URLSearchParams("a=1&b=2");
const copy = new URLSearchParams(original);
copy.get("a");            // "1"
copy.get("b");            // "2"

// Modifications to copy don't affect original
copy.set("a", "changed");
original.get("a");        // "1" (unchanged)
```

---

### 10. URL.canParse() Static Method Missing

**Status:** Fixed
**Severity:** Low
**Spec:** [WHATWG URL - URL.canParse](https://url.spec.whatwg.org/#dom-url-canparse)

The static `URL.canParse()` method is now implemented:

```javascript
URL.canParse("https://example.com");       // true
URL.canParse("not a url");                 // false
URL.canParse("/path", "https://base.com"); // true
```

---

### 11. URLSearchParams-URL Live Binding Not Maintained

**Status:** Fixed
**Severity:** Medium
**Spec:** [WHATWG URL - URLSearchParams update](https://url.spec.whatwg.org/#concept-urlsearchparams-update)

Per the WHATWG spec, mutating `url.searchParams` now properly updates `url.search` and `url.href` in real-time:

```javascript
const url = new URL("https://example.com?a=1");
url.searchParams.set("b", "2");

url.search;               // "?a=1&b=2"
url.href;                 // "https://example.com?a=1&b=2"
url.searchParams.toString(); // "a=1&b=2"
```

Setting `url.search` also updates the searchParams:

```javascript
const url = new URL("https://example.com?a=1");
const paramsRef = url.searchParams;
url.search = "?b=2&c=3";

paramsRef.get("a");       // null
paramsRef.get("b");       // "2"
paramsRef.get("c");       // "3"
paramsRef === url.searchParams; // true (same instance)
```

---

### Previously Fixed Issues

| Issue | Severity | Spec Area | Status |
|-------|----------|-----------|--------|
| Blob from Blob/File | High | File API | Fixed |
| File.webkitRelativePath | Low | File API | Fixed |
| Request body in serve() | High | Fetch | Fixed |
| Response.body stream | High | Streams | Fixed |

---

## Summary Table

| Issue | Severity | Spec Area | Status |
|-------|----------|-----------|--------|
| AbortSignal.onabort missing | Low | DOM | Open |
| AbortSignal.any() missing | Medium | DOM | Open |
| AbortController/AbortSignal no marshalling | Low | N/A | Open (By Design) |
| Response.body identity | Medium | Fetch | Fixed |
| Blob from Blob/File | High | File API | Fixed |
| File.webkitRelativePath | Low | File API | Fixed |
| Request body in serve() | High | Fetch | Fixed |
| Response.body stream | High | Streams | Fixed |
| URL marshalling returns string | Medium | URL | Fixed |
| URLSearchParams.size missing | Low | URL | Fixed |
| URLSearchParams has/delete with value | Low | URL | Fixed |
| URLSearchParams toString() space encoding | Low | URL | Fixed |
| URLSearchParams copy constructor | Low | URL | Fixed |
| URL.canParse() missing | Low | URL | Fixed |
| URLSearchParams-URL live binding | Medium | URL | Fixed |
