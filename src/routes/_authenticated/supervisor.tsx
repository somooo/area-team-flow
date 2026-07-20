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
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/supervisor")({
  head: () => ({ meta: [{ title: "Supervisor — Shift & Leave Manager" }] }),
  component: SupervisorPage,
});

type ShiftType = "Morning" | "Evening" | "Night" | "Off";
type Shift = { id: string; staff_email: string; staff_name: string; area: string; date: string; shift_type: ShiftType; hours: number; is_overtime: boolean; notes: string | null };
type Staff = { id: string; name: string; email: string; role: string; area: string | null; supervisor_email: string | null; delegated_to_email: string | null; delegation_active: boolean };
type LeaveReq = { id: string; staff_email: string; staff_name: string; area: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; approver_email: string | null };
type ChangeReq = { id: string; requester_email: string; requester_name: string; area: string; change_type: string; source_shift_id: string; target_staff_email: string; target_staff_name: string; target_shift_id: string | null; details: string | null; staff_response: string; supervisor_response: string; status: string; approver_email: string | null };

function SupervisorPage() {
  const { me, reload } = useMe();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leaves, setLeaves] = useState<LeaveReq[]>([]);
  const [changes, setChanges] = useState<ChangeReq[]>([]);
  const [supervisors, setSupervisors] = useState<Staff[]>([]);

  const load = async () => {
    if (!me?.staff || me.staff.role !== "supervisor") return;
    const area = me.staff.area!;
    const [{ data: sh }, { data: st }, { data: lv }, { data: ch }, { data: sup }] = await Promise.all([
      supabase.from("shifts").select("*").eq("area", area).order("date"),
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
  useEffect(() => { void load(); }, [me?.staff?.email]);

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
          <AddShiftDialog area={meStaff.area!} staff={staff} onDone={load} />
        </CardHeader>
        <CardContent>
          {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shifts.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b"><th className="p-2">Date</th><th className="p-2">Staff</th><th className="p-2">Shift</th><th className="p-2">Hours</th><th className="p-2">OT</th><th className="p-2"></th></tr></thead>
                <tbody>
                  {shifts.map(s => <ShiftEditRow key={s.id} shift={s} onDone={load} />)}
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  );
}

function ShiftEditRow({ shift, onDone }: { shift: Shift; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(shift);

  const save = async () => {
    const { error } = await supabase.from("shifts").update({
      date: form.date, shift_type: form.shift_type as Shift["shift_type"], hours: Number(form.hours), is_overtime: form.is_overtime, notes: form.notes,
    }).eq("id", shift.id);
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "schedule_changed", staff_name: shift.staff_name, staff_email: shift.staff_email, date: form.date, shift_type: form.shift_type } });
    setEditing(false); onDone();
  };
  const del = async () => {
    const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
    if (error) { toast.error(error.message); return; }
    onDone();
  };

  if (!editing) return (
    <tr className="border-b">
      <td className="p-2">{shift.date}</td>
      <td className="p-2">{shift.staff_name}</td>
      <td className="p-2">{shift.shift_type}</td>
      <td className="p-2">{shift.hours}</td>
      <td className="p-2">{shift.is_overtime ? "Yes" : "—"}</td>
      <td className="p-2 text-right">
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={del}><Trash2 className="h-4 w-4" /></Button>
      </td>
    </tr>
  );
  return (
    <tr className="border-b bg-muted/40">
      <td className="p-2"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></td>
      <td className="p-2">{shift.staff_name}</td>
      <td className="p-2">
        <Select value={form.shift_type} onValueChange={(v) => setForm({ ...form, shift_type: v as Shift["shift_type"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Morning", "Evening", "Night", "Off"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </td>
      <td className="p-2"><Input type="number" value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} /></td>
      <td className="p-2"><Switch checked={form.is_overtime} onCheckedChange={(v) => setForm({ ...form, is_overtime: v })} /></td>
      <td className="p-2 text-right">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => { setForm(shift); setEditing(false); }}>Cancel</Button>
      </td>
    </tr>
  );
}

function AddShiftDialog({ area, staff, onDone }: { area: string; staff: Staff[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState<"Morning" | "Evening" | "Night" | "Off">("Morning");
  const [hours, setHours] = useState("8");
  const [ot, setOt] = useState(false);
  const submit = async () => {
    const s = staff.find(x => x.email === email);
    if (!s || !date) { toast.error("Missing fields"); return; }
    const { error } = await supabase.from("shifts").insert({
      staff_email: s.email, staff_name: s.name, area, date, shift_type: type, hours: Number(hours), is_overtime: ot,
    });
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "schedule_changed", staff_name: s.name, staff_email: s.email, date, shift_type: type } });
    setOpen(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Add shift</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add shift</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Staff</Label>
            <Select value={email} onValueChange={setEmail}>
              <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {staff.map(s => <SelectItem key={s.id} value={s.email}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label>Shift</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Morning", "Evening", "Night", "Off"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Hours</Label><Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <div className="flex items-end gap-2"><Switch checked={ot} onCheckedChange={setOt} /><Label>Overtime</Label></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit}>Add</Button></DialogFooter>
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