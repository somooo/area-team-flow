import { supabase } from "@/integrations/supabase/client";

export type ApproverInput = {
  email: string;
  supervisor_email?: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
  area?: string | null;
};

/**
 * Resolve the approver for a request.
 *
 * Routing never depends on free-text directory fields (they go stale on import).
 * The database function walks a strict chain and always lands on a real, active
 * person: area approver -> all-areas approver -> admin, honoring delegation.
 * The requester is never their own approver.
 */
export async function resolveApprover(me: ApproverInput): Promise<string | null> {
  const { data, error } = await supabase.rpc("resolve_approver", { _area: me.area ?? undefined });
  if (error) return null;
  const approver = (data as string | null)?.toLowerCase() ?? null;
  if (approver && approver === me.email?.toLowerCase()) {
    // Self-approval is not a route: fall back to an all-areas approver / admin.
    const { data: alt } = await supabase.rpc("resolve_approver", { _area: undefined });
    const altEmail = (alt as string | null)?.toLowerCase() ?? null;
    return altEmail && altEmail !== approver ? altEmail : approver;
  }
  return approver;
}

/** Hours allowed to respond before a request is overdue. */
export const SLA_HOURS = { leave: 48, change: 24, preschedule: 48 } as const;

export function slaDeadline(kind: keyof typeof SLA_HOURS, from: Date = new Date()): string {
  return new Date(from.getTime() + SLA_HOURS[kind] * 3600_000).toISOString();
}

export type SlaState = { label: string; className: string; overdue: boolean };

export function slaState(deadline: string | null | undefined): SlaState | null {
  if (!deadline) return null;
  const msLeft = new Date(deadline).getTime() - Date.now();
  const hours = msLeft / 3600_000;
  if (hours < 0) {
    const late = Math.max(1, Math.round(-hours));
    return { label: `Overdue ${late}h`, className: "bg-destructive/15 text-destructive border-destructive/30", overdue: true };
  }
  if (hours < 24) {
    return { label: `Due in ${Math.max(1, Math.round(hours))}h`, className: "bg-amber-100 text-amber-900 border-amber-300", overdue: false };
  }
  return { label: `${Math.round(hours / 24)}d left`, className: "bg-emerald-100 text-emerald-900 border-emerald-300", overdue: false };
}
