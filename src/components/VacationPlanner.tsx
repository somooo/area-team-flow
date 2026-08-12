import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { toISODate } from "@/lib/roster";
import { useSystemRules, ruleNumber } from "@/lib/system-rules";
import { notify } from "@/lib/notify.functions";
import { createNotification } from "@/lib/notifications.functions";
import { logAudit } from "@/lib/audit";
import { resolveApprover } from "@/lib/approver";
import { countVacationDays, isOfficeHoursRole } from "@/lib/hours-model";
import { canManageVacationsIn, canUseSupervisorsCalendar } from "@/lib/permissions";
import { AREAS } from "@/lib/areas";
import { maxOffPerDay } from "@/components/VacationCapsTable";
import { ExcelImportButton, type ImportItem } from "@/components/ExcelImportButton";
import { commitVacationImport, exportVacationsExcel, planVacationImport, type DirectoryStaffLite, type ExistingLeave, type VacationImportPayload } from "@/lib/vacation-io";

export const SUPERVISORS_AREA = "Supervisors";

export type PlannerStaff = {
  id: string;
  email: string;
  name: string;
  role: "staff" | "supervisor" | "admin" | "team_leader";
  area: string | null;
  supervisor_email: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
};

type LeaveRow = {
  id: string;
  staff_email: string;
  staff_name: string;
  start_date: string;
  end_date: string;
  status: string;
  reason: string | null;
  approver_email: string | null;
  covering_supervisor_email: string | null;
  stage: string | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function monthMatrix(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= count; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function eachDay(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const a = new Date(startISO + "T00:00:00");
  const b = new Date(endISO + "T00:00:00");
  const cur = new Date(a);
  while (cur <= b) { out.push(toISODate(cur)); cur.setDate(cur.getDate() + 1); }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function countDays(a: string, b: string) {
  return eachDay(a, b).length;
}

/** Human-readable stage for a supervisor-calendar request. */
export function stageLabel(r: { status: string; stage: string | null }) {
  if (r.status === "Approved") return "Approved";
  if (r.status === "Rejected") return "Rejected";
  if (r.stage === "covering") return "Pending covering supervisor approval";
  if (r.stage === "admin") return "Pending admin approval";
  return "Pending";
}

export function VacationPlanner({ me, onDone }: { me: PlannerStaff; onDone: () => void }) {
  const { rules } = useSystemRules();
  const canSwitchArea = me.role !== "staff";
  const canSeeSupervisorsCalendar = canUseSupervisorsCalendar(me);
  const areas = AREAS as readonly string[];
  const [viewArea, setViewArea] = useState<string>(
    me.role === "supervisor" || me.role === "admin" ? SUPERVISORS_AREA : (me.area ?? ""),
  );
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [headcount, setHeadcount] = useState(1);
  const [capRow, setCapRow] = useState<{ cap_pct: number; warn_pct: number } | null>(null);
  const [balance, setBalance] = useState<{ approved: number; pending: number }>({ approved: 0, pending: 0 });
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState<string | null>(null);
  const [approverName, setApproverName] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeaveRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supervisors, setSupervisors] = useState<{ email: string; name: string }[]>([]);
  const [covering, setCovering] = useState<string>("");
  const [manageDay, setManageDay] = useState<{ iso: string; rows: LeaveRow[] } | null>(null);
  const [manageRow, setManageRow] = useState<LeaveRow | null>(null);
  const [staffMeta, setStaffMeta] = useState<Record<string, { badge: string | null; area: string | null }>>({});
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const isSupervisorsView = viewArea === SUPERVISORS_AREA;
  const isOwnArea = isSupervisorsView ? canSeeSupervisorsCalendar : viewArea === me.area;
  /** Supervisors manage their own area; admins manage every area including the supervisors calendar. */
  const canManage = canManageVacationsIn(me, viewArea, SUPERVISORS_AREA);

  useEffect(() => {
    if (!canSeeSupervisorsCalendar) return;
    void supabase.from("staff").select("email,name,role").eq("role", "supervisor").then(({ data }) => {
      setSupervisors(((data ?? []) as { email: string; name: string }[])
        .filter((s) => s.email.toLowerCase() !== me.email.toLowerCase()));
    });
  }, [canSeeSupervisorsCalendar, me.email]);

  useEffect(() => {
    void resolveApprover(me).then(async (email) => {
      setApprover(email);
      if (!email) { setApproverName(null); return; }
      const { data } = await supabase.from("staff").select("name").ilike("email", email).maybeSingle();
      setApproverName(data?.name ?? email);
    });
  }, [me.email]);

  const load = useCallback(async () => {
    if (!viewArea) return;
    const winStart = toISODate(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const winEnd = toISODate(new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0));
    const year = new Date().getFullYear();
    const hcQuery = isSupervisorsView
      ? supabase.from("staff").select("id", { count: "exact", head: true }).eq("role", "supervisor")
      : supabase.from("staff").select("id", { count: "exact", head: true }).eq("area", viewArea);
    const capArea = isSupervisorsView ? "Supervisor" : viewArea;
    const [{ count: hc }, { data: area }, { data: mine }, { data: capData }] = await Promise.all([
      hcQuery,
      supabase.from("leave_requests")
        .select("id,staff_email,staff_name,start_date,end_date,status,reason,approver_email,covering_supervisor_email,stage")
        .eq("area", viewArea).eq("leave_type", "Vacation")
        .in("status", ["Approved", "Pending"])
        .lte("start_date", winEnd).gte("end_date", winStart),
      supabase.from("leave_requests").select("start_date,end_date,status")
        .ilike("staff_email", me.email).eq("leave_type", "Vacation")
        .gte("start_date", `${year}-01-01`).lte("end_date", `${year}-12-31`)
        .in("status", ["Approved", "Pending"]),
      supabase.from("vacation_caps").select("cap_pct,warn_pct").eq("area", capArea).maybeSingle(),
    ]);
    setHeadcount(hc ?? 1);
    setCapRow((capData as { cap_pct: number; warn_pct: number } | null) ?? null);
    setLeaves((area ?? []) as LeaveRow[]);
    let approved = 0, pending = 0;
    for (const r of mine ?? []) {
      const n = countVacationDays(r.start_date, r.end_date, me.role);
      if (r.status === "Approved") approved += n;
      else if (r.status === "Pending") pending += n;
    }
    setBalance({ approved, pending });
  }, [viewArea, cursor, me.email, me.role, isSupervisorsView]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void supabase.from("staff").select("email,badge_id,area").then(({ data }) => {
      const map: Record<string, { badge: string | null; area: string | null }> = {};
      for (const s of (data ?? []) as { email: string; badge_id: string | null; area: string | null }[]) {
        map[s.email.toLowerCase()] = { badge: s.badge_id, area: s.area };
      }
      setStaffMeta(map);
    });
  }, []);

  /** Per-day cap for this area, from vacation_caps (falls back to the legacy rule). */
  const capPct = capRow?.cap_pct ?? ruleNumber(rules, "vacation_cap_pct", 30);
  const warnPct = capRow?.warn_pct ?? 80;
  const cap = useMemo(() => maxOffPerDay(headcount, capPct), [headcount, capPct]);
  const countsPending = rules["vacation_cap_counts_pending"] !== false;
  const capAreaLabel = isSupervisorsView ? "Supervisors" : viewArea;
  const yearlyCap = ruleNumber(rules, "vacation_yearly_days", 25);
  const remaining = Math.max(0, yearlyCap - balance.approved - balance.pending);

  // day → approved colleague names, all rows per day, and my own request per day
  const { approvedByDay, mineByDay, rowsByDay } = useMemo(() => {
    const approvedByDay = new Map<string, string[]>();
    const mineByDay = new Map<string, LeaveRow>();
    const rowsByDay = new Map<string, LeaveRow[]>();
    const isMine = (r: LeaveRow) => r.staff_email.toLowerCase() === me.email.toLowerCase();
    for (const r of leaves) {
      for (const iso of eachDay(r.start_date, r.end_date)) {
        if (r.status === "Approved") {
          const list = approvedByDay.get(iso) ?? [];
          list.push(r.staff_name);
          approvedByDay.set(iso, list);
        }
        const all = rowsByDay.get(iso) ?? [];
        all.push(r);
        rowsByDay.set(iso, all);
        if (isMine(r)) mineByDay.set(iso, r);
      }
    }
    return { approvedByDay, mineByDay, rowsByDay };
  }, [leaves, me.email]);

  const todayISO = toISODate(new Date());

  const selectedSet = useMemo(() => {
    if (!start) return new Set<string>();
    return new Set(eachDay(start, end ?? start));
  }, [start, end]);

  const onDayClick = (iso: string) => {
    const own = mineByDay.get(iso);
    const dayRows = rowsByDay.get(iso) ?? [];
    if (canManage && dayRows.length > 0) { setManageDay({ iso, rows: dayRows }); return; }
    if (own) { setDetail(own); return; }
    if (!isOwnArea) return;
    if (iso < todayISO) return;
    const used = countsPending
      ? (rowsByDay.get(iso)?.length ?? 0)
      : (approvedByDay.get(iso)?.length ?? 0);
    if (cap > 0 && used >= cap) return;
    if (!start || (start && end)) { setStart(iso); setEnd(null); return; }
    if (iso < start) { setStart(iso); return; }
    setEnd(iso);
  };

  const officeHours = isOfficeHoursRole(me.role);
  const totalDays = start ? countVacationDays(start, end ?? start, me.role) : 0;

  const submit = async () => {
    if (!start) return;
    const s = start, e = end ?? start;
    if (isSupervisorsView && !covering) { toast.error("Select a covering supervisor"); return; }
    const routeTo = isSupervisorsView ? covering : approver;
    if (!routeTo) { toast.error("No approver available"); return; }
    setBusy(true);
    const { data: inserted, error } = await supabase.from("leave_requests").insert({
      staff_email: me.email.toLowerCase(), staff_name: me.name,
      area: isSupervisorsView ? SUPERVISORS_AREA : me.area!,
      leave_type: "Vacation",
      staff_id: me.id, start_date: s, end_date: e, reason, approver_email: routeTo,
      covering_supervisor_email: isSupervisorsView ? covering : null,
      stage: isSupervisorsView ? "covering" : null,
    }).select("id").maybeSingle();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_submitted", staff_name: me.name, staff_email: me.email, supervisor_email: routeTo, area: isSupervisorsView ? SUPERVISORS_AREA : me.area, leave_type: "Vacation", start_date: s, end_date: e, reason } });
    await createNotification({ data: { recipient_email: routeTo, title: isSupervisorsView ? "Cover + approve vacation" : "Vacation leave request", body: `${me.name}: ${s} → ${e}`, link: "/approvals" } });
    await logAudit({ action: "leave_requested", entity_type: "leave_request", entity_id: inserted?.id ?? null, area: isSupervisorsView ? SUPERVISORS_AREA : me.area, details: { start_date: s, end_date: e, leave_type: "Vacation", covering_supervisor_email: isSupervisorsView ? covering : null } });
    toast.success("Vacation request submitted");
    setConfirmOpen(false); setStart(null); setEnd(null); setReason(""); setCovering("");
    await load(); onDone();
  };

  const cancelPending = async (row: LeaveRow) => {
    setBusy(true);
    const { error } = await supabase.from("leave_requests").update({ status: "Rejected" }).eq("id", row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "leave_cancelled_by_requester", entity_type: "leave_request", entity_id: row.id, area: viewArea, details: { start_date: row.start_date, end_date: row.end_date } });
    if (row.approver_email) {
      await createNotification({ data: { recipient_email: row.approver_email, title: "Vacation request cancelled", body: `${me.name} cancelled ${row.start_date} → ${row.end_date}`, link: "/approvals" } });
    }
    toast.success("Request cancelled");
    setDetail(null);
    await load(); onDone();
  };

  /** Supervisor/admin acting on a staff member's vacation — applies immediately, no approval. */
  const saveAdjusted = async () => {
    if (!manageRow) return;
    if (!editStart || !editEnd || editEnd < editStart) { toast.error("Pick a valid date range"); return; }
    setBusy(true);
    const { error } = await supabase.from("leave_requests")
      .update({ start_date: editStart, end_date: editEnd }).eq("id", manageRow.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "leave_dates_adjusted_by_manager", entity_type: "leave_request", entity_id: manageRow.id, area: viewArea, details: { from: [manageRow.start_date, manageRow.end_date], to: [editStart, editEnd] } });
    await createNotification({ data: { recipient_email: manageRow.staff_email, title: "Vacation dates updated", body: `${me.name} set your vacation to ${editStart} → ${editEnd}`, link: "/vacations" } });
    await notify({ data: { event: "schedule_changed", staff_name: manageRow.staff_name, staff_email: manageRow.staff_email, area: viewArea, start_date: editStart, end_date: editEnd } });
    toast.success("Vacation updated — schedule synced");
    setManageRow(null); setManageDay(null);
    await load(); onDone();
  };

  const cancelVacation = async (row: LeaveRow) => {
    setBusy(true);
    const { error } = await supabase.from("leave_requests").update({ status: "Rejected" }).eq("id", row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "leave_cancelled_by_manager", entity_type: "leave_request", entity_id: row.id, area: viewArea, details: { start_date: row.start_date, end_date: row.end_date } });
    await createNotification({ data: { recipient_email: row.staff_email, title: "Vacation cancelled", body: `${me.name} cancelled ${row.start_date} → ${row.end_date}`, link: "/vacations" } });
    await notify({ data: { event: "schedule_changed", staff_name: row.staff_name, staff_email: row.staff_email, area: viewArea, start_date: row.start_date, end_date: row.end_date } });
    toast.success("Vacation cancelled — schedule reverted");
    setManageRow(null); setManageDay(null);
    await load(); onDone();
  };

  const months = [cursor, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)];
  const areaOptions = canSeeSupervisorsCalendar ? [SUPERVISORS_AREA, ...areas.filter((a) => a !== SUPERVISORS_AREA)] : areas;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{viewArea || "—"} Vacation Planner</h2>
        {canSwitchArea && (
          <Select value={viewArea} onValueChange={(v) => { setViewArea(v); setStart(null); setEnd(null); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>{areaOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      {/* Selection bar */}
      <div className="rounded-xl border bg-card px-4 py-3 flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Vacation start</div>
          <div className="font-semibold text-ink">{start ?? "—"}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Vacation end</div>
          <div className="font-semibold text-ink">{end ?? "—"}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {start && <Button variant="ghost" size="sm" onClick={() => { setStart(null); setEnd(null); }}>Clear</Button>}
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <Button disabled={!start || !isOwnArea}>Request leave</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="end">
              <div className="text-sm space-y-1">
                {officeHours && <p className="text-[11px] text-muted-foreground">Office hours (9h) — only Sunday–Thursday count as vacation days.</p>}
              <div className="flex justify-between"><span className="text-muted-foreground">Total days</span><span className="font-semibold">{totalDays}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remaining this year</span><span className="font-semibold">{remaining}</span></div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Routes to</span>
                  <span className="font-medium truncate">
                    {isSupervisorsView
                      ? (supervisors.find((s) => s.email === covering)?.name ?? "Covering supervisor")
                      : (approverName ?? "—")}
                  </span>
                </div>
              </div>
              {isSupervisorsView && (
                <div>
                  <Label className="text-xs">Covering supervisor (required)</Label>
                  <Select value={covering} onValueChange={setCovering}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select a supervisor" /></SelectTrigger>
                    <SelectContent>
                      {supervisors.map((s) => <SelectItem key={s.email} value={s.email}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Approval: covering supervisor → admin.</p>
                </div>
              )}
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button className="w-full" disabled={busy || (isSupervisorsView && !covering)} onClick={submit}>Submit request</Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Yearly cap <span className="font-medium text-ink">{yearlyCap}</span> · Used{" "}
        <span className="font-medium text-ink">{balance.approved}</span> · Pending{" "}
        <span className="font-medium text-ink">{balance.pending}</span> · Remaining{" "}
        <span className="font-medium text-steel-700">{remaining}</span>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <ExcelImportButton<VacationImportPayload>
            size="default"
            title={`Import ${viewArea} vacations`}
            description="Required columns: Badge, Vacation Start, Vacation End. Staff Name / Area / Status are optional — names and areas always come from the staff directory, matched by badge number."
            toggles={[{ key: "allAreas", label: "Import all areas", description: "Ignore the area filter and import every badge found in the directory." }]}
            parse={async ({ rows, toggles }) => {
              const allAreas = !!toggles["allAreas"];
              const [{ data: st }, { data: lv }] = await Promise.all([
                supabase.from("staff").select("id,email,name,role,area,badge_id"),
                supabase.from("leave_requests")
                  .select("id,staff_id,staff_email,start_date,end_date,status")
                  .eq("leave_type", "Vacation"),
              ]);
              const staff = ((st ?? []) as unknown as DirectoryStaffLite[]).filter((m) =>
                isSupervisorsView ? m.role === "supervisor" : true,
              );
              return planVacationImport({
                rows,
                area: viewArea,
                allAreas: allAreas || isSupervisorsView,
                staff,
                existing: (lv ?? []) as ExistingLeave[],
              });
            }}
            commit={async (items: ImportItem<VacationImportPayload>[], { setProgress }) => {
              if (items.length === 0) return { written: 0, failures: [] };
              const { written, errors } = await commitVacationImport(items, {
                approverEmail: me.email,
                setProgress,
              });
              if (written > 0) {
                await logAudit({ action: "vacations_imported", entity_type: "leave_request", area: viewArea, details: { count: written } });
                toast.success(`${written} vacation row${written === 1 ? "" : "s"} imported`);
                await load(); onDone();
              }
              if (errors.length > 0) console.error("[vacation import] row failures", errors);
              return {
                written,
                failures: errors.map((e) => `Badge ${e.badge} · ${e.name} · ${e.range} — ${e.message}`),
              };
            }}
          />
          <Button
            variant="outline"
            onClick={async () => {
              const n = await exportVacationsExcel(viewArea, cursor.getFullYear());
              toast.success(`Exported ${n} vacation row${n === 1 ? "" : "s"}`);
            }}
          >
            Export to Excel
          </Button>
        </div>
      )}

      {/* Calendars */}
      <div className="grid gap-3 lg:grid-cols-2 max-w-4xl mx-auto">
        {months.map((m, idx) => (
          <div key={idx} className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1.5 border-b bg-bone/60">
              <div className="flex items-center gap-1">
                {idx === 0 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                )}
                <div className="font-semibold text-ink text-sm">{m.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
              </div>
              <div className="flex items-center gap-1">
                <span className="hidden sm:inline text-[10px] text-muted-foreground">
                  {canManage ? "Tap a day with entries to adjust or cancel" : "Tap a highlighted day to adjust or cancel"}
                </span>
                {idx === 1 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-7 text-[10px] uppercase tracking-wide text-muted-foreground border-b">
              {WEEKDAYS.map((w) => <div key={w} className="px-1 py-0.5 text-center">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 relative">
              {monthMatrix(m.getFullYear(), m.getMonth()).map((d, i) => {
                if (!d) return <div key={i} className="min-h-[86px] border-b border-r bg-muted/20" />;
                const iso = toISODate(d);
                const names = approvedByDay.get(iso) ?? [];
                const own = mineByDay.get(iso);
                const dayRows = rowsByDay.get(iso) ?? [];
                const used = names.length;
                const full = cap > 0 && used >= cap && !own;
                const past = iso < todayISO;
                const selected = selectedSet.has(iso);
                const clickable = !!own || (canManage && dayRows.length > 0) || (isOwnArea && !full && !past);
                const visible = dayRows.slice(0, 3);
                const overflow = dayRows.length - visible.length;
                return (
                  <div
                    key={i}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={() => { if (clickable) onDayClick(iso); }}
                    onKeyDown={(e) => {
                      if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onDayClick(iso); }
                    }}
                    className={[
                      "min-h-[86px] max-h-[86px] overflow-hidden border-b border-r p-1 text-left align-top flex flex-col gap-0.5 transition-colors",
                      full ? "bg-muted text-muted-foreground" : "bg-card",
                      past && !own ? "opacity-50" : "",
                      selected && !own ? "ring-2 ring-inset ring-steel-500 bg-steel-50" : "",
                      clickable ? "hover:bg-steel-50/70 cursor-pointer" : "cursor-default",
                    ].join(" ")}
                  >
                    <span className="text-[11px] font-semibold text-ink">{d.getDate()}</span>
                    <div className="flex flex-col gap-px w-full min-w-0 overflow-y-auto">
                      {visible.map((r) => {
                        const mine = r.staff_email.toLowerCase() === me.email.toLowerCase();
                        return (
                          <TooltipProvider key={r.id} delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={[
                                  "flex items-center gap-1 rounded px-1 py-px w-full min-w-0",
                                  mine ? "bg-steel-100" : "bg-muted/40",
                                ].join(" ")}>
                                  <span className="text-[9px] leading-tight truncate flex-1 min-w-0 text-ink">{r.staff_name}</span>
                                  <span className={[
                                    "shrink-0 rounded px-1 text-[8px] font-semibold leading-[13px]",
                                    r.status === "Approved" ? "bg-steel-600 text-white" : "bg-copper/25 text-ink",
                                  ].join(" ")}>{r.status === "Approved" ? "A" : "P"}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-56">
                                <div className="text-xs">{r.staff_name} — {r.status}</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                      {overflow > 0 && (
                        <Popover open={openDay === iso} onOpenChange={(o) => setOpenDay(o ? iso : null)}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setOpenDay(iso); }}
                              className="text-[9px] leading-tight text-steel-700 underline underline-offset-2 text-left w-full"
                            >
                              +{overflow} more
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            collisionPadding={8}
                            className="w-64 p-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="text-xs font-semibold mb-1">{iso} — {dayRows.length} on leave</div>
                            <div className="max-h-56 overflow-y-auto space-y-1">
                              {dayRows.map((r) => {
                                const meta = staffMeta[r.staff_email.toLowerCase()];
                                return (
                                  <div key={r.id} className="rounded border px-1.5 py-1">
                                    <div className="flex items-center gap-1 min-w-0">
                                      <span className="text-xs truncate flex-1 min-w-0">{r.staff_name}</span>
                                      <span className={[
                                        "shrink-0 rounded px-1 text-[9px] font-semibold",
                                        r.status === "Approved" ? "bg-steel-600 text-white" : "bg-copper/25 text-ink",
                                      ].join(" ")}>{r.status}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                      {meta?.badge ? `#${meta.badge} · ` : ""}{meta?.area ?? viewArea}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">{r.start_date} → {r.end_date}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Own request detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{detail?.status === "Approved" ? "Approved vacation" : "Pending request"}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Dates: </span><span className="font-medium">{detail.start_date} → {detail.end_date}</span></div>
              <div><span className="text-muted-foreground">Days: </span><span className="font-medium">{countVacationDays(detail.start_date, detail.end_date, me.role)}</span></div>
              <div><span className="text-muted-foreground">Stage: </span><span className="font-medium">{stageLabel(detail)}</span></div>
              <div><span className="text-muted-foreground">Approver: </span><span className="font-medium">{(detail.approver_email && detail.approver_email.toLowerCase() === approver?.toLowerCase() ? approverName : detail.approver_email) ?? "—"}</span></div>
              {detail.reason && <div><span className="text-muted-foreground">Reason: </span>{detail.reason}</div>}
              {detail.status === "Approved" ? (
                <p className="text-xs text-muted-foreground">Approved vacations can only be changed by your supervisor.</p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => { setStart(detail.start_date); setEnd(detail.end_date); setDetail(null); }}>Edit dates</Button>
                  <Button variant="destructive" className="flex-1" disabled={busy} onClick={() => cancelPending(detail)}>Cancel request</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Supervisor / admin management */}
      <Dialog open={!!manageDay} onOpenChange={(o) => { if (!o) { setManageDay(null); setManageRow(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{manageRow ? "Adjust vacation" : `Vacations on ${manageDay?.iso}`}</DialogTitle></DialogHeader>
          {!manageRow && manageDay && (
            <div className="space-y-2">
              {manageDay.rows.map((r) => (
                <div key={r.id} className="rounded-md border p-2 space-y-2">
                  <div className="text-sm font-medium">{r.staff_name}</div>
                  <div className="text-xs text-muted-foreground">{r.start_date} → {r.end_date} · {stageLabel(r)}</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => { setManageRow(r); setEditStart(r.start_date); setEditEnd(r.end_date); }}>Adjust dates</Button>
                    <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={() => cancelVacation(r)}>Cancel vacation</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {manageRow && (
            <div className="space-y-3">
              <div className="text-sm font-medium">{manageRow.staff_name}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">End</Label>
                  <Input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Applies immediately and syncs the schedule — no approval needed.</p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setManageRow(null)}>Back</Button>
                <Button className="flex-1" disabled={busy} onClick={saveAdjusted}>Save</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
