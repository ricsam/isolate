import type { RuntimeDiagnostics } from "../types.ts";

export interface MutableRuntimeDiagnostics extends RuntimeDiagnostics {
  activeRequests: number;
  activeResources: number;
  pendingFetches: number;
  pendingTools: number;
  streamCount: number;
  lifecycleState: "idle" | "active" | "reloading" | "disposing";
}

export function createRuntimeDiagnostics(): MutableRuntimeDiagnostics {
  return {
    activeRequests: 0,
    activeResources: 0,
    pendingFetches: 0,
    pendingTools: 0,
    streamCount: 0,
    lifecycleState: "idle",
  };
}
