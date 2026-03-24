import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage<{
  requestId?: string;
  metadata: Record<string, string>;
}>();

export function withRequestContext<T>(
  context: { requestId?: string; metadata?: Record<string, string> },
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(
    {
      requestId: context.requestId,
      metadata: context.metadata ?? {},
    },
    fn,
  );
}

export function getRequestContext(): { requestId?: string; metadata: Record<string, string> } {
  return requestContextStorage.getStore() ?? { metadata: {} };
}
