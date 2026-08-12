import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useDirectoryAreas } from "@/lib/areas";
import { fetchZoneAssignments, type ZoneAssignment } from "@/lib/zones";

type Draft = { assignment_no: string; unit: string; zone: string; sort_order: string };

const EMPTY: Draft = { assignment_no: "", unit: "", zone: "", sort_order: "" };

/** Editable assignment number → unit → zone map used to group the schedule grid. */
export default function ZoneMapTable({ actorEmail }: { actorEmail?: string | null }) {
  const { areas } = useDirectoryAreas();
  const [area, setArea] = useState("");
  const [rows, setRows] = useState<ZoneAssignment[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!area && areas.length) setArea(areas[0]);
  }, [areas, area]);

  const load = async (a: string) => setRows(await fetchZoneAssignments(a));
  useEffect(() => {
    if (area) void load(area);
  }, [area]);

  const patch = async (r: ZoneAssignment, change: Partial<ZoneAssignment>) => {
    const { error } = await supabase.from("zone_assignments").update(change).eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load(area);
  };

  const add = async () => {
    if (!draft.assignment_no.trim() || !draft.zone.trim()) {
      toast.error("Assignment number and zone are required");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("zone_assignments").insert({
      area,
      assignment_no: String(Number(draft.assignment_no.replace(/\D/g, "")) || draft.assignment_no.trim()),
      unit: draft.unit.trim(),
      zone: draft.zone.trim(),
      sort_order: Number(draft.sort_order) || rows.length * 10 + 10,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft(EMPTY);
    toast.success(`Added ${draft.assignment_no} to ${draft.zone}`);
    void load(area);
  };

  const remove = async (r: ZoneAssignment) => {
    const { error } = await supabase.from("zone_assignments").delete().eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load(area);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Assignment numbers change between months and areas, so the zone grouping used by the
        schedule grid is configured here — not in code. {actorEmail ? "" : ""}
      </p>
      <div className="sm:w-56">
        <Label className="mb-1.5 block text-xs">Area</Label>
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
          <SelectContent>
            {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left">
            <tr>
              <th className="p-2">Assignment #</th>
              <th className="p-2">Unit</th>
              <th className="p-2">Zone</th>
              <th className="p-2 w-20">Order</th>
              <th className="p-2 w-10" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t bg-muted/20">
              <td className="p-1">
                <Input value={draft.assignment_no} placeholder="12"
                  onChange={(e) => setDraft({ ...draft, assignment_no: e.target.value })} />
              </td>
              <td className="p-1">
                <Input value={draft.unit} placeholder="PCICU I,II"
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
              </td>
              <td className="p-1">
                <Input value={draft.zone} placeholder="ZONE I"
                  onChange={(e) => setDraft({ ...draft, zone: e.target.value })} />
              </td>
              <td className="p-1">
                <Input value={draft.sort_order} placeholder="10"
                  onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} />
              </td>
              <td className="p-1">
                <Button size="sm" disabled={busy || !area} onClick={() => void add()}>Add</Button>
              </td>
            </tr>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-1">
                  <Input defaultValue={r.assignment_no}
                    onBlur={(e) => e.target.value !== r.assignment_no && void patch(r, { assignment_no: e.target.value })} />
                </td>
                <td className="p-1">
                  <Input defaultValue={r.unit}
                    onBlur={(e) => e.target.value !== r.unit && void patch(r, { unit: e.target.value })} />
                </td>
                <td className="p-1">
                  <Input defaultValue={r.zone}
                    onBlur={(e) => e.target.value !== r.zone && void patch(r, { zone: e.target.value })} />
                </td>
                <td className="p-1">
                  <Input type="number" defaultValue={r.sort_order}
                    onBlur={(e) => Number(e.target.value) !== r.sort_order && void patch(r, { sort_order: Number(e.target.value) })} />
                </td>
                <td className="p-1">
                  <Button size="icon" variant="ghost" onClick={() => void remove(r)} aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No zones mapped for {area || "this area"} yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
