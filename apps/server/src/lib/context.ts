import type { Context as HonoContext } from "hono";
import { verifyAuth } from "./auth";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const user = await verifyAuth(context.req.raw.headers);
  return { user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
