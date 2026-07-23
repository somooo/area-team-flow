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
import { MonthGrid, type StaffLite } from "@/components/MonthGrid";
import { BookingLeaveDialog } from "@/components/BookingLeaveDialog";
import { toISODate, monthDays } from "@/lib/roster";
import type { RosterShift } from "@/lib/roster";
import { exportExcel, exportPdf } from "@/lib/schedule-export";
import { totalsForStaff, groupByStaff } from "@/lib/roster-totals";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "My shifts — Shift & Leave Manager" }] }),
  component: Dashboard,
});

type Shift = RosterShift;
type Staff = StaffLite;

function Dashboard() {
  const { me } = useMe();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<Staff[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [viewArea, setViewArea] = useState<string>("");
  const [changeShift, setChangeShift] = useState<Shift | null>(null);

  const isAdmin = me?.staff?.role === "admin";
  const activeArea = isAdmin ? viewArea : (me?.staff?.area ?? "");

  const load = async () => {
    if (!me?.staff) return;
    if (isAdmin && !viewArea) return;
    const startISO = toISODate(new Date(year, month, 1));
    const endISO = toISODate(new Date(year, month + 1, 0));
    const [{ data: sh }, { data: st }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", activeArea).gte("date", startISO).lte("date", endISO).order("date"),
      supabase.from("staff").select("id,name,email,role,area,department").eq("area", activeArea).order("name"),
    ]);
    setShifts((sh as Shift[]) ?? []);
    setRoster((st as Staff[]) ?? []);
  };

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("staff").select("area").not("area", "is", null).then(({ data }) => {
      const uniq = Array.from(new Set((data ?? []).map((r) => r.area as string).filter(Boolean))).sort();
      setAreas(uniq);
      if (uniq[0] && !viewArea) setViewArea(uniq[0]);
    });
  }, [isAdmin]);

  useEffect(() => { void load(); }, [me?.staff?.email, year, month, activeArea]);

  const meRoster = useMemo(() => roster, [roster]);

  if (!me?.staff) return null;
  const meStaff = me.staff;

  const canClickCell = (email: string) => {
    if (isAdmin) return false;
    // Staff: only clicks their own cell; supervisor handled on /supervisor.
    return email.toLowerCase() === meStaff.email.toLowerCase();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {meStaff.name}</h1>
          <p className="text-muted-foreground text-sm">
            {meStaff.role === "admin" ? "Admin — org-wide view" : `${meStaff.area ?? "—"} · ${meStaff.department ?? ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Select value={viewArea} onValueChange={setViewArea}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Area" /></SelectTrigger>
              <SelectContent>
                {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {!isAdmin && <BookingLeaveDialog me={meStaff} onDone={load} />}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Monthly schedule</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportExcel({ area: activeArea, year, month, staff: meRoster, shifts })}>Download Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportPdf({ area: activeArea, year, month, staff: meRoster, shifts })}>Download PDF</Button>
          </div>
        </CardHeader>
        <CardContent>
          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={meRoster} shifts={shifts} meEmail={meStaff.email}
            areaLabel={activeArea}
            onCellClick={({ staff, shift }) => {
              if (!canClickCell(staff.email)) return;
              if (!shift) { toast.info("No shift on that day."); return; }
              setChangeShift(shift);
            }}
          />
          <TotalsTable staff={meRoster} shifts={shifts} />
        </CardContent>
      </Card>

      {changeShift && (
        <ChangeRequestDialog
          shift={changeShift}
          me={meStaff}
          roster={roster}
          onClose={() => setChangeShift(null)}
          onDone={() => { setChangeShift(null); load(); }}
        />
      )}
    </div>
  );
}

function TotalsTable({ staff, shifts }: { staff: Staff[]; shifts: Shift[] }) {
  const byStaff = groupByStaff(shifts);
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-xs border rounded-md">
        <thead className="bg-teal-50">
          <tr>
            <th className="p-2 text-left">Staff</th>
            <th className="p-2">Day</th><th className="p-2">Night</th>
            <th className="p-2">Hours</th><th className="p-2">OT h</th>
            <th className="p-2">Sick</th><th className="p-2">Vacation</th>
          </tr>
        </thead>
        <tbody>
          {staff.map(s => {
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

function ChangeRequestDialog({ shift, me, roster, onDone, onClose }: { shift: Shift; me: NonNullable<ReturnType<typeof useMe>["me"]>["staff"]; roster: Staff[]; onDone: () => void; onClose: () => void }) {
  const [changeType, setChangeType] = useState<"give_ot" | "switch_area" | "switch_date">(shift.is_overtime ? "give_ot" : "switch_date");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetShiftId, setTargetShiftId] = useState("");
  const [details, setDetails] = useState("");
  const [candidateShifts, setCandidateShifts] = useState<Shift[]>([]);
  const [candidatesAllAreas, setCandidatesAllAreas] = useState<Staff[]>([]);

  useEffect(() => {
    if (changeType === "switch_area") {
      supabase.from("staff").select("id,name,email,role,area,department").neq("email", me!.email).then(({ data }) => setCandidatesAllAreas((data as Staff[]) ?? []));
    }
  }, [changeType, me]);

  useEffect(() => {
    if (!targetEmail || changeType === "give_ot") { setCandidateShifts([]); return; }
    supabase.from("shifts").select("*").ilike("staff_email", targetEmail).order("date")
      .then(({ data }) => setCandidateShifts((data as Shift[]) ?? []));
  }, [targetEmail, changeType]);

  const submit = async () => {
    if (!me || !targetEmail) { toast.error("Pick a colleague"); return; }
    if (changeType === "give_ot" && !shift.is_overtime) { toast.error("Not an OT shift"); return; }
    if (changeType !== "give_ot" && !targetShiftId) { toast.error("Pick their shift"); return; }
    const targetPool = changeType === "switch_area" ? candidatesAllAreas : roster;
    const target = targetPool.find(s => s.email === targetEmail);
    if (!target) { toast.error("Target not found"); return; }
    // approver = requester's area supervisor honoring delegation
    let approver: string | null = null;
    if (me.supervisor_email) {
      const { data: sup } = await supabase.from("staff").select("email,delegated_to_email,delegation_active").ilike("email", me.supervisor_email).maybeSingle();
      approver = sup?.delegation_active && sup.delegated_to_email ? sup.delegated_to_email : (sup?.email ?? me.supervisor_email);
    } else if (me.role === "supervisor") {
      // supervisor requesting: their own change routes to another supervisor of same area — none; leave null
      approver = me.delegated_to_email && me.delegation_active ? me.delegated_to_email : null;
    }
    const { error } = await supabase.from("schedule_change_requests").insert({
      requester_email: me.email, requester_name: me.name, area: me.area!,
      change_type: changeType, source_shift_id: shift.id,
      target_staff_email: target.email, target_staff_name: target.name,
      target_shift_id: changeType === "give_ot" ? null : targetShiftId,
      details, approver_email: approver,
    });
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "change_requested", change_type: changeType, requester_name: me.name, staff_email: target.email, staff_name: target.name, details } });
    toast.success("Change request sent");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule change — {shift.date} {shift.duty}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={changeType} onValueChange={(v) => { setChangeType(v as typeof changeType); setTargetShiftId(""); setTargetEmail(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="give_ot" disabled={!shift.is_overtime}>Give away OT (this shift must be OT)</SelectItem>
                <SelectItem value="switch_area">Switch area with another staff</SelectItem>
                <SelectItem value="switch_date">Switch date with another staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Target staff</Label>
            <Select value={targetEmail} onValueChange={setTargetEmail}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {(changeType === "switch_area" ? candidatesAllAreas : roster.filter(s => s.email !== me!.email)).map((s) => (
                  <SelectItem key={s.id} value={s.email}>{s.name} ({s.area})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {changeType !== "give_ot" && targetEmail && (
            <div>
              <Label>Their shift to swap</Label>
              <Select value={targetShiftId} onValueChange={setTargetShiftId}>
                <SelectTrigger><SelectValue placeholder="Choose their shift" /></SelectTrigger>
                <SelectContent>
                  {candidateShifts.map(s => <SelectItem key={s.id} value={s.id}>{s.date} · {s.shift_type} ({s.area})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div><Label>Details</Label><Textarea value={details} onChange={(e) => setDetails(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Send request</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}