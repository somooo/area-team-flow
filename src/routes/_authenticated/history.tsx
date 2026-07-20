import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { notify } from "@/lib/notify.functions";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Requests — Shift & Leave Manager" }] }),
  component: HistoryPage,
});

type LeaveReq = { id: string; staff_email: string; staff_name: string; area: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; approver_email: string | null; created_at: string };
type ChangeReq = { id: string; requester_email: string; requester_name: string; area: string; change_type: string; target_staff_email: string; target_staff_name: string; details: string | null; staff_response: string; supervisor_response: string; status: string; created_at: string };

function HistoryPage() {
  const { me } = useMe();
  const [leaves, setLeaves] = useState<LeaveReq[]>([]);
  const [changes, setChanges] = useState<ChangeReq[]>([]);

  const load = async () => {
    const [{ data: lv }, { data: ch }] = await Promise.all([
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("schedule_change_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setLeaves((lv as LeaveReq[]) ?? []);
    setChanges((ch as ChangeReq[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.email]);

  const respondChange = async (r: ChangeReq, accept: boolean) => {
    const newStaff = accept ? "Accepted" : "Declined";
    const newStatus = accept ? "Pending Supervisor" : "Rejected";
    const { error } = await supabase.from("schedule_change_requests")
      .update({ staff_response: newStaff, status: newStatus }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    if (accept) {
      await notify({ data: { event: "change_pending_supervisor", change_type: r.change_type, requester_name: r.requester_name, staff_email: "", details: r.details } });
    } else {
      await notify({ data: { event: "change_decided", change_type: r.change_type, status: "Rejected", staff_email: r.requester_email, staff_name: r.requester_name } });
    }
    toast.success(accept ? "Accepted — sent to supervisor" : "Declined");
    load();
  };

  const meEmail = me?.staff?.email?.toLowerCase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Requests</h1>
        <p className="text-sm text-muted-foreground">All leave and schedule change requests you can see.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Change requests</CardTitle></CardHeader>
        <CardContent>
          {changes.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="p-2">Requested</th><th className="p-2">Type</th><th className="p-2">Requester → Target</th>
                  <th className="p-2">Staff</th><th className="p-2">Supervisor</th><th className="p-2">Status</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {changes.map(c => (
                    <tr key={c.id} className="border-b">
                      <td className="p-2">{new Date(c.created_at).toLocaleString()}</td>
                      <td className="p-2">{c.change_type}</td>
                      <td className="p-2">{c.requester_name} → {c.target_staff_name}</td>
                      <td className="p-2"><Badge variant="outline">{c.staff_response}</Badge></td>
                      <td className="p-2"><Badge variant="outline">{c.supervisor_response}</Badge></td>
                      <td className="p-2"><StatusBadge status={c.status} /></td>
                      <td className="p-2 text-right">
                        {c.target_staff_email.toLowerCase() === meEmail && c.staff_response === "Pending" && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" onClick={() => respondChange(c, true)}>Accept</Button>
                            <Button size="sm" variant="outline" onClick={() => respondChange(c, false)}>Decline</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Leave requests</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="p-2">Requested</th><th className="p-2">Staff</th><th className="p-2">Type</th>
                  <th className="p-2">Dates</th><th className="p-2">Approver</th><th className="p-2">Status</th>
                </tr></thead>
                <tbody>
                  {leaves.map(l => (
                    <tr key={l.id} className="border-b">
                      <td className="p-2">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="p-2">{l.staff_name}</td>
                      <td className="p-2">{l.leave_type}</td>
                      <td className="p-2">{l.start_date} → {l.end_date}</td>
                      <td className="p-2 text-xs">{l.approver_email}</td>
                      <td className="p-2"><StatusBadge status={l.status} /></td>
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

function StatusBadge({ status }: { status: string }) {
  const variant = status === "Approved" ? "default" : status === "Rejected" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}