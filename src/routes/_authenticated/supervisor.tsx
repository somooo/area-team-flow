import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { notify } from "@/lib/notify.functions";
import { applyScheduleChange } from "@/lib/schedule-change.functions";
import { MonthGrid, type StaffLite } from "@/components/MonthGrid";
import { exportExcel } from "@/lib/schedule-export";
import { ExcelImportButton, type ImportItem } from "@/components/ExcelImportButton";
import { planScheduleImport, type ImportedCell } from "@/lib/schedule-import";
import { canManageArea, isAdmin } from "@/lib/permissions";
import { ReferenceTable } from "@/components/ReferenceTable";
import { BookingLeaveDialog } from "@/components/BookingLeaveDialog";
import { toISODate } from "@/lib/roster";
import type { RosterShift, Duty, OtType } from "@/lib/roster";
import {
  codesForLayer, fetchAssignmentCodes, fetchZoneReference,
  type AssignmentCode, type ZoneReferenceRow,
} from "@/lib/assignments";
import { bedsideHoursInMonth, canTakeBedsideShift, isOfficeHoursRole, validateBedsideAssignment, BEDSIDE_SHIFT_HOURS } from "@/lib/hours-model";
import { AlertTriangle, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({ meta: [{ title: "Supervisor — KADIR Staff Management" }] }),
  component: SupervisorPage,
});

type Shift = RosterShift;
type Staff = { id: string; name: string; email: string; role: string; area: string | null; department: string | null; badge_id: string | null; supervisor_email: string | null; delegated_to_email: string | null; delegation_active: boolean };
type LeaveReq = { id: string; staff_email: string; staff_name: string; area: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; approver_email: string | null };
type ChangeReq = { id: string; requester_email: string; requester_name: string; area: string; change_type: string; source_shift_id: string; target_staff_email: string; target_staff_name: string; target_shift_id: string | null; details: string | null; staff_response: string; supervisor_response: string; status: string; approver_email: string | null };
type SickCall = { staff_name: string; staff_code: string; covered_by: string; coverage_type: string };
type TlReport = { id: string; reporter_name: string; reporter_email: string; area: string; layer: string; shift_date: string; assignment_code: string | null; sick_calls: SickCall[]; comment: string | null; status: string; created_at: string };

/** A staged, not-yet-saved schedule edit. */
type PendingEdit = {
  staff: StaffLite;
  date: string;
  existing?: Shift;
  /** null = remove the assignment */
  payload: null | {
    duty: Duty; unit_code: string | null; ot_type: OtType; hours: number; sick_tag: boolean;
  };
};

const keyOf = (email: string, date: string) => `${email.toLowerCase()}|${date}`;

