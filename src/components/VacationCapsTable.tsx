import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { SUPERVISORS_TEAM, UNASSIGNED_AREA } from "@/lib/areas";

type Cap = { id: string; area: string; cap_pct: number; warn_pct: number };
type StaffRow = { area: string | null; role: string; status: string | null };

export function maxOffPerDay(activeStaff: number, capPct: number): number {
  return Math.max(1, Math.floor((activeStaff * capPct) / 100));
}

function isActive(s: StaffRow) {
  return (s.status ?? "Active").toLowerCase() === "active";
}

export default function VacationCapsTable({ actorEmail }: { actorEmail?: string | null }) {
  const [caps, setCaps] = useState<Cap[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { cap: string; warn: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: capData }, { data: staffData }] = await Promise.all([
      supabase.from("vacation_caps").select("id,area,cap_pct,warn_pct"),
      supabase.from("staff").select("area,role,status"),
    ]);
    const list = (capData ?? []) as Cap[];
    setCaps(list);
    setStaff((staffData ?? []) as StaffRow[]);
    setDraft(
      Object.fromEntries(
        list.map((c) => [c.area, { cap: String(c.cap_pct), warn: String(c.warn_pct) }]),
      ),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Live headcount per row — recomputed from the directory, never cached. */
  const headcount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of CAP_ROWS) {
      m[row] =
        (row as string) === "Supervisor"
          ? staff.filter((s) => isActive(s) && s.role === "supervisor").length
          : staff.filter((s) => isActive(s) && s.area === row).length;
    }
    return m;
  }, [staff]);

  const save = async (cap: Cap) => {
    const d = draft[cap.area] ?? { cap: "", warn: "" };
    const capPct = Number(d.cap);
    const warnPct = Number(d.warn);
    if (!Number.isInteger(capPct) || capPct < 1 || capPct > 100) {
      toast.error("Cap % must be a whole number between 1 and 100");
      return;
    }
    if (!Number.isInteger(warnPct) || warnPct < 1 || warnPct > 100) {
      toast.error("Warn % must be a whole number between 1 and 100");
      return;
    }
    setSaving(cap.area);
    const { error } = await supabase
      .from("vacation_caps")
      .update({ cap_pct: capPct, warn_pct: warnPct, updated_by: actorEmail ?? null })
      .eq("id", cap.id);
    setSaving(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "vacation_cap_updated",
      entity_type: "vacation_cap",
      entity_id: cap.id,
      area: cap.area,
      actor_email: actorEmail ?? undefined,
      actor_role: "admin",
      details: { cap_pct: capPct, warn_pct: warnPct },
    });
    toast.success(`Saved ${cap.area} cap`);
    void load();
  };

  const ordered = CAP_ROWS.map((a) => caps.find((c) => c.area === a)).filter(Boolean) as Cap[];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3">Area</th>
            <th className="py-2 pr-3">Active staff</th>
            <th className="py-2 pr-3 w-[110px]">Cap %</th>
            <th className="py-2 pr-3 w-[110px]">Warn %</th>
            <th className="py-2 pr-3">Max staff off/day</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {ordered.map((c) => {
            const active = headcount[c.area] ?? 0;
            const d = draft[c.area] ?? { cap: String(c.cap_pct), warn: String(c.warn_pct) };
            const pending = Number(d.cap);
            const effective =
              Number.isInteger(pending) && pending >= 1 && pending <= 100 ? pending : c.cap_pct;
            const max = maxOffPerDay(active, effective);
            return (
              <tr key={c.id} className="border-t align-top">
                <td className="py-3 pr-3 font-medium">
                  {c.area}
                  <div className="mt-1 text-[11px] font-normal text-muted-foreground">
                    {active} active · {effective}% · max {max}/day
                  </div>
                </td>
                <td className="py-3 pr-3 tabular-nums">{active}</td>
                <td className="py-3 pr-3">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={d.cap}
                    onChange={(e) =>
                      setDraft((s) => ({ ...s, [c.area]: { ...d, cap: e.target.value } }))
                    }
                  />
                </td>
                <td className="py-3 pr-3">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={d.warn}
                    onChange={(e) =>
                      setDraft((s) => ({ ...s, [c.area]: { ...d, warn: e.target.value } }))
                    }
                  />
                </td>
                <td className="py-3 pr-3 tabular-nums">{max}</td>
                <td className="py-3">
                  <Button size="sm" disabled={saving === c.area} onClick={() => void save(c)}>
                    {saving === c.area ? "Saving…" : "Save"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
