
## E2E Testing

Tests are located in the `e2e/` folder and use Playwright.

### Run tests (standard)

```bash
npm run test:e2e
```

This uses Playwright's built-in `webServer` to start the server automatically.

### Run tests with server logs visible

```bash
npm run test:e2e:logs
```

This starts the server manually and pipes all server output to both the console and `.e2e-logs/server.log`. Useful for debugging server-side issues during e2e tests.

**Options:**

```bash
# Run specific test file
npm run test:e2e:logs api

# Run in headed mode (see browser)
npm run test:e2e:logs --headed

# Combine options
npm run test:e2e:logs api --headed

# Run with Playwright UI
npm run test:e2e:logs --ui
```

**Log file location:** `.e2e-logs/server.log`

After tests complete, you can review the full server logs in this file.

**Note:** The HTML report browser is disabled by default when using `test:e2e:logs`. To view the report manually:

```bash
npx playwright show-report
```