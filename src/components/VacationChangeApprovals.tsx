import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications.functions";

type Leave = {
  id: string; staff_email: string; staff_name: string; area: string;
  start_date: string; end_date: string; status: string;
  covering_supervisor_email: string | null; stage: string | null;
};
type Row = {
  id: string; leave_request_id: string; requested_by: string; type: string;
  new_start_date: string | null; new_end_date: string | null; reason: string | null;
  created_at: string; leave: Leave | null; badge: string | null;
};

/** Pending staff-initiated cancel/adjust requests, decided by supervisors and admins. */
export function VacationChangeApprovals({
  actor,
  onDecided,
}: {
  actor: { email: string; name: string; role: string };
  onDecided?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("vacation_change_requests")
      .select("id,leave_request_id,requested_by,type,new_start_date,new_end_date,reason,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const reqs = (data ?? []) as Omit<Row, "leave" | "badge">[];
    if (reqs.length === 0) { setRows([]); return; }
    const { data: lv } = await supabase
      .from("leave_requests")
      .select("id,staff_email,staff_name,area,start_date,end_date,status,covering_supervisor_email,stage")
      .in("id", reqs.map((r) => r.leave_request_id));
    const byId = new Map(((lv ?? []) as Leave[]).map((l) => [l.id, l]));
    const emails = Array.from(new Set(((lv ?? []) as Leave[]).map((l) => l.staff_email.toLowerCase())));
    const { data: st } = await supabase.from("staff").select("email,badge_id").in("email", emails);
    const badges = new Map(((st ?? []) as { email: string; badge_id: string | null }[])
      .map((s) => [s.email.toLowerCase(), s.badge_id]));
    setRows(reqs.map((r) => {
      const leave = byId.get(r.leave_request_id) ?? null;
      return { ...r, leave, badge: leave ? badges.get(leave.staff_email.toLowerCase()) ?? null : null };
    }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const finish = async (r: Row, status: "approved" | "rejected", decisionReason?: string) => {
    const { error } = await supabase.from("vacation_change_requests")
      .update({ status, decided_by: actor.email.toLowerCase(), decided_at: new Date().toISOString(), decision_reason: decisionReason ?? null })
      .eq("id", r.id).eq("status", "pending");
    if (error) { toast.error(error.message); return false; }
    await logAudit({
      action: status === "approved" ? "vacation_change_request_approved" : "vacation_change_request_rejected",
      entity_type: "vacation_change_request",
      entity_id: r.id,
      area: r.leave?.area ?? null,
      details: {
        leave_request_id: r.leave_request_id,
        type: r.type,
        requested_by: r.requested_by,
        from: r.leave ? [r.leave.start_date, r.leave.end_date] : null,
        to: r.type === "adjust" ? [r.new_start_date, r.new_end_date] : null,
        decision_reason: decisionReason ?? null,
        actor_name: actor.name,
      },
    });
    await createNotification({ data: {
      recipient_email: r.requested_by,
      title: `Vacation ${r.type === "cancel" ? "cancellation" : "adjustment"} ${status}`,
      body: decisionReason ? `Reason: ${decisionReason}` : (r.leave ? `${r.leave.start_date} → ${r.leave.end_date}` : ""),
      link: "/vacations",
    } });
    return true;
  };

  const approve = async (r: Row) => {
    if (!r.leave) { toast.error("The original vacation no longer exists"); return; }
    setBusy(true);
    try {
      if (r.type === "cancel") {
        const { error } = await supabase.from("leave_requests").update({ status: "Cancelled" }).eq("id", r.leave.id);
        if (error) { toast.error(error.message); return; }
        if (r.leave.covering_supervisor_email) {
          await logAudit({
            action: "cover_cancelled", entity_type: "leave_request", entity_id: r.leave.id, area: r.leave.area,
            details: { covering_supervisor_email: r.leave.covering_supervisor_email, start_date: r.leave.start_date, end_date: r.leave.end_date, actor_name: actor.name },
          });
          await createNotification({ data: {
            recipient_email: r.leave.covering_supervisor_email,
            title: "Cover cancelled",
            body: `${r.leave.staff_name}: ${r.leave.start_date} → ${r.leave.end_date} was cancelled`,
            link: "/vacations",
          } });
        }
      } else {
        if (!r.new_start_date || !r.new_end_date) { toast.error("The request has no new dates"); return; }
        const useOverride = overrideFor === r.id && overrideReason.trim().length > 0;
        const { error } = await supabase.from("leave_requests").update({
          start_date: r.new_start_date,
          end_date: r.new_end_date,
          ...(useOverride ? { over_cap_override: true, over_cap_reason: overrideReason.trim() } : {}),
        }).eq("id", r.leave.id);
        if (error) {
          setBlocked((b) => ({ ...b, [r.id]: error.message }));
          setOverrideFor(r.id);
          toast.error(error.message);
          return;
        }
        if (useOverride) {
          await logAudit({
            action: "vacation_cap_override",
            entity_type: "leave_request",
            entity_id: r.leave.id,
            area: r.leave.area,
            details: { start_date: r.new_start_date, end_date: r.new_end_date, reason: overrideReason.trim(), source: "change_request_approval", actor_name: actor.name },
          });
        }
        // Supervisor vacations: extra days need the cover to accept again.
        const addsDays = r.new_start_date < r.leave.start_date || r.new_end_date > r.leave.end_date;
        if (r.leave.area === "Supervisors" && r.leave.covering_supervisor_email && addsDays) {
          await supabase.from("leave_requests").update({
            stage: "covering",
            status: "Pending",
            cover_accepted_at: null,
            cover_decline_reason: null,
            approver_email: r.leave.covering_supervisor_email,
          }).eq("id", r.leave.id);
          await logAudit({
            action: "cover_nominated", entity_type: "leave_request", entity_id: r.leave.id, area: r.leave.area,
            details: { covering_supervisor_email: r.leave.covering_supervisor_email, start_date: r.new_start_date, end_date: r.new_end_date, source: "adjustment_added_days" },
          });
          await createNotification({ data: {
            recipient_email: r.leave.covering_supervisor_email,
            title: "Cover request — extended dates",
            body: `${r.leave.staff_name}: ${r.new_start_date} → ${r.new_end_date}`,
            link: "/approvals",
          } });
        }
      }
      const ok = await finish(r, "approved");
      if (!ok) return;
      setBlocked((b) => { const n = { ...b }; delete n[r.id]; return n; });
      setOverrideFor(null); setOverrideReason("");
      toast.success(r.type === "cancel" ? "Vacation cancelled — days freed" : "Vacation dates updated");
      await load(); onDecided?.();
    } finally {
      setBusy(false);
    }
  };

  const reject = async (r: Row) => {
    if (!rejectReason.trim()) { toast.error("A rejection reason is required"); return; }
    setBusy(true);
    const ok = await finish(r, "rejected", rejectReason.trim());
    setBusy(false);
    if (!ok) return;
    setRejectFor(null); setRejectReason("");
    toast.success("Change request rejected — the vacation is unchanged");
    await load(); onDecided?.();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Vacation change requests</CardTitle>
        <Badge variant="secondary">{rows.length} pending</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {rows.map((r) => (
          <div key={r.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">
                  {r.leave?.staff_name ?? "Unknown staff"}
                  {r.badge ? <span className="text-xs text-muted-foreground"> · badge {r.badge}</span> : null}
                  <span className="text-xs text-muted-foreground"> ({r.leave?.area ?? "—"})</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Current: {r.leave ? `${r.leave.start_date} → ${r.leave.end_date}` : "—"}
                  {" · "}
                  {r.type === "cancel"
                    ? "Requested: cancelled"
                    : `Requested: ${r.leave?.start_date} → ${r.leave?.end_date} ⇒ ${r.new_start_date} → ${r.new_end_date}`}
                </div>
                {r.reason && <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>}
                <div className="text-[11px] text-muted-foreground">
                  Requested by {r.requested_by} · {new Date(r.created_at).toLocaleString("en-GB")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => approve(r)}>Approve</Button>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => { setRejectFor(rejectFor === r.id ? null : r.id); setRejectReason(""); }}>
                  Reject
                </Button>
              </div>
            </div>

            {blocked[r.id] && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p className="text-[11px] text-destructive">{blocked[r.id]}</p>
                <Label className="text-xs">Override reason (required to approve over cap)</Label>
                <Input value={overrideFor === r.id ? overrideReason : ""} onChange={(e) => { setOverrideFor(r.id); setOverrideReason(e.target.value); }} />
                <Button size="sm" disabled={busy || !(overrideFor === r.id && overrideReason.trim())} onClick={() => approve(r)}>
                  Approve with override
                </Button>
              </div>
            )}

            {rejectFor === r.id && (
              <div className="space-y-2 rounded-md border p-2">
                <Label className="text-xs">Rejection reason (required)</Label>
                <Textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setRejectFor(null); setRejectReason(""); }}>Back</Button>
                  <Button size="sm" variant="destructive" disabled={busy || !rejectReason.trim()} onClick={() => reject(r)}>
                    Confirm rejection
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
