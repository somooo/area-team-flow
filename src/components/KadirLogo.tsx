import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <UsersRound className={cn(icon, "text-primary")} strokeWidth={1.75} aria-hidden />
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