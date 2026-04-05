import { invokeBestEffortEventHandler } from "../internal/event-callback.ts";
import type { TestEvent } from "../types.ts";

interface TestEventApi {
  onEvent(handler: (event: TestEvent) => void): () => void;
}

export interface TestEventSubscriptions {
  readonly api: TestEventApi;
  emit(event: TestEvent): void;
  clear(): void;
  setEnsureUsable(ensureUsable?: () => void): void;
}

export function createTestEventSubscriptions(
  ensureUsable?: () => void,
): TestEventSubscriptions {
  let currentEnsureUsable = ensureUsable;
  const handlers = new Set<(event: TestEvent) => void>();

  return {
    api: {
      onEvent(handler) {
        currentEnsureUsable?.();
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    },
    emit(event) {
      for (const handler of handlers) {
        invokeBestEffortEventHandler("[isolate-test] Test event", handler, event);
      }
    },
    clear() {
      handlers.clear();
    },
    setEnsureUsable(nextEnsureUsable) {
      currentEnsureUsable = nextEnsureUsable;
    },
  };
}
