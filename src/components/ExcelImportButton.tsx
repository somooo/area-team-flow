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
  /** Badge / identifier shown in the preview. */
  badge?: string;
  /** Resolved area shown in the preview. */
  area?: string;
  /** Non-blocking note shown under the row. */
  warning?: string;
  payload?: P;
};

export type ParseInput = {
  rows: Record<string, unknown>[];
  matrix: unknown[][];
  file: File;
  /** All sheets, cell types preserved — used by adaptive layout detection. */
  workbook: { sheetNames: string[]; sheets: Record<string, unknown[][]> };
  /** State of the importer's toggle checkboxes, keyed by toggle key. */
  toggles: Record<string, boolean>;
};

export type CommitOptions = {
  replace: boolean;
  setProgress: (text: string | null) => void;
};

export type CommitReport = {
  /** Rows the commit tried to write. */
  attempted?: number;
  /** Rows the database reported as written/updated. */
  written: number;
  /** Rows re-queried from the table after the write — the trustworthy number. */
  confirmed?: number;
  /** One human-readable line per failed row, including badge and the real error text. */
  failures: string[];
  /** Extra confirmation line shown in the result panel (e.g. the date range re-queried). */
  note?: string;
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
  toggles,
}: {
  title: string;
  buttonLabel?: string;
  description?: string;
  parse: (input: ParseInput, config?: C) => Promise<ImportItem<P>[]>;
  commit: (
    items: ImportItem<P>[],
    options: CommitOptions,
  ) => Promise<void | CommitReport>;
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
  replaceOption?: {
    label: string;
    description: string;
    mergeLabel?: string;
    mergeDescription?: string;
    /** Extra detail shown when Replace is selected, e.g. who will be removed. */
    extra?: ReactNode;
  };
  /** Extra line above the preview table, e.g. "12 label rows skipped". */
  extraSummary?: (items: ImportItem<P>[]) => ReactNode;
  /** Checkboxes that change how the file is parsed; toggling re-runs the parse. */
  toggles?: { key: string; label: string; description?: string }[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportItem<P>[] | null>(null);
  const [configInput, setConfigInput] = useState<ParseInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<
    { attempted: number; committed: number; confirmed: number | null; skipped: number; failures: string[]; note?: string } | null
  >(null);
  const [toggleState, setToggleState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((toggles ?? []).map((t) => [t.key, false])),
  );
  const [lastInput, setLastInput] = useState<ParseInput | null>(null);

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
      const input: ParseInput = { rows, matrix, file, workbook, toggles: toggleState };
      setLastInput(input);
      setReplace(false);
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
      const result = await commit(applicable, { replace: destructive, setProgress });
      const failures = result?.failures ?? [];
      const written = result?.written ?? applicable.length;
      const confirmed = result?.confirmed ?? null;
      const committedForReal = confirmed ?? written;
      // Never report success when nothing actually landed in the table.
      if (committedForReal === 0) {
        throw new Error(
          failures.length > 0
            ? `0 of ${applicable.length} rows were written.\n${failures.slice(0, 5).join("\n")}`
            : `0 of ${applicable.length} rows were written. The database accepted the request but stored nothing.`,
        );
      }
      setDone({
        attempted: result?.attempted ?? applicable.length,
        committed: written,
        confirmed,
        skipped: skipped.length,
        failures,
        note: result?.note,
      });
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
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {replaceOption && (
              <div className="space-y-2">
                {([false, true] as const).map((mode) => (
                  <label
                    key={String(mode)}
                    className={`flex cursor-pointer gap-2 items-start rounded-md border p-3 text-xs ${
                      replace === mode ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="import-mode"
                      className="mt-0.5"
                      checked={replace === mode}
                      onChange={() => setReplace(mode)}
                    />
                    <span>
                      <span className="font-medium block">
                        {mode
                          ? replaceOption.label
                          : (replaceOption.mergeLabel ?? "Merge — keep everyone already on the schedule")}
                      </span>
                      <span className="text-muted-foreground">
                        {mode
                          ? replaceOption.description
                          : (replaceOption.mergeDescription ??
                            "Adds the new staff and overwrites only the dates present in the file.")}
                      </span>
                      {mode && replace && replaceOption.extra}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {(toggles ?? []).map((t) => (
              <label key={t.key} className="flex gap-2 items-start rounded-md border p-3 text-xs">
                <Checkbox
                  checked={!!toggleState[t.key]}
                  disabled={busy}
                  onCheckedChange={(v) => {
                    const next = { ...toggleState, [t.key]: v === true };
                    setToggleState(next);
                    if (lastInput) {
                      const input = { ...lastInput, toggles: next };
                      setLastInput(input);
                      void runParse(input);
                    }
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium block">{t.label}</span>
                  {t.description && <span className="text-muted-foreground">{t.description}</span>}
                </span>
              </label>
            ))}
            {extraSummary?.(items ?? [])}
            {skipped.length > 0 && (
              <div className="rounded-md border p-2 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Skipped rows by reason</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => {
                      const text = skipped
                        .map((i) => [i.badge ?? "", i.label, i.area ?? "", i.change, i.reason ?? ""].join("\t"))
                        .join("\n");
                      void navigator.clipboard.writeText(text);
                      toast.success(`Copied ${skipped.length} skipped row${skipped.length === 1 ? "" : "s"}`);
                    }}
                  >
                    Copy skipped rows
                  </Button>
                </div>
                {Object.entries(
                  skipped.reduce<Record<string, number>>((acc, i) => {
                    const key = i.reason ?? "Skipped";
                    const bucket = /not found in staff directory/.test(key) ? "Badge not found in staff directory" : key;
                    acc[bucket] = (acc[bucket] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([reason, count]) => (
                  <div key={reason} className="flex justify-between text-muted-foreground">
                    <span>{reason}</span>
                    <span>{count}</span>
                  </div>
                ))}
              </div>
            )}
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
                    <th className="p-2">Badge</th>
                    <th className="p-2">Row</th>
                    <th className="p-2">Area</th>
                    <th className="p-2">Change</th>
                    <th className="p-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).slice(0, 400).map((i) => (
                    <tr key={i.id} className="border-t align-top">
                      <td className="p-2 tabular-nums">{i.badge ?? "—"}</td>
                      <td className="p-2 font-medium">
                        {i.label}
                        {i.warning && (
                          <span className="block font-normal text-[11px] text-copper-700">{i.warning}</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground">{i.area ?? "—"}</td>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(done?.failures.length ?? 0) > 0 ? "Import finished with errors" : "Import complete"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows attempted</span>
              <span className="font-semibold">{done?.attempted ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows written</span>
              <span className="font-semibold">{done?.committed ?? 0}</span>
            </div>
            {done?.confirmed != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Confirmed in database</span>
                <span className="font-semibold">{done.confirmed}</span>
              </div>
            )}
            {done?.note && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">{done.note}</div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows skipped</span>
              <span className="font-semibold">{done?.skipped ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rows failed</span>
              <span className="font-semibold">{done?.failures.length ?? 0}</span>
            </div>
            {(done?.failures.length ?? 0) > 0 && (
              <div className="mt-2 max-h-48 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <div className="font-medium">{done?.failures.length} row(s) failed</div>
                {done?.failures.map((f, idx) => <div key={idx}>{f}</div>)}
              </div>
            )}
          </div>
          <DialogFooter>
            {(done?.failures.length ?? 0) > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText((done?.failures ?? []).join("\n"));
                  toast.success("Copied failed rows");
                }}
              >
                Copy errors
              </Button>
            )}
            <Button onClick={() => setDone(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
