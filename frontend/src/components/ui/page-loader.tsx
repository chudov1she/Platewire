import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type LoaderProps = {
  label?: ReactNode;
  className?: string;
};

/** Centered page/section spinner. */
export function PageLoader({ label, className }: LoaderProps) {
  return (
    <div
      aria-busy
      className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}
      role="status"
    >
      <Loader2 aria-hidden className="h-7 w-7 animate-spin text-muted-foreground" />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : null}
      <span className="sr-only">{typeof label === "string" ? label : "Загрузка"}</span>
    </div>
  );
}

/** Compact inline spinner for panels. */
export function InlineLoader({ label, className }: LoaderProps) {
  return (
    <div
      aria-busy
      className={cn("flex items-center gap-2 py-1 text-sm text-muted-foreground", className)}
      role="status"
    >
      <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
      {label ? <span>{label}</span> : <span className="sr-only">Загрузка</span>}
    </div>
  );
}
