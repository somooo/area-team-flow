import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { ParseInput } from "@/components/ExcelImportButton";
import { detectSheetLayout } from "@/lib/sheet-schedule-import";

export type SheetImportConfig = {
  daySheet: string | null;
  nightSheet: string | null;
  side: "day" | "night" | "both";
};

const NONE = "__none__";

export function SheetMappingDialog({
  input,
  onConfirm,
  onCancel,
}: {
  input: ParseInput;
  onConfirm: (config: SheetImportConfig) => void;
  onCancel: () => void;
}) {
  const names = input.workbook.sheetNames;
  const [daySheet, setDaySheet] = useState<string>(
    () => names.find((n) => /^\s*day\s*$/i.test(n)) ?? names.find((n) => /day/i.test(n)) ?? NONE,
  );
  const [nightSheet, setNightSheet] = useState<string>(
    () => names.find((n) => /^\s*night\s*$/i.test(n)) ?? names.find((n) => /night/i.test(n)) ?? NONE,
  );
  const [side, setSide] = useState<"day" | "night" | "both">("both");

  const summary = useMemo(() => {
    const out: { label: string; sheet: string; dates: number; rows: number; month: string; warnings: string[] }[] = [];
    const add = (sheet: string, s: "day" | "night") => {
      if (!sheet || sheet === NONE) return;
      const layout = detectSheetLayout(input.workbook.sheets[sheet] ?? [], sheet, s);
      out.push({
        label: s === "day" ? "Day" : "Night",
        sheet,
        dates: layout.dateCols.length,
        rows: layout.rows.length,
        month: new Date(layout.year, layout.month, 1).toLocaleString(undefined, {
          month: "long",
          year: "numeric",
        }),
        warnings: layout.warnings,
      });
    };
    if (side !== "night") add(daySheet, "day");
    if (side !== "day") add(nightSheet, "night");
    return out;
  }, [input, daySheet, nightSheet, side]);

  const confirm = () => {
    if (side !== "night" && daySheet === NONE) {
      toast.error("Map a Day sheet, or import Night only");
      return;
    }
    if (side !== "day" && nightSheet === NONE) {
      toast.error("Map a Night sheet, or import Day only");
      return;
    }
    if (side === "both" && daySheet === nightSheet) {
      toast.error("Day and Night must be different sheets");
      return;
    }
    onConfirm({
      daySheet: daySheet === NONE ? null : daySheet,
      nightSheet: nightSheet === NONE ? null : nightSheet,
      side,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Map the workbook sheets</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Rows from the Day sheet are written to the Day schedule only, and rows from the Night
            sheet to the Night schedule only. Codes are stored exactly as written in the file.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs">Day sheet</Label>
              <Select value={daySheet} onValueChange={setDaySheet}>
                <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Night sheet</Label>
              <Select value={nightSheet} onValueChange={setNightSheet}>
                <SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not mapped</SelectItem>
                  {names.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block text-xs">What to import</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["day", "night", "both"] as const).map((s) => (
                <label
                  key={s}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs capitalize ${
                    side === s ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="import-side"
                    checked={side === s}
                    onChange={() => setSide(s)}
                  />
                  {s === "both" ? "Both" : `${s} only`}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {summary.map((s) => (
              <div key={s.label} className="rounded-md border p-2 text-xs">
                <div className="font-medium">
                  {s.label} — “{s.sheet}”
                </div>
                <div className="text-muted-foreground">
                  {s.dates} date column{s.dates === 1 ? "" : "s"} · {s.rows} staff row
                  {s.rows === 1 ? "" : "s"} · {s.month}
                </div>
                {s.warnings.map((w) => (
                  <div key={w} className="mt-1 text-amber-700 dark:text-amber-400">{w}</div>
                ))}
              </div>
            ))}
            {summary.length === 0 && (
              <p className="text-xs text-destructive">Map at least one sheet to continue.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={confirm} disabled={summary.length === 0}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
