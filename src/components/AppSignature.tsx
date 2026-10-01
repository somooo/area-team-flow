import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KadirLogo } from "@/components/KadirLogo";
import bfMonogram from "@/assets/bf-monogram.png.asset.json";

const OWNER = "Bsmah Alfayez";
const YEAR = new Date().getFullYear();

/** Personal monogram of the app's creator. The artwork is solid black on a
 * transparent background, so it is inverted on dark surfaces to stay legible. */
export function BFMonogram({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <img
      src={bfMonogram.url}
      alt={`${OWNER} monogram`}
      className={cn(
        "shrink-0 object-contain select-none",
        tone === "dark" && "invert",
        className,
      )}
      draggable={false}
    />
  );
}

/** Discreet creator signature with an ownership / system-information dialog. */
export function AppSignature({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-2.5 rounded-full px-3 py-1.5 transition-colors",
            tone === "dark"
              ? "text-bone/60 hover:text-bone"
              : "text-muted-foreground hover:text-foreground hover:bg-steel-100",
            className,
          )}
          aria-label="System information and ownership"
        >
          <BFMonogram className="h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100" tone={tone} />
          <span className="text-[11px] uppercase tracking-[0.18em]">
            Designed &amp; developed by <span className="font-semibold">{OWNER}</span>
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="sr-only">System information and ownership</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 border-b pb-5">
            <KadirLogo size="sm" />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border bg-card">
              <BFMonogram className="h-9 w-9" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Creator &amp; System Architect
              </div>
              <div className="font-display text-lg font-semibold tracking-wide">{OWNER}</div>
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">System</dt>
            <dd>Clinical Roster &amp; Operations Platform</dd>
            <dt className="text-muted-foreground">Edition</dt>
            <dd>KADIR v1.0</dd>
            <dt className="text-muted-foreground">Domain</dt>
            <dd>kadir-app.com</dd>
          </dl>

          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Intellectual property notice
            </div>
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              © {YEAR} {OWNER}. All rights reserved. The design, workflows, scheduling
              logic, data architecture and interfaces of this system are the proprietary
              work of {OWNER}. Copying, modification, redistribution or deployment
              without prior written permission is prohibited.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
