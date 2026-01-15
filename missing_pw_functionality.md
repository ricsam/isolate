# Missing Playwright Functionality

This document lists Playwright features that are not yet implemented in the `@ricsam/isolate-playwright` bridge.

## High Priority - Used in E2E Tests

These APIs are **actually used** in the demo e2e tests and should be implemented first.

### Expect Matchers for Primitives

| Matcher | Example | Usage |
|---------|---------|-------|
| `toBeDefined()` | `expect(data.timestamp).toBeDefined()` | Used extensively to check if values exist |
| `toBeGreaterThan(n)` | `expect(count).toBeGreaterThan(0)` | Used in streaming tests for chunk counts |
| `toBeGreaterThanOrEqual(n)` | `expect(length).toBeGreaterThanOrEqual(1)` | Used in streaming tests for event verification |
| `toHaveProperty(path, value?)` | `expect(obj).toHaveProperty("key", "value")` | Used to verify object properties exist |

### Page Methods

| Method | Description | Usage |
|--------|-------------|-------|
| `page.click(selector)` | Shorthand for `page.locator(selector).click()` | Used in WebSocket UI tester tests |
| `page.fill(selector, value)` | Shorthand for `page.locator(selector).fill(value)` | Used to fill form inputs |

### Locator Methods

| Method | Description | Usage |
|--------|-------------|-------|
| `locator.nth(index)` | Get nth matching element | Used to select specific elements from a list |

### Assertion Options

| Feature | Example | Usage |
|---------|---------|-------|
| `timeout` option | `expect(locator).toBeVisible({ timeout: 5000 })` | Used extensively for async UI operations |

---

## Lower Priority - Not Currently Used

The following APIs are available in Playwright but not used in current e2e tests. Listed for reference.

### Expect Matchers for Primitives (Not Used)

| Matcher | Example |
|---------|---------|
| `toBeUndefined()` | `expect(data.value).toBeUndefined()` |
| `toBeNull()` | `expect(result).toBeNull()` |
| `toBeLessThan(n)` | `expect(index).toBeLessThan(10)` |
| `toBeLessThanOrEqual(n)` | `expect(size).toBeLessThanOrEqual(100)` |
| `toHaveLength(n)` | `expect(arr).toHaveLength(3)` |
| `toMatch(pattern)` | `expect(str).toMatch(/regex/)` |
| `toMatchObject(obj)` | `expect(data).toMatchObject({ key: "value" })` |
| `toThrow(msg?)` | `expect(() => fn()).toThrow("error")` |
| `resolves` | `expect(promise).resolves.toBe(value)` |
| `rejects` | `expect(promise).rejects.toThrow()` |

**Currently available:** `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toContain`, `not.*`

### Page Methods (Not Used)

| Method | Description |
|--------|-------------|
| `page.type(selector, text)` | Shorthand for typing text |
| `page.press(selector, key)` | Shorthand for key press |
| `page.screenshot(options?)` | Take screenshot |
| `page.setViewportSize(size)` | Set viewport dimensions |
| `page.goBack()` | Navigate back |
| `page.goForward()` | Navigate forward |
| `page.bringToFront()` | Focus page |
| `page.waitForURL(url)` | Wait for navigation to URL |
| `page.waitForNavigation()` | Wait for navigation |
| `page.waitForResponse(url)` | Wait for network response |
| `page.waitForRequest(url)` | Wait for network request |
| `page.route(url, handler)` | Intercept network requests |
| `page.keyboard` | Keyboard API |
| `page.mouse` | Mouse API |
| `page.frame(name)` | Get frame by name |
| `page.frames()` | Get all frames |

**Currently available:** `goto`, `reload`, `url`, `title`, `content`, `waitForSelector`, `waitForTimeout`, `waitForLoadState`, `evaluate`, `locator`, `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`

### Locator Methods (Not Used)

