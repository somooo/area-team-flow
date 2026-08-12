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
import type {
  DirectoryPerson as ImportDirectoryPerson,
  MissingPerson,
} from "@/lib/schedule-import";
import {
  detectSheetLayout,
  planSheetImport,
  type SheetCell,
  type SheetSource,
  type SheetPlanResult,
} from "@/lib/sheet-schedule-import";
import { buildScheduleGroups, fetchZoneAssignments, type ZoneAssignment } from "@/lib/zones";
import { normalizeBadge, isProtectedTest } from "@/lib/staff-import";
import { SheetMappingDialog, type SheetImportConfig } from "@/components/SheetMappingDialog";
import { logAudit } from "@/lib/audit";
import { canManageArea, isAdmin } from "@/lib/permissions";
import { useDirectoryAreas } from "@/lib/areas";
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
type Staff = { id: string; name: string; email: string; role: string; area: string | null; department: string | null; supervisor_email: string | null; delegated_to_email: string | null; delegation_active: boolean };
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
  const { areas } = useDirectoryAreas();
  const [viewArea, setViewArea] = useState("");
  const [layer, setLayer] = useState<"day" | "night">("day");
  const [codes, setCodes] = useState<AssignmentCode[]>([]);
  const [reference, setReference] = useState<ZoneReferenceRow[]>([]);
  const [editor, setEditor] = useState<{ staff: StaffLite; date: string; shift?: Shift } | null>(null);
  const [pending, setPending] = useState<Record<string, PendingEdit>>({});
  const [saving, setSaving] = useState(false);
  const [badges, setBadges] = useState<Record<string, string>>({});
  const [importConfig, setImportConfig] = useState<SheetImportConfig | null>(null);
  const [importMonths, setImportMonths] = useState<{ year: number; month: number }[]>([]);
  const [zones, setZones] = useState<ZoneAssignment[]>([]);
  const [sheetSummary, setSheetSummary] = useState<Pick<
    SheetPlanResult,
    "perSheet" | "crossSheetWarnings" | "unmappedNumbers" | "bothSheets" | "warnings" | "range"
  > | null>(null);
  const [replaceInfo, setReplaceInfo] = useState<{ count: number; label: string }>({ count: 0, label: "" });
  const [labelRowsSkipped, setLabelRowsSkipped] = useState(0);
  const [directory, setDirectory] = useState<ImportDirectoryPerson[]>([]);
  const [missingPeople, setMissingPeople] = useState<MissingPerson[]>([]);
  const [addingMissing, setAddingMissing] = useState(false);
  const [addedToSchedule, setAddedToSchedule] = useState<StaffLite[]>([]);
  const [removalPreview, setRemovalPreview] = useState<{ name: string; badge: string }[]>([]);
  const [scopeWarning, setScopeWarning] = useState<string | null>(null);
  /** Every non-blank cell in the file, used when the import replaces the whole month. */
  const [replaceAllItems, setReplaceAllItems] = useState<ImportItem<SheetCell>[]>([]);

  const role = me?.staff?.role;
  const admin = isAdmin(me?.staff);
  const canManage = admin || role === "supervisor";
  /** Admin bypasses area scoping entirely; supervisors are limited to their own area. */
  const canEditViewedArea = canManageArea(me?.staff, viewArea);

  useEffect(() => {
    if (viewArea) return;
    setViewArea(me?.staff?.area ?? "ICU");
  }, [me?.staff?.area]);

  useEffect(() => {
    if (!viewArea) return;
    void fetchAssignmentCodes(viewArea).then(setCodes);
    void fetchZoneReference(viewArea).then(setReference);
    void fetchZoneAssignments(viewArea).then(setZones);
  }, [viewArea]);

  /** The whole directory is the match source for imports — not just this area's roster. */
  const loadDirectory = async () => {
    const { data } = await supabase
      .from("staff")
      .select("id,name,email,role,area,department,position,badge_id,first_name")
      .order("name");
    const rows = (data ?? []) as {
      id: string; name: string; email: string | null; role: string; area: string | null;
      department: string | null; position: string | null; badge_id: string | null; first_name: string | null;
    }[];
    setDirectory(
      rows
        .filter((r) => !isProtectedTest(r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          email: (r.email ?? "").toLowerCase() || `badge-${normalizeBadge(r.badge_id) || r.id}@no-email.local`,
          role: r.role,
          area: r.area,
          department: r.department,
          position: r.position,
          badge: normalizeBadge(r.badge_id),
        })),
    );
  };
  useEffect(() => { void loadDirectory(); }, []);

  const isAssistants = viewArea.toLowerCase() === "assistants";
  const effectiveLayer: "all" | "day" | "night" = isAssistants ? "all" : layer;

  const load = async () => {
    if (!canManage || !viewArea) return;
    const start = toISODate(new Date(year, month, 1));
    const end = toISODate(new Date(year, month + 1, 0));
    const [{ data: sh }, { data: st }, { data: lv }, { data: ch }, { data: sup }, { data: tl }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", viewArea).gte("date", start).lte("date", end).order("date"),
      supabase.from("staff").select("id,name,email,role,area,department,supervisor_email,delegated_to_email,delegation_active,badge_id").eq("area", viewArea).order("name"),
      supabase.from("leave_requests").select("*").eq("area", viewArea).order("created_at", { ascending: false }),
      supabase.from("schedule_change_requests").select("*").eq("area", viewArea).order("created_at", { ascending: false }),
      supabase.from("staff").select("id,name,email,role,area,department,supervisor_email,delegated_to_email,delegation_active").eq("role", "supervisor"),
      supabase.from("team_leader_reports").select("*").eq("area", viewArea).order("shift_date", { ascending: false }).limit(30),
    ]);
    setShifts((sh as Shift[]) ?? []);
    const staffRows = (st as (Staff & { badge_id?: string | null })[]) ?? [];
    setStaff(staffRows as Staff[]);
    setBadges(Object.fromEntries(staffRows.filter((s) => s.badge_id).map((s) => [s.email.toLowerCase(), String(s.badge_id)])));
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

  const monthLabel = (y: number, m: number) =>
    new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  /**
   * Grid roster = staff assigned to this area PLUS anyone who has a shift in the
   * visible month, so people added by an import show up immediately.
   */
  const gridStaff = useMemo(() => {
    const map = new Map<string, StaffLite>();
    for (const s of staff) map.set(s.email.toLowerCase(), s as StaffLite);
    for (const sh of mergedShifts) {
      const k = sh.staff_email.toLowerCase();
      if (map.has(k)) continue;
      const dir = directory.find((d) => d.email.toLowerCase() === k);
      map.set(k, dir ?? { id: k, name: sh.staff_name, email: sh.staff_email, role: "staff", area: viewArea, department: null });
    }
    // Display order comes from the imported sheet order, never from the alphabet.
    return Array.from(map.values());
  }, [staff, mergedShifts, directory, viewArea]);

  /** Zone separator rows with the Excel row order preserved inside each zone. */
  const gridGroups = useMemo(
    () => buildScheduleGroups({ staff: gridStaff, shifts: mergedShifts, zones }),
    [gridStaff, mergedShifts, zones],
  );

  if (!me?.staff) return null;
  if (!canManage) return <p>Supervisor / admin access only.</p>;
  const meStaff = me.staff;

  const stageEdit = (edit: PendingEdit) => {
    setPending((p) => ({ ...p, [keyOf(edit.staff.email, edit.date)]: edit }));
    setEditor(null);
  };

  /** The month(s) the mapped sheets cover, as ISO date ranges. */
  const importRanges = (months: { year: number; month: number }[]) => {
    const seen = new Map<string, { year: number; month: number }>();
    for (const b of months) seen.set(`${b.year}-${b.month}`, { year: b.year, month: b.month });
    return Array.from(seen.values()).map((m) => ({
      ...m,
      start: toISODate(new Date(m.year, m.month, 1)),
      end: toISODate(new Date(m.year, m.month + 1, 0)),
      label: new Date(m.year, m.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" }),
    }));
  };

  /** Bulk apply an imported grid after the mapping and preview steps. */
  const commitScheduleImport = async (
    items: ImportItem<SheetCell>[],
    { replace, setProgress }: { replace: boolean; setProgress: (t: string | null) => void },
  ) => {
    const staffIdByEmail = new Map<string, string>();
    for (const s of staff) staffIdByEmail.set(s.email.toLowerCase(), s.id);
    for (const d of directory) if (!staffIdByEmail.has(d.email.toLowerCase())) staffIdByEmail.set(d.email.toLowerCase(), d.id);
    const ranges = importRanges(importMonths);
    // In replace mode nothing survives to diff against, so every parsed cell is written.
    const source = replace ? replaceAllItems : items;

    // Deletions first (merge mode only clears cells that were emptied in the file).
    const toDelete = replace ? [] : source.filter((i) => i.payload && !i.payload.payload && i.payload.existingId)
      .map((i) => i.payload!.existingId!);
    for (let i = 0; i < toDelete.length; i += 500) {
      const { error } = await supabase.from("shifts").delete().in("id", toDelete.slice(i, i + 500));
      if (error) throw new Error(`Could not clear cells: ${error.message}`);
    }

    const rows = source
      .filter((i) => i.payload?.payload)
      .map((i) => {
        const c = i.payload!;
        const p = c.payload!;
        return {
          staff_email: c.staff.email.toLowerCase(),
          staff_name: c.staff.name,
          staff_id: staffIdByEmail.get(c.staff.email.toLowerCase()) ?? null,
          area: viewArea,
          date: c.date,
          duty: p.duty,
          unit_code: p.unit_code,
          ot_type: p.ot_type,
          is_overtime: p.ot_type !== "None",
          sick_tag: p.sick_tag,
          hours: p.hours,
          shift_type: (p.duty === "Night" ? "Night" : p.duty === "Day" ? "Morning" : "Off") as "Morning" | "Night" | "Off",
          sort_order: c.order,
        };
      });

    // One transactional RPC per month: delete + insert either fully apply or fully roll back.
    const targets = replace
      ? ranges
      : [{ year: 0, month: 0, start: "1900-01-01", end: "2999-12-31", label: "schedule" }];
    let written = 0;
    let attempted = 0;
    let confirmed = 0;
    const failures: string[] = [];
    for (let idx = 0; idx < targets.length; idx++) {
      const r = targets[idx];
      const chunk = replace ? rows.filter((x) => x.date >= r.start && x.date <= r.end) : rows;
      setProgress(
        `Writing ${r.label} — ${chunk.length} row${chunk.length === 1 ? "" : "s"} (${idx + 1} of ${targets.length})…`,
      );
      attempted += chunk.length;
      // Server-side batch: one row failing is collected, not fatal, and the real
      // Postgres message comes back per row.
      const { data, error } = await supabase.rpc("import_schedule_rows", {
        _area: viewArea,
        _start: r.start,
        _end: r.end,
        _replace: replace,
        _rows: chunk,
      });
      if (error) {
        console.error("[schedule import] batch failed", { area: viewArea, range: r, rows: chunk.length, error });
        failures.push(
          `${r.label} — all ${chunk.length} rows rejected: ${error.message}${error.hint ? ` (${error.hint})` : ""}`,
        );
        continue;
      }
      const res = data as {
        attempted: number; written: number; confirmed: number;
        failures: { staff_name: string; badge: string; date: string; error: string }[];
      };
      written += res?.written ?? 0;
      // In merge mode the confirmed count covers the whole area, so only the
      // month-scoped replace count is meaningful as a re-queried confirmation.
      confirmed += replace ? (res?.confirmed ?? 0) : (res?.written ?? 0);
      for (const f of res?.failures ?? []) {
        failures.push(`${f.badge} · ${f.staff_name} · ${f.date} — ${f.error}`);
      }
    }
    setProgress(null);
    if (written === 0) {
      console.error("[schedule import] nothing written", { area: viewArea, attempted, failures });
      return { attempted, written: 0, confirmed: 0, failures };
    }

    if (replace) {
      for (const r of ranges) {
        await logAudit({
          action: "schedule_month_replaced", entity_type: "schedule", entity_id: `${viewArea}-${r.year}-${r.month}`,
          actor_email: me?.staff?.email, actor_role: me?.staff?.role, area: viewArea,
          details: {
            area: viewArea, year: r.year, month: r.month,
            cells_written: rows.length,
            staff_rows: new Set(rows.map((x) => x.staff_email)).size,
            side: importConfig?.side ?? null,
            day_sheet: importConfig?.daySheet ?? null,
            night_sheet: importConfig?.nightSheet ?? null,
          },
        });
      }
    }

    toast.success(
      `Import complete — ${written} of ${attempted} shift${attempted === 1 ? "" : "s"} written into ${viewArea}`,
    );

    await logAudit({
      action: replace ? "schedule_import_replace" : "schedule_import_merge",
      entity_type: "schedule",
      entity_id: `${viewArea}-${ranges.map((r) => r.label).join(",")}`,
      actor_email: me?.staff?.email, actor_role: me?.staff?.role, area: viewArea,
      details: {
        area: viewArea,
        months: ranges.map((r) => r.label),
        shift: isAssistants ? "all" : layer,
        mode: replace ? "replace" : "merge",
        assignments_written: written,
        staff_added_to_schedule: addedToSchedule.map((s) => s.name),
        staff_removed_from_schedule: replace ? removalPreview : [],
      },
    });

    setPending({});
    await load();
    await loadDirectory();
    return { attempted, written, confirmed, failures };
  };

  /** Create real directory records for badges the file contains but the directory does not. */
  const addMissingToDirectory = async () => {
    if (!missingPeople.length) return;
    setAddingMissing(true);
    const rows = missingPeople.map((m) => ({
      badge_id: m.badge,
      name: m.name && m.name !== "(no name in file)" ? m.name : `Badge ${m.badge}`,
      role: "staff" as const,
      status: "Active",
    }));
    const { data, error } = await supabase.from("staff").insert(rows as never).select("id");
    setAddingMissing(false);
    if (error) { toast.error(`Could not add to directory: ${error.message}`); return; }
    await logAudit({
      action: "staff_created_from_schedule_import", entity_type: "staff",
      actor_email: me?.staff?.email, actor_role: me?.staff?.role, area: viewArea,
      details: { created: rows.length, badges: missingPeople.map((m) => m.badge) },
    });
    toast.success(`${data?.length ?? rows.length} staff added to the directory — re-run the import to include them`);
    setMissingPeople([]);
    await loadDirectory();
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
            {canEditViewedArea && (
            <ExcelImportButton<SheetCell, SheetImportConfig>
              title={`Import ${viewArea} schedule`}
              description="Two-sheet format: row 1 holds the dates, column A the name and column B the badge. Day rows go to the Day schedule and Night rows to the Night schedule — codes are stored exactly as written."
              disabled={!canEditViewedArea}
              configure={({ input, onConfirm, onCancel }) => (
                <SheetMappingDialog
                  input={input}
                  onCancel={onCancel}
                  onConfirm={(cfg) => { setImportConfig(cfg); onConfirm(cfg); }}
                />
              )}
              replaceOption={{
                mergeLabel: "Merge — keep everyone currently on the schedule",
                mergeDescription: "Adds the new staff and overwrites only the assignments for dates present in the file. Nobody is removed.",
                label: `Replace — the file becomes the full ${viewArea} roster for ${replaceInfo.label || "the imported month"}`,
                description: `${replaceInfo.count} existing shift${replaceInfo.count === 1 ? "" : "s"} in ${viewArea} · ${replaceInfo.label || "the imported month"} will be cleared first. Staff absent from the file are removed from this schedule only — their Staff Directory record is never changed.`,
                extra: removalPreview.length > 0 ? (
                  <span className="mt-2 block rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    <span className="font-medium block text-destructive">
                      {removalPreview.length} staff will be removed from this schedule
                    </span>
                    <span className="block text-muted-foreground">
                      {removalPreview.map((p) => `${p.name}${p.badge ? ` (${p.badge})` : ""}`).join(", ")}
                    </span>
                  </span>
                ) : (
                  <span className="mt-2 block text-muted-foreground">Nobody currently on the schedule is missing from the file.</span>
                ),
              }}
              extraSummary={() => (
                <div className="space-y-2 text-xs">
                  <p className="text-muted-foreground">
                    Scope: <span className="font-medium text-foreground">{viewArea}</span> ·{" "}
                    <span className="font-medium text-foreground">{replaceInfo.label || monthLabel(year, month)}</span> ·{" "}
                    <span className="font-medium text-foreground">
                      {importConfig?.side === "both" ? "Day + Night" : importConfig?.side === "night" ? "Night only" : "Day only"}
                    </span>
                  </p>
                  {(sheetSummary?.perSheet ?? []).map((s) => (
                    <p key={s.side} className="text-muted-foreground">
                      <span className="font-medium text-foreground capitalize">{s.side}</span> · sheet “{s.sheetName}” ·{" "}
                      <span className="font-medium text-foreground">{s.monthLabel}</span> ·{" "}
                      <span className="font-medium text-foreground">{s.firstDate} to {s.lastDate}</span> ·{" "}
                      {s.dateCols} date columns · {s.rows} staff rows · {s.matched} matched to the directory
                      {s.blankRowsSkipped > 0 ? ` · ${s.blankRowsSkipped} blank rows skipped` : ""}
                    </p>
                  ))}
                  {(sheetSummary?.warnings ?? []).map((w) => (
                    <p key={w} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                      {w}
                    </p>
                  ))}
                  {scopeWarning && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                      {scopeWarning}
                    </p>
                  )}
                  {(sheetSummary?.crossSheetWarnings.length ?? 0) > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                      <p className="font-medium">
                        {sheetSummary!.crossSheetWarnings.length} code{sheetSummary!.crossSheetWarnings.length === 1 ? "" : "s"} look like they belong to the other sheet
                      </p>
                      <ul>
                        {sheetSummary!.crossSheetWarnings.slice(0, 10).map((w) => <li key={w}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  {(sheetSummary?.unmappedNumbers.length ?? 0) > 0 && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                      Assignment numbers with no zone mapped: {sheetSummary!.unmappedNumbers.join(", ")} — these staff are grouped under “Unassigned”.{" "}
                      <a className="underline" href="/settings#zone-map">Edit the zone map in Settings</a>
                    </p>
                  )}
                  {(sheetSummary?.bothSheets.length ?? 0) > 0 && (
                    <p className="text-muted-foreground">
                      {sheetSummary!.bothSheets.length} badge{sheetSummary!.bothSheets.length === 1 ? "" : "s"} appear on both sheets: {sheetSummary!.bothSheets.join(", ")}
                    </p>
                  )}
                  {addedToSchedule.length > 0 && (
                    <p className="text-muted-foreground">
                      {addedToSchedule.length} staff will be added to this schedule from the directory:{" "}
                      {addedToSchedule.map((s) => s.name).join(", ")}
                    </p>
                  )}
                  {missingPeople.length > 0 && (
                    <div className="rounded-md border p-2 space-y-2">
                      <p className="font-medium">
                        {missingPeople.length} badge{missingPeople.length === 1 ? "" : "s"} not in the directory — review and add them there first
                      </p>
                      <ul className="text-muted-foreground">
                        {missingPeople.map((m) => (
                          <li key={m.badge}>{m.badge} · {m.name}</li>
                        ))}
                      </ul>
                      <Button size="sm" variant="outline" disabled={addingMissing} onClick={() => void addMissingToDirectory()}>
                        {addingMissing ? "Adding…" : `Add ${missingPeople.length} staff to directory`}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              parse={async (input, config) => {
                if (!config) return [];
                const sources: SheetSource[] = [];
                if (config.side !== "night" && config.daySheet) {
                  const m = input.workbook.sheets[config.daySheet] ?? [];
                  sources.push({ side: "day", matrix: m, layout: detectSheetLayout(m, config.daySheet, "day") });
                }
                if (config.side !== "day" && config.nightSheet) {
                  const m = input.workbook.sheets[config.nightSheet] ?? [];
                  sources.push({ side: "night", matrix: m, layout: detectSheetLayout(m, config.nightSheet, "night") });
                }
                const common = {
                  sources,
                  staff: staff as StaffLite[],
                  directory,
                  shifts,
                  knownAssignmentNumbers: new Set(zones.map((z) => z.assignment_no)),
                };
                const diff = planSheetImport({ ...common, replace: false });
                const full = planSheetImport({ ...common, replace: true });
                setLabelRowsSkipped(0);
                setMissingPeople(full.missing);
                setAddedToSchedule(full.addedToSchedule);
                setReplaceAllItems(full.items.filter((i) => i.status !== "skip"));
                setSheetSummary({
                  perSheet: full.perSheet,
                  crossSheetWarnings: full.crossSheetWarnings,
                  unmappedNumbers: full.unmappedNumbers,
                  bothSheets: full.bothSheets,
                  warnings: Array.from(new Set(full.warnings)),
                  range: full.range,
                });

                // layout.month is a real month number (1-12); state months are JS indexes.
                const months = sources.map((s) => ({ year: s.layout.year, month: s.layout.month - 1 }));
                setImportMonths(months);
                const ranges = importRanges(months);
                const off = months.filter((b) => b.year !== year || b.month !== month);
                setScopeWarning(
                  off.length
                    ? `The file contains dates outside ${monthLabel(year, month)} (${off
                        .map((b) => monthLabel(b.year, b.month))
                        .join(", ")}). They will be imported into that period, not the month shown above.`
                    : null,
                );
                let count = 0;
                for (const r of ranges) {
                  const { count: c } = await supabase.from("shifts")
                    .select("id", { count: "exact", head: true })
                    .eq("area", viewArea).gte("date", r.start).lte("date", r.end);
                  count += c ?? 0;
                }
                setReplaceInfo({ count, label: ranges.map((r) => r.label).join(", ") });

                // Who is on the schedule today but absent from the file (Replace mode only).
                const inFile = new Set<string>([
                  ...full.items.filter((i) => i.payload).map((i) => i.payload!.staff.email.toLowerCase()),
                ]);
                const existing = new Map<string, { name: string; badge: string }>();
                for (const r of ranges) {
                  const { data } = await supabase.from("shifts")
                    .select("staff_email,staff_name")
                    .eq("area", viewArea).gte("date", r.start).lte("date", r.end);
                  for (const s of (data ?? []) as { staff_email: string; staff_name: string }[]) {
                    const k = s.staff_email.toLowerCase();
                    if (inFile.has(k)) continue;
                    existing.set(k, {
                      name: s.staff_name,
                      badge: directory.find((d) => d.email.toLowerCase() === k)?.badge ?? "",
                    });
                  }
                }
                setRemovalPreview(Array.from(existing.values()));
                return diff.items;
              }}
              commit={commitScheduleImport}
            />
            )}
            {canEditViewedArea && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportExcel({ area: viewArea, year, month, staff: gridStaff, shifts: mergedShifts, layer: effectiveLayer, withSummary: true })}
            >
              Export to Excel
            </Button>
            )}
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

          {gridStaff.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No staff assigned to this area yet — use Add staff to get started.
            </p>
          ) : (
          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={gridStaff} shifts={mergedShifts} meEmail={meStaff.email}
            layer={effectiveLayer}
            areaLabel={isAssistants ? viewArea : `${viewArea} · ${layer === "day" ? "Day" : "Night"}`}
            pendingKeys={pendingKeys}
            groups={gridGroups}
            onCellClick={canEditViewedArea ? ({ staff: s, date, shift }) => setEditor({ staff: s, date, shift }) : undefined}
          />
          )}
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
          <AddStaffDialog
            area={viewArea}
            admin={admin}
            canEdit={canEditViewedArea}
            assignedEmails={staff.map((s) => s.email.toLowerCase())}
            onDone={load}
          />
        </CardHeader>
        <CardContent>
          {staff.length === 0 && (
            <p className="text-sm text-muted-foreground">No staff assigned to this area yet — use Add staff to get started.</p>
          )}
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {staff.map(s => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.email}</div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge variant="secondary" className="capitalize">{s.role}</Badge>
                  {canEditViewedArea && (
                  <Button
                    size="sm" variant="ghost" disabled={!canEditViewedArea}
                    title="Remove from schedule"
                    onClick={async () => {
                      if (!confirm(`Remove ${s.name} from the ${viewArea} schedule? They stay in the Staff Directory.`)) return;
                      const { error } = await supabase.from("staff").update({ area: null }).eq("id", s.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success("Removed from this schedule — still in the Staff Directory"); load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  )}
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

type DirectoryPerson = {
  id: string; name: string; email: string; badge_id: string | null;
  assigned_to: string | null; status: string | null; area: string | null;
};

/**
 * Assign someone who already exists in the Staff Directory to this area's
 * schedule. Supervisors never create people — only admins may do that.
 */
function AddStaffDialog({ area, admin, canEdit, assignedEmails, onDone }: {
  area: string; admin: boolean; canEdit: boolean; assignedEmails: string[]; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [q, setQ] = useState("");
  const [assignedFilter, setAssignedFilter] = useState("__all");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("staff")
      .select("id,name,email,badge_id,assigned_to,status,area")
      .order("name")
      .then(({ data }) => setPeople((data as DirectoryPerson[]) ?? []));
  }, [open]);

  const assignedOptions = useMemo(
    () => Array.from(new Set(people.map((p) => p.assigned_to).filter(Boolean) as string[])).sort(),
    [people],
  );

  const taken = useMemo(() => new Set(assignedEmails.map((e) => e.toLowerCase())), [assignedEmails]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (statusFilter !== "__all" && (p.status ?? "Active") !== statusFilter) return false;
      if (assignedFilter !== "__all" && (p.assigned_to ?? "") !== assignedFilter) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || (p.badge_id ?? "").toLowerCase().includes(needle);
    });
  }, [people, q, assignedFilter, statusFilter]);

  const assign = async (p: DirectoryPerson) => {
    setBusy(true);
    const { data, error } = await supabase
      .from("staff")
      .update({ area })
      .eq("id", p.id)
      .select("id");
    setBusy(false);
    if (error) {
      console.error("[add staff] update failed", { staffId: p.id, area, error });
      toast.error(`Could not add ${p.name}: ${error.message}${error.hint ? ` (${error.hint})` : ""}`);
      return;
    }
    if (!data || data.length === 0) {
      console.error("[add staff] update affected 0 rows — blocked by access rules", { staffId: p.id, area });
      toast.error(`Could not add ${p.name} — your account is not allowed to assign staff to ${area}.`);
      return;
    }
    toast.success(`${p.name} added to the ${area} schedule`);
    setOpen(false); onDone();
  };

  const createNew = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Name and email are required"); return; }
    const { data, error } = await supabase.from("staff").insert({
      name: name.trim(), email: email.trim().toLowerCase(), role: "staff", area, status: "Active",
    }).select("id");
    if (error) { console.error("[create staff] failed", error); toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error("Could not create this person — your account is not allowed to add staff.");
      return;
    }
    toast.success(`${name.trim()} added to the ${area} schedule`);
    setName(""); setEmail(""); setCreateOpen(false); setOpen(false); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" disabled={!canEdit}>Add staff</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Add staff to the {area} schedule</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <Label className="text-xs">Search</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or badge number" />
            </div>
            <div>
              <Label className="text-xs">Assigned to</Label>
              <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All</SelectItem>
                  {assignedOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                  <SelectItem value="__all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="max-h-80 overflow-auto rounded-md border">
            {list.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matching staff in the directory.</p>}
            {list.map((p) => {
              const already = taken.has(p.email.toLowerCase());
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={already || busy}
                  onClick={() => assign(p)}
                  className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground"> — {p.badge_id ?? "no badge"} — {p.assigned_to ?? "—"} — {p.status ?? "Active"}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {already ? "already assigned" : p.area ? `on ${p.area}` : "Add"}
                  </span>
                </button>
              );
            })}
          </div>

          {admin && (
            <div className="rounded-md border p-3">
              {createOpen ? (
                <div className="space-y-2">
                  <div><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                  <div><Label className="text-xs">Email (Google)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={createNew}>Create and add</Button>
                    <Button size="sm" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>Create new staff member</Button>
              )}
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
