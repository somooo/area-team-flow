import { cn } from "@/lib/utils";
import kadirBrand from "@/assets/kadir-brand.webp.asset.json";

/** The supplied KADIR artwork, shared by every staff view and sign-in. */
export function KadirLogo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <img
      src={kadirBrand.url}
      alt="KADIR — healthcare staff"
      className={cn(
        "block shrink-0 object-contain",
        size === "lg" ? "h-44 w-auto" : size === "sm" ? "h-16 w-auto" : "h-24 w-auto max-sm:h-20",
        className,
      )}
    />
  );
}