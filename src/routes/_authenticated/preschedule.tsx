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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [dates, setDates] = useState<Date[]>([]);
  const [dateError, setDateError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [shiftFrom, setShiftFrom] = useState<"Day" | "Night">("Day");
  const [shiftTo, setShiftTo] = useState<"Day" | "Night">("Night");
  const [switchStaffName, setSwitchStaffName] = useState("");
  const [switchStaffBadge, setSwitchStaffBadge] = useState("");

  // Missed OT form
  const [otDate, setOtDate] = useState("");
  const [otUnit, setOtUnit] = useState("");
  const [otContact, setOtContact] = useState("");
  const [otNotes, setOtNotes] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);

  const openDay = ruleNumber(rules, "preschedule_open_day", 10);
  const closeDay = ruleNumber(rules, "preschedule_close_day", 20);
  const MAX_DAYS = 4;

  const countFullWeekends = (list: Date[]) => {
    const iso = new Set(list.map(toISODate));
    let n = 0;
    for (const d of list) {
      if (d.getDay() !== 5) continue;
      const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      if (iso.has(toISODate(sat))) n++;
    }
    return n;
  };

  const handleSelectDates = (next: Date[] | undefined) => {
    const list = next ?? [];
    if (list.length > dates.length) {
      if (list.length > MAX_DAYS) {
        setDateError(`You can select a maximum of ${MAX_DAYS} days.`);
        return;
      }
      if (countFullWeekends(list) > 1) {
        setDateError("You can only request one full weekend (Fri–Sat) per month.");
        return;
      }
    }
    setDateError("");
    setDates(list);
  };

  const { targetMonth, windowOpen, monthStart, monthEnd } = useMemo(() => {
    const now = new Date();
    const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const day = now.getDate();
    return {
      targetMonth: `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, "0")}`,
      windowOpen: day >= openDay && day <= closeDay,
      monthStart: nm,
      monthEnd: new Date(nm.getFullYear(), nm.getMonth() + 1, 0),
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
    swap_with_name?: string | null;
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
    if (type === "switch") {
      if (!switchStaffName.trim()) { toast.error("Enter the name of the staff you are switching with"); return; }
      if (!switchStaffBadge.trim()) { toast.error("Enter their badge number"); return; }
      const ok = await insertRequest(
        {
          request_type: "switch",
          requested_dates: [],
          swap_with_name: switchStaffName.trim(),
          details: [
            `Shift from: ${shiftFrom}`,
            `Shift to: ${shiftTo}`,
            `Switch with: ${switchStaffName.trim()} (badge ${switchStaffBadge.trim()})`,
            details.trim() ? `Notes: ${details.trim()}` : "",
          ].filter(Boolean).join(" · "),
        },
        "Pre-schedule request",
      );
      if (ok) { setSwitchStaffName(""); setSwitchStaffBadge(""); setDetails(""); }
      return;
    }
    const dateList = [...dates].sort((a, b) => a.getTime() - b.getTime()).map(toISODate);
    if (dateList.length === 0) { setDateError("Select at least one date"); return; }
    if (dateList.length > MAX_DAYS) { setDateError(`You can select a maximum of ${MAX_DAYS} days.`); return; }
    if (countFullWeekends(dates) > 1) { setDateError("You can only request one full weekend (Fri–Sat) per month."); return; }
    const ok = await insertRequest(
      { request_type: "off", requested_dates: dateList, details },
      "Pre-schedule request",
    );
    if (ok) { setDates([]); setDetails(""); setDateError(""); }
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
          {type === "off" ? (
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Requested dates</Label>
                <span className="text-xs text-muted-foreground">{dates.length} / {MAX_DAYS} days selected</span>
              </div>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={!windowOpen}
                    className={cn("w-[280px] justify-start text-left font-normal", dates.length === 0 && "text-muted-foreground")}
                  >
                    <CalendarIcon />
                    {dates.length > 0
                      ? [...dates].sort((a, b) => a.getTime() - b.getTime()).map(toISODate).join(", ")
                      : "Pick your days off"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="multiple"
                    selected={dates}
                    onSelect={(d) => handleSelectDates(d as Date[] | undefined)}
                    month={monthStart}
                    startMonth={monthStart}
                    endMonth={monthStart}
                    disableNavigation
                    disabled={
                      !windowOpen
                        ? true
                        : [
                            { before: monthStart },
                            { after: monthEnd },
                            (d: Date) =>
                              dates.length >= MAX_DAYS &&
                              !dates.some((s) => toISODate(s) === toISODate(d)),
                          ]
                    }
                    className="p-3 pointer-events-auto"
                  />
                  {dateError && <p className="px-3 pb-2 text-xs text-destructive">{dateError}</p>}
                </PopoverContent>
              </Popover>
              {dateError && <p className="mt-1 text-xs text-destructive">{dateError}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                Tap up to {MAX_DAYS} days off in {targetMonth}. Only 1 full weekend (Fri–Sat) allowed.
              </p>
            </div>
          ) : (
            <>
              <div>
                <Label>Shift: From</Label>
                <Select value={shiftFrom} onValueChange={(v) => setShiftFrom(v as "Day" | "Night")} disabled={!windowOpen}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Day">Day</SelectItem>
                    <SelectItem value="Night">Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Shift: To</Label>
                <Select value={shiftTo} onValueChange={(v) => setShiftTo(v as "Day" | "Night")} disabled={!windowOpen}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Day">Day</SelectItem>
                    <SelectItem value="Night">Night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Switch with (Staff name)</Label>
                <Input value={switchStaffName} onChange={(e) => setSwitchStaffName(e.target.value)} disabled={!windowOpen} />
              </div>
              <div>
                <Label>Switch with (Badge number)</Label>
                <Input value={switchStaffBadge} onChange={(e) => setSwitchStaffBadge(e.target.value)} disabled={!windowOpen} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Label>Details{type === "switch" ? " (optional)" : ""}</Label>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} disabled={!windowOpen} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={submit} disabled={!windowOpen}>Submit</Button>
          </div>
        </CardContent>
      </Card>

      <div className="pt-2">
        <h2 className="text-2xl font-semibold">Post-Schedule</h2>
        <p className="text-sm text-muted-foreground">
          Report overtime you worked that was not recorded in the schedule.
        </p>
      </div>

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

      <div className="pt-2">
        <h2 className="text-2xl font-semibold">My Requests</h2>
        <p className="text-sm text-muted-foreground">Approval status of your requests · tap a request to see details.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Submitted requests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {mine.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => setDetail(r)}
              className="w-full text-left flex items-center justify-between border rounded-md p-3 transition-colors hover:bg-muted/50"
            >
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
            </button>
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{detail?.request_type.replace("_", " ")} request</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="text-sm">
              <DetailRow label="Status" value={detail.status} />
              <DetailRow label="Target month" value={detail.target_month.slice(0, 7)} />
              <DetailRow label="Area" value={detail.area} />
              {detail.request_type === "missed_ot" ? (
                <>
                  <DetailRow label="Overtime date" value={detail.missed_ot_date ?? "—"} />
                  <DetailRow label="Unit code" value={detail.unit_code ?? "—"} />
                  <DetailRow label="Contacted by" value={detail.contacted_by ?? "—"} />
                </>
              ) : (
                <DetailRow label="Requested dates" value={detail.requested_dates.join(", ") || "—"} />
              )}
              <DetailRow label="Details" value={detail.details || "—"} />
              <DetailRow label="Submitted" value={new Date(detail.created_at).toLocaleString()} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
