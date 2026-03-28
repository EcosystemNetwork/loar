/**
 * Mock for the `ponder:registry` virtual module.
 * Captures handler callbacks so tests can invoke them directly.
 */
export const registeredHandlers: Record<string, (args: any) => Promise<void>> = {};

export const ponder = {
  on(event: string, handler: (args: any) => Promise<void>) {
    registeredHandlers[event] = handler;
  },
};
