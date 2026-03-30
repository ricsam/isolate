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
    || typeof native.setPromiseHooks !== "function"
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

  const topLevelResource = {};
  const topLevelExecutionState = {
    asyncId: 1,
    triggerAsyncId: 0,
    type: "ROOT",
    resource: topLevelResource,
    destroyed: false,
  };
  const currentExecutionState = new AsyncContext.Variable({
    name: "isolate.executionState",
    defaultValue: topLevelExecutionState,
  });

  const promiseStateByPromise = new WeakMap();
  const activeHooks = new Map();
  const promiseFrameStack = [];
  const kWrappedState = Symbol("isolate.asyncResourceState");
  const kWrappedDestroy = Symbol("isolate.destroyAsyncResource");
  let nextAsyncId = 2;
  let hookDispatchDepth = 0;
  let promiseHooksEnabled = false;

  function getCurrentExecutionState() {
    return currentExecutionState.get();
  }

  function normalizeType(type, fallback) {
    if (typeof type === "string" && type.length > 0) {
      return type;
    }
    return fallback;
  }

  function normalizeTriggerAsyncId(triggerAsyncId) {
    return Number.isSafeInteger(triggerAsyncId) && triggerAsyncId >= 0
      ? triggerAsyncId
      : undefined;
  }

  function dispatchHook(name, args) {
    if (hookDispatchDepth > 0 || activeHooks.size === 0) {
      return;
    }

    hookDispatchDepth++;
    try {
      for (const [hook, callbacks] of Array.from(activeHooks.entries())) {
        const callback = callbacks[name];
        if (typeof callback === "function") {
          Reflect.apply(callback, hook, args);
        }
      }
    } finally {
      hookDispatchDepth--;
    }
  }

  function createResource(type, resource, options = {}) {
    const normalizedOptions =
      options && typeof options === "object" ? options : {};
    const state = {
      asyncId: nextAsyncId++,
      triggerAsyncId:
        normalizeTriggerAsyncId(normalizedOptions.triggerAsyncId)
        ?? getCurrentExecutionState().asyncId,
      type: normalizeType(type, "isolate.resource"),
      resource:
        resource !== undefined && resource !== null ? resource : {},
      destroyed: false,
    };

    if (normalizedOptions.emitInit !== false) {
      dispatchHook("init", [
        state.asyncId,
        state.type,
        state.triggerAsyncId,
        state.resource,
      ]);
    }

    return state;
  }

  function enterResource(resourceState) {
    return AsyncContextFrame.exchange(
      new AsyncContextFrame(currentExecutionState, resourceState),
    );
  }

  function destroyResource(resourceState) {
    if (!resourceState || resourceState.destroyed) {
      return false;
    }
    resourceState.destroyed = true;
    dispatchHook("destroy", [resourceState.asyncId]);
    return true;
  }

  function runWithResource(resourceState, fn, thisArg, args) {
    const priorFrame = enterResource(resourceState);
    let didRunBeforeHook = false;
    try {
      dispatchHook("before", [resourceState.asyncId]);
      didRunBeforeHook = true;
      return Reflect.apply(fn, thisArg, args);
    } finally {
      try {
        if (didRunBeforeHook) {
          dispatchHook("after", [resourceState.asyncId]);
        }
      } finally {
        AsyncContextFrame.set(priorFrame);
      }
    }
  }

  function wrapCallback(callback, options = {}) {
    if (typeof callback !== "function") {
      return callback;
    }

    const normalizedOptions =
      options && typeof options === "object" ? options : {};
    const snapshot = new AsyncContext.Snapshot();
    const resourceState = createResource(
      normalizedOptions.type,
      normalizedOptions.resource,
      normalizedOptions,
    );

    function wrapped(...args) {
      const thisArg = normalizedOptions.thisArg === undefined
        ? this
        : normalizedOptions.thisArg;
      return snapshot.run(
        () => runWithResource(resourceState, callback, thisArg, args),
      );
    }

    try {
      Object.defineProperty(wrapped, "name", {
        configurable: true,
        value: callback.name ? "wrapped " + callback.name : "wrapped",
      });
    } catch {}

    Object.defineProperty(wrapped, kWrappedState, {
      configurable: false,
      enumerable: false,
      value: resourceState,
      writable: false,
    });
    Object.defineProperty(wrapped, kWrappedDestroy, {
      configurable: false,
      enumerable: false,
      value: () => destroyResource(resourceState),
      writable: false,
    });

    return wrapped;
  }

  function releaseCallback(callback) {
    if (typeof callback !== "function") {
      return false;
    }
    const destroy = callback[kWrappedDestroy];
    if (typeof destroy === "function") {
      return destroy();
    }
    return false;
  }

  function onPromiseInit(promise, parentPromise) {
    const parentState = (
      parentPromise && typeof parentPromise === "object"
        ? promiseStateByPromise.get(parentPromise)
        : undefined
    );
    const promiseState = createResource("PROMISE", promise, {
      triggerAsyncId: parentState?.asyncId ?? getCurrentExecutionState().asyncId,
    });
    promiseStateByPromise.set(promise, promiseState);
  }

  function onPromiseBefore(promise) {
    const promiseState = promiseStateByPromise.get(promise);
    if (!promiseState) {
      return;
    }
    const priorFrame = enterResource(promiseState);
    promiseFrameStack.push(priorFrame);
    try {
      dispatchHook("before", [promiseState.asyncId]);
    } catch (error) {
      promiseFrameStack.pop();
      AsyncContextFrame.set(priorFrame);
      throw error;
    }
  }

  function onPromiseAfter(promise) {
    const promiseState = promiseStateByPromise.get(promise);
    if (!promiseState) {
      return;
    }
    const priorFrame = promiseFrameStack.pop();
    try {
      dispatchHook("after", [promiseState.asyncId]);
    } finally {
      AsyncContextFrame.set(priorFrame);
    }
  }

  function onPromiseResolve(promise) {
    const promiseState = promiseStateByPromise.get(promise);
    if (!promiseState) {
      return;
    }
    dispatchHook("promiseResolve", [promiseState.asyncId]);
  }

  function refreshPromiseHooks() {
    if (activeHooks.size > 0) {
      if (!promiseHooksEnabled) {
        native.setPromiseHooks(
          onPromiseInit,
          onPromiseBefore,
          onPromiseAfter,
          onPromiseResolve,
        );
        promiseHooksEnabled = true;
      }
      return;
    }

    if (promiseHooksEnabled) {
      native.setPromiseHooks(undefined, undefined, undefined, undefined);
      promiseFrameStack.length = 0;
      promiseHooksEnabled = false;
    }
  }

  function enableHook(hook, callbacks) {
    activeHooks.set(hook, callbacks);
    refreshPromiseHooks();
  }

  function disableHook(hook) {
    activeHooks.delete(hook);
    refreshPromiseHooks();
  }

  Object.defineProperty(globalThis, "__isolateAsyncContextInternals", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: {
      AsyncContextFrame,
      topLevelExecutionState,
      currentExecutionState,
      getCurrentExecutionState,
      executionAsyncId() {
        return getCurrentExecutionState().asyncId;
      },
      triggerAsyncId() {
        return getCurrentExecutionState().triggerAsyncId;
      },
      executionAsyncResource() {
        return getCurrentExecutionState().resource;
      },
      createResource,
      runWithResource,
      destroyResource,
      wrapCallback,
      releaseCallback,
      enableHook,
      disableHook,
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
      && typeof globalThis.__ivmAsyncContextInternal?.setPromiseHooks === "function"
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
