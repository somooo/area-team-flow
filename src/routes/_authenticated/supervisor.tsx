import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { MonthGrid } from "@/components/MonthGrid";
import { BookingLeaveDialog } from "@/components/BookingLeaveDialog";
import type { RosterShift, Duty, OtType } from "@/lib/roster";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({ meta: [{ title: "Supervisor — Shift & Leave Manager" }] }),
  component: SupervisorPage,
});

type Shift = RosterShift;
type Staff = { id: string; name: string; email: string; role: string; area: string | null; department: string | null; supervisor_email: string | null; delegated_to_email: string | null; delegation_active: boolean };
type LeaveReq = { id: string; staff_email: string; staff_name: string; area: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; approver_email: string | null };
type ChangeReq = { id: string; requester_email: string; requester_name: string; area: string; change_type: string; source_shift_id: string; target_staff_email: string; target_staff_name: string; target_shift_id: string | null; details: string | null; staff_response: string; supervisor_response: string; status: string; approver_email: string | null };

function SupervisorPage() {
  const { me, reload } = useMe();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leaves, setLeaves] = useState<LeaveReq[]>([]);
  const [changes, setChanges] = useState<ChangeReq[]>([]);
  const [supervisors, setSupervisors] = useState<Staff[]>([]);
  const [editor, setEditor] = useState<{ staff: Staff; date: string; shift?: Shift } | null>(null);

  const load = async () => {
    if (!me?.staff || me.staff.role !== "supervisor") return;
    const area = me.staff.area!;
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    const [{ data: sh }, { data: st }, { data: lv }, { data: ch }, { data: sup }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", area).gte("date", start).lte("date", end).order("date"),
      supabase.from("staff").select("*").eq("area", area).order("name"),
      supabase.from("leave_requests").select("*").eq("area", area).order("created_at", { ascending: false }),
      supabase.from("schedule_change_requests").select("*").eq("area", area).order("created_at", { ascending: false }),
      supabase.from("staff").select("*").eq("role", "supervisor"),
    ]);
    setShifts((sh as Shift[]) ?? []);
    setStaff((st as Staff[]) ?? []);
    setLeaves((lv as LeaveReq[]) ?? []);
    setChanges((ch as ChangeReq[]) ?? []);
    setSupervisors(((sup as Staff[]) ?? []).filter(s => s.email !== me.staff!.email));
  };
  useEffect(() => { void load(); }, [me?.staff?.email, year, month]);

  if (!me?.staff || me.staff.role !== "supervisor") return <p>Supervisor access only.</p>;
  const meStaff = me.staff;

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Supervisor · {meStaff.area}</h1>
        <p className="text-sm text-muted-foreground">Manage your area's schedule and approvals.</p>
      </div>

      <div className="flex justify-end"><BookingLeaveDialog me={meStaff} onDone={load} /></div>

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Area schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthGrid
            year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
            staff={staff} shifts={shifts} meEmail={meStaff.email}
            areaLabel={meStaff.area ?? undefined}
            onCellClick={({ staff: s, date, shift }) => setEditor({ staff: s, date, shift })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Staff</CardTitle>
          <AddStaffDialog area={meStaff.area!} supervisorEmail={meStaff.email} onDone={load} />
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
            {staff.map(s => (
              <div key={s.id} className="rounded-md border p-3">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.email}</div>
                <Badge variant="secondary" className="mt-2 capitalize">{s.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

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
          area={meStaff.area!}
          entry={editor}
          onClose={() => setEditor(null)}
          onDone={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}

function CellEditor({ area, entry, onClose, onDone }: { area: string; entry: { staff: Staff; date: string; shift?: Shift }; onClose: () => void; onDone: () => void }) {
  const { staff: s, date, shift } = entry;
  const [duty, setDuty] = useState<Duty>(shift?.duty ?? "Day");
  const [unitCode, setUnitCode] = useState(shift?.unit_code ?? "");
  const [ot, setOt] = useState<OtType>(shift?.ot_type ?? "None");
  const [hours, setHours] = useState<string>(String(shift?.hours ?? 8));
  const isWorking = duty === "Day" || duty === "Night";

  const save = async () => {
    const payload = {
      staff_email: s.email, staff_name: s.name, area, date,
      duty, unit_code: isWorking ? (unitCode || null) : null,
      ot_type: isWorking ? ot : "None" as OtType,
      is_overtime: isWorking && ot !== "None",
      hours: Number(hours) || 0,
      shift_type: (duty === "Night" ? "Night" : duty === "Day" ? "Morning" : "Off") as "Morning" | "Night" | "Off",
    };
    const { error } = shift
      ? await supabase.from("shifts").update(payload).eq("id", shift.id)
      : await supabase.from("shifts").insert(payload);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "schedule_changed", staff_name: s.name, staff_email: s.email, date, shift_type: payload.shift_type } });
    toast.success("Shift saved");
    onDone();
  };
  const del = async () => {
    if (!shift) return;
    const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Shift removed");
    onDone();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{s.name} · {date}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Duty</Label>
            <Select value={duty} onValueChange={(v) => setDuty(v as Duty)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Day","Night","Off","Vacation","Sick","Paternity"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isWorking && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit code</Label>
                <Input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="e.g. 6" />
              </div>
              <div>
                <Label>OT type</Label>
                <Select value={ot} onValueChange={(v) => setOt(v as OtType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["None","BuiltIn","Additional","MedEvac"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
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
          {shift ? <Button variant="destructive" onClick={del}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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