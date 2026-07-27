import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

export function VacationPlanner({ me, onDone }: { me: PlannerStaff; onDone: () => void }) {
  const { rules } = useSystemRules();
  const canSwitchArea = me.role !== "staff";
  const [areas, setAreas] = useState<string[]>([]);
  const [viewArea, setViewArea] = useState<string>(me.area ?? "");
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

  const isOwnArea = viewArea === me.area;

  useEffect(() => {
    if (!canSwitchArea) return;
    void supabase.from("staff").select("area").not("area", "is", null).then(({ data }) => {
      setAreas(Array.from(new Set((data ?? []).map((r) => r.area as string).filter(Boolean))).sort());
    });
  }, [canSwitchArea]);

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
    const [{ count: hc }, { data: area }, { data: mine }] = await Promise.all([
      supabase.from("staff").select("id", { count: "exact", head: true }).eq("area", viewArea),
      supabase.from("leave_requests")
        .select("id,staff_email,staff_name,start_date,end_date,status,reason,approver_email")
        .eq("area", viewArea).eq("leave_type", "Vacation")
        .in("status", ["Approved", "Pending"])
        .lte("start_date", winEnd).gte("end_date", winStart),
      supabase.from("leave_requests").select("start_date,end_date,status")
        .ilike("staff_email", me.email).eq("leave_type", "Vacation")
        .gte("start_date", `${year}-01-01`).lte("end_date", `${year}-12-31`),
    ]);
    setHeadcount(hc ?? 1);
    setLeaves((area ?? []) as LeaveRow[]);
    let approved = 0, pending = 0;
    for (const r of mine ?? []) {
      const n = countDays(r.start_date, r.end_date);
      if (r.status === "Approved") approved += n;
      else if (r.status === "Pending") pending += n;
    }
    setBalance({ approved, pending });
  }, [viewArea, cursor, me.email]);

  useEffect(() => { void load(); }, [load]);

  const cap = useMemo(
    () => Math.floor((headcount * ruleNumber(rules, "vacation_cap_pct", 30)) / 100),
    [headcount, rules],
  );
  const yearlyCap = ruleNumber(rules, "vacation_yearly_days", 25);
  const remaining = Math.max(0, yearlyCap - balance.approved - balance.pending);

  // day → approved colleague names, and my own request per day
  const { approvedByDay, mineByDay } = useMemo(() => {
    const approvedByDay = new Map<string, string[]>();
    const mineByDay = new Map<string, LeaveRow>();
    const isMine = (r: LeaveRow) => r.staff_email.toLowerCase() === me.email.toLowerCase();
    for (const r of leaves) {
      for (const iso of eachDay(r.start_date, r.end_date)) {
        if (r.status === "Approved") {
          const list = approvedByDay.get(iso) ?? [];
          list.push(r.staff_name);
          approvedByDay.set(iso, list);
        }
        if (isMine(r)) mineByDay.set(iso, r);
      }
    }
    return { approvedByDay, mineByDay };
  }, [leaves, me.email]);

  const todayISO = toISODate(new Date());

  const selectedSet = useMemo(() => {
    if (!start) return new Set<string>();
    return new Set(eachDay(start, end ?? start));
  }, [start, end]);

  const onDayClick = (iso: string) => {
    const own = mineByDay.get(iso);
    if (own) { setDetail(own); return; }
    if (!isOwnArea) return;
    if (iso < todayISO) return;
    const used = approvedByDay.get(iso)?.length ?? 0;
    if (cap > 0 && used >= cap) return;
    if (!start || (start && end)) { setStart(iso); setEnd(null); return; }
    if (iso < start) { setStart(iso); return; }
    setEnd(iso);
  };

  const totalDays = start ? countDays(start, end ?? start) : 0;

  const submit = async () => {
    if (!start) return;
    const s = start, e = end ?? start;
    if (!approver) { toast.error("No approver available"); return; }
    setBusy(true);
    const { data: inserted, error } = await supabase.from("leave_requests").insert({
      staff_email: me.email, staff_name: me.name, area: me.area!, leave_type: "Vacation",
      staff_id: me.id, start_date: s, end_date: e, reason, approver_email: approver,
    }).select("id").maybeSingle();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_submitted", staff_name: me.name, staff_email: me.email, supervisor_email: approver, area: me.area, leave_type: "Vacation", start_date: s, end_date: e, reason } });
    await createNotification({ data: { recipient_email: approver, title: "Vacation leave request", body: `${me.name}: ${s} → ${e}`, link: "/approvals" } });
    await logAudit({ action: "leave_requested", entity_type: "leave_request", entity_id: inserted?.id ?? null, area: me.area, details: { start_date: s, end_date: e, leave_type: "Vacation" } });
    toast.success("Vacation request submitted");
    setConfirmOpen(false); setStart(null); setEnd(null); setReason("");
    await load(); onDone();
  };

  const cancelPending = async (row: LeaveRow) => {
    setBusy(true);
    const { error } = await supabase.from("leave_requests").update({ status: "Rejected" }).eq("id", row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "leave_cancelled_by_requester", entity_type: "leave_request", entity_id: row.id, area: me.area, details: { start_date: row.start_date, end_date: row.end_date } });
    if (row.approver_email) {
      await createNotification({ data: { recipient_email: row.approver_email, title: "Vacation request cancelled", body: `${me.name} cancelled ${row.start_date} → ${row.end_date}`, link: "/approvals" } });
    }
    toast.success("Request cancelled");
    setDetail(null);
    await load(); onDone();
  };

  const months = [cursor, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{viewArea || "—"} Vacation Planner</h2>
        {canSwitchArea && (
          <Select value={viewArea} onValueChange={setViewArea}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>{areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
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
          <div className="font-semibold text-ink">{end ?? (start ? "—" : "—")}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {start && <Button variant="ghost" size="sm" onClick={() => { setStart(null); setEnd(null); }}>Clear</Button>}
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <Button disabled={!start || !isOwnArea}>Request leave</Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="end">
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Total days</span><span className="font-semibold">{totalDays}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Remaining this year</span><span className="font-semibold">{remaining}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Routes to</span><span className="font-medium truncate">{approverName ?? "—"}</span></div>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button className="w-full" disabled={busy} onClick={submit}>Submit request</Button>
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
                <span className="hidden sm:inline text-[11px] text-muted-foreground">Tap a highlighted day to adjust or cancel</span>
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
                const used = names.length;
                const full = cap > 0 && used >= cap && !own;
                const past = iso < todayISO;
                const selected = selectedSet.has(iso);
                const clickable = !!own || (isOwnArea && !full && !past);
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{detail?.status === "Approved" ? "Approved vacation" : "Pending request"}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Dates: </span><span className="font-medium">{detail.start_date} → {detail.end_date}</span></div>
              <div><span className="text-muted-foreground">Days: </span><span className="font-medium">{countDays(detail.start_date, detail.end_date)}</span></div>
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
    </div>
  );
}