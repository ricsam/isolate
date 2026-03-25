import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage<{
  requestId?: string;
  metadata: Record<string, string>;
  signal?: AbortSignal;
}>();

export function withRequestContext<T>(
  context: { requestId?: string; metadata?: Record<string, string>; signal?: AbortSignal },
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(
    {
      requestId: context.requestId,
      metadata: context.metadata ?? {},
      signal: context.signal,
    },
    fn,
  );
}

export function getRequestContext(): {
  requestId?: string;
  metadata: Record<string, string>;
  signal?: AbortSignal;
} {
  return requestContextStorage.getStore() ?? { metadata: {} };
}
