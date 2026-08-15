import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { notify } from "@/lib/notify.functions";
import { createNotification } from "@/lib/notifications.functions";
import { useSystemRules, ruleNumber } from "@/lib/system-rules";
import { toast } from "sonner";
import { toISODate } from "@/lib/roster";
import { useCapabilities } from "@/lib/use-can";
import { canAnywhere, fetchCapabilityHolders } from "@/lib/capabilities";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

type MeStaff = {
  id: string;
  email: string;
  name: string;
  role: "staff" | "supervisor" | "admin" | "team_leader";
  area: string | null;
  supervisor_email: string | null;
  delegated_to_email: string | null;
  delegation_active: boolean;
};

export function BookingLeaveDialog({ me, onDone, inline = false, allowSick = false }: {
  me: MeStaff; onDone: () => void; inline?: boolean; allowSick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = inline || open;
  const [range, setRange] = useState<DateRange | undefined>();
  const [type, setType] = useState<"Vacation" | "Sick">("Vacation");
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState<string>(me.supervisor_email ?? "");
  const [resolvedApprover, setResolvedApprover] = useState<string>("");
  const [supervisors, setSupervisors] = useState<{ id: string; name: string; email: string; area: string | null }[]>([]);
  const { actor } = useCapabilities();
  /** People who approve their own leave elsewhere pick an approver themselves. */
  const picksOwnApprover = canAnywhere(actor, "leave.approve");
  const { rules } = useSystemRules();
  const [dailyUsed, setDailyUsed] = useState<Map<string, number>>(new Map());
  const [headcount, setHeadcount] = useState(1);
  const [balance, setBalance] = useState<{ approved: number; pending: number } | null>(null);

  useEffect(() => {
    if (!active || !me.area) return;
    const area = me.area;
    void (async () => {
      const year = new Date().getFullYear();
      const yStart = `${year}-01-01`;
      const yEnd = `${year}-12-31`;
      const [{ count: hc }, { data: approvedArea }, { data: mine }] = await Promise.all([
        supabase.from("staff").select("id", { count: "exact", head: true }).eq("area", area),
        supabase.from("leave_requests").select("start_date,end_date")
          .eq("area", area).eq("leave_type", "Vacation").eq("status", "Approved"),
        supabase.from("leave_requests").select("start_date,end_date,status,leave_type")
          .ilike("staff_email", me.email).eq("leave_type", "Vacation")
          .gte("start_date", yStart).lte("end_date", yEnd),
      ]);
      setHeadcount(hc ?? 1);
      const map = new Map<string, number>();
      for (const r of approvedArea ?? []) {
        const s = new Date(r.start_date + "T00:00:00");
        const e = new Date(r.end_date + "T00:00:00");
        const cur = new Date(s);
        while (cur <= e) {
          const k = toISODate(cur);
          map.set(k, (map.get(k) ?? 0) + 1);
          cur.setDate(cur.getDate() + 1);
        }
      }
      setDailyUsed(map);
      // balance
      let approved = 0, pending = 0;
      const countDays = (a: string, b: string) => {
        const A = new Date(a + "T00:00:00"); const B = new Date(b + "T00:00:00");
        let n = 0; const c = new Date(A);
        while (c <= B) { n++; c.setDate(c.getDate()+1); }
        return n;
      };
      for (const r of mine ?? []) {
        const n = countDays(r.start_date, r.end_date);
        if (r.status === "Approved") approved += n;
        else if (r.status === "Pending") pending += n;
      }
      setBalance({ approved, pending });
    })();
  }, [active, me.area, me.email]);

  const cap = useMemo(() => Math.floor(headcount * ruleNumber(rules, "vacation_cap_pct", 30) / 100), [headcount, rules]);
  const fullDays = useMemo(() => {
    const set = new Set<Date>();
    for (const [iso, n] of dailyUsed) {
      if (n >= cap && cap > 0) set.add(new Date(iso + "T00:00:00"));
    }
    return Array.from(set);
  }, [dailyUsed, cap]);

  useEffect(() => {
    if (!active) return;
    if (picksOwnApprover) {
      void fetchCapabilityHolders("leave.approve").then((holders) => {
        setSupervisors(
          holders
            .filter((h) => h.email && h.email !== me.email.toLowerCase())
            .map((h) => ({ id: h.staffId, name: h.name, email: h.email, area: h.area })),
        );
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
  }, [active, me, approver, picksOwnApprover]);

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
    const approverEmail = picksOwnApprover ? approver : resolvedApprover;
    if (!approverEmail) { toast.error("No approver available"); return; }
    const { error } = await supabase.from("leave_requests").insert({
      // `area` is derived server-side from the staff directory record.
      staff_email: me.email.toLowerCase(), staff_name: me.name, leave_type: type, staff_id: me.id,
      start_date: start, end_date: end, reason, approver_email: approverEmail,
    });
    if (error) { toast.error(error.message); return; }
    await notify({ data: { event: "request_submitted", staff_name: me.name, staff_email: me.email, supervisor_email: approverEmail, area: me.area, leave_type: type, start_date: start, end_date: end, reason } });
    await createNotification({ data: { recipient_email: approverEmail, title: `${type} leave request`, body: `${me.name}: ${start} → ${end}`, link: "/approvals" } });
    toast.success("Leave request submitted");
    setOpen(false); setRange(undefined); setReason("");
    onDone();
  };

  const fmt = (d?: Date) => d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—";

  const body = (
    <div className="grid md:grid-cols-[1fr_260px] gap-4">
          <div className="rounded-lg border bg-white p-2">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={range}
              onSelect={setRange}
              disabled={[{ before: new Date(new Date().setHours(0, 0, 0, 0)) }, ...(type === "Vacation" ? fullDays : [])]}
              modifiers={type === "Vacation" ? {
                full: fullDays,
                nearly: Array.from(dailyUsed.entries()).filter(([, n]) => cap > 0 && n >= Math.max(1, cap - 1) && n < cap).map(([iso]) => new Date(iso + "T00:00:00")),
              } : undefined}
              modifiersClassNames={{
                full: "bg-muted text-muted-foreground line-through opacity-70",
                nearly: "bg-copper/25 text-foreground",
              }}
              autoFocus
              className="pointer-events-auto"
            />
            {type === "Vacation" && (
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border bg-card inline-block" />Available</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-copper/25 inline-block" />Almost full</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted inline-block" />Unavailable · cap {cap}/day</span>
              </div>
            )}
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
              <div className="text-lg font-bold text-steel-700">{days}</div>
            </div>
            {allowSick ? (
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
            ) : (
              <div className="text-xs text-muted-foreground">Leave type: <span className="font-medium text-slate-700">Vacation</span></div>
            )}
            {picksOwnApprover ? (
              <div>
                <Label className="text-xs">Approver (another approver)</Label>
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
            {type === "Vacation" && balance && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                <div>Yearly cap: <span className="font-medium">{ruleNumber(rules, "vacation_yearly_days", 25)}</span></div>
                <div>Used approved: <span className="font-medium">{balance.approved}</span></div>
                <div>Pending: <span className="font-medium">{balance.pending}</span></div>
                <div>Remaining: <span className="font-medium text-steel-700">{Math.max(0, ruleNumber(rules, "vacation_yearly_days", 25) - balance.approved - balance.pending)}</span></div>
              </div>
            )}
            <div>
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button onClick={submit} disabled={!range?.from || !range?.to} className="w-full">
              Submit request
            </Button>
          </div>
    </div>
  );

  if (inline) return body;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className=""><CalendarDays className="h-4 w-4 mr-2" />Request leave</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Book your leave</DialogTitle></DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}