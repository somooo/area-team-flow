import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify.functions";
import { toast } from "sonner";
import { toISODate } from "@/lib/roster";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

type MeStaff = {
  id: string;
  email: string;
  name: string;
  role: "staff" | "supervisor" | "admin";
  area: string | null;
  supervisor_email: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
};

export function BookingLeaveDialog({ me, onDone }: { me: MeStaff; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>();
  const [type, setType] = useState<"Vacation" | "Sick">("Vacation");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState<string>(me.supervisor_email ?? "");
  const [resolvedApprover, setResolvedApprover] = useState<string>("");
  const [supervisors, setSupervisors] = useState<{ id: string; name: string; email: string; area: string | null }[]>([]);

  useEffect(() => {
    if (!open) return;
    if (me.role === "supervisor") {
      supabase.from("staff").select("id,name,email,area").eq("role", "supervisor").then(({ data }) => {
        setSupervisors((data ?? []).filter((s) => s.email !== me.email));
      });
      setResolvedApprover(approver);
    } else if (me.supervisor_email) {
      supabase
        .from("staff")
        .select("email,delegated_to_email,delegation_active,name")
        .ilike("email", me.supervisor_email)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.delegation_active && data.delegated_to_email) setResolvedApprover(data.delegated_to_email);
          else setResolvedApprover(data?.email ?? me.supervisor_email!);
        });
    }
  }, [open, me, approver]);

  const days = useMemo(() => {
    if (!range?.from || !range?.to) return 0;
    // Count inclusive calendar days (DST-safe)
    const a = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
    const b = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate());
    let n = 0;
    const cur = new Date(a);
    while (cur <= b) { n++; cur.setDate(cur.getDate() + 1); }
    return n;
  }, [range]);

  const submit = async () => {
    if (!range?.from || !range?.to) { toast.error("Pick your dates"); return; }
    const start = toISODate(range.from);
    const end = toISODate(range.to);
    const approverEmail = me.role === "supervisor" ? approver : resolvedApprover;
    if (!approverEmail) { toast.error("No approver available"); return; }
    const { error } = await supabase.from("leave_requests").insert({
      staff_email: me.email, staff_name: me.name, area: me.area!, leave_type: type,
      start_date: start, end_date: end, reason, approver_email: approverEmail,
    });
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_submitted", staff_name: me.name, staff_email: me.email, supervisor_email: approverEmail, area: me.area, leave_type: type, start_date: start, end_date: end, reason } });
    toast.success("Leave request submitted");
    setOpen(false); setRange(undefined); setReason("");
    onDone();
  };

  const fmt = (d?: Date) => d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-teal-600 hover:bg-teal-700 text-white"><CalendarDays className="h-4 w-4 mr-2" />Request leave</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Book your leave</DialogTitle></DialogHeader>
        <div className="grid md:grid-cols-[1fr_260px] gap-4">
          <div className="rounded-lg border bg-white p-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={range}
              onSelect={setRange}
              disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
              autoFocus
              className="pointer-events-auto"
            />
          </div>
          <div className="rounded-lg border p-4 space-y-3 bg-slate-50">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Check-in</div>
              <div className="font-semibold">{fmt(range?.from)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Check-out</div>
              <div className="font-semibold">{fmt(range?.to)}</div>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <div className="text-sm">Total days</div>
              <div className="text-lg font-bold text-teal-700">{days}</div>
            </div>
            <div>
              <Label className="text-xs">Leave type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "Vacation" | "Sick")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Vacation">Vacation</SelectItem>
                  <SelectItem value="Sick">Sick</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {me.role === "supervisor" ? (
              <div>
                <Label className="text-xs">Approver (another supervisor)</Label>
                <Select value={approver} onValueChange={setApprover}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {supervisors.map((s) => <SelectItem key={s.id} value={s.email}>{s.name} ({s.area})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Routes to: <span className="font-medium text-slate-700">{resolvedApprover || "—"}</span>
              </div>
            )}
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button onClick={submit} disabled={!range?.from || !range?.to} className="w-full bg-teal-600 hover:bg-teal-700 text-white">
              Submit request
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}