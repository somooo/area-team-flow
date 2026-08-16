import { cn } from "@/lib/utils";

export function KadirIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Center person */}
      <circle cx="12" cy="7" r="3" />
      <path d="M7.5 17.5v-1a4.5 4.5 0 0 1 9 0v1" />
      {/* Left person */}
      <circle cx="4.75" cy="9.25" r="2" />
      <path d="M4 17v-1.5a3.5 3.5 0 0 1 1.4-2.8" />
      {/* Right person */}
      <circle cx="19.25" cy="9.25" r="2" />
      <path d="M20 17v-1.5a3.5 3.5 0 0 0-1.4-2.8" />
    </svg>
  );
}

export function KadirIconTile({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-2xl bg-ink-tile",
        className,
      )}
    >
      <KadirIcon className={cn("text-steel", iconClassName)} />
    </span>
  );
}

export function KadirArabic({ className }: { className?: string }) {
  return (
    <span lang="ar" dir="rtl" className={cn("font-arabic text-steel leading-none", className)}>
      كادر
    </span>
  );
}

export function KadirLogo({
  className,
  size = "md",
  showTagline = true,
  showArabic = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  showArabic?: boolean;
}) {
  const word = size === "lg" ? "text-3xl" : size === "md" ? "text-xl" : "text-base";
  const tag = size === "lg" ? "text-[11px]" : "text-[9px]";
  const tile = size === "lg" ? "h-16 w-16" : size === "md" ? "h-8 w-8" : "h-7 w-7";
  const icon = size === "lg" ? "h-8 w-8" : size === "md" ? "h-5 w-5" : "h-4 w-4";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <KadirIconTile className={tile} iconClassName={icon} />
      <div className="leading-none">
        <div className="flex items-baseline gap-2">
          <span className={cn("font-display font-bold uppercase tracking-[0.3em] text-foreground", word)}>
            Kadir
          </span>
          {showArabic && <KadirArabic className={size === "lg" ? "text-2xl" : "text-base"} />}
        </div>
        {showTagline && (
          <div className={cn("mt-1 uppercase tracking-[0.28em] text-bronze", tag)}>
            Staff Management
          </div>
        )}
      </div>
    </div>
  );
}