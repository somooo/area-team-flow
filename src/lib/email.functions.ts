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

    // Respect the recipient's email preference.
    if (st.email_notifications === false) {
      const { error } = await supabaseAdmin.from("email_outbox").insert({
        to_email: data.recipient_email,
        subject: data.subject,
        body: data.body,
        link: data.link ?? null,
        event_type: data.event_type,
        related_id: data.related_id ?? null,
        status: "skipped",
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, status: "skipped" };
    }

    // Record the attempt, then send immediately through the managed email API.
    const { data: row, error: insErr } = await supabaseAdmin
      .from("email_outbox")
      .insert({
        to_email: data.recipient_email,
        subject: data.subject,
        body: data.body,
        link: data.link ?? null,
        event_type: data.event_type,
        related_id: data.related_id ?? null,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) return { ok: false, error: insErr.message };

    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    let status = "sent";
    try {
      await sendTemplateEmail("request-notification", data.recipient_email, {
        templateData: {
          subject: data.subject,
          message: data.body,
          link: data.link,
        },
        idempotencyKey: `${data.event_type}-${data.related_id ?? row.id}`,
      });
    } catch (e) {
      status = "failed";
      console.error("email send failed:", e);
    }

    await supabaseAdmin
      .from("email_outbox")
      .update({ status })
      .eq("id", row.id);
    return { ok: status === "sent", status };
  });
