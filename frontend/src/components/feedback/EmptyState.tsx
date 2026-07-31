import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center",
        className
      )}
    >
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Что-то пошло не так",
  description,
  onRetry,
  className
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-4",
        className
      )}
      role="alert"
    >
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

export function PageSkeleton({ cards = 3, className }: { cards?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)}>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-muted/70" />
      <div className="game-cards-grid mt-2">
        {Array.from({ length: cards }).map((_, index) => (
          <div className="h-36 animate-pulse rounded-xl border border-border bg-muted/40" key={index} />
        ))}
      </div>
    </div>
  );
}
