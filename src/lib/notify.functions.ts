import { createServerFn } from "@tanstack/react-start";

export const notify = createServerFn({ method: "POST" })
  .inputValidator((payload: Record<string, unknown>) => payload)
  .handler(async ({ data }) => {
    const url = process.env.N8N_WEBHOOK_URL;
    if (!url) {
      console.log("[notify] N8N_WEBHOOK_URL not set, payload:", data);
      return { ok: false, skipped: true };
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      console.log("[notify] status", res.status);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      console.error("[notify] failed", e);
      return { ok: false, error: String(e) };
    }
  });