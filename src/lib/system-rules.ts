import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type RuleValue = number | string | boolean | string[] | number[];
export type RulesMap = Record<string, RuleValue>;

export const RULE_DEFAULTS: RulesMap = {
  vacation_cap_pct: 30,
  vacation_yearly_days: 25,
  preschedule_lead_days: 10,
  auto_approve_days: 3,
  ot_monthly_max_hours: 60,
  same_day_edit_roles: ["team_leader", "supervisor", "admin"],
};

export function useSystemRules() {
  const [rules, setRules] = useState<RulesMap>(RULE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from("system_rules").select("key,value").then(({ data }) => {
      const map: RulesMap = { ...RULE_DEFAULTS };
      for (const r of (data ?? []) as { key: string; value: RuleValue }[]) map[r.key] = r.value;
      setRules(map);
      setLoading(false);
    });
  }, []);
  return { rules, loading };
}

export function ruleNumber(rules: RulesMap, key: string, fallback: number): number {
  const v = rules[key];
  return typeof v === "number" ? v : fallback;
}