| Method | Description |
|--------|-------------|
| `locator.first()` | Get first matching element |
| `locator.last()` | Get last matching element |
| `locator.filter(options)` | Filter locator |
| `locator.locator(selector)` | Chain locators |
| `locator.getByRole(...)` | Chain with role query |
| `locator.getByText(...)` | Chain with text query |
| `locator.getAttribute(name)` | Get attribute value |
| `locator.innerHTML()` | Get inner HTML |
| `locator.innerText()` | Get inner text |
| `locator.boundingBox()` | Get bounding box |
| `locator.screenshot()` | Screenshot element |
| `locator.scrollIntoViewIfNeeded()` | Scroll element into view |
| `locator.waitFor(options?)` | Wait for element state |
| `locator.evaluate(fn)` | Run function on element |
| `locator.evaluateAll(fn)` | Run function on all elements |
| `locator.all()` | Get all matching locators |
| `locator.allInnerTexts()` | Get all inner texts |
| `locator.allTextContents()` | Get all text contents |

**Currently available:** `click`, `dblclick`, `fill`, `type`, `check`, `uncheck`, `selectOption`, `clear`, `press`, `hover`, `focus`, `textContent`, `inputValue`, `isVisible`, `isEnabled`, `isChecked`, `count`

### Locator Expect Matchers (Not Used)

| Matcher | Description |
|--------|-------------|
| `toBeAttached()` | Element is attached to DOM |
| `toBeDisabled()` | Element is disabled |
| `toBeEditable()` | Element is editable |
| `toBeEmpty()` | Element is empty |
| `toBeFocused()` | Element is focused |
| `toBeHidden()` | Element is hidden |
| `toBeInViewport()` | Element is in viewport |
| `toHaveAttribute(name, value?)` | Element has attribute |
| `toHaveClass(class)` | Element has CSS class |
| `toHaveCount(n)` | Locator matches n elements |
| `toHaveCSS(prop, value)` | Element has CSS property |
| `toHaveId(id)` | Element has ID |
| `toHaveScreenshot()` | Visual comparison |
| `toHaveText(text)` | Element has exact text |

**Currently available:** `toBeVisible`, `toContainText`, `toHaveValue`, `toBeEnabled`, `toBeChecked`, `not.*`

### Other Features (Not Used)

| Feature | Description |
|---------|-------------|
| `soft` assertions | Continue test after failure |
| Custom message | `expect(value, "custom message").toBe(...)` |
| `test.describe.configure()` | Configure test suite |
| `test.beforeAll()` | Setup before all tests |
| `test.afterAll()` | Cleanup after all tests |
| `test.beforeEach()` | Setup before each test |
| `test.afterEach()` | Cleanup after each test |
| `test.skip()` | Skip test conditionally |
| `test.only()` | Run only this test |
| `test.fixme()` | Mark test as fixme |
| `test.slow()` | Mark test as slow |
| `test.step()` | Create test steps |
| Parallel execution | Tests run serially |
| Fixtures | Test fixtures |
| Annotations | Test annotations |
| Request API | `request.get()`, `request.post()`, etc. |

---

## Workarounds

### For missing `toBeDefined()`:
```javascript
expect(value !== undefined).toBe(true);
```

### For missing `toBeGreaterThan()`:
```javascript
expect(count > 0).toBe(true);
```

### For missing `locator.nth()`:
```javascript
const text = await page.evaluate(() => {
  return document.querySelectorAll('.item')[2].textContent;
});
```

### For missing `timeout` in assertions:
```javascript
// Instead of: await expect(locator).toBeVisible({ timeout: 5000 });
await page.waitForSelector('.selector', { timeout: 5000 });
await expect(page.locator('.selector')).toBeVisible();
```

### For API testing without `request` fixture:
```javascript
const data = await page.evaluate(async () => {
  const response = await fetch('/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'value' }),
  });
  return { status: response.status, data: await response.json() };
});
expect(data.status).toBe(200);
```
