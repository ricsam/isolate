# Issue: Implement multipart/form-data parsing in formData()

## Summary

The `formData()` method in `@ricsam/isolate-fetch` only supports `application/x-www-form-urlencoded` content type. File uploads via `multipart/form-data` are not supported.

## Current Error

```
{"error":"Upload failed","message":"Unsupported content type for formData()"}
```

## Location

`packages/fetch/src/index.ts` lines 613-629 and 1072-1087

## Current Implementation

```typescript
async formData() {
  const contentType = this.headers.get('content-type') || '';
  const text = await this.text();

  // Parse application/x-www-form-urlencoded
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = new FormData();
    const params = new URLSearchParams(text);
    for (const [key, value] of params) {
      formData.append(key, value);
    }
    return formData;
  }

  // For multipart/form-data, throw for now (complex parsing)
  throw new TypeError('Unsupported content type for formData()');
}
```

## Required Implementation

Need to implement multipart/form-data parsing:
1. Parse the boundary from the Content-Type header
2. Split the body by boundary
3. Parse each part's headers and body
4. Create FormData entries (including File objects for file uploads)

## Affected Tests

- `e2e/files.e2e.ts` - All file upload tests
