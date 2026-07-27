import { cn } from "@/lib/utils";

export function KadirIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Left person */}
      <circle cx="6" cy="7" r="2.5" />
      <path d="M3.5 15c0-2.5 1-4.5 2.5-4.5s2.5 2 2.5 4.5" />
      {/* Center person */}
      <circle cx="12" cy="5" r="2.5" />
      <path d="M8.5 17c0-3 1.5-5.5 3.5-5.5s3.5 2.5 3.5 5.5" />
      {/* Right person */}
      <circle cx="18" cy="7" r="2.5" />
      <path d="M15.5 15c0-2.5 1-4.5 2.5-4.5s2.5 2 2.5 4.5" />
    </svg>
  );
}

export function KadirLogo({
  className,
  size = "md",
  showTagline = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}) {
  const icon = size === "lg" ? "h-8 w-8" : size === "md" ? "h-6 w-6" : "h-5 w-5";
  const word = size === "lg" ? "text-3xl" : size === "md" ? "text-xl" : "text-base";
  const tag = size === "lg" ? "text-[11px]" : "text-[9px]";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <KadirIcon className={cn(icon, "text-primary")} />
      <div className="leading-none">
        <div className={cn("font-display font-semibold uppercase tracking-[0.22em] text-foreground", word)}>
          Kadir
        </div>
        {showTagline && (
          <div className={cn("mt-1 uppercase tracking-[0.28em] text-muted-foreground", tag)}>
            Staff Management
          </div>
        )}
      </div>
    </div>
  );
}