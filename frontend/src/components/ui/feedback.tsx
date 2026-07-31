import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoticeError({
  children,
  message,
  className,
}: {
  children?: ReactNode;
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("ui-notice ui-notice-error", className)} role="alert">
      {message ?? children}
    </div>
  );
}

export function NoticeLoading({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-busy
      className={cn(
        "ui-notice ui-notice-loading flex items-center gap-2.5",
        className
      )}
      role="status"
    >
      <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
      {children ? <span>{children}</span> : <span className="sr-only">Загрузка</span>}
    </div>
  );
}

export function NoticeSuccess({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui-notice ui-notice-success", className)} role="status">
      {children}
    </div>
  );
}

export function NoticeWarn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui-notice ui-notice-warn", className)} role="note">
      {children}
    </div>
  );
}
