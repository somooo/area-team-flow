import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { notify } from "@/lib/notify.functions";
import { createNotification } from "@/lib/notifications.functions";
import { logAudit } from "@/lib/audit";
import { resolveApprover } from "@/lib/approver";
import { MonthGrid, type StaffLite } from "@/components/MonthGrid";
import { MyChangeRequests } from "@/components/MyChangeRequests";
import { ReferenceTable } from "@/components/ReferenceTable";
import { TeamLeaderReportDialog } from "@/components/TeamLeaderReportDialog";
import { fetchZoneReference, isLeaderShift, type ZoneReferenceRow } from "@/lib/assignments";
import { toISODate, cellFor } from "@/lib/roster";
import type { RosterShift } from "@/lib/roster";
import { getServerNow } from "@/lib/server-time.functions";
import { exportExcel, exportPdf } from "@/lib/schedule-export";
import { totalsForStaff, groupByStaff } from "@/lib/roster-totals";
import { useSystemRules } from "@/lib/system-rules";
import { AREAS } from "@/lib/areas";
import { X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Schedule — KADIR Staff Management" },
      { name: "description", content: "Monthly duty roster by area with swap and overtime requests." },
      { property: "og:title", content: "Schedule — KADIR Staff Management" },
      { property: "og:description", content: "Monthly duty roster by area with swap and overtime requests." },
    ],
  }),
  component: SchedulePage,
});

type Shift = RosterShift;
type Staff = StaffLite;
type PickMode = null | { kind: "switch_date" | "switch_area"; source: Shift };

/** Cells that carry a working assignment. */
function hasAssignment(shift?: Shift) {
  return !!shift && shift.duty !== "Off" && shift.duty !== "Vacation";
}

/** Empty / unscheduled cells are eligible for missed-OT reports on past days of the same month. */
function isEmpty(shift?: Shift) {
  return !shift;
}

