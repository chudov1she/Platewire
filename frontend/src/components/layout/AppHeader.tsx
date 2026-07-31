"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DesktopNav } from "@/components/layout/DesktopNav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { copy } from "@/lib/copy";

export function AppHeader({ statusSlot }: { statusSlot?: ReactNode }) {
  const { user, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="app-header hidden border-b border-border md:block">
      <div className="app-container px-6 py-3">
        <div className="flex flex-wrap items-center gap-3 gap-y-2">
          <Link
            className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary"
            href="/"
          >
            {copy.brand}
          </Link>
          <DesktopNav />
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-transparent px-3 text-xs text-muted-foreground hover:bg-muted"
                  type="button"
                >
                  {user.login}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onClick={() => router.push("/settings")}>
                    {copy.nav.settings}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logout()}
                    variant="destructive"
                  >
                    {copy.nav.logout}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {statusSlot ? <div className="mt-3">{statusSlot}</div> : null}
      </div>
    </header>
  );
}
