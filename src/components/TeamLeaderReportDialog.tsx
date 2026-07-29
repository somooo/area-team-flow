import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { resolveApprover } from "@/lib/approver";
import { createNotification } from "@/lib/notifications.functions";

export type SickCall = {
  staff_name: string;
  staff_code: string;
  covered_by: string;
  coverage_type: "overtime" | "area_pull";
};

type Me = {
  name: string; email: string; role: string; area: string | null;
  supervisor_email: string | null; delegated_to_email: string | null; delegation_active: boolean;
};

const emptyCall: SickCall = { staff_name: "", staff_code: "", covered_by: "", coverage_type: "overtime" };

export function TeamLeaderReportDialog({
  me, date, layer, assignmentCode, onClose,
}: { me: Me; date: string; layer: "day" | "night" | "all"; assignmentCode: string | null; onClose: () => void }) {
  const [calls, setCalls] = useState<SickCall[]>([{ ...emptyCall }]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<SickCall>) =>
    setCalls((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const submit = async () => {
    setBusy(true);
    const approver = await resolveApprover(me);
    const filled = calls.filter((c) => c.staff_name.trim());
    const { error } = await supabase.from("team_leader_reports").insert({
      reporter_email: me.email,
      reporter_name: me.name,
      area: me.area!,
      layer: layer === "night" ? "night" : "day",
      shift_date: date,
      assignment_code: assignmentCode,
      sick_calls: filled as never,
      comment: comment || null,
      approver_email: approver,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (approver) {
      const needsAction = filled.length > 0;
      await createNotification({
        data: {
          recipient_email: approver,
          title: `Team Leader Report — ${me.name}`,
          body: `${date} · ${filled.length} sick call(s)${needsAction ? " needing schedule approval" : ""}`,
          link: "/supervisor",
        },
      });
    }
    toast.success("Report sent to your supervisor");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Team Leader Report · {date}{assignmentCode ? ` · ${assignmentCode}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-auto pr-1">
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Sick calls</Label>
            {calls.map((c, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Staff name</Label>
                    <Input value={c.staff_name} onChange={(e) => update(i, { staff_name: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Staff code / assignment</Label>
                    <Input value={c.staff_code} onChange={(e) => update(i, { staff_code: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Who covered this area</Label>
                    <Input value={c.covered_by} onChange={(e) => update(i, { covered_by: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Coverage type</Label>
                    <Select value={c.coverage_type} onValueChange={(v) => update(i, { coverage_type: v as SickCall["coverage_type"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="overtime">Called for overtime</SelectItem>
                        <SelectItem value="area_pull">Pulled from another area</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {calls.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setCalls((cs) => cs.filter((_, idx) => idx !== i))}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setCalls((cs) => [...cs, { ...emptyCall }])}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add another
            </Button>
          </div>
          <div>
            <Label>Comments to supervisor</Label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything else the supervisor should know" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Submit report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
