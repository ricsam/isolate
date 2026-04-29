export interface AbortableOperationOptions {
  signal?: AbortSignal;
  disposeOnAbort: (reason: string) => Promise<void>;
}

export type UnresponsiveDisposeHandler = (reason: string) => Promise<void>;

export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    const error = new Error(reason.message);
    error.name = "AbortError";
    (error as Error & { cause?: unknown }).cause = reason;
    return error;
  }

  const error = new Error(
    typeof reason === "string" && reason.length > 0
      ? reason
      : "The operation was aborted.",
  );
  error.name = "AbortError";
  return error;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isTerminalExecutionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "TimeoutError" ||
    /^(Execution|Test) timed out after \d+ms$/i.test(error.message) ||
    /Runtime execution timed out after \d+ms/i.test(error.message) ||
    /Isolate was disposed during execution/i.test(error.message);
}

export async function runAbortableOperation<T>(
  operation: () => Promise<T>,
  options: AbortableOperationOptions,
): Promise<T> {
  const { signal } = options;
  if (!signal) {
    return await operation();
  }

  if (signal.aborted) {
    throw createAbortError(signal.reason);
  }

  let abortHandler: (() => void) | undefined;
  let abortError: Error | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      abortError = createAbortError(signal.reason);
      void options.disposeOnAbort(abortError.message).then(
        () => reject(abortError),
        () => reject(abortError),
      );
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  const operationPromise = operation().catch((error) => {
    if (abortError) {
      throw abortError;
    }
    throw error;
  });

  try {
    return await Promise.race([operationPromise, abortPromise]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

export async function disposeWithUnresponsiveFallback(
  dispose: () => Promise<void>,
  reason: string,
  onUnresponsiveDispose?: UnresponsiveDisposeHandler,
  timeoutMs = 250,
): Promise<void> {
  const disposePromise = dispose();
  disposePromise.catch(() => {});

  if (!onUnresponsiveDispose) {
    await disposePromise;
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const fallbackPromise = new Promise<void>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      void onUnresponsiveDispose(reason).then(resolve, reject);
    }, timeoutMs);
  });

  try {
    await Promise.race([disposePromise, fallbackPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
