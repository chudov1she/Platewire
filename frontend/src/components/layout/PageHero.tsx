import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHero({
  eyebrow,
  title,
  description,
  stats,
  actions,
  className,
  compact = false
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  stats?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid gap-2 rounded-xl border border-border bg-card/80 sm:rounded-xl sm:gap-3 sm:border-border sm:bg-card sm:p-4",
        compact ? "p-3" : "p-4",
        stats || actions
          ? "max-sm:gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          : "",
        className
      )}
    >
      <div className="min-w-0 grid gap-1">
        <p className="ui-label sm:text-[11px]">{eyebrow}</p>
        <h2
          className={cn(
            "font-semibold tracking-[-0.03em] text-foreground",
            compact ? "text-base sm:text-xl" : "text-lg sm:text-2xl md:text-3xl"
          )}
        >
          {title}
        </h2>
        {description && (
          <div className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{description}</div>
        )}
      </div>
      {(stats || actions) && (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end sm:justify-end">
          {stats}
          {actions}
        </div>
      )}
    </section>
  );
}
