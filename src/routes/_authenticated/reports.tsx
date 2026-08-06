import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toISODate } from "@/lib/roster";
import { AREAS } from "@/lib/areas";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Reports — KADIR Staff Management" }] }),
  component: ReportsPage,
});

type Row = { email: string; name: string; area: string; shifts: number; hours: number; ot_shifts: number; ot_hours: number; sick: number; vacation: number };

function ReportsPage() {
  const { me } = useMe();
  const today = toISODate(new Date());
  const monthAgo = toISODate(new Date(Date.now() - 30 * 86400000));
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [areas, setAreas] = useState<string[]>([...AREAS]);
  const [rows, setRows] = useState<Row[]>([]);

  const isAdmin = me?.staff?.role === "admin";
  const isSup = me?.staff?.role === "supervisor";

  useEffect(() => {
    if (isAdmin) {
      setAreas([...AREAS]);
    } else if (isSup && me?.staff?.area) {
      setAreas([me.staff.area]);
      setAreaFilter(me.staff.area);
    }
  }, [isAdmin, isSup, me?.staff?.area]);

  const load = async () => {
    const scopedArea = isSup ? me!.staff!.area! : (areaFilter === "all" ? null : areaFilter);
    let staffQ = supabase.from("staff").select("email,name,area");
    if (scopedArea) staffQ = staffQ.eq("area", scopedArea);
    const { data: staff } = await staffQ;

    let shiftsQ = supabase.from("shifts").select("*").gte("date", start).lte("date", end);
    if (scopedArea) shiftsQ = shiftsQ.eq("area", scopedArea);
    const { data: shifts } = await shiftsQ;

    let leavesQ = supabase.from("leave_requests").select("*").eq("status", "Approved").gte("start_date", start).lte("end_date", end);
    if (scopedArea) leavesQ = leavesQ.eq("area", scopedArea);
    const { data: leaves } = await leavesQ;

    const map = new Map<string, Row>();
    ((staff as { email: string; name: string; area: string }[]) ?? []).forEach(s => {
      map.set(s.email.toLowerCase(), { email: s.email, name: s.name, area: s.area ?? "—", shifts: 0, hours: 0, ot_shifts: 0, ot_hours: 0, sick: 0, vacation: 0 });
    });
    ((shifts as { staff_email: string; hours: number; is_overtime: boolean }[]) ?? []).forEach(sh => {
      const r = map.get(sh.staff_email.toLowerCase()); if (!r) return;
      r.shifts++; r.hours += Number(sh.hours);
      if (sh.is_overtime) { r.ot_shifts++; r.ot_hours += Number(sh.hours); }
    });
    ((leaves as { staff_email: string; leave_type: string; start_date: string; end_date: string }[]) ?? []).forEach(l => {
      const r = map.get(l.staff_email.toLowerCase()); if (!r) return;
      const days = Math.max(1, Math.round((+new Date(l.end_date) - +new Date(l.start_date)) / 86400000) + 1);
      if (l.leave_type === "Sick") r.sick += days; else r.vacation += days;
    });
    setRows(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
  };

  useEffect(() => { if (me?.staff) void load(); }, [me?.staff, start, end, areaFilter]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    shifts: acc.shifts + r.shifts, hours: acc.hours + r.hours, ot_shifts: acc.ot_shifts + r.ot_shifts,
    ot_hours: acc.ot_hours + r.ot_hours, sick: acc.sick + r.sick, vacation: acc.vacation + r.vacation,
  }), { shifts: 0, hours: 0, ot_shifts: 0, ot_hours: 0, sick: 0, vacation: 0 }), [rows]);

  const exportCsv = () => {
    const header = ["Name", "Email", "Area", "Shifts", "Hours", "OT shifts", "OT hours", "Sick days", "Vacation days"];
    const lines = [header.join(",")].concat(
      rows.map(r => [r.name, r.email, r.area, r.shifts, r.hours, r.ot_shifts, r.ot_hours, r.sick, r.vacation].join(",")),
      ["TOTAL", "", "", totals.shifts, totals.hours, totals.ot_shifts, totals.ot_hours, totals.sick, totals.vacation].join(","),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report_${start}_${end}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!isAdmin && !isSup) return <p>Reports are available to admins and supervisors.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">{isAdmin ? "Org-wide read-only report." : `Report for ${me?.staff?.area}.`}</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-4 gap-3 items-end">
            <div><Label>Start</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><Label>End</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            <div>
              <Label>Area</Label>
              <Select value={areaFilter} onValueChange={setAreaFilter} disabled={!isAdmin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isAdmin && <SelectItem value="all">All areas</SelectItem>}
                  {areas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={exportCsv}>Export CSV</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="p-2">Staff</th><th className="p-2">Area</th>
                  <th className="p-2">Shifts</th><th className="p-2">Hours</th>
                  <th className="p-2">OT shifts</th><th className="p-2">OT hours</th>
                  <th className="p-2">Sick days</th><th className="p-2">Vacation days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.email} className="border-b">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.area}</td>
                    <td className="p-2">{r.shifts}</td>
                    <td className="p-2">{r.hours}</td>
                    <td className="p-2">{r.ot_shifts}</td>
                    <td className="p-2">{r.ot_hours}</td>
                    <td className="p-2">{r.sick}</td>
                    <td className="p-2">{r.vacation}</td>
                  </tr>
                ))}
                <tr className="font-medium bg-muted/40">
                  <td className="p-2">Total</td><td className="p-2"></td>
                  <td className="p-2">{totals.shifts}</td><td className="p-2">{totals.hours}</td>
                  <td className="p-2">{totals.ot_shifts}</td><td className="p-2">{totals.ot_hours}</td>
                  <td className="p-2">{totals.sick}</td><td className="p-2">{totals.vacation}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}