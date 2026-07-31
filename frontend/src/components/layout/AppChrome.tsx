"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { NavIcon } from "@/components/layout/NavIcon";
import {
  DESKTOP_NAV,
  PRIMARY_NAV,
  SETTINGS_NAV,
  isNavItemActive,
  sectionTitle,
  type NavItem
} from "@/components/layout/nav-config";
import { useAuth } from "@/hooks/useAuth";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

type AppChromeProps = {
  statusSlot?: ReactNode;
  children: ReactNode;
};

/**
 * Sticky offset under the sticky header.
 * Header row ≈ 2.75rem + border; keep a small gap below it.
 */
const STICKY_TOP = "4rem";

const navActiveClass =
  "bg-emerald-500/15 font-semibold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300";
const navIdleClass =
  "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground";

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavItemActive(pathname, item);
  return (
    <Link
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors",
        active ? navActiveClass : navIdleClass
      )}
      href={item.to}
    >
      <NavIcon
        className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-70")}
        name={item.icon}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AppChrome({ statusSlot, children }: AppChromeProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const title = sectionTitle(pathname);
  const settingsActive = pathname.startsWith("/settings");

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2.5 sm:px-4">
          <Link
            className="shrink-0 font-mono text-[11px] font-black uppercase tracking-[0.16em] text-foreground"
            href="/"
          >
            {copy.brand}
          </Link>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
            {title}
          </p>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {user ? (
              <span
                className="hidden max-w-[8rem] truncate rounded-lg border border-border/80 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground sm:inline-block"
                title={user.displayName ?? user.login ?? user.telegramUsername ?? undefined}
              >
                {user.displayName ?? user.login ?? user.telegramUsername ?? "user"}
              </span>
            ) : null}
            {/* Settings in header only on mobile — desktop has it in the left rail */}
            <Link
              aria-label={copy.nav.settings}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors md:hidden",
                settingsActive
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              href="/settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
        </div>
        {statusSlot ? (
          <div className="mx-auto w-full max-w-6xl border-t border-border/60 px-3 py-2 sm:px-4">
            {statusSlot}
          </div>
        ) : null}
      </header>

      {/* Row grows with main content → left column is the rail sticky travels on */}
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 gap-4 px-3 py-3 sm:gap-5 sm:px-4 sm:py-5">
        {/* Rail: full content height. Compact nav card sticks and rides the rail. */}
        <div className="relative hidden w-[14.5rem] shrink-0 md:block">
          <div className="sticky z-30" style={{ top: STICKY_TOP } as CSSProperties}>
            <nav
              aria-label="Основная навигация"
              className="flex flex-col rounded-2xl border border-border/80 bg-card p-2"
            >
              <ul className="flex flex-col gap-0.5">
                {DESKTOP_NAV.map((item) => (
                  <li key={item.id}>
                    <NavLink item={item} pathname={pathname} />
                  </li>
                ))}
              </ul>
              <div aria-hidden className="my-2 border-t border-border/70" />
              <NavLink item={SETTINGS_NAV} pathname={pathname} />
            </nav>
          </div>
        </div>

        <main className="min-w-0 flex-1 pb-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          <div className="min-w-0 w-full max-w-full">{children}</div>
        </main>
      </div>

      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md md:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-6xl grid-cols-4 gap-1 px-2 py-1.5">
          {PRIMARY_NAV.map((item) => {
            const active = isNavItemActive(pathname, item);
            return (
              <li className="min-w-0" key={item.id}>
                <Link
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors",
                    active
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                  href={item.to}
                >
                  <NavIcon
                    className={cn("h-5 w-5 shrink-0", active ? "opacity-100" : "opacity-70")}
                    name={item.icon}
                  />
                  <span
                    className={cn(
                      "max-w-full truncate text-[11px] leading-none",
                      active ? "font-semibold" : "font-medium"
                    )}
                  >
                    {item.shortLabel ?? item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
