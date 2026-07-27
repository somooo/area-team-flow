import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Audit log — KADIR Staff Management" }] }),
  component: AuditPage,
});

type Row = { id: string; actor_email: string | null; actor_role: string | null; action: string; entity_type: string; entity_id: string | null; area: string | null; details: unknown; created_at: string };

function AuditPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if ((me?.staff?.role as string) !== "admin") return;
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(300)
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, [me?.staff?.role]);
  if ((me?.staff?.role as string) !== "admin") return <p>Admins only.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Last 300 sensitive actions.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Events</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b">
                <th className="p-2">When</th><th className="p-2">Actor</th><th className="p-2">Role</th>
                <th className="p-2">Action</th><th className="p-2">Entity</th><th className="p-2">Area</th><th className="p-2">Details</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2">{r.actor_email ?? "—"}</td>
                    <td className="p-2"><Badge variant="outline">{r.actor_role ?? "—"}</Badge></td>
                    <td className="p-2">{r.action}</td>
                    <td className="p-2">{r.entity_type}</td>
                    <td className="p-2">{r.area ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground max-w-md truncate">{r.details ? JSON.stringify(r.details) : ""}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}