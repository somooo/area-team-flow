import { supabase } from "@/integrations/supabase/client";
import { canServer } from "@/lib/capabilities";

export type ApproverInput = {
  email: string;
  supervisor_email: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
  area?: string | null;
};

/**
 * Resolve the approver: the area's approver, honoring their active delegation.
 * Eligibility comes from the `leave.approve` capability, never from role text.
 */
export async function resolveApprover(me: ApproverInput): Promise<string | null> {
  if (me.supervisor_email) {
    const { data: sup } = await supabase
      .from("staff")
      .select("email,delegated_to_email,delegation_active")
      .ilike("email", me.supervisor_email)
      .maybeSingle();
    if (sup?.delegation_active && sup.delegated_to_email) return sup.delegated_to_email;
    return sup?.email ?? me.supervisor_email;
  }
  if (await canServer("leave.approve", me.area ?? null)) {
    return me.delegation_active && me.delegated_to_email ? me.delegated_to_email : null;
  }
  return null;
}
