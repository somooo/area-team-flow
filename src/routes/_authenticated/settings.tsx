import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { useCapabilities } from "@/lib/use-can";
import { NoAccess } from "@/components/NoAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import VacationCapsTable from "@/components/VacationCapsTable";
import ZoneMapTable from "@/components/ZoneMapTable";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "System rules — KADIR Staff Management" }] }),
  component: SettingsPage,
});

type RuleType = "boolean" | "number" | "string" | "array";
type Rule = {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  type: RuleType;
  group: string;
};

const GROUP_ORDER = ["Vacation", "Pre-schedule", "Overtime", "Import", "General"];

/** Rules rendered by dedicated UI instead of the generic list. */
const CUSTOM_RULE_KEYS = new Set(["vacation_cap_pct", "vacation_change_deadline_day"]);

/** Longer explanations shown under specific rules. */
const HELP: Record<string, { title: string; body: string }> = {
  sick_ot_excluded_from_duty: {
    title: "Sick on overtime doesn't count as duty",
    body:
      "When on, a sick day that falls on a BOT or AOT shift is removed from the duty count, which reduces that month's overtime (OT = duty shifts − regular shifts). " +
      "Sick days on regular shifts still count as duty days. Either way the day is still counted as sick leave. MedEvac (MOT) shifts are never removed from the duty count.",
  },
  benefit_days_min_holidays: {
    title: "Benefit days threshold",
    body: "2 days off are added to the leave-day count once a leave period uses at least this many holidays, following the HR guideline.",
  },
};

function SettingsPage() {
  const { me } = useMe();
  const { can, loading: capsLoading } = useCapabilities();
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase.from("system_rules").select("*").order("key");
    const list = ((data ?? []) as unknown as Rule[]).map((r) => ({
      ...r,
      type: (r.type ?? "string") as RuleType,
      group: r.group ?? "General",
    }));
    setRules(list);
    const d: Record<string, string> = {};
    for (const r of list)
      d[r.key] = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
    setDraft(d);
  };
  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules) {
      if (CUSTOM_RULE_KEYS.has(r.key)) continue;
      const g = GROUP_ORDER.includes(r.group) ? r.group : "General";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(r);
    }
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [rules]);

  const deadlineRule = useMemo(
    () => rules.find((r) => r.key === "vacation_change_deadline_day"),
    [rules],
  );

  if (capsLoading) return null;
  if (!can("settings.manage")) return <NoAccess what="Manage system settings" />;

  const persist = async (r: Rule, parsed: unknown) => {
    const { error } = await supabase
      .from("system_rules")
      .update({ value: parsed as never, updated_by: me?.staff?.email })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logAudit({
      action: "rule_updated",
      entity_type: "system_rule",
      entity_id: r.id,
      actor_email: me?.staff?.email,
      details: { key: r.key, value: parsed },
    });
    toast.success(`Saved ${r.key}`);
    void load();
  };

  const saveTyped = (r: Rule) => {
    const raw = draft[r.key] ?? "";
    if (r.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        toast.error(`${r.key} must be a number`);
        return;
      }
      void persist(r, n);
      return;
    }
    if (r.type === "string") {
      void persist(r, raw);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      toast.error(`Invalid JSON for ${r.key}`);
      return;
    }
    void persist(r, parsed);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System rules</h1>
        <p className="text-sm text-muted-foreground">
          Vacation caps, auto-approve window, OT limits and other operational rules.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vacation caps</CardTitle>
        </CardHeader>
        <CardContent>
          <VacationCapsTable actorEmail={me?.staff?.email} />
        </CardContent>
      </Card>

      <Card id="zone-map">
        <CardHeader>
          <CardTitle>Zone map (assignment number → unit → zone)</CardTitle>
        </CardHeader>
        <CardContent>
          <ZoneMapTable actorEmail={me?.staff?.email} />
        </CardContent>
      </Card>

      {deadlineRule && (
        <Card>
          <CardHeader>
            <CardTitle>Change requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-[320px_1fr_auto] gap-2 items-start">
              <div>
                <Label className="text-xs">Change request deadline day</Label>
                <div className="text-[11px] text-muted-foreground">
                  Staff may request cancel/adjust until this day of the month before the vacation
                  starts.
                </div>
                <div className="text-[10px] text-muted-foreground/70">
                  {deadlineRule.key}
                </div>
              </div>
              <Input
                type="number"
                min={1}
                max={31}
                value={draft[deadlineRule.key] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [deadlineRule.key]: e.target.value }))
                }
              />
              <Button size="sm" onClick={() => saveTyped(deadlineRule)}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {grouped.map(([group, list]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {list.map((r) => {
              const help = HELP[r.key];
              if (r.type === "boolean") {
                const on = r.value === true;
                return (
                  <div
                    key={r.id}
                    className="flex items-start justify-between gap-4 rounded-md border p-3"
                  >
                    <div>
                      <Label className="text-sm">{help?.title ?? r.key}</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {help?.body ?? r.description}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground/70">{r.key}</p>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => void persist(r, v)} />
                  </div>
                );
              }
              return (
                <div key={r.id} className="grid sm:grid-cols-[240px_1fr_auto] gap-2 items-start">
                  <div>
                    <Label className="text-xs">{help?.title ?? r.key}</Label>
                    <div className="text-[11px] text-muted-foreground">
                      {help?.body ?? r.description}
                    </div>
                    {help && <div className="text-[10px] text-muted-foreground/70">{r.key}</div>}
                  </div>
                  <Input
                    type={r.type === "number" ? "number" : "text"}
                    value={draft[r.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))}
                  />
                  <Button size="sm" onClick={() => saveTyped(r)}>
                    Save
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
