import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VacationPlanner } from "@/components/VacationPlanner";

export const Route = createFileRoute("/_authenticated/vacations")({
  head: () => ({
    meta: [
      { title: "Vacations — KADIR Staff Management" },
      { name: "description", content: "Book vacation days on the availability calendar and track your requests." },
      { property: "og:title", content: "Vacations — KADIR Staff Management" },
      { property: "og:description", content: "Book vacation days on the availability calendar and track your requests." },
    ],
  }),
  component: VacationsPage,
});

type Leave = {
  id: string; leave_type: string; start_date: string; end_date: string;
  reason: string | null; status: string; approver_email: string | null; created_at: string;
};

function VacationsPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<Leave[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = async () => {
    if (!me?.staff) return;
    const { data } = await supabase
      .from("leave_requests")
      .select("*")
      .ilike("staff_email", me.staff.email)
      .eq("leave_type", "Vacation")
      .order("created_at", { ascending: false });
    setRows((data as Leave[]) ?? []);
    const emails = Array.from(new Set(((data as Leave[]) ?? []).map((r) => r.approver_email?.toLowerCase()).filter(Boolean) as string[]));
    if (emails.length) {
      const { data: staff } = await supabase.from("staff").select("email,name");
      const map: Record<string, string> = {};
      for (const s of staff ?? []) map[(s.email as string).toLowerCase()] = s.name as string;
      setNames(map);
    }
  };
  useEffect(() => { void load(); }, [me?.staff?.email]);

  if (!me?.staff) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vacations</h1>
        <p className="text-muted-foreground text-sm">Click a day to set your vacation start, then another for the end. Requests go to your approver.</p>
      </div>

      <VacationPlanner me={me.staff} onDone={load} />

      <Card>
        <CardHeader><CardTitle>My vacation requests</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vacation requests yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="p-2">Submitted</th><th className="p-2">Dates</th>
                  <th className="p-2">Reason</th><th className="p-2">Approver</th><th className="p-2">Status</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="p-2">{r.start_date} → {r.end_date}</td>
                      <td className="p-2">{r.reason || "—"}</td>
                      <td className="p-2">{(r.approver_email && names[r.approver_email.toLowerCase()]) || r.approver_email || "—"}</td>
                      <td className="p-2">
                        <Badge variant={r.status === "Approved" ? "default" : r.status === "Rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
