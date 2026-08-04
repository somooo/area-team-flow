import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { readSheet } from "@/lib/xlsx-io";

export type ImportStatus = "add" | "update" | "skip";

export type ImportItem<P = unknown> = {
  id: string;
  /** Row subject, e.g. the staff name. */
  label: string;
  /** What will change, e.g. "2026-03-01 → 2026-03-05" or "D6 → VAC". */
  change: string;
  status: ImportStatus;
  /** Why the row is skipped. */
  reason?: string;
  payload?: P;
};

export type ParseInput = { rows: Record<string, unknown>[]; matrix: unknown[][]; file: File };

/**
 * One shared import flow for every Excel import in the app:
 * pick file → parse → validate → preview diff/summary → confirm → commit.
 */
export function ExcelImportButton<P>({
  title,
  buttonLabel = "Import from Excel",
  description,
  parse,
  commit,
  disabled,
  sheetName,
  size = "sm",
  variant = "outline",
  onDone,
}: {
  title: string;
  buttonLabel?: string;
  description?: string;
  parse: (input: ParseInput) => Promise<ImportItem<P>[]>;
  commit: (items: ImportItem<P>[]) => Promise<void>;
  disabled?: boolean;
  /** Read only this sheet (case-insensitive) instead of the first one. */
  sheetName?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  onDone?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem<P>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ committed: number; skipped: number } | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const { rows, matrix } = await readSheet(file, sheetName ? { sheetName } : undefined);
      const parsed = await parse({ rows, matrix, file });
      if (parsed.length === 0) { toast.error("Nothing to import from this file"); return; }
      setDone(null);
      setItems(parsed);
    } catch (e) {
      toast.error(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const applicable = (items ?? []).filter((i) => i.status !== "skip");
  const skipped = (items ?? []).filter((i) => i.status === "skip");

  const confirm = async () => {
    if (!items) return;
    setBusy(true);
    try {
      await commit(applicable);
      setDone({ committed: applicable.length, skipped: skipped.length });
      setItems(null);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      <Button size={size} variant={variant} disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
        {buttonLabel}
      </Button>

      <Dialog open={!!items} onOpenChange={(o) => { if (!o) setItems(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="default">{applicable.filter((i) => i.status === "add").length} to add</Badge>
              <Badge variant="secondary">{applicable.filter((i) => i.status === "update").length} to update</Badge>
              <Badge variant="outline">{skipped.length} skipped</Badge>
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left">
                    <th className="p-2">Row</th><th className="p-2">Change</th><th className="p-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).map((i) => (
                    <tr key={i.id} className="border-t align-top">
                      <td className="p-2 font-medium">{i.label}</td>
                      <td className="p-2 text-muted-foreground">{i.change}</td>
                      <td className="p-2">
                        {i.status === "skip"
                          ? <span className="text-destructive">Skipped — {i.reason}</span>
                          : <span className="capitalize">{i.status}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItems(null)} disabled={busy}>Cancel</Button>
            <Button onClick={confirm} disabled={busy || applicable.length === 0}>
              Confirm {applicable.length} change{applicable.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!done} onOpenChange={(o) => { if (!o) setDone(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Import complete</DialogTitle></DialogHeader>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Rows applied</span><span className="font-semibold">{done?.committed ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Rows skipped</span><span className="font-semibold">{done?.skipped ?? 0}</span></div>
          </div>
          <DialogFooter><Button onClick={() => setDone(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}