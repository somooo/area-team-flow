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
  const isManagerRole = me.role === "supervisor" || me.role === "team_leader" || me.role === "admin";
  const canSwitchArea = me.role !== "staff";
  const canSeeSupervisorsCalendar = me.role === "supervisor" || me.role === "admin";
  const [areas, setAreas] = useState<string[]>([]);
  const [viewArea, setViewArea] = useState<string>(
    me.role === "supervisor" || me.role === "admin" ? SUPERVISORS_AREA : (me.area ?? ""),
  );
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [headcount, setHeadcount] = useState(1);
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
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const isSupervisorsView = viewArea === SUPERVISORS_AREA;
  const isOwnArea = isSupervisorsView ? canSeeSupervisorsCalendar : viewArea === me.area;
  /** Supervisors manage their own area; admins manage every area. Not on the shared supervisors calendar. */
  const canManage = isManagerRole && !isSupervisorsView && (me.role === "admin" || viewArea === me.area);

  useEffect(() => {
    if (!canSwitchArea) return;
    void supabase.from("staff").select("area").not("area", "is", null).then(({ data }) => {
      setAreas(Array.from(new Set((data ?? []).map((r) => r.area as string).filter(Boolean))).sort());
    });
  }, [canSwitchArea]);

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
    const [{ count: hc }, { data: area }, { data: mine }] = await Promise.all([
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
    ]);
    setHeadcount(hc ?? 1);
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

  const cap = useMemo(
    () => Math.floor((headcount * ruleNumber(rules, "vacation_cap_pct", 30)) / 100),
    [headcount, rules],
  );
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
    const used = approvedByDay.get(iso)?.length ?? 0;
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
      staff_email: me.email, staff_name: me.name,
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

      {/* Calendars */}
      <div className="grid gap-4 lg:grid-cols-2">
        {months.map((m, idx) => (
          <div key={idx} className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-bone/60">
              <div className="flex items-center gap-2">
                {idx === 0 && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                <div className="font-semibold text-ink">{m.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-[11px] text-muted-foreground">
                  {canManage ? "Tap a day with entries to adjust or cancel" : "Tap a highlighted day to adjust or cancel"}
                </span>
                {idx === 1 && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-7 text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              {WEEKDAYS.map((w) => <div key={w} className="px-2 py-1 text-center">{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthMatrix(m.getFullYear(), m.getMonth()).map((d, i) => {
                if (!d) return <div key={i} className="h-24 border-b border-r bg-muted/20" />;
                const iso = toISODate(d);
                const names = approvedByDay.get(iso) ?? [];
                const own = mineByDay.get(iso);
                const dayRows = rowsByDay.get(iso) ?? [];
                const used = names.length;
                const full = cap > 0 && used >= cap && !own;
                const past = iso < todayISO;
                const selected = selectedSet.has(iso);
                const clickable = !!own || (canManage && dayRows.length > 0) || (isOwnArea && !full && !past);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onDayClick(iso)}
                    disabled={!clickable}
                    className={[
                      "h-24 border-b border-r p-1.5 text-left align-top flex flex-col gap-1 transition-colors",
                      full ? "bg-muted text-muted-foreground" : "bg-card",
                      past && !own ? "opacity-50" : "",
                      selected && !own ? "ring-2 ring-inset ring-steel-500 bg-steel-50" : "",
                      clickable ? "hover:bg-steel-50/70 cursor-pointer" : "cursor-default",
                    ].join(" ")}
                  >
                    <span className="text-xs font-semibold text-ink">{d.getDate()}</span>
                    {own && (
                      <span className={[
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold w-fit",
                        own.status === "Approved" ? "bg-steel-600 text-white" : "bg-copper/25 text-ink",
                      ].join(" ")}>{own.status === "Approved" ? "Approved" : "Pending"}</span>
                    )}
                    {names.length > 0 && (
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-[10px] leading-tight text-muted-foreground truncate w-full">
                              {names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent><div className="text-xs">{names.join(", ")}</div></TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </button>
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
