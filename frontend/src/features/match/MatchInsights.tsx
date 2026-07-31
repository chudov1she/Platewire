"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MatchContext } from "@/features/match/MatchContext";
import { MatchLedgerPanel } from "@/features/match/MatchLedgerPanel";
import { MatchSavant } from "@/features/match/MatchSavant";
import { MatchWeather } from "@/features/match/MatchWeather";
import { cn } from "@/lib/utils";
import type { NestLedgerEntry } from "@/types";

type TabId = "lineups" | "savant" | "weather" | "ledger";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "lineups", label: "Составы" },
  { id: "savant", label: "Savant / Statcast" },
  { id: "weather", label: "Погода" },
  { id: "ledger", label: "Журнал матча" },
];

export function MatchInsights({
  gameId,
  ledgerEntries,
  onLedgerChanged,
}: {
  gameId: string;
  ledgerEntries: NestLedgerEntry[];
  onLedgerChanged?: () => void;
}) {
  const [tab, setTab] = useState<TabId>("lineups");

  return (
    <Card className="min-w-0 overflow-hidden border-border bg-card">
      <div className="grid grid-cols-2 gap-1 border-b border-border/80 bg-muted/20 p-1.5 sm:grid-cols-4" role="tablist">
        {TABS.map((t) => (
          <button
            className={cn(
              "rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
              tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={t.id}
            onClick={() => setTab(t.id)}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>
      <CardContent className="min-w-0 overflow-x-hidden pt-4">
        {tab === "lineups" ? <MatchContext gameId={gameId} /> : null}
        {tab === "savant" ? <MatchSavant gameId={gameId} /> : null}
        {tab === "weather" ? <MatchWeather gameId={gameId} /> : null}
        {tab === "ledger" ? <MatchLedgerPanel entries={ledgerEntries} gameId={gameId} onSettled={onLedgerChanged} /> : null}
      </CardContent>
    </Card>
  );
}
