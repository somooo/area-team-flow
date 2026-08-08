import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ParseInput } from "@/components/ExcelImportButton";
import {
  detectScheduleLayout,
  collectUnknownCodes,
  cellText,
  colLetter,
  type DetectedBlock,
  type ColumnConfidence,
  type CodeMap,
  type MonthSource,
} from "@/lib/schedule-import";
import { codesForLayer, type AssignmentCode } from "@/lib/assignments";
import { monthDays, toISODate } from "@/lib/roster";

export type ScheduleImportConfig = {
  sheetName: string;
  blocks: DetectedBlock[];
  codeMap: CodeMap;
};

const SOURCE_TEXT: Record<MonthSource, string> = {
  "date-headers": "read from the date headers",
  "weekday-row": "inferred from the weekday row — please confirm",
  "title-text": "inferred from the sheet title — please confirm",
  filename: "inferred from the filename — please confirm",
  "ui-selection": "taken from the month you have open — please confirm",
};

function Chip({ level }: { level: ColumnConfidence }) {
  const cls =
    level === "certain"
      ? "bg-muted text-muted-foreground"
      : level === "inferred"
        ? "bg-amber-100 text-amber-900"
        : "bg-destructive/15 text-destructive";
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${cls}`}>{level}</span>;
}

export function ScheduleMappingDialog({
  input,
  area,
  codes,
  uiYear,
  uiMonth,
  onConfirm,
  onCancel,
}: {
  input: ParseInput;
  area: string;
  codes: AssignmentCode[];
  uiYear: number;
  uiMonth: number;
  onConfirm: (config: ScheduleImportConfig) => void;
  onCancel: () => void;
}) {
  const [sheetName, setSheetName] = useState<string>("");
  const [blocks, setBlocks] = useState<DetectedBlock[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [touchedMonth, setTouchedMonth] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<"map" | "codes">("map");
  const [codeMap, setCodeMap] = useState<CodeMap>({});
  const [rememberProfile, setRememberProfile] = useState(true);
  const [profileMatched, setProfileMatched] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const detected = useMemo(
    () =>
      detectScheduleLayout(
        input.workbook,
        input.file.name,
        { year: uiYear, month: uiMonth },
        sheetName || undefined,
      ),
    [input, uiYear, uiMonth, sheetName],
  );

  useEffect(() => {
    setSheetName(detected.sheetName);
    setBlocks(detected.blocks);
    setWarnings(detected.warnings);
  }, [detected.sheetName]);

  // A saved profile that still validates makes the routine monthly import one click.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("import_profiles")
        .select("name,layout,code_map")
        .eq("area", area);
      if (cancelled || !data?.length) return;
      for (const p of data as { name: string; layout: unknown; code_map: unknown }[]) {
        const layout = p.layout as { sheetName: string; blocks: DetectedBlock[] } | null;
        if (!layout?.blocks?.length) continue;
        const fits =
          layout.blocks.every((b, i) => {
            const d = detected.blocks[i];
            return d && d.headerRow === b.headerRow && d.dayStartCol === b.dayStartCol;
          }) && layout.blocks.length === detected.blocks.length;
        if (!fits) continue;
        setProfileMatched(p.name);
        setCodeMap((p.code_map as CodeMap) ?? {});
        setBlocks(
          detected.blocks.map((d, i) => ({
            ...d,
            nameCol: layout.blocks[i].nameCol,
            badgeCol: layout.blocks[i].badgeCol,
            layer: layout.blocks[i].layer,
          })),
        );
        break;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [area, detected]);

  const matrix = input.workbook.sheets[sheetName] ?? [];

  const patch = (id: string, change: Partial<DetectedBlock>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...change } : b)));

  const unknown = useMemo(
    () => collectUnknownCodes({ matrix, blocks, codes, codeMap }),
    [matrix, blocks, codes, codeMap],
  );

  const monthBlocked = blocks.some((b) => b.confidence.month === "guess" && !touchedMonth[b.id]);

  const continueFromMapping = () => {
    if (monthBlocked) {
      toast.error("Confirm the month for every block before continuing");
      return;
    }
    if (unknown.length) {
      setStep("codes");
      return;
    }
    void finish({});
  };

  const finish = async (extraMap: CodeMap) => {
    const finalMap = { ...codeMap, ...extraMap };
    if (rememberProfile) {
      const name = `${area} monthly profile`;
      const { error } = await supabase
        .from("import_profiles")
        .upsert(
          { area, name, layout: { sheetName, blocks } as never, code_map: finalMap as never },
          { onConflict: "area,name" },
        );
      if (error) toast.error(`Mapping saved locally only: ${error.message}`);
    }
    onConfirm({ sheetName, blocks, codeMap: finalMap });
  };

  const columnOptions = (b: DetectedBlock) =>
    Array.from({ length: Math.max(1, b.dayStartCol) }, (_, c) => {
      const sample = cellText(matrix[b.firstDataRow]?.[c]);
      return {
        value: String(c),
        label: `${colLetter(c)}${sample ? ` — "${sample.slice(0, 24)}"` : ""}`,
      };
    });

  const preview = (b: DetectedBlock) => {
    const days = monthDays(b.year, b.month).slice(0, 5);
    const rows: { name: string; badge: string; cells: string[] }[] = [];
    for (let r = b.firstDataRow; r <= b.lastDataRow && rows.length < 5; r++) {
      const name = cellText(matrix[r]?.[b.nameCol]);
      if (!name) continue;
      rows.push({
        name,
        badge: b.badgeCol == null ? "" : cellText(matrix[r]?.[b.badgeCol]),
        cells: days.map((_, i) => cellText(matrix[r]?.[b.dayStartCol + i])),
      });
    }
    return { days, rows };
  };

  if (step === "codes") {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onCancel();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {unknown.length} code{unknown.length === 1 ? "" : "s"} in this file aren&apos;t in the{" "}
              {area} code list. Tell us what each one means.
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-3 overflow-auto">
            {unknown.map((u) => (
              <div
                key={u.code}
                className="grid gap-2 sm:grid-cols-[1fr_220px] items-center rounded-md border p-3"
              >
                <div>
                  <div className="font-medium text-sm">
                    {u.code} <span className="text-muted-foreground">· {u.count} cells</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{u.samples.join(" · ")}</div>
                </div>
                <Select
                  value={codeMap[u.code.toUpperCase()] ?? ""}
                  onValueChange={(v) => setCodeMap((m) => ({ ...m, [u.code.toUpperCase()]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a meaning" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VAC">Vacation</SelectItem>
                    <SelectItem value="OFF">Off</SelectItem>
                    <SelectItem value="SICK">Sick</SelectItem>
                    <SelectItem value="PAT">Paternity</SelectItem>
                    <SelectItem value="SKIP">Skip these cells</SelectItem>
                    {codes.map((c) => (
                      <SelectItem key={c.id} value={c.code}>
                        {c.code}
                        {c.unit ? ` — ${c.unit}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={rememberProfile}
              onCheckedChange={(v) => setRememberProfile(v === true)}
            />
            Remember these mappings for {area}
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("map")}>
              Back
            </Button>
            <Button
              disabled={unknown.some((u) => !codeMap[u.code.toUpperCase()])}
              onClick={() => void finish({})}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (profileMatched && !reviewing) {
    return (
      <Dialog
        open
        onOpenChange={(o) => {
          if (!o) onCancel();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm import mapping</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Matched your saved <span className="font-medium">{profileMatched}</span> ·{" "}
            <button className="underline" onClick={() => setReviewing(true)}>
              Review mapping
            </button>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={continueFromMapping}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm import mapping</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
          {warnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Sheet</Label>
              <Select value={sheetName} onValueChange={setSheetName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {input.workbook.sheetNames.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {blocks.map((b) => {
            const { days, rows } = preview(b);
            return (
              <div key={b.id} className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    Rows {b.firstDataRow + 1}–{b.lastDataRow + 1}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Day columns {colLetter(b.dayStartCol)} …{" "}
                    {colLetter(b.dayStartCol + b.dayCount - 1)} · {b.dayCount} days
                    <Chip level={b.confidence.days} />
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label className="text-xs">
                      This grid is
                      <Chip level={b.confidence.layer} />
                    </Label>
                    <Select
                      value={b.layer}
                      onValueChange={(v) => patch(b.id, { layer: v as "day" | "night" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="night">Night</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">
                      Name column
                      <Chip level={b.confidence.name} />
                    </Label>
                    <Select
                      value={String(b.nameCol)}
                      onValueChange={(v) => patch(b.id, { nameCol: Number(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {columnOptions(b).map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">
                      Badge column
                      <Chip level={b.confidence.badge} />
                    </Label>
                    <Select
                      value={b.badgeCol == null ? "none" : String(b.badgeCol)}
                      onValueChange={(v) =>
                        patch(b.id, { badgeCol: v === "none" ? null : Number(v) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (match on name)</SelectItem>
                        {columnOptions(b).map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">First day column</Label>
                    <Input
                      value={colLetter(b.dayStartCol)}
                      onChange={(e) => {
                        const letters = e.target.value
                          .trim()
                          .toUpperCase()
                          .replace(/[^A-Z]/g, "");
                        if (!letters) return;
                        let n = 0;
                        for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
                        patch(b.id, { dayStartCol: n - 1 });
                      }}
                    />
                  </div>

                  <div>
                    <Label className="text-xs">Rows</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={b.firstDataRow + 1}
                        onChange={(e) =>
                          patch(b.id, { firstDataRow: Math.max(0, Number(e.target.value) - 1) })
                        }
                      />
                      <Input
                        type="number"
                        value={b.lastDataRow + 1}
                        onChange={(e) =>
                          patch(b.id, { lastDataRow: Math.max(0, Number(e.target.value) - 1) })
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">
                      Month
                      <Chip level={b.confidence.month} />
                    </Label>
                    <Input
                      type="month"
                      value={`${b.year}-${String(b.month + 1).padStart(2, "0")}`}
                      onChange={(e) => {
                        const [y, m] = e.target.value.split("-").map(Number);
                        if (!y || !m) return;
                        setTouchedMonth((t) => ({ ...t, [b.id]: true }));
                        patch(b.id, { year: y, month: m - 1 });
                      }}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {SOURCE_TEXT[b.monthSource]}
                    </p>
                  </div>
                </div>

                <div className="overflow-auto rounded border">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="p-1 text-left">Name</th>
                        <th className="p-1 text-left">Badge</th>
                        {days.map((d) => (
                          <th key={d.toISOString()} className="p-1">
                            {toISODate(d).slice(5)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-1">{r.name}</td>
                          <td className="p-1">{r.badge}</td>
                          {r.cells.map((c, ci) => (
                            <td key={ci} className="p-1 text-center">
                              {c || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Codes are read from {codesForLayer(codes, b.layer).length} {b.layer} assignment
                  codes for {area}.
                </p>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <label className="mr-auto flex items-center gap-2 text-xs">
            <Checkbox
              checked={rememberProfile}
              onCheckedChange={(v) => setRememberProfile(v === true)}
            />
            Remember this mapping for {area}
          </label>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={continueFromMapping} disabled={blocks.length === 0 || monthBlocked}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