function SupervisorPage() {
  const { me, reload } = useMe();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leaves, setLeaves] = useState<LeaveReq[]>([]);
  const [changes, setChanges] = useState<ChangeReq[]>([]);
  const [reports, setReports] = useState<TlReport[]>([]);
  const [supervisors, setSupervisors] = useState<Staff[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [viewArea, setViewArea] = useState("");
  const [layer, setLayer] = useState<"day" | "night">("day");
  const [codes, setCodes] = useState<AssignmentCode[]>([]);
  const [reference, setReference] = useState<ZoneReferenceRow[]>([]);
  const [editor, setEditor] = useState<{ staff: StaffLite; date: string; shift?: Shift } | null>(null);
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  const [saving, setSaving] = useState(false);

  const role = me?.staff?.role;
  const admin = isAdmin(me?.staff);
  const canManage = admin || role === "supervisor";
  /** Admin bypasses area scoping entirely; supervisors are limited to their own area. */
  const canEditViewedArea = canManageArea(me?.staff, viewArea);

  useEffect(() => {
    supabase.from("staff").select("area").not("area", "is", null).then(({ data }) => {
      const uniq = Array.from(new Set((data ?? []).map((r) => r.area as string).filter(Boolean))).sort();
      setAreas(uniq);
    });
  }, []);

  useEffect(() => {
    if (viewArea) return;
    if (me?.staff?.area) setViewArea(me.staff.area);
    else if (areas.includes("ICU")) setViewArea("ICU");
    else if (areas[0]) setViewArea(areas[0]);
  }, [me?.staff?.area, areas]);

  useEffect(() => {
    if (!viewArea) return;
    void fetchAssignmentCodes(viewArea).then(setCodes);
    void fetchZoneReference(viewArea).then(setReference);
  }, [viewArea]);

  const isAssistants = viewArea.toLowerCase() === "assistants";
  const effectiveLayer: "all" | "day" | "night" = isAssistants ? "all" : layer;

  const load = async () => {
    if (!canManage || !viewArea) return;
    const start = toISODate(new Date(year, month, 1));
    const end = toISODate(new Date(year, month + 1, 0));
    const [{ data: sh }, { data: st }, { data: lv }, { data: ch }, { data: sup }, { data: tl }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", viewArea).gte("date", start).lte("date", end).order("date"),
      supabase.from("staff").select("id,name,email,role,area,department,badge_id,supervisor_email,delegated_to_email,delegation_active").eq("area", viewArea).order("name"),
      supabase.from("leave_requests").select("*").eq("area", viewArea).order("created_at", { ascending: false }),
      supabase.from("schedule_change_requests").select("*").eq("area", viewArea).order("created_at", { ascending: false }),
      supabase.from("staff").select("id,name,email,role,area,department,badge_id,supervisor_email,delegated_to_email,delegation_active").eq("role", "supervisor"),
      supabase.from("team_leader_reports").select("*").eq("area", viewArea).order("shift_date", { ascending: false }).limit(30),
    ]);
    setShifts((sh as Shift[]) ?? []);
    setStaff((st as Staff[]) ?? []);
    setLeaves((lv as LeaveReq[]) ?? []);
    setChanges((ch as ChangeReq[]) ?? []);
    setSupervisors(((sup as Staff[]) ?? []).filter(s => s.email !== me?.staff?.email));
    setReports((tl as unknown as TlReport[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.email, year, month, viewArea]);

  /** Grid data = saved shifts with staged edits layered on top. */
  const mergedShifts = useMemo(() => {
    const out = shifts.filter((s) => {
      const p = pending[keyOf(s.staff_email, s.date)];
      return !p;
    });
    for (const p of Object.values(pending)) {
      if (!p.payload) continue;
      out.push({
        id: p.existing?.id ?? `pending:${keyOf(p.staff.email, p.date)}`,
        staff_email: p.staff.email, staff_name: p.staff.name, area: viewArea,
        date: p.date, shift_type: p.payload.duty === "Night" ? "Night" : p.payload.duty === "Day" ? "Morning" : "Off",
        hours: p.payload.hours, is_overtime: p.payload.ot_type !== "None",
        notes: null, unit_code: p.payload.unit_code,
        duty: p.payload.duty, ot_type: p.payload.ot_type, sick_tag: p.payload.sick_tag,
      });
    }
    return out;
  }, [shifts, pending, viewArea]);

  const pendingKeys = useMemo(() => new Set(Object.keys(pending)), [pending]);

  if (!me?.staff) return null;
  if (!canManage) return <p>Supervisor / admin access only.</p>;
  const meStaff = me.staff;

  const stageEdit = (edit: PendingEdit) => {
    setPending((p) => ({ ...p, [keyOf(edit.staff.email, edit.date)]: edit }));
    setEditor(null);
  };

  /** Bulk apply an imported grid after the preview/confirm step. */
  const commitScheduleImport = async (items: ImportItem<ImportedCell>[]) => {
    for (const it of items) {
      const cell = it.payload!;
      if (!cell.payload) {
        if (cell.existingId) await supabase.from("shifts").delete().eq("id", cell.existingId);
        continue;
      }
      const body = {
        staff_email: cell.staff.email, staff_name: cell.staff.name, area: viewArea, date: cell.date,
        duty: cell.payload.duty,
        unit_code: cell.payload.unit_code,
        ot_type: cell.payload.ot_type,
        is_overtime: cell.payload.ot_type !== "None",
        sick_tag: cell.payload.sick_tag,
        hours: cell.payload.hours,
        shift_type: (cell.payload.duty === "Night" ? "Night" : cell.payload.duty === "Day" ? "Morning" : "Off") as "Morning" | "Night" | "Off",
      };
      const { error } = cell.existingId
        ? await supabase.from("shifts").update(body).eq("id", cell.existingId)
        : await supabase.from("shifts").insert(body);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`Imported ${items.length} schedule cell${items.length === 1 ? "" : "s"}`);
    setPending({});
    await load();
  };

  const saveAll = async () => {
    const list = Object.values(pending);
    if (list.length === 0) return;
    setSaving(true);
    for (const p of list) {
      if (!p.payload) {
        if (p.existing) await supabase.from("shifts").delete().eq("id", p.existing.id);
        continue;
      }
      const body = {
        staff_email: p.staff.email, staff_name: p.staff.name, area: viewArea, date: p.date,
        duty: p.payload.duty,
        unit_code: p.payload.unit_code,
        ot_type: p.payload.ot_type,
        is_overtime: p.payload.ot_type !== "None",
        sick_tag: p.payload.sick_tag,
        hours: p.payload.hours,
        shift_type: (p.payload.duty === "Night" ? "Night" : p.payload.duty === "Day" ? "Morning" : "Off") as "Morning" | "Night" | "Off",
      };
      const { error } = p.existing
        ? await supabase.from("shifts").update(body).eq("id", p.existing.id)
        : await supabase.from("shifts").insert(body);
      if (error) { toast.error(error.message); setSaving(false); return; }
      await notify({ data: { event: "schedule_changed", staff_name: p.staff.name, staff_email: p.staff.email, date: p.date, shift_type: body.shift_type } });
    }
    setPending({});
    setSaving(false);
    toast.success(`Saved ${list.length} schedule change${list.length > 1 ? "s" : ""}`);
    load();
  };

  const decideLeave = async (r: LeaveReq, status: "Approved" | "Rejected") => {
    const { error } = await supabase.from("leave_requests").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_decided", staff_name: r.staff_name, staff_email: r.staff_email, status, start_date: r.start_date, end_date: r.end_date } });
    toast.success(`Leave ${status.toLowerCase()}`);
    load();
  };

  const decideChange = async (r: ChangeReq, approve: boolean) => {
    if (approve) {
      try {
        await applyScheduleChange({ data: { requestId: r.id } });
        await notify({ data: { event: "change_decided", change_type: r.change_type, status: "Approved", staff_email: r.requester_email, staff_name: r.requester_name } });
        toast.success("Change approved and applied");
      } catch (e) {
        toast.error(String(e));
      }
    } else {
      const { error } = await supabase.from("schedule_change_requests").update({ supervisor_response: "Rejected", status: "Rejected" }).eq("id", r.id);
      if (error) { toast.error(error.message); return; }
      await notify({ data: { event: "change_decided", change_type: r.change_type, status: "Rejected", staff_email: r.requester_email, staff_name: r.requester_name } });
      toast.success("Change rejected");
    }
    load();
  };

  const setDelegation = async (email: string, active: boolean) => {
    const { error } = await supabase.from("staff").update({
      delegated_to_email: email || null,
      delegation_active: active && !!email,
    }).eq("id", meStaff.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Delegation updated");
    reload();
  };

  const openReportDay = (r: TlReport) => {
    const [y, m] = r.shift_date.split("-").map(Number);
    setYear(y); setMonth(m - 1);
    setLayer(r.layer === "night" ? "night" : "day");
    const member = staff.find((s) => s.name.toLowerCase() === (r.sick_calls[0]?.staff_name ?? "").toLowerCase());
    if (member) setEditor({ staff: member as StaffLite, date: r.shift_date, shift: shifts.find((sh) => sh.staff_email.toLowerCase() === member.email.toLowerCase() && sh.date === r.shift_date) });
    else toast.info("Open the schedule cell for that day to apply the change.");
  };

  const actionReports = reports.filter(
    (r) => r.status !== "Reviewed" && r.sick_calls?.some((c) => c.coverage_type === "overtime" || c.coverage_type === "area_pull"),
  );

  const markReviewed = async (r: TlReport) => {
    const { error } = await supabase.from("team_leader_reports").update({ status: "Reviewed" }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{admin ? "Admin" : "Supervisor"} · {viewArea}</h1>
        <p className="text-sm text-muted-foreground">Manage the schedule and approvals.</p>
      </div>

      <div className="flex justify-end"><BookingLeaveDialog me={meStaff} onDone={load} /></div>

      {actionReports.length > 0 && (
        <div className="rounded-md border border-copper/60 bg-copper/10 p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-copper">
            <AlertTriangle className="h-4 w-4" /> Team Leader Report needs your approval
          </div>
          <div className="space-y-2">
            {actionReports.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3 text-sm">
                <div>
                  <div className="font-medium">{r.shift_date} · {r.layer} · {r.reporter_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.sick_calls.map((c) => `${c.staff_name} (${c.staff_code}) → ${c.covered_by} · ${c.coverage_type === "overtime" ? "overtime" : "area pull"}`).join(" | ")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => openReportDay(r)}>Review schedule</Button>
                  <Button size="sm" variant="outline" onClick={() => markReviewed(r)}>Mark reviewed</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pending inbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Leave requests</h3>
            {leaves.filter(l => l.status === "Pending").length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {leaves.filter(l => l.status === "Pending").map(l => (
              <div key={l.id} className="flex items-center justify-between border rounded-md p-3 mb-2 gap-3 flex-wrap">
                <div>
                  <div className="font-medium">{l.staff_name} — {l.leave_type}</div>
                  <div className="text-xs text-muted-foreground">{l.start_date} → {l.end_date} · {l.reason}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decideLeave(l, "Approved")}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decideLeave(l, "Rejected")}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Change requests (awaiting supervisor)</h3>
            {changes.filter(c => c.status === "Pending Supervisor").length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {changes.filter(c => c.status === "Pending Supervisor").map(c => (
              <div key={c.id} className="flex items-center justify-between border rounded-md p-3 mb-2 gap-3 flex-wrap">
                <div>
                  <div className="font-medium">{c.requester_name} → {c.target_staff_name} · {c.change_type}</div>
                  <div className="text-xs text-muted-foreground">Target accepted. {c.details}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decideChange(c, true)}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decideChange(c, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Area schedule</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <ExcelImportButton<ImportedCell>
              title={`Import ${viewArea} schedule`}
              sheetName="Schedule"
              description="Only cells that differ from the current schedule are listed. Re-importing an untouched export produces no changes."
              disabled={!canEditViewedArea}
              parse={async ({ matrix }) => planScheduleImport({
                matrix, staff: staff as StaffLite[], shifts: mergedShifts,
                codes: codesForLayer(codes, effectiveLayer), year, month, layer: effectiveLayer,
              })}
              commit={commitScheduleImport}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportExcel({ area: viewArea, year, month, staff: staff as StaffLite[], shifts: mergedShifts, layer: effectiveLayer, withSummary: true })}
            >
              Export to Excel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportExcel({ area: viewArea, year, month, staff: staff as StaffLite[], shifts: mergedShifts, layer: effectiveLayer, withSummary: true })}
            >
              Download Excel
            </Button>
            {Object.keys(pending).length > 0 && (
              <>
                <Badge variant="secondary">{Object.keys(pending).length} unsaved</Badge>
                <Button size="sm" variant="outline" onClick={() => setPending({})}>Discard</Button>
                <Button size="sm" onClick={saveAll} disabled={saving}>Save changes</Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            {admin && (
              <div className="min-w-0 flex-1">
                <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Area</Label>
                <Select value={viewArea} onValueChange={(v) => { setPending({}); setViewArea(v); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="min-w-0 sm:w-56">
              <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Schedule</Label>
              <div className={`grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1 ${isAssistants ? "opacity-50" : ""}`}>
                {(["day", "night"] as const).map((l) => (
                  <button
                    key={l} type="button" disabled={isAssistants}
                    onClick={() => setLayer(l)} aria-pressed={!isAssistants && layer === l}
                    className={`min-h-11 rounded px-2 text-sm font-medium capitalize transition-colors disabled:cursor-not-allowed ${
                      !isAssistants && layer === l ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-background"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ReferenceTable area={viewArea} rows={reference} />

          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={staff} shifts={mergedShifts} meEmail={meStaff.email}
            layer={effectiveLayer}
            areaLabel={isAssistants ? viewArea : `${viewArea} · ${layer === "day" ? "Day" : "Night"}`}
            pendingKeys={pendingKeys}
            onCellClick={canEditViewedArea ? ({ staff: s, date, shift }) => setEditor({ staff: s, date, shift }) : undefined}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Changes are staged — press <span className="font-medium">Save changes</span> to apply them.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team Leader Reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reports.length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
          {reports.map((r) => (
            <div key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{r.shift_date} · {r.layer} shift · {r.reporter_name}{r.assignment_code ? ` (${r.assignment_code})` : ""}</div>
                <Badge variant={r.status === "Reviewed" ? "secondary" : "default"}>{r.status}</Badge>
              </div>
              {r.sick_calls?.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                  {r.sick_calls.map((c, i) => (
                    <li key={i}>{c.staff_name} ({c.staff_code}) covered by {c.covered_by} — {c.coverage_type === "overtime" ? "called for overtime" : "pulled from another area"}</li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-xs text-muted-foreground">No sick calls.</p>}
              {r.comment && <p className="mt-2 text-xs">{r.comment}</p>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Staff</CardTitle>
          <AddStaffDialog area={viewArea} supervisorEmail={meStaff.email} onDone={load} />
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {staff.map(s => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.email}</div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge variant="secondary" className="capitalize">{s.role}</Badge>
                  <Button
                    size="sm" variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Remove ${s.name} from ${viewArea}?`)) return;
                      const { error } = await supabase.from("staff").delete().eq("id", s.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success("Staff removed"); load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AssignmentCodesCard area={viewArea} layer={effectiveLayer} codes={codes} onDone={() => fetchAssignmentCodes(viewArea).then(setCodes)} />

      <Card>
        <CardHeader><CardTitle>Delegation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3 items-end">
            <div>
              <Label>Delegate approvals to</Label>
              <Select value={meStaff.delegated_to_email ?? ""} onValueChange={(v) => setDelegation(v, meStaff.delegation_active)}>
                <SelectTrigger><SelectValue placeholder="Choose a supervisor" /></SelectTrigger>
                <SelectContent>
                  {supervisors.map(s => <SelectItem key={s.id} value={s.email}>{s.name} ({s.area})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={meStaff.delegation_active} onCheckedChange={(v) => setDelegation(meStaff.delegated_to_email ?? "", v)} />
              <Label>Delegation active</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {editor && (
        <CellEditor
          entry={editor}
          codes={codesForLayer(codes, effectiveLayer)}
          monthShifts={shifts}
          year={year}
          month={month}
          onClose={() => setEditor(null)}
          onStage={stageEdit}
        />
      )}
    </div>
  );
}

const SPECIAL = [
  { value: "__vacation", label: "Vacation (VAC)", duty: "Vacation" as Duty, ot: "None" as OtType },
  { value: "__off", label: "Off", duty: "Off" as Duty, ot: "None" as OtType },
];

const MOT_VALUE = "__mot";
type Tag = "" | "BuiltIn" | "Additional" | "Sick";

function CellEditor({ entry, codes, monthShifts, year, month, onClose, onStage }: {
  entry: { staff: StaffLite; date: string; shift?: Shift };
  codes: AssignmentCode[];
  monthShifts: Shift[]; year: number; month: number;
  onClose: () => void; onStage: (e: PendingEdit) => void;
}) {
  const { staff: s, date, shift } = entry;
  const officeRole = isOfficeHoursRole(s.role);
  const bedsideEligible = canTakeBedsideShift(s.role);
  const bedsideUsed = bedsideHoursInMonth(monthShifts, s.email, year, month, shift?.id);

  const initial = shift
    ? shift.ot_type === "MedEvac" ? MOT_VALUE
      : shift.duty === "Vacation" ? "__vacation"
      : shift.duty === "Sick" ? "__off"
      : shift.duty === "Off" ? "__off"
      : codes.find((c) => c.unit_code === shift.unit_code && c.duty === shift.duty)?.code ?? ""
    : "";

  const [selection, setSelection] = useState(initial);
  const [tag, setTag] = useState<Tag>(
    shift?.sick_tag || shift?.duty === "Sick" ? "Sick"
      : shift?.ot_type === "BuiltIn" ? "BuiltIn"
      : shift?.ot_type === "Additional" ? "Additional"
      : officeRole ? "Additional" : "",
  );
  const [hours, setHours] = useState(String(shift?.hours ?? (officeRole ? BEDSIDE_SHIFT_HOURS : 12)));

  const chosenCode = codes.find((c) => c.code === selection);
  const isMot = selection === MOT_VALUE;
  const special = SPECIAL.find((x) => x.value === selection);
  const isWorking = !!chosenCode || isMot;
  const motDuty: Duty = (shift?.duty === "Night" || shift?.duty === "Day" ? shift.duty : codes[0]?.duty ?? "Day") as Duty;
  const otType: OtType = isMot ? "MedEvac" : tag === "BuiltIn" ? "BuiltIn" : tag === "Additional" ? "Additional" : "None";

  const stage = () => {
    if (!selection) { toast.error("Pick an assignment"); return; }
    if (isWorking && officeRole) {
      const check = validateBedsideAssignment({
        role: s.role, dateISO: date, duty: (chosenCode?.duty ?? motDuty) as "Day" | "Night", otType,
        existingMonthHours: bedsideUsed, hours: Number(hours) || 0,
      });
      if (!check.ok) { toast.error(check.message); return; }
    }
    onStage({
      staff: s, date, existing: shift,
      payload: isWorking
        ? {
            duty: (chosenCode?.duty ?? motDuty) as Duty,
            unit_code: chosenCode?.unit_code ?? null,
            ot_type: otType,
            hours: Number(hours) || 0,
            sick_tag: tag === "Sick",
          }
        : { duty: special!.duty, unit_code: null, ot_type: "None", hours: 0, sick_tag: false },
    });
  };

  const remove = () => onStage({ staff: s, date, existing: shift, payload: null });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{s.name} · {date}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {officeRole && (
            <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              {bedsideEligible ? (
                <>Office-hours role (9h, Sun–Thu) — bedside cover is 12h weekend overtime only.{" "}
                  Used this month: <span className="font-medium text-foreground">{bedsideUsed}h / 24h</span>.</>
              ) : (<>Admins can never be assigned bedside shifts.</>)}
            </div>
          )}
          <div>
            <Label>Assignment</Label>
            <Select value={selection} onValueChange={setSelection}>
              <SelectTrigger><SelectValue placeholder="Pick a code for this schedule" /></SelectTrigger>
              <SelectContent>
                {codes.map((c) => (
                  <SelectItem key={c.id} value={c.code}>{c.code}{c.unit ? ` — ${c.unit}` : ""}</SelectItem>
                ))}
                <SelectItem value={MOT_VALUE}>MOT — MedEvac OT</SelectItem>
                {SPECIAL.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isWorking && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tag</Label>
                <Select value={tag} onValueChange={(v) => setTag(v as Tag)}>
                  <SelectTrigger><SelectValue placeholder="No tag" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BuiltIn">BOT — Built-in Overtime</SelectItem>
                    <SelectItem value="Additional">AOT — Additional Overtime</SelectItem>
                    <SelectItem value="Sick">Sick leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hours</Label>
                <Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="justify-between">
          {shift ? <Button variant="destructive" onClick={remove}>Remove</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={stage} disabled={officeRole && !bedsideEligible && isWorking}>Stage change</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentCodesCard({ area, layer, codes, onDone }: {
  area: string; layer: "all" | "day" | "night"; codes: AssignmentCode[]; onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState("");
  const list = codesForLayer(codes, layer);

  const add = async () => {
    if (!code.trim()) return;
    const duty: Duty = layer === "night" ? "Night" : "Day";
    const unitCode = code.trim().replace(/^[DN]/i, "");
    const { error } = await supabase.from("assignment_codes").insert({
      area, layer, code: code.trim(), unit: unit || null, duty, unit_code: unitCode || code.trim(), sort_order: 999,
    });
    if (error) { toast.error(error.message); return; }
    setCode(""); setUnit(""); toast.success("Code added"); onDone();
  };

  const del = async (id: string) => {
    const { error } = await supabase.from("assignment_codes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle>Assignment codes · {area} {layer !== "all" ? (layer === "day" ? "Day" : "Night") : ""}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs">
              {c.code}{c.unit ? <span className="text-muted-foreground">· {c.unit}</span> : null}
              <button type="button" onClick={() => del(c.id)} aria-label={`Remove ${c.code}`} className="text-muted-foreground hover:text-destructive">×</button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label className="text-xs">Code</Label><Input className="w-28" value={code} onChange={(e) => setCode(e.target.value)} placeholder="D40" /></div>
          <div><Label className="text-xs">Unit</Label><Input className="w-44" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="MICU" /></div>
          <Button size="sm" variant="outline" onClick={add}>Add code</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddStaffDialog({ area, supervisorEmail, onDone }: { area: string; supervisorEmail: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const submit = async () => {
    if (!name || !email) return;
    const { error } = await supabase.from("staff").insert({
      name, email: email.toLowerCase(), role: "staff", area, department, supervisor_email: supervisorEmail,
    });
    if (error) { toast.error(error.message); return; }
    setOpen(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Add staff</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add staff to {area}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Email (Google)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Department</Label><Input value={department} onChange={(e) => setDepartment(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Add</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
