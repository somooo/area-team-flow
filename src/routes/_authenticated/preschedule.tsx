import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/preschedule")({
  head: () => ({ meta: [{ title: "Pre-schedule — Shift & Leave Manager" }] }),
  component: PreschedulePage,
});

type Row = { id: string; requester_email: string; requester_name: string; area: string; request_type: string; target_month: string; requested_dates: string[]; details: string | null; status: string; created_at: string };

function PreschedulePage() {
  const { me } = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const nextMonth = new Date();
  nextMonth.setDate(1); nextMonth.setMonth(nextMonth.getMonth() + 1);
  const [targetMonth, setTargetMonth] = useState(nextMonth.toISOString().slice(0, 7));
  const [type, setType] = useState<"off" | "switch">("off");
  const [dates, setDates] = useState("");
  const [details, setDetails] = useState("");

  const load = async () => {
    const { data } = await supabase.from("preschedule_requests").select("*").order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.email]);

  if (!me?.staff) return null;
  const meStaff = me.staff;

  const submit = async () => {
    const dateList = dates.split(",").map(s => s.trim()).filter(Boolean);
    if (dateList.length === 0) { toast.error("Enter at least one date"); return; }
    // resolve approver = area supervisor (honor delegation)
    let approver: string | null = null;
    if (meStaff.supervisor_email) {
      const { data: sup } = await supabase.from("staff").select("email,delegated_to_email,delegation_active").ilike("email", meStaff.supervisor_email).maybeSingle();
      approver = sup?.delegation_active && sup.delegated_to_email ? sup.delegated_to_email : (sup?.email ?? meStaff.supervisor_email);
    }
    const autoApprove = new Date(); autoApprove.setDate(autoApprove.getDate() + 3);
    const { error } = await supabase.from("preschedule_requests").insert({
      requester_email: meStaff.email, requester_name: meStaff.name, area: meStaff.area!,
      request_type: type, target_month: `${targetMonth}-01`, requested_dates: dateList,
      details, approver_email: approver, auto_approve_at: autoApprove.toISOString(),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Pre-schedule request submitted");
    setDates(""); setDetails("");
    load();
  };

  const mine = rows.filter(r => r.requester_email.toLowerCase() === meStaff.email.toLowerCase());
  const areaRows = rows.filter(r => r.area === meStaff.area);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pre-schedule requests</h1>
        <p className="text-sm text-muted-foreground">Request OFF days or a switch before the month's schedule is published.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>New request</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Target month</Label>
            <Input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "off" | "switch")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">OFF request</SelectItem>
                <SelectItem value="switch">Switch request</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Requested dates (comma separated, YYYY-MM-DD)</Label>
            <Input value={dates} onChange={(e) => setDates(e.target.value)} placeholder="2026-08-05, 2026-08-06" />
          </div>
          <div className="sm:col-span-2">
            <Label>Details</Label>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={submit}>Submit</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My requests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {mine.map(r => (
            <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
              <div>
                <div className="font-medium capitalize">{r.request_type} · {r.target_month.slice(0, 7)}</div>
                <div className="text-xs text-muted-foreground">Dates: {r.requested_dates.join(", ")}</div>
              </div>
              <Badge variant={r.status === "Approved" ? "default" : r.status === "Rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {(me.staff.role === "supervisor" || (me.staff.role as string) === "admin") && (
        <Card>
          <CardHeader><CardTitle>Area pre-schedule feed</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {areaRows.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {areaRows.map(r => (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="font-medium">{r.requester_name} · {r.request_type}</div>
                  <div className="text-xs text-muted-foreground">{r.target_month.slice(0, 7)} · {r.requested_dates.join(", ")}</div>
                </div>
                <Badge>{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}