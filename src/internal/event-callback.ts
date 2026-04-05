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
