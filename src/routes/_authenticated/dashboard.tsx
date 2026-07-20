import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { notify } from "@/lib/notify.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "My shifts — Shift & Leave Manager" }] }),
  component: Dashboard,
});

type Shift = { id: string; staff_email: string; staff_name: string; area: string; date: string; shift_type: string; hours: number; is_overtime: boolean };
type Staff = { id: string; name: string; email: string; role: string; area: string | null };

function Dashboard() {
  const { me } = useMe();
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [roster, setRoster] = useState<Staff[]>([]);

  const load = async () => {
    if (!me?.staff) return;
    const email = me.staff.email;
    const area = me.staff.area;
    const [{ data: shifts }, { data: staff }] = await Promise.all([
      supabase.from("shifts").select("*").ilike("staff_email", email).order("date"),
      area
        ? supabase.from("staff").select("*").eq("area", area).order("name")
        : Promise.resolve({ data: [] as Staff[] }),
    ]);
    setMyShifts((shifts as Shift[]) ?? []);
    setRoster((staff as Staff[]) ?? []);
  };

  useEffect(() => { void load(); }, [me?.staff?.email]);

  if (!me?.staff) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {me.staff.name}</h1>
          <p className="text-muted-foreground text-sm">{me.staff.area ?? "—"} · {me.staff.department ?? ""}</p>
        </div>
        <LeaveRequestDialog onDone={load} me={me.staff} />
      </div>

      <Card>
        <CardHeader><CardTitle>Your upcoming shifts</CardTitle></CardHeader>
        <CardContent>
          {myShifts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No shifts assigned.</p>
          ) : (
            <div className="divide-y">
              {myShifts.map((s) => (
                <ShiftRow key={s.id} shift={s} me={me.staff!} roster={roster} onDone={load} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Roster — {me.staff.area}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {roster.map((s) => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.email}</div>
                <Badge variant="secondary" className="mt-2 capitalize">{s.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ShiftRow({ shift, me, roster, onDone }: { shift: Shift; me: NonNullable<ReturnType<typeof useMe>["me"]>["staff"]; roster: Staff[]; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between py-2 gap-4 flex-wrap">
      <div>
        <div className="font-medium">{shift.date} · {shift.shift_type}</div>
        <div className="text-xs text-muted-foreground">
          {shift.hours}h {shift.is_overtime && <Badge className="ml-2" variant="outline">OT</Badge>}
        </div>
      </div>
      <ChangeRequestDialog shift={shift} me={me!} roster={roster} onDone={onDone} />
    </div>
  );
}

function LeaveRequestDialog({ me, onDone }: { me: NonNullable<ReturnType<typeof useMe>["me"]>["staff"]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"Vacation" | "Sick">("Vacation");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState(me?.supervisor_email ?? "");
  const [supervisors, setSupervisors] = useState<Staff[]>([]);

  useEffect(() => {
    if (me?.role !== "supervisor") return;
    supabase.from("staff").select("*").eq("role", "supervisor").then(({ data }) => {
      setSupervisors(((data as Staff[]) ?? []).filter(s => s.email !== me.email));
    });
  }, [me]);

  const submit = async () => {
    if (!me || !start || !end) { toast.error("Fill dates"); return; }
    // resolve approver: supervisor's own = chosen. staff = own supervisor honoring delegation
    let approverEmail = me.role === "supervisor" ? approver : (me.supervisor_email ?? "");
    if (me.role === "staff" && me.supervisor_email) {
      const { data: sup } = await supabase.from("staff").select("email,delegated_to_email,delegation_active").ilike("email", me.supervisor_email).maybeSingle();
      if (sup?.delegation_active && sup.delegated_to_email) approverEmail = sup.delegated_to_email;
    }
    const { error } = await supabase.from("leave_requests").insert({
      staff_email: me.email, staff_name: me.name, area: me.area!, leave_type: type,
      start_date: start, end_date: end, reason, approver_email: approverEmail,
    });
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_submitted", staff_name: me.name, staff_email: me.email, supervisor_email: approverEmail, area: me.area, leave_type: type, start_date: start, end_date: end, reason } });
    toast.success("Leave request submitted");
    setOpen(false); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Request leave</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Request leave</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "Vacation" | "Sick")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Vacation">Vacation</SelectItem>
                <SelectItem value="Sick">Sick</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label>End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          {me?.role === "supervisor" && (
            <div>
              <Label>Approver (another supervisor)</Label>
              <Select value={approver} onValueChange={setApprover}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {supervisors.map(s => <SelectItem key={s.id} value={s.email}>{s.name} ({s.area})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={submit}>Submit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRequestDialog({ shift, me, roster, onDone }: { shift: Shift; me: NonNullable<ReturnType<typeof useMe>["me"]>["staff"]; roster: Staff[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [changeType, setChangeType] = useState<"give_ot" | "switch_area" | "switch_date">("give_ot");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetShiftId, setTargetShiftId] = useState("");
  const [details, setDetails] = useState("");
  const [candidateShifts, setCandidateShifts] = useState<Shift[]>([]);
  const [candidatesAllAreas, setCandidatesAllAreas] = useState<Staff[]>([]);

  useEffect(() => {
    if (!open) return;
    if (changeType === "switch_area") {
      supabase.from("staff").select("*").neq("email", me!.email).then(({ data }) => setCandidatesAllAreas((data as Staff[]) ?? []));
    }
  }, [open, changeType, me]);

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
    setOpen(false); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Request change</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule change — {shift.date} {shift.shift_type}</DialogTitle></DialogHeader>
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