import { createServerFn } from "@tanstack/react-start";

export const createNotification = createServerFn({ method: "POST" })
  .inputValidator((d: { recipient_email: string; title: string; body?: string; link?: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: st } = await supabaseAdmin
      .from("staff").select("id").ilike("email", data.recipient_email).maybeSingle();
    if (!st) return { ok: false, error: "recipient not found" };
    const { error } = await supabaseAdmin.from("notifications").insert({
      recipient_staff_id: st.id,
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });