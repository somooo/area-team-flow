import { supabase } from "@/integrations/supabase/client";

export type ApproverInput = {
  email: string;
  role: string;
  supervisor_email: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
};

/** Resolve the approver: the area supervisor, honoring their active delegation. */
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
  if (me.role === "supervisor" || me.role === "team_leader") {
    return me.delegation_active && me.delegated_to_email ? me.delegated_to_email : null;
  }
  return null;
}
