const warnedAsyncHandlers = new WeakSet<Function>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function invokeBestEffortEventHandler<TArgs extends unknown[]>(
  label: string,
  handler: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
): void {
  if (!handler) {
    return;
  }

  try {
    const result = handler(...args);
    if (!isPromiseLike(result)) {
      return;
    }

    if (!warnedAsyncHandlers.has(handler)) {
      warnedAsyncHandlers.add(handler);
      console.warn(
        `[isolate] ${label} handlers are sync-only and best-effort. Returned promises are ignored.`,
      );
    }

    void Promise.resolve(result).catch((error) => {
      console.error(
        `[isolate] ${label} handler rejected after returning a promise.`,
        error,
      );
    });
  } catch (error) {
    console.error(`[isolate] ${label} handler failed.`, error);
  }
}

function shouldDeferBestEffortHandler(handler: Function): boolean {
  return handler.constructor?.name === "AsyncFunction";
}

export function invokeBestEffortEventHandlerNonReentrant<TArgs extends unknown[]>(
  label: string,
  handler: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
): void {
  if (!handler) {
    return;
  }

  if (!shouldDeferBestEffortHandler(handler)) {
    invokeBestEffortEventHandler(label, handler, ...args);
    return;
  }

  // Nested isolate callbacks are marshalled as async proxy functions. Deferring them
  // to the next macrotask avoids re-entering the parent isolate while the child
  // operation is still on the stack, and nested wrappers already drain a few turns
  // before they resolve back into the isolate.
  setTimeout(() => {
    invokeBestEffortEventHandler(label, handler, ...args);
  }, 0);
}
