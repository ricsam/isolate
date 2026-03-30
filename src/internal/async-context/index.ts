import type ivm from "@ricsam/isolated-vm";

const ASYNC_CONTEXT_BOOTSTRAP = `
(function() {
  if (globalThis.__isolateAsyncContextInternals) {
    return;
  }

  const AsyncContext = globalThis.AsyncContext;
  const native = globalThis.__ivmAsyncContextInternal;
  if (
    !AsyncContext
    || typeof AsyncContext.Variable !== "function"
    || typeof AsyncContext.Snapshot !== "function"
    || !native
    || typeof native.getContinuationPreservedEmbedderData !== "function"
    || typeof native.setContinuationPreservedEmbedderData !== "function"
  ) {
    throw new Error(
      "The installed isolated-vm runtime does not expose async context support. " +
      "Install the async-context-enabled isolate engine build."
    );
  }

  class AsyncContextFrame extends Map {
    constructor(store, value) {
      super(AsyncContextFrame.current() ?? undefined);
      if (arguments.length > 0) {
        this.set(store, value);
      }
    }

    static current() {
      return native.getContinuationPreservedEmbedderData();
    }

    static set(frame) {
      native.setContinuationPreservedEmbedderData(frame);
    }

    static exchange(frame) {
      const prior = this.current();
      this.set(frame);
      return prior;
    }

    static disable(store) {
      const frame = this.current();
      frame?.delete(store);
    }
  }

  Object.defineProperty(AsyncContextFrame, "enabled", {
    configurable: true,
    enumerable: false,
    value: true,
  });
  const currentAsyncResource = new AsyncContext.Variable({
    name: "isolate.asyncResource",
    defaultValue: undefined,
  });

  const wrapCallback = (callback) => {
    if (typeof callback !== "function") {
      return callback;
    }
    return AsyncContext.Snapshot.wrap(callback);
  };

  Object.defineProperty(globalThis, "__isolateAsyncContextInternals", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: {
      AsyncContextFrame,
      currentAsyncResource,
      wrapCallback,
    },
  });
})();
`;

export interface AsyncContextHandle {
  supported: boolean;
}

export async function setupAsyncContext(context: ivm.Context): Promise<AsyncContextHandle> {
  const supported = context.evalSync(`
    typeof globalThis.AsyncContext === "object"
      && typeof globalThis.AsyncContext?.Variable === "function"
      && typeof globalThis.AsyncContext?.Snapshot === "function"
      && typeof globalThis.__ivmAsyncContextInternal === "object"
      && typeof globalThis.__ivmAsyncContextInternal?.getContinuationPreservedEmbedderData === "function"
      && typeof globalThis.__ivmAsyncContextInternal?.setContinuationPreservedEmbedderData === "function"
  `) as boolean;

  if (!supported) {
    throw new Error(
      "The installed isolated-vm runtime does not support AsyncContext. " +
      "Use the async-context-enabled isolate engine build."
    );
  }

  context.evalSync(ASYNC_CONTEXT_BOOTSTRAP);
  return { supported };
}
