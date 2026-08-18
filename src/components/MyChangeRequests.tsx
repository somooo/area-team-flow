import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import { createNotification } from "@/lib/notifications.functions";
import { enqueueEmail } from "@/lib/email.functions";
import { logAudit } from "@/lib/audit";

export type ChangeReq = {
  id: string;
  requester_email: string;
  requester_name: string;
  area: string;
  change_type: string;
  target_staff_email: string;
  target_staff_name: string;
  details: string | null;
  staff_response: string;
  supervisor_response: string;
  status: string;
  approver_email: string | null;
  created_at: string;
};

export function MyChangeRequests({ meEmail, refreshKey }: { meEmail: string; refreshKey?: number }) {
  const [rows, setRows] = useState<ChangeReq[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("schedule_change_requests")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data as ChangeReq[]) ?? []);
  };
  useEffect(() => { void load(); }, [meEmail, refreshKey]);

  const me = meEmail.toLowerCase();
  const mine = rows.filter(
    (r) => r.requester_email.toLowerCase() === me || r.target_staff_email.toLowerCase() === me,
  );

  // Stage 1 of the pipeline: target staff accepts or declines. Supervisor
  // approval (and applyScheduleChange) still happens afterwards in /approvals.
  const respond = async (r: ChangeReq, accept: boolean) => {
    const { error } = await supabase
      .from("schedule_change_requests")
      .update({
        staff_response: accept ? "Accepted" : "Declined",
        status: accept ? "Pending Supervisor" : "Rejected",
      })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }

    if (accept) {
      
      if (r.approver_email) {
        await createNotification({ data: { recipient_email: r.approver_email, title: "Change request needs approval", body: `${r.requester_name} · ${r.change_type}`, link: "/approvals" } });
        await enqueueEmail({ data: { recipient_email: r.approver_email, subject: "KADIR: a request needs your review", body: "A change request needs your approval — open KADIR.", link: "/approvals", event_type: "change_needs_supervisor" } });
      }
    } else {
      
      await createNotification({ data: { recipient_email: r.requester_email, title: "Change declined by target", body: r.change_type, link: "/dashboard" } });
      await enqueueEmail({ data: { recipient_email: r.requester_email, subject: "KADIR: your request was updated", body: "Your change request was declined — open KADIR.", link: "/dashboard", event_type: "change_declined_by_target" } });
    }
    await logAudit({
      action: accept ? "change_accepted_by_target" : "change_declined_by_target",
      entity_type: "schedule_change_request", entity_id: r.id, area: r.area,
      details: { change_type: r.change_type },
    });
    toast.success(accept ? "Accepted — sent to supervisor" : "Declined");
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle>My change requests</CardTitle></CardHeader>
      <CardContent>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No swap or give-away requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b">
                <th className="p-2">Requested</th><th className="p-2">Type</th>
                <th className="p-2">Requester → Target</th>
                <th className="p-2">Target</th><th className="p-2">Supervisor</th>
                <th className="p-2">Status</th><th className="p-2"></th>
              </tr></thead>
              <tbody>
                {mine.map((c) => (
                  <tr key={c.id} className="border-b">
                    <td className="p-2">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="p-2">{c.change_type}</td>
                    <td className="p-2">{c.requester_name} → {c.target_staff_name}</td>
                    <td className="p-2"><Badge variant="outline">{c.staff_response}</Badge></td>
                    <td className="p-2"><Badge variant="outline">{c.supervisor_response}</Badge></td>
                    <td className="p-2">
                      <Badge variant={c.status === "Approved" ? "default" : c.status === "Rejected" ? "destructive" : "secondary"}>{c.status}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      {c.target_staff_email.toLowerCase() === me && c.staff_response === "Pending" && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" onClick={() => respond(c, true)}>Accept</Button>
                          <Button size="sm" variant="outline" onClick={() => respond(c, false)}>Decline</Button>
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
  );
}
