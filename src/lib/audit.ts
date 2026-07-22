import { supabase } from "@/integrations/supabase/client";

export async function logAudit(input: {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  area?: string | null;
  details?: Record<string, unknown>;
  actor_email?: string | null;
  actor_role?: string | null;
}) {
  try {
    await supabase.from("audit_logs").insert({
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      area: input.area ?? null,
      details: (input.details ?? {}) as never,
      actor_email: input.actor_email ?? null,
      actor_role: input.actor_role ?? null,
    });
  } catch (e) {
    console.warn("audit log failed", e);
  }
}