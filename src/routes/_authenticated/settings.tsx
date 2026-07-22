import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "System rules — Shift & Leave Manager" }] }),
  component: SettingsPage,
});

type Rule = { id: string; key: string; value: unknown; description: string | null };

function SettingsPage() {
  const { me } = useMe();
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const load = async () => {
    const { data } = await supabase.from("system_rules").select("*").order("key");
    const list = (data as Rule[]) ?? [];
    setRules(list);
    const d: Record<string, string> = {};
    for (const r of list) d[r.key] = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
    setDraft(d);
  };
  useEffect(() => { void load(); }, []);
  if ((me?.staff?.role as string) !== "admin") return <p>Admins only.</p>;
  const save = async (r: Rule) => {
    let parsed: unknown;
    try { parsed = JSON.parse(draft[r.key]); } catch { toast.error(`Invalid JSON for ${r.key}`); return; }
    const { error } = await supabase.from("system_rules").update({ value: parsed as never, updated_by: me?.staff?.email }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    await logAudit({ action: "rule_updated", entity_type: "system_rule", entity_id: r.id, actor_email: me?.staff?.email, actor_role: "admin", details: { key: r.key, value: parsed } });
    toast.success(`Saved ${r.key}`);
    load();
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">System rules</h1>
        <p className="text-sm text-muted-foreground">Vacation caps, auto-approve window, OT limits and other operational rules.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {rules.map(r => (
            <div key={r.id} className="grid sm:grid-cols-[220px_1fr_auto] gap-2 items-end">
              <div>
                <Label className="text-xs">{r.key}</Label>
                <div className="text-[11px] text-muted-foreground">{r.description}</div>
              </div>
              <Input value={draft[r.key] ?? ""} onChange={(e) => setDraft(d => ({ ...d, [r.key]: e.target.value }))} />
              <Button size="sm" onClick={() => save(r)}>Save</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}