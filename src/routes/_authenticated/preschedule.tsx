import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSystemRules, ruleNumber } from "@/lib/system-rules";
import { resolveApprover } from "@/lib/approver";
import { createNotification } from "@/lib/notifications.functions";
import { logAudit } from "@/lib/audit";
import { toISODate } from "@/lib/roster";

export const Route = createFileRoute("/_authenticated/preschedule")({
  head: () => ({
    meta: [
      { title: "Pre-schedule — KADIR Staff Management" },
      { name: "description", content: "Submit OFF or switch requests for next month and report missed overtime." },
      { property: "og:title", content: "Pre-schedule — KADIR Staff Management" },
      { property: "og:description", content: "Submit OFF or switch requests for next month and report missed overtime." },
    ],
  }),
  component: PreschedulePage,
});

type Row = {
  id: string; requester_email: string; requester_name: string; area: string;
  request_type: string; target_month: string; requested_dates: string[];
  details: string | null; status: string; created_at: string;
  missed_ot_date: string | null; unit_code: string | null; contacted_by: string | null;
};

function PreschedulePage() {
  const { me } = useMe();
  const { rules } = useSystemRules();
  const [rows, setRows] = useState<Row[]>([]);
  const [type, setType] = useState<"off" | "switch">("off");
  const [dates, setDates] = useState("");
  const [details, setDetails] = useState("");

  // Missed OT form
  const [otDate, setOtDate] = useState("");
  const [otUnit, setOtUnit] = useState("");
  const [otContact, setOtContact] = useState("");
  const [otNotes, setOtNotes] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);

  const openDay = ruleNumber(rules, "preschedule_open_day", 10);
  const closeDay = ruleNumber(rules, "preschedule_close_day", 20);

  const { targetMonth, windowOpen } = useMemo(() => {
    const now = new Date();
    const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const day = now.getDate();
    return {
      targetMonth: `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, "0")}`,
      windowOpen: day >= openDay && day <= closeDay,
    };
  }, [openDay, closeDay]);

  const missedOtDeadline = useMemo(() => {
    if (!otDate) return null;
    const [y, m, day] = otDate.split("-").map(Number);
    return toISODate(new Date(y, m, 5));
  }, [otDate]);
  const missedOtWindowOpen = !missedOtDeadline || toISODate(new Date()) <= missedOtDeadline;

  const load = async () => {
    const { data } = await supabase.from("preschedule_requests").select("*").order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.email]);

  if (!me?.staff) return null;
  const meStaff = me.staff;

  type Payload = {
    request_type: string;
    requested_dates: string[];
    details: string;
    missed_ot_date?: string | null;
    unit_code?: string | null;
    contacted_by?: string | null;
  };

  const insertRequest = async (payload: Payload, label: string) => {
    const approver = await resolveApprover(meStaff);
    const autoApprove = new Date();
    autoApprove.setDate(autoApprove.getDate() + ruleNumber(rules, "auto_approve_days", 3));
    const { data: inserted, error } = await supabase.from("preschedule_requests").insert({
      requester_email: meStaff.email, requester_name: meStaff.name, area: meStaff.area!,
      staff_id: meStaff.id, target_month: `${targetMonth}-01`,
      approver_email: approver, auto_approve_at: autoApprove.toISOString(),
      ...payload,
    }).select("id").maybeSingle();
    if (error) { toast.error(error.message); return false; }
    if (approver) {
      await createNotification({ data: { recipient_email: approver, title: label, body: `${meStaff.name} · ${meStaff.area}`, link: "/approvals" } });
    }
    await logAudit({
      action: "preschedule_requested", entity_type: "preschedule_request",
      entity_id: inserted?.id ?? null, area: meStaff.area, details: payload,
    });
    toast.success("Submitted");
    load();
    return true;
  };

  const submit = async () => {
    if (!windowOpen) { toast.error(`The pre-schedule window is open from day ${openDay} to ${closeDay}.`); return; }
    const dateList = dates.split(",").map((s) => s.trim()).filter(Boolean);
    if (dateList.length === 0) { toast.error("Enter at least one date"); return; }
    const ok = await insertRequest(
      { request_type: type, requested_dates: dateList, details },
      "Pre-schedule request",
    );
    if (ok) { setDates(""); setDetails(""); }
  };

  const submitMissedOt = async () => {
    if (!otDate) { toast.error("Pick the date of the missed overtime"); return; }
    if (!missedOtWindowOpen) { toast.error("The reporting window for this missed overtime has closed."); return; }
    const ok = await insertRequest(
      {
        request_type: "missed_ot", requested_dates: [otDate],
        missed_ot_date: otDate, unit_code: otUnit || null,
        contacted_by: otContact || null, details: otNotes,
      },
      "Missed overtime report",
    );
    if (ok) { setOtDate(""); setOtUnit(""); setOtContact(""); setOtNotes(""); }
  };

  const mine = rows.filter((r) => r.requester_email.toLowerCase() === meStaff.email.toLowerCase());
  const areaRows = rows.filter((r) => r.area === meStaff.area);
  const isManager = meStaff.role === "supervisor" || meStaff.role === "team_leader" || (meStaff.role as string) === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pre-Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Requests for <strong>{targetMonth}</strong> · window open day {openDay}–{closeDay} of each month.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Next month request</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {!windowOpen && (
            <div className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The window is closed. It opens on day {openDay} and closes after day {closeDay} for next month only.
            </div>
          )}
          <div>
            <Label>Target month</Label>
            <Input value={targetMonth} readOnly disabled />
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
            <Input value={dates} onChange={(e) => setDates(e.target.value)} placeholder={`${targetMonth}-05, ${targetMonth}-06`} disabled={!windowOpen} />
          </div>
          <div className="sm:col-span-2">
            <Label>Details</Label>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={!windowOpen} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={submit} disabled={!windowOpen}>Submit</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Missed Overtime</CardTitle>
          <p className="text-sm text-muted-foreground">
            Report missed overtime up to the 5th of the following month. Any request after this window will not be accepted.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {!missedOtWindowOpen && (
            <div className="sm:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The reporting window for this missed overtime has closed (deadline was {missedOtDeadline}).
            </div>
          )}
          <div>
            <Label>Date</Label>
            <Input type="date" value={otDate} max={toISODate(new Date())} onChange={(e) => setOtDate(e.target.value)} />
          </div>
          <div>
            <Label>Unit code</Label>
            <Input value={otUnit} onChange={(e) => setOtUnit(e.target.value)} placeholder="e.g. N6" />
          </div>
          <div className="sm:col-span-2">
            <Label>Who contacted you</Label>
            <Input value={otContact} onChange={(e) => setOtContact(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={otNotes} onChange={(e) => setOtNotes(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={submitMissedOt} disabled={!missedOtWindowOpen}>Report missed overtime</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>My pre-schedule history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {mine.map((r) => (
            <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
              <div>
                <div className="font-medium capitalize">{r.request_type.replace("_", " ")} · {r.target_month.slice(0, 7)}</div>
                <div className="text-xs text-muted-foreground">
                  {r.request_type === "missed_ot"
                    ? `${r.missed_ot_date ?? ""} ${r.unit_code ?? ""} · contacted by ${r.contacted_by ?? "—"}`
                    : `Dates: ${r.requested_dates.join(", ")}`}
                </div>
                <div className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
              </div>
              <Badge variant={r.status === "Approved" ? "default" : r.status === "Rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {isManager && (
        <Card>
          <CardHeader><CardTitle>Area pre-schedule feed</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {areaRows.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            {areaRows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="font-medium">{r.requester_name} · {r.request_type.replace("_", " ")}</div>
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
