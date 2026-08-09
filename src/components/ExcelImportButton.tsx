import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { readSheet, readWorkbook } from "@/lib/xlsx-io";

export type ImportStatus = "add" | "update" | "skip";

export type ImportItem<P = unknown> = {
  id: string;
  /** Row subject, e.g. the staff name. */
  label: string;
  /** What will change, e.g. "2026-03-01 → 2026-03-05" or "D6 → V". */
  change: string;
  status: ImportStatus;
  /** Why the row is skipped. */
  reason?: string;
  payload?: P;
};

export type ParseInput = {
  rows: Record<string, unknown>[];
  matrix: unknown[][];
  file: File;
  /** All sheets, cell types preserved — used by adaptive layout detection. */
  workbook: { sheetNames: string[]; sheets: Record<string, unknown[][]> };
};

export type CommitOptions = {
  replace: boolean;
  setProgress: (text: string | null) => void;
};

/**
 * One shared import flow for every Excel import in the app:
 * pick file → (optional mapping step) → parse → validate → preview diff → confirm → commit.
 */
export function ExcelImportButton<P, C = unknown>({
  title,
  buttonLabel = "Import from Excel",
  description,
  parse,
  commit,
  disabled,
  size = "sm",
  variant = "outline",
  onDone,
  configure,
  replaceOption,
  extraSummary,
}: {
  title: string;
  buttonLabel?: string;
  description?: string;
  parse: (input: ParseInput, config?: C) => Promise<ImportItem<P>[]>;
  commit: (items: ImportItem<P>[], options: CommitOptions) => Promise<void>;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  onDone?: () => void;
  /** Renders a mapping-confirmation step between reading the file and the diff preview. */
  configure?: (args: {
    input: ParseInput;
    onConfirm: (config: C) => void;
    onCancel: () => void;
  }) => ReactNode;
  /** Shows a "remove all data before importing" checkbox above the preview. */
  replaceOption?: { label: string; description: string };
  /** Extra line above the preview table, e.g. "12 label rows skipped". */
  extraSummary?: (items: ImportItem<P>[]) => ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem<P>[] | null>(null);
  const [configInput, setConfigInput] = useState<ParseInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ committed: number; skipped: number } | null>(null);

  const runParse = async (input: ParseInput, config?: C) => {
    setBusy(true);
    try {
      const parsed = await parse(input, config);
      if (parsed.length === 0) {
        toast.error("Nothing to import from this file");
        return;
      }
      setDone(null);
      setItems(parsed);
    } catch (e) {
      toast.error(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const [{ rows, matrix }, workbook] = await Promise.all([readSheet(file), readWorkbook(file)]);
      const input: ParseInput = { rows, matrix, file, workbook };
      setReplace(true);
      if (configure) {
        setConfigInput(input);
        return;
      }
      await runParse(input);
    } catch (e) {
      toast.error(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const applicable = (items ?? []).filter((i) => i.status !== "skip");
  const skipped = (items ?? []).filter((i) => i.status === "skip");
  const destructive = !!replaceOption && replace;

  const runCommit = async () => {
    if (!items) return;
    setBusy(true);
    setFailure(null);
    try {
      await commit(applicable, { replace: destructive, setProgress });
      setDone({ committed: applicable.length, skipped: skipped.length });
      setItems(null);
      setConfirmDestructive(false);
      onDone?.();
    } catch (e) {
      console.error("[import] commit failed", e);
      const message = e instanceof Error ? e.message : String(e);
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const confirm = () => {
    if (destructive) {
      setConfirmDestructive(true);
      return;
    }
    void runCommit();
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
      <Button
        size={size}
        variant={variant}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {buttonLabel}
      </Button>

      {configInput &&
        configure?.({
          input: configInput,
          onCancel: () => setConfigInput(null),
          onConfirm: (config) => {
            setConfigInput(null);
            void runParse(configInput, config);
          },
        })}

      <Dialog
        open={!!items}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setItems(null);
            setFailure(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {replaceOption && (
              <label className="flex gap-2 items-start rounded-md border p-3 text-xs">
                <Checkbox
                  checked={replace}
                  onCheckedChange={(v) => setReplace(v === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium block">{replaceOption.label}</span>
                  <span className="text-muted-foreground">{replaceOption.description}</span>
                </span>
              </label>
            )}
            {extraSummary?.(items ?? [])}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="default">
                {applicable.filter((i) => i.status === "add").length} to add
              </Badge>
              <Badge variant="secondary">
                {applicable.filter((i) => i.status === "update").length} to update
              </Badge>
              <Badge variant="outline">{skipped.length} skipped</Badge>
            </div>
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60">
                  <tr className="text-left">
                    <th className="p-2">Row</th>
                    <th className="p-2">Change</th>
                    <th className="p-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).slice(0, 400).map((i) => (
                    <tr key={i.id} className="border-t align-top">
                      <td className="p-2 font-medium">{i.label}</td>
                      <td className="p-2 text-muted-foreground">{i.change}</td>
                      <td className="p-2">
                        {i.status === "skip" ? (
                          <span className="text-destructive">Skipped — {i.reason}</span>
                        ) : (
                          <span className="capitalize">{i.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(items ?? []).length > 400 && (
                <div className="p-2 text-xs text-muted-foreground">
                  …and {(items ?? []).length - 400} more rows
                </div>
              )}
            </div>
            {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
            {failure && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                Import failed: {failure}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setItems(null);
                setFailure(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={confirm} disabled={busy || applicable.length === 0}>
              {failure ? "Retry" : `Confirm ${applicable.length} change${applicable.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDestructive}
        onOpenChange={(o) => {
          if (!o && !busy) setConfirmDestructive(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>This will delete existing data</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{replaceOption?.description}</p>
          <p className="text-sm font-medium">
            {applicable.length} cells will be written afterwards.
          </p>
          {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
          {failure && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              Import failed: {failure}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDestructive(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void runCommit()} disabled={busy}>
              {failure ? "Retry" : "Delete and import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!done}
        onOpenChange={(o) => {
          if (!o) setDone(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Import complete</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows applied</span>
              <span className="font-semibold">{done?.committed ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows skipped</span>
              <span className="font-semibold">{done?.skipped ?? 0}</span>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setDone(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