function SchedulePage() {
  const { me } = useMe();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<Staff[]>([]);
  const areas = AREAS as readonly string[];
  const [viewArea, setViewArea] = useState<string>("");
  const [layer, setLayer] = useState<"all" | "day" | "night">("day");
  const [menuShift, setMenuShift] = useState<Shift | null>(null);
  const [pick, setPick] = useState<PickMode>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ shift: Shift; staff: Staff } | null>(null);
  const [otShift, setOtShift] = useState<Shift | null>(null);
  const [reportShift, setReportShift] = useState<Shift | null>(null);
  const [missedOtDate, setMissedOtDate] = useState<{ staff: Staff; date: string } | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reference, setReference] = useState<ZoneReferenceRow[]>([]);
  const [tlOpen, setTlOpen] = useState(false);

  useEffect(() => {
    void getServerNow().then((r) => setServerNow(new Date(r.now)));
  }, []);

  useEffect(() => {
    if (viewArea) return;
    setViewArea(me?.staff?.area ?? "ICU");
  }, [me?.staff?.area]);

  const isAssistants = viewArea.toLowerCase() === "assistants";
  const effectiveLayer: "all" | "day" | "night" = isAssistants ? "all" : layer;

  const load = async () => {
    if (!viewArea) return;
    const startISO = toISODate(new Date(year, month, 1));
    const endISO = toISODate(new Date(year, month + 1, 0));
    const [{ data: sh }, { data: st }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", viewArea).gte("date", startISO).lte("date", endISO).order("date"),
      supabase.from("staff").select("id,name,email,role,area,department").eq("area", viewArea).order("name"),
    ]);
    setShifts((sh as Shift[]) ?? []);
    setRoster((st as Staff[]) ?? []);
  };

  useEffect(() => { void load(); }, [year, month, viewArea]);

  useEffect(() => {
    if (!viewArea) { setReference([]); return; }
    void fetchZoneReference(viewArea).then(setReference);
  }, [viewArea]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPick(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isMyArea = me?.staff?.area === viewArea;
  const meEmail = me?.staff?.email ?? "";

  /** Today's own shift in the visible schedule, used for the Team Leader Report button. */
  const todaysOwnShift = useMemo(() => {
    if (!serverNow || !meEmail) return undefined;
    const iso = toISODate(serverNow);
    return shifts.find(
      (s) =>
        s.staff_email.toLowerCase() === meEmail.toLowerCase() &&
        s.date === iso &&
        (effectiveLayer === "all" || (effectiveLayer === "night" ? s.duty === "Night" : s.duty !== "Night")),
    );
  }, [shifts, serverNow, meEmail, effectiveLayer]);
  const isLeaderToday = isMyArea && isLeaderShift(todaysOwnShift, reference);

  /** Classify a cell against the authoritative server clock. */
  const classify = (date: string, shift?: Shift): "inert" | "past_month" | "action" | "report" | "missed_ot" => {
    if (!serverNow) return "inert";
    const [y, m, d] = date.split("-").map(Number);
    const cellStart = new Date(y, m - 1, d);
    const nowMonth = serverNow.getFullYear() * 12 + serverNow.getMonth();
    const cellMonth = y * 12 + (m - 1);
    if (cellMonth < nowMonth) return "past_month";

    if (isEmpty(shift)) {
      // Empty cells in the current month, today or earlier, can report missed OT.
      if (cellStart.getTime() <= serverNow.getTime()) return "missed_ot";
      return "inert";
    }

    if (!hasAssignment(shift)) return "inert";
    if (cellStart.getTime() - serverNow.getTime() > 24 * 60 * 60 * 1000) return "action";
    return "report";
  };

  const cellClickable = ({ staff, date, shift }: { staff: Staff; date: string; shift?: Shift }) => {
    if (!meEmail || staff.email.toLowerCase() !== meEmail.toLowerCase()) return !!pick && hasAssignment(shift);
    return classify(date, shift) !== "inert";
  };

  const handleCell = ({ staff, shift, date }: { staff: Staff; date: string; shift?: Shift }) => {
    const isSelf = staff.email.toLowerCase() === meEmail.toLowerCase();
    if (pick) {
      if (isSelf) { toast.info("Pick another person's shift."); return; }
      if (!shift) { toast.info("That day has no assignment."); return; }
      const sourceIsNight = pick.source.duty === "Night";
      const targetIsNight = shift.duty === "Night";
      if (sourceIsNight !== targetIsNight) {
        toast.error("Day and Night schedules can't be swapped — pick someone on the same schedule.");
        return;
      }
      if (pick.kind === "switch_date" && staff.area !== pick.source.area) {
        toast.error("Switch day must stay within the same area.");
        return;
      }
      setConfirmTarget({ shift, staff });
      return;
    }
    if (!isSelf) return; // read-only for other people
    const kind = classify(date, shift);
    if (kind === "past_month") {
      toast.info("For previous month requests, please use the Requests tab.");
      return;
    }
    if (kind === "missed_ot") { setMissedOtDate({ staff, date }); return; }
    if (kind === "report") { setReportShift(shift!); return; }
    if (kind === "action") setMenuShift(shift!);
  };

  if (!me?.staff) return null;
  const meStaff = me.staff;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Schedule</h1>
          <p className="text-muted-foreground text-sm">
            {isMyArea ? `${meStaff.area ?? "—"} · your area` : `${viewArea} · read-only`}
          </p>
          {isLeaderToday && (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setTlOpen(true)}>
              Team Leader Report
            </Button>
          )}
        </div>
      </div>

      {pick && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-steel-300 bg-steel-100 px-4 py-2 text-sm text-steel-900">
          <span>
            Select the shift to switch with
            {pick.kind === "switch_area" ? " (you can change area above)" : " (same area)"} — Esc to cancel
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPick(null)}><X className="h-4 w-4" /></Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Monthly schedule</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void exportExcel({ area: viewArea, year, month, staff: roster, shifts, layer: effectiveLayer, withSummary: meStaff.role !== "staff" })}
            >
              {meStaff.role === "staff" ? "Download schedule" : "Download Excel"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportPdf({ area: viewArea, year, month, staff: roster, shifts })}>Download PDF</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-row items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-56">
              <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Area</Label>
              <Select value={viewArea} onValueChange={(v) => setViewArea(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
              <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Shift</Label>
              <Select value={layer} onValueChange={(v) => setLayer(v as "day" | "night")} disabled={isAssistants}>
                <SelectTrigger className="w-full capitalize">
                  <SelectValue placeholder="Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="night">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ReferenceTable area={viewArea} rows={reference} />
          {roster.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No staff assigned to this area yet — use Add staff to get started.
            </p>
          ) : (
          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={roster} shifts={shifts}
            meEmail={isMyArea ? meStaff.email : ""}
            layer={effectiveLayer}
            areaLabel={isAssistants ? viewArea : `${viewArea} · ${layer === "day" ? "Day" : "Night"}`}
            onCellClick={handleCell}
            isCellClickable={cellClickable}
          />
          )}
          {meStaff.role !== "staff" && <TotalsTable staff={roster} shifts={shifts} area={viewArea} year={year} month={month} />}
        </CardContent>
      </Card>

      <MyChangeRequests meEmail={meStaff.email} refreshKey={refreshKey} />

      {menuShift && (
        <Dialog open onOpenChange={(v) => { if (!v) setMenuShift(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>{menuShift.date} · {cellFor(menuShift, false).code || menuShift.duty}</DialogTitle></DialogHeader>
            <div className="grid gap-2">
              <Button variant="outline" onClick={() => { setPick({ kind: "switch_date", source: menuShift }); setMenuShift(null); }}>
                Switch day with another staff
              </Button>
              <Button variant="outline" onClick={() => { setPick({ kind: "switch_area", source: menuShift }); setMenuShift(null); }}>
                Switch area with another staff
              </Button>
              {(menuShift.is_overtime || menuShift.ot_type !== "None") && (
                <Button variant="outline" onClick={() => { setOtShift(menuShift); setMenuShift(null); }}>
                  Give away overtime
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {pick && confirmTarget && (
        <ConfirmSwapDialog
          me={meStaff}
          kind={pick.kind}
          source={pick.source}
          target={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onDone={() => { setConfirmTarget(null); setPick(null); setRefreshKey((k) => k + 1); }}
        />
      )}

      {otShift && (
        <GiveOtDialog
          me={meStaff}
          shift={otShift}
          roster={roster.filter((s) => s.email.toLowerCase() !== meStaff.email.toLowerCase())}
          onClose={() => setOtShift(null)}
          onDone={() => { setOtShift(null); setRefreshKey((k) => k + 1); }}
        />
      )}

      {reportShift && (
        <ReportDialog me={meStaff} shift={reportShift} onClose={() => setReportShift(null)} />
      )}

      {missedOtDate && (
        <MissedOvertimeDialog me={meStaff} date={missedOtDate.date} onClose={() => setMissedOtDate(null)} />
      )}

      {tlOpen && serverNow && (
        <TeamLeaderReportDialog
          me={meStaff}
          date={toISODate(serverNow)}
          layer={effectiveLayer}
          assignmentCode={todaysOwnShift?.unit_code ?? null}
          onClose={() => setTlOpen(false)}
        />
      )}
    </div>
  );
}

function ReportDialog({ me, shift, onClose }: { me: MeStaff; shift: Shift; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const code = cellFor(shift, false).code || shift.duty;

  const submit = async () => {
    setBusy(true);
    const approver = await resolveApprover(me);
    await logAudit({
      action: "report_wrong_entry",
      entity_type: "shift",
      entity_id: shift.id,
      area: me.area,
      details: { date: shift.date, code, note, approver_email: approver },
    });
    if (approver) {
      await createNotification({
        data: {
          recipient_email: approver,
          title: `Wrong entry report — ${me.name}`,
          body: `${shift.date} · ${code}${note ? ` — ${note}` : ""}`,
          link: "/approvals",
        },
      });
    }
    setBusy(false);
    toast.success("Report sent to your supervisor");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{shift.date} · {code}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what should be corrected" />
          </div>
          <p className="text-xs text-muted-foreground">
            This is a flagged note for your supervisor to review — not an approval request.
          </p>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || !note.trim()}>Submit</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MissedOvertimeDialog({ me, date, onClose }: { me: MeStaff; date: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    const approver = await resolveApprover(me);
    await logAudit({
      action: "report_missed_overtime",
      entity_type: "shift",
      entity_id: null,
      area: me.area,
      details: { date, note, approver_email: approver },
    });
    if (approver) {
      await createNotification({
        data: {
          recipient_email: approver,
          title: `Missed overtime report — ${me.name}`,
          body: `${date}${note ? ` — ${note}` : ""}`,
          link: "/approvals",
        },
      });
    }
    setBusy(false);
    toast.success("Report sent to your supervisor");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{date} · Missed overtime</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the missed overtime" />
          </div>
          <p className="text-xs text-muted-foreground">
            This is a flagged note for your supervisor to review — not an approval request.
          </p>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || !note.trim()}>Submit</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type MeStaff = NonNullable<NonNullable<ReturnType<typeof useMe>["me"]>["staff"]>;

async function createChangeRequest(opts: {
  me: MeStaff;
  changeType: "give_ot" | "switch_area" | "switch_date";
  sourceShift: Shift;
  targetEmail: string;
  targetName: string;
  targetShiftId: string | null;
  details: string;
}) {
  const approver = await resolveApprover(opts.me);
  const { data: inserted, error } = await supabase
    .from("schedule_change_requests")
    .insert({
      requester_email: opts.me.email,
      requester_name: opts.me.name,
      area: opts.me.area!,
      change_type: opts.changeType,
      source_shift_id: opts.sourceShift.id,
      target_staff_email: opts.targetEmail,
      target_staff_name: opts.targetName,
      target_shift_id: opts.targetShiftId,
      details: opts.details,
      approver_email: approver,
    })
    .select("id")
    .maybeSingle();
  if (error) { toast.error(error.message); return false; }
  await notify({ data: { event: "change_requested", change_type: opts.changeType, requester_name: opts.me.name, staff_email: opts.targetEmail, staff_name: opts.targetName, details: opts.details } });
  await createNotification({ data: { recipient_email: opts.targetEmail, title: "Schedule change request", body: `${opts.me.name} · ${opts.changeType}`, link: "/dashboard" } });
  await logAudit({
    action: "change_requested", entity_type: "schedule_change_request",
    entity_id: inserted?.id ?? null, area: opts.me.area,
    details: { change_type: opts.changeType, target: opts.targetEmail },
  });
  toast.success("Request sent — waiting for the other staff member");
  return true;
}

function ConfirmSwapDialog({ me, kind, source, target, onClose, onDone }: {
  me: MeStaff; kind: "switch_date" | "switch_area"; source: Shift;
  target: { shift: Shift; staff: Staff }; onClose: () => void; onDone: () => void;
}) {
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await createChangeRequest({
      me, changeType: kind, sourceShift: source,
      targetEmail: target.staff.email, targetName: target.staff.name,
      targetShiftId: target.shift.id, details,
    });
    setBusy(false);
    if (ok) onDone();
  };
  const Side = ({ title, name, shift }: { title: string; name: string; shift: Shift }) => (
    <div className="rounded-md border p-3 bg-slate-50">
      <div className="text-xs uppercase text-muted-foreground">{title}</div>
      <div className="font-medium">{name}</div>
      <div className="text-sm">{shift.date}</div>
      <div className="text-sm font-semibold text-steel-700">{cellFor(shift, false).code || shift.duty} · {shift.area}</div>
    </div>
  );
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{kind === "switch_date" ? "Switch day" : "Switch area"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Side title="Your shift" name={me.name} shift={source} />
          <Side title="Their shift" name={target.staff.name} shift={target.shift} />
        </div>
        <div><Label>Details (optional)</Label><Textarea value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        <DialogFooter><Button onClick={submit} disabled={busy}>Send request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GiveOtDialog({ me, shift, roster, onClose, onDone }: {
  me: MeStaff; shift: Shift; roster: Staff[]; onClose: () => void; onDone: () => void;
}) {
  const [targetEmail, setTargetEmail] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const target = roster.find((s) => s.email === targetEmail);
    if (!target) { toast.error("Pick who will take the shift"); return; }
    setBusy(true);
    const ok = await createChangeRequest({
      me, changeType: "give_ot", sourceShift: shift,
      targetEmail: target.email, targetName: target.name, targetShiftId: null, details,
    });
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Give away overtime — {shift.date}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border p-3 bg-slate-50 text-sm">
            {cellFor(shift, false).code || shift.duty} · {shift.area} · {shift.hours}h
          </div>
          <div>
            <Label>Who will take it?</Label>
            <Select value={targetEmail} onValueChange={setTargetEmail}>
              <SelectTrigger><SelectValue placeholder="Choose a colleague" /></SelectTrigger>
              <SelectContent>
                {roster.map((s) => <SelectItem key={s.id} value={s.email}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Details (optional)</Label><Textarea value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>Send request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TotalsTable({ staff, shifts, area, year, month }: { staff: Staff[]; shifts: Shift[]; area: string; year: number; month: number }) {
  const byStaff = useMemo(() => groupByStaff(shifts), [shifts]);
  const { rules } = useSystemRules();
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [bases, setBases] = useState<Record<string, { base: number | null; area: string | null }>>({});

  useEffect(() => {
    void (async () => {
      const [{ data: ovr }, { data: st }] = await Promise.all([
        supabase.from("regular_shift_overrides").select("staff_id,regular_shifts").eq("area", area).eq("year", year).eq("month", month),
        supabase.from("staff").select("id,shift_base_override,area").in("id", staff.map((s) => s.id).length ? staff.map((s) => s.id) : ["00000000-0000-0000-0000-000000000000"]),
      ]);
      setOverrides(Object.fromEntries(((ovr as { staff_id: string; regular_shifts: number }[]) ?? []).map((o) => [o.staff_id, o.regular_shifts])));
      setBases(Object.fromEntries(((st as { id: string; shift_base_override: number | null; area: string | null }[]) ?? []).map((r) => [r.id, { base: r.shift_base_override, area: r.area }])));
    })();
  }, [area, year, month, staff.length]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-xs border rounded-md">
        <thead className="bg-steel-100">
          <tr>
            <th className="p-2 text-left">Staff</th>
            <th className="p-2">Day</th><th className="p-2">Night</th>
            <th className="p-2">Duty</th><th className="p-2">R/Shifts</th><th className="p-2">OT shifts</th>
            <th className="p-2">Sick on OT (not counted as duty)</th>
            <th className="p-2">Hours</th><th className="p-2">OT h</th>
            <th className="p-2">Sick</th><th className="p-2">Vacation</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => {
            const info = bases[s.id];
            const t = totalsForStaff(byStaff.get(s.email.toLowerCase()) ?? [], {
              daysInMonth,
              sickOtExcludedFromDuty: rules["sick_ot_excluded_from_duty"] === true,
              baseOverride: info?.base ?? null,
              staffArea: info?.area ?? s.area,
              scheduleArea: area,
              regularShiftsOverride: overrides[s.id] ?? null,
              benefitDaysMinHolidays: Number(rules["benefit_days_min_holidays"] ?? 5),
            });
            return (
              <tr key={s.id} className="border-t">
                <td className="p-2 text-left">
                  {s.name}
                  {t.cross_area && <span className="ml-2 text-[10px] text-muted-foreground">{info?.area ?? s.area} staff — overtime only</span>}
                </td>
                <td className="p-2 text-center">{t.day}</td>
                <td className="p-2 text-center">{t.night}</td>
                <td className="p-2 text-center">{t.duty_shifts}</td>
                <td className="p-2 text-center" title={t.override_applied ? "Manual override" : undefined}>
                  {t.regular_shifts}
                  {t.override_applied && <span className="ml-1 text-muted-foreground line-through">{t.computed_regular_shifts}</span>}
                </td>
                <td className="p-2 text-center">{t.ot_shifts}</td>
                <td className="p-2 text-center">{t.sick_on_ot}</td>
                <td className="p-2 text-center">{t.hours}</td>
                <td className="p-2 text-center">{t.ot_hours}</td>
                <td className="p-2 text-center">{t.sick}</td>
                <td className="p-2 text-center">{t.vacation}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
