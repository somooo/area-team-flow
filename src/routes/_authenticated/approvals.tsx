import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { notify } from "@/lib/notify.functions";
import { applyScheduleChange } from "@/lib/schedule-change.functions";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications.functions";
import { isAdmin } from "@/lib/permissions";
import { VacationChangeApprovals } from "@/components/VacationChangeApprovals";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({ meta: [{ title: "Approvals — KADIR Staff Management" }] }),
  component: ApprovalsPage,
});

type Leave = { id: string; staff_email: string; staff_name: string; area: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; approver_email: string | null; stage: string | null; covering_supervisor_email: string | null };
type Change = { id: string; requester_email: string; requester_name: string; area: string; change_type: string; target_staff_name: string; details: string | null; status: string };
type Pre = { id: string; requester_email: string; requester_name: string; area: string; request_type: string; target_month: string; requested_dates: string[]; details: string | null; status: string };
type SickCall = { staff_name: string; staff_code: string; covered_by: string; coverage_type: string };
type TlReport = { id: string; reporter_name: string; reporter_email: string; area: string; layer: string; shift_date: string; sick_calls: SickCall[]; comment: string | null; status: string };

function ApprovalsPage() {
  const { me } = useMe();
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [pre, setPre] = useState<Pre[]>([]);
  const [reports, setReports] = useState<TlReport[]>([]);

  const role = me?.staff?.role as string | undefined;
  const canApprove = role === "supervisor" || role === "admin" || role === "team_leader";
  const admin = isAdmin(me?.staff);

  const load = async () => {
    const [{ data: lv }, { data: ch }, { data: pr }, { data: tl }] = await Promise.all([
      supabase.from("leave_requests").select("*").eq("status", "Pending").order("created_at", { ascending: false }),
      supabase.from("schedule_change_requests").select("*").eq("status", "Pending Supervisor").order("created_at", { ascending: false }),
      supabase.from("preschedule_requests").select("*").eq("status", "Pending").order("created_at", { ascending: false }),
      supabase.from("team_leader_reports").select("*").eq("status", "Pending").order("shift_date", { ascending: false }),
    ]);
    setLeaves((lv as Leave[]) ?? []);
    setChanges((ch as Change[]) ?? []);
    setPre((pr as Pre[]) ?? []);
    setReports((tl as unknown as TlReport[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.email]);

  if (!canApprove) return <p>Approvals are limited to supervisors, team leaders and admins.</p>;

  const decideLeave = async (r: Leave, status: "Approved" | "Rejected") => {
    // Supervisor-calendar vacations: covering supervisor approves first, then admin.
    // Admin can override and approve at any stage.
    if (status === "Approved" && r.stage === "covering" && !admin) {
      const { data: admin } = await supabase.from("staff").select("email").eq("role", "admin").limit(1).maybeSingle();
      if (!admin?.email) { toast.error("No admin available for final approval"); return; }
      const { error: e1 } = await supabase.from("leave_requests")
        .update({ stage: "admin", approver_email: admin.email }).eq("id", r.id);
      if (e1) { toast.error(e1.message); return; }
      await logAudit({ action: "leave_covering_approved", entity_type: "leave_request", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role });
      await createNotification({ data: { recipient_email: admin.email, title: "Supervisor vacation — final approval", body: `${r.staff_name}: ${r.start_date} → ${r.end_date}`, link: "/approvals" } });
      await createNotification({ data: { recipient_email: r.staff_email, title: "Covering supervisor approved", body: "Pending admin approval", link: "/vacations" } });
      toast.success("Sent to admin for final approval");
      load();
      return;
    }
    const { error } = await supabase.from("leave_requests").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_decided", staff_name: r.staff_name, staff_email: r.staff_email, status, start_date: r.start_date, end_date: r.end_date } });
    await logAudit({ action: `leave_${status.toLowerCase()}`, entity_type: "leave_request", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role, details: { leave_type: r.leave_type } });
    await createNotification({ data: { recipient_email: r.staff_email, title: `Leave ${status.toLowerCase()}`, body: `${r.leave_type} ${r.start_date} → ${r.end_date}`, link: "/dashboard" } });
    toast.success(`Leave ${status.toLowerCase()}`);
    load();
  };
  const decideChange = async (r: Change, approve: boolean) => {
    if (approve) {
      try {
        await applyScheduleChange({ data: { requestId: r.id } });
        await notify({ data: { event: "change_decided", change_type: r.change_type, status: "Approved", staff_email: r.requester_email, staff_name: r.requester_name } });
        await logAudit({ action: "change_approved", entity_type: "schedule_change_request", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role });
        await createNotification({ data: { recipient_email: r.requester_email, title: "Change request approved", body: r.change_type, link: "/dashboard" } });
      } catch (e) { toast.error(String(e)); return; }
    } else {
      const { error } = await supabase.from("schedule_change_requests").update({ supervisor_response: "Rejected", status: "Rejected" }).eq("id", r.id);
      if (error) { toast.error(error.message); return; }
      await notify({ data: { event: "change_decided", change_type: r.change_type, status: "Rejected", staff_email: r.requester_email, staff_name: r.requester_name } });
      await logAudit({ action: "change_rejected", entity_type: "schedule_change_request", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role });
      await createNotification({ data: { recipient_email: r.requester_email, title: "Change request rejected", body: r.change_type, link: "/dashboard" } });
    }
    load();
  };
  const decidePre = async (r: Pre, status: "Approved" | "Rejected") => {
    const { error } = await supabase.from("preschedule_requests").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: `preschedule_${status.toLowerCase()}`, entity_type: "preschedule_request", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role });
    await createNotification({ data: { recipient_email: r.requester_email, title: `Pre-schedule ${status.toLowerCase()}`, link: "/preschedule" } });
    toast.success(`Pre-schedule ${status.toLowerCase()}`);
    load();
  };

  const decideReport = async (r: TlReport, status: "Reviewed" | "Rejected") => {
    const { error } = await supabase.from("team_leader_reports").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: `tl_report_${status.toLowerCase()}`, entity_type: "team_leader_report", entity_id: r.id, area: r.area, actor_email: me?.staff?.email, actor_role: role });
    await createNotification({ data: { recipient_email: r.reporter_email, title: `Shift report ${status.toLowerCase()}`, body: `${r.shift_date} · ${r.layer}`, link: "/dashboard" } });
    toast.success(`Report ${status.toLowerCase()}`);
    load();
  };

  const total = leaves.length + changes.length + pre.length + reports.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            {admin ? "Unified inbox — every pending request across all areas." : "Unified inbox for pending requests."}
          </p>
        </div>
        <Badge variant="secondary">{total} pending</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Vacation / Sick leave</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {leaves.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {leaves.map(l => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 border rounded-md p-3">
              <div>
                <div className="font-medium">{l.staff_name} · {l.leave_type} <span className="text-xs text-muted-foreground">({l.area})</span></div>
                <div className="text-xs text-muted-foreground">
                  {l.start_date} → {l.end_date}{l.reason ? ` · ${l.reason}` : ""}
                  {l.stage === "covering" && " · Pending covering supervisor approval"}
                  {l.stage === "admin" && " · Pending admin approval"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decideLeave(l, "Approved")}>
                  {admin && l.stage === "covering" ? "Approve (override)" : "Approve"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => decideLeave(l, "Rejected")}>Reject</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Team Leader reports</CardTitle></CardHeader>
*** PLACEHOLDER ***
        <CardContent className="space-y-2">
          {reports.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {reports.map(r => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border rounded-md p-3">
              <div>
                <div className="font-medium">{r.reporter_name} · {r.shift_date} · {r.layer} <span className="text-xs text-muted-foreground">({r.area})</span></div>
                <div className="text-xs text-muted-foreground">
                  {(r.sick_calls ?? []).map(c => `${c.staff_name} (${c.staff_code}) → ${c.covered_by} · ${c.coverage_type === "overtime" ? "overtime" : "area pull"}`).join(" | ") || "No sick calls"}
                  {r.comment ? ` · ${r.comment}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decideReport(r, "Reviewed")}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decideReport(r, "Rejected")}>Reject</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pre-schedule requests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pre.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {pre.map(r => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border rounded-md p-3">
              <div>
                <div className="font-medium">{r.requester_name} · {r.request_type} <span className="text-xs text-muted-foreground">({r.area})</span></div>
                <div className="text-xs text-muted-foreground">Month {r.target_month.slice(0, 7)} · dates: {r.requested_dates.join(", ") || "—"} · {r.details}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decidePre(r, "Approved")}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decidePre(r, "Rejected")}>Reject</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>In-month schedule changes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {changes.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
          {changes.map(c => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border rounded-md p-3">
              <div>
                <div className="font-medium">{c.requester_name} → {c.target_staff_name} · {c.change_type} <span className="text-xs text-muted-foreground">({c.area})</span></div>
                <div className="text-xs text-muted-foreground">{c.details}</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decideChange(c, true)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decideChange(c, false)}>Reject</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}