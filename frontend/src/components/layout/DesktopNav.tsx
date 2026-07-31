"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, PRIMARY_NAV } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация" className="hidden flex-wrap items-center gap-2 md:flex">
      {PRIMARY_NAV.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            className={cn(
              "inline-flex h-10 items-center rounded-lg border px-4 text-sm font-bold transition-colors",
              active
                ? "border-primary/40 bg-primary text-primary-foreground"
                : "border-border bg-muted/40 text-foreground hover:border-emerald-500/50 hover:bg-emerald-500/10"
            )}
            href={item.to}
            key={item.id}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
