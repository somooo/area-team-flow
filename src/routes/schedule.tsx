import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MonthGrid, type StaffLite } from "@/components/MonthGrid";
import type { RosterShift } from "@/lib/roster";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Public schedule — Shift & Leave Manager" },
      { name: "description", content: "Read-only monthly duty roster for hospital respiratory therapy areas." },
      { property: "og:title", content: "Public schedule" },
      { property: "og:description", content: "Read-only monthly duty roster." },
    ],
  }),
  component: PublicSchedule,
});

function PublicSchedule() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [area, setArea] = useState<string>("");
  const [areas, setAreas] = useState<string[]>([]);
  const [layer, setLayer] = useState<"all" | "day" | "night">("all");
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [shifts, setShifts] = useState<RosterShift[]>([]);

  useEffect(() => {
    supabase.from("staff").select("area").then(({ data }) => {
      const uniq = Array.from(new Set((data ?? []).map(r => r.area as string).filter(Boolean))).sort();
      setAreas(uniq);
      if (uniq[0] && !area) setArea(uniq[0]);
    });
  }, []);

  useEffect(() => {
    if (!area) return;
    const start = new Date(year, month, 1).toISOString().slice(0, 10);
    const end = new Date(year, month + 1, 0).toISOString().slice(0, 10);
    Promise.all([
      supabase.from("shifts").select("*").eq("area", area).gte("date", start).lte("date", end).order("date"),
      supabase.from("staff").select("id,name,email,role,area,department").eq("area", area).order("name"),
    ]).then(([sh, st]) => {
      setShifts((sh.data as RosterShift[]) ?? []);
      setStaff((st.data as StaffLite[]) ?? []);
    });
  }, [area, year, month]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Public schedule</h1>
            <p className="text-sm text-muted-foreground">Read-only view. <a className="underline" href="/auth">Staff sign in</a></p>
          </div>
          <div className="flex gap-2 items-center">
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Area" /></SelectTrigger>
              <SelectContent>{areas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex rounded-md border overflow-hidden">
              {(["all","day","night"] as const).map(l => (
                <Button key={l} size="sm" variant={layer === l ? "default" : "ghost"} className="rounded-none" onClick={() => setLayer(l)}>{l}</Button>
              ))}
            </div>
          </div>
        </div>
        <Card>
          <CardHeader><CardTitle>{area || "—"}</CardTitle></CardHeader>
          <CardContent>
            <MonthGrid
              year={year} month={month} onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
              staff={staff} shifts={shifts} meEmail=""
              areaLabel={area} layer={layer}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}