import { createServerFn } from "@tanstack/react-start";

/** Authoritative server clock — never trust the client device time for date rules. */
export const getServerNow = createServerFn({ method: "GET" }).handler(async () => {
  return { now: new Date().toISOString() };
});
