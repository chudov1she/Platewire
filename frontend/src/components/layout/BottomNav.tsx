"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/components/layout/NavIcon";
import { isNavItemActive, PRIMARY_NAV } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Основная навигация" className="app-bottom-nav fixed inset-x-0 bottom-0 z-50 md:hidden">
      <div className="mx-auto w-full max-w-lg px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2">
        <ul className="app-bottom-nav-dock flex items-stretch gap-0.5 rounded-2xl border border-border bg-card/95 p-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {PRIMARY_NAV.map((item) => {
            const active = isNavItemActive(pathname, item);
            const label = item.shortLabel ?? item.label;
            return (
              <li className="min-w-0 flex-1" key={item.id}>
                <Link
                  className={cn(
                    "relative flex min-h-[3.35rem] flex-col items-center justify-center gap-1 rounded-[0.85rem] px-0.5 py-2 transition-[background-color,color] duration-150",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground active:bg-muted/60"
                  )}
                  href={item.to}
                >
                  {active ? (
                    <span aria-hidden className="absolute inset-x-2.5 top-1 h-0.5 rounded-full bg-primary" />
                  ) : null}
                  <NavIcon
                    className={cn("h-[1.35rem] w-[1.35rem]", active ? "opacity-100" : "opacity-80")}
                    name={item.icon}
                  />
                  <span
                    className={cn(
                      "max-w-full truncate text-[9px] leading-none tracking-[0.01em]",
                      active ? "font-bold" : "font-medium"
                    )}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
