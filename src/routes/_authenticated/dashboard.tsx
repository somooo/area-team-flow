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
import { toISODate, cellFor } from "@/lib/roster";
import type { RosterShift } from "@/lib/roster";
import { getServerNow } from "@/lib/server-time.functions";
import { exportExcel, exportPdf } from "@/lib/schedule-export";
import { totalsForStaff, groupByStaff } from "@/lib/roster-totals";
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
  const [areas, setAreas] = useState<string[]>([]);
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

  useEffect(() => {
    void getServerNow().then((r) => setServerNow(new Date(r.now)));
  }, []);

  useEffect(() => {
    supabase.from("staff").select("area").not("area", "is", null).then(({ data }) => {
      const uniq = Array.from(new Set((data ?? []).map((r) => r.area as string).filter(Boolean))).sort();
      const order = ["ICU", "Wards", "Assistants"];
      uniq.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      });
      setAreas(uniq);
    });
  }, []);

  useEffect(() => {
    if (viewArea) return;
    if (me?.staff?.area) setViewArea(me.staff.area);
    else if (areas.includes("ICU")) setViewArea("ICU");
    else if (areas[0]) setViewArea(areas[0]);
  }, [me?.staff?.area, areas]);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPick(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isMyArea = me?.staff?.area === viewArea;
  const meEmail = me?.staff?.email ?? "";

  /** Classify a cell against the authoritative server clock. */
  const classify = (date: string, shift?: Shift): "inert" | "past_month" | "action" | "report" => {
    if (!serverNow || !hasAssignment(shift)) return "inert";
    const [y, m, d] = date.split("-").map(Number);
    const cellStart = new Date(y, m - 1, d);
    const nowMonth = serverNow.getFullYear() * 12 + serverNow.getMonth();
    const cellMonth = y * 12 + (m - 1);
    if (cellMonth < nowMonth) return "past_month";
    if (cellStart.getTime() - serverNow.getTime() > 24 * 60 * 60 * 1000) return "action";
    return "report";
  };

  const cellClickable = ({ staff, date, shift }: { staff: Staff; date: string; shift?: Shift }) => {
    if (!meEmail || staff.email.toLowerCase() !== meEmail.toLowerCase()) return !!pick && hasAssignment(shift);
    return classify(date, shift) !== "inert";
  };

  const handleCell = ({ staff, shift }: { staff: Staff; date: string; shift?: Shift }) => {
    const isSelf = staff.email.toLowerCase() === meEmail.toLowerCase();
    if (pick) {
      if (isSelf) { toast.info("Pick another person's shift."); return; }
      if (!shift) { toast.info("That day has no assignment."); return; }
      if (pick.kind === "switch_date" && staff.area !== pick.source.area) {
        toast.error("Switch day must stay within the same area.");
        return;
      }
      setConfirmTarget({ shift, staff });
      return;
    }
    if (!isSelf) return; // read-only for other people
    if (!hasAssignment(shift)) return;
    const kind = classify(shift!.date, shift);
    if (kind === "past_month") {
      toast.info("For previous month requests, please use the Requests tab.");
      return;
    }
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
            {meStaff.role !== "staff" && (
              <Button size="sm" variant="outline" onClick={() => exportExcel({ area: viewArea, year, month, staff: roster, shifts })}>Download Excel</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => exportPdf({ area: viewArea, year, month, staff: roster, shifts })}>Download PDF</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Area</Label>
              <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-1">
                {areas.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setViewArea(a)}
                    aria-pressed={viewArea === a}
                    className={`min-h-11 truncate rounded px-2 text-sm font-medium transition-colors ${
                      viewArea === a ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-background"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0 sm:w-56">
              <Label className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-muted-foreground">Shift</Label>
              <div className={`grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1 ${isAssistants ? "opacity-50" : ""}`}>
                {(["day", "night"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={isAssistants}
                    onClick={() => setLayer(l)}
                    aria-pressed={!isAssistants && layer === l}
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
          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={roster} shifts={shifts}
            meEmail={isMyArea ? meStaff.email : ""}
            layer={effectiveLayer}
            areaLabel={isAssistants ? viewArea : `${viewArea} · ${layer === "day" ? "Day" : "Night"}`}
            onCellClick={handleCell}
            isCellClickable={cellClickable}
          />
          {meStaff.role !== "staff" && <TotalsTable staff={roster} shifts={shifts} />}
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
    </div>
  );
}

function ReportDialog({ me, shift, onClose }: { me: MeStaff; shift: Shift; onClose: () => void }) {
  const isMot = shift.ot_type === "MedEvac";
  const [kind, setKind] = useState<ReportKind | null>(isMot ? "wrong_entry" : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const code = cellFor(shift, false).code || shift.duty;

  const submit = async () => {
    if (!kind) return;
    setBusy(true);
    const label = kind === "missed_ot" ? "Missed overtime" : "Wrong entry";
    const approver = await resolveApprover(me);
    await logAudit({
      action: kind === "missed_ot" ? "report_missed_overtime" : "report_wrong_entry",
      entity_type: "shift",
      entity_id: shift.id,
      area: me.area,
      details: { date: shift.date, code, note, approver_email: approver },
    });
    if (approver) {
      await createNotification({
        data: {
          recipient_email: approver,
          title: `${label} report — ${me.name}`,
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
        {!kind ? (
          <div className="grid gap-2">
            <Button variant="outline" onClick={() => setKind("missed_ot")}>Report missed overtime</Button>
            <Button variant="outline" onClick={() => setKind("wrong_entry")}>Report wrong entry</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm font-medium">
              {kind === "missed_ot" ? "Report missed overtime" : "Report wrong entry"}
            </div>
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
        )}
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

function TotalsTable({ staff, shifts }: { staff: Staff[]; shifts: Shift[] }) {
  const byStaff = useMemo(() => groupByStaff(shifts), [shifts]);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-xs border rounded-md">
        <thead className="bg-steel-100">
          <tr>
            <th className="p-2 text-left">Staff</th>
            <th className="p-2">Day</th><th className="p-2">Night</th>
            <th className="p-2">Hours</th><th className="p-2">OT h</th>
            <th className="p-2">Sick</th><th className="p-2">Vacation</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => {
            const t = totalsForStaff(byStaff.get(s.email.toLowerCase()) ?? []);
            return (
              <tr key={s.id} className="border-t">
                <td className="p-2 text-left">{s.name}</td>
                <td className="p-2 text-center">{t.day}</td>
                <td className="p-2 text-center">{t.night}</td>
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
