import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  className
}: {
  status: string;
  className?: string;
}) {
  const normalized = status.toLowerCase();
  const label =
    normalized === "win"
      ? "WIN"
      : normalized === "lose" || normalized === "loss"
        ? "LOSE"
        : normalized === "push"
          ? "PUSH"
          : "Pending";

  return (
    <Badge
      className={cn(
        "rounded-md font-semibold uppercase",
        normalized === "win" && "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
        (normalized === "lose" || normalized === "loss") &&
          "border-destructive/40 bg-destructive/15 text-red-400",
        normalized === "push" && "border-amber-500/40 bg-amber-500/15 text-amber-400",
        !["win", "lose", "loss", "push"].includes(normalized) && "text-muted-foreground",
        className
      )}
      variant="outline"
    >
      {label}
    </Badge>
  );
}

export function StatPill({
  label,
  value,
  className
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-muted/30 px-3 py-2", className)}>
      <p className="ui-label">{label}</p>
      <p className="mt-1 font-mono text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

export function StatusPill({
  label,
  value,
  compact = false,
  className
}: {
  label: string;
  value: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("ui-stat", compact ? "px-2.5 py-2" : "", className)}>
      <span className="ui-label block">{label}</span>
      <strong className={cn("mt-0.5 block tabular-nums text-foreground", compact ? "text-sm" : "text-base")}>
        {value}
      </strong>
    </div>
  );
}
