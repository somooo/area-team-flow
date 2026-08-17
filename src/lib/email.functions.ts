import { createServerFn } from "@tanstack/react-start";

export const enqueueEmail = createServerFn({ method: "POST" })
  .inputValidator((d: {
    recipient_email: string;
    subject: string;
    body: string;
    link?: string;
    event_type: string;
    related_id?: string;
  }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: st } = await supabaseAdmin
      .from("staff")
      .select("id, email_notifications")
      .ilike("email", data.recipient_email)
      .maybeSingle();
    if (!st) return { ok: false, error: "recipient not found" };
    const status = st.email_notifications === false ? "skipped" : "queued";
    const { error } = await supabaseAdmin.from("email_outbox").insert({
      to_email: data.recipient_email,
      subject: data.subject,
      body: data.body,
      link: data.link ?? null,
      event_type: data.event_type,
      related_id: data.related_id ?? null,
      status,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, status };
  });
