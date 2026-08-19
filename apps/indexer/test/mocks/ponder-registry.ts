export type Handler = (args: { event: any; context: any }) => Promise<void>;

export const handlers = new Map<string, Handler>();

export const ponder = {
  on(name: string, handler: Handler) {
    handlers.set(name, handler);
  },
};
