import type ivm from "isolated-vm";

export interface ConsoleOptions {
  onLog?: (level: string, ...args: unknown[]) => void;
}

export interface ConsoleHandle {
  dispose(): void;
}

/**
 * Setup console API in an isolated-vm context
 *
 * Injects console.log, console.warn, console.error, console.info, console.debug
 *
 * @example
 * const handle = await setupConsole(context, {
 *   onLog: (level, ...args) => console.log(`[${level}]`, ...args)
 * });
 */
export async function setupConsole(
  context: ivm.Context,
  options?: ConsoleOptions
): Promise<ConsoleHandle> {
  // TODO: Implement console setup for isolated-vm
  return {
    dispose() {
      // TODO: Cleanup resources
    },
  };
}
