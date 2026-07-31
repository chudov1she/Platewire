"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/page-loader";
import { loadGameSavant, loadGameStatcast, refreshGameSavant } from "@/lib/api";
import type { NestSavantLineupRow, NestSavantPitcher, NestSavantResponse, NestStatcastResponse } from "@/types";

function PitcherRow({ p }: { p: NestSavantPitcher }) {
  return (
    <li className="min-w-0 border-b border-border/60 py-1.5 text-xs last:border-0">
      <p className="truncate font-medium">{p.full_name ?? p.mlb_player_id ?? "—"}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
        <span>ERA {p.era ?? "—"}</span>
        <span>WHIP {p.whip ?? "—"}</span>
        <span>xwOBA {p.xwoba ?? "—"}</span>
        <span>GS {p.games_started ?? "—"}</span>
        <span>FF {p.ff_avg_speed ?? "—"}mph</span>
      </p>
    </li>
  );
}

function LineupList({ rows }: { rows: NestSavantLineupRow[] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">нет данных</p>;
  return (
    <ul className="grid gap-0.5">
      {rows.map((r) => (
        <li className="min-w-0 border-b border-border/60 py-1.5 text-xs last:border-0" key={`${r.side}-${r.batting_order}-${r.mlb_player_id}`}>
          <p className="truncate">
            {r.batting_order}. {r.full_name ?? r.mlb_player_id}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
            <span>xwOBA {r.xwoba ?? "—"}</span>
            <span>xSLG {r.xslg ?? "—"}</span>
            <span>Barrel% {r.barrel_batted_rate ?? "—"}</span>
            <span>HardHit% {r.hard_hit_percent ?? "—"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MatchSavant({ gameId }: { gameId: string }) {
  const [preview, setPreview] = useState<NestSavantResponse | null>(null);
  const [statcast, setStatcast] = useState<NestStatcastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFeed, setShowFeed] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([loadGameSavant(gameId), loadGameStatcast(gameId, { limit: 100 }).catch(() => null)]);
      setPreview(p);
      setStatcast(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Savant");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshGameSavant(gameId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить Savant");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <InlineLoader label="Savant" />;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2 text-xs">
          {preview ? (
            <>
              <Badge variant={preview.ok ? "outline" : "secondary"}>{preview.ok ? "ok" : preview.error ?? "нет данных"}</Badge>
              <Badge variant={preview.has_lineup ? "outline" : "secondary"}>{preview.has_lineup ? "составы есть" : "составов нет"}</Badge>
              {preview.gamefeed ? <Badge variant="outline">gamefeed: {preview.gamefeed.game_status}</Badge> : null}
            </>
          ) : null}
        </div>
        <Button className="shrink-0" disabled={refreshing} onClick={() => void onRefresh()} size="sm" type="button" variant="outline">
          {refreshing ? "…" : "Обновить"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {preview ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Away pitchers</p>
            <ul>
              {preview.away.pitchers.map((p, i) => (
                <PitcherRow key={i} p={p} />
              ))}
            </ul>
            <p className="mb-1 mt-2 text-[11px] font-semibold uppercase text-muted-foreground">Away lineup</p>
            <LineupList rows={preview.away.lineup} />
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Home pitchers</p>
            <ul>
              {preview.home.pitchers.map((p, i) => (
                <PitcherRow key={i} p={p} />
              ))}
            </ul>
            <p className="mb-1 mt-2 text-[11px] font-semibold uppercase text-muted-foreground">Home lineup</p>
            <LineupList rows={preview.home.lineup} />
          </div>
        </div>
      ) : null}

      {preview?.gamefeed ? (
        <div>
          <button className="text-xs text-primary underline" onClick={() => setShowFeed((v) => !v)} type="button">
            {showFeed ? "Скрыть" : "Показать"} gamefeed (scoreboard/stats/top performers)
          </button>
          {showFeed ? (
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-muted/20 p-2 text-[11px]">
              {JSON.stringify(preview.gamefeed, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Statcast pitch log {statcast ? `(${statcast.total})` : ""}</p>
        {statcast?.pitches.length ? (
          <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="bg-muted/40">
                <tr>
                  {["Inn", "Count", "Pitch", "Result", "MPH", "EV", "LA", "xBA", "xwOBA"].map((h) => (
                    <th className="whitespace-nowrap px-2 py-1.5 font-semibold uppercase text-muted-foreground" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statcast.pitches.slice(0, 60).map((p, i) => (
                  <tr className="border-t border-border" key={i}>
                    <td className="px-2 py-1">
                      {p.inning_half === "top" ? "▲" : p.inning_half === "bottom" ? "▼" : ""}
                      {p.inning ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {p.balls ?? 0}-{p.strikes ?? 0}, {p.outs ?? 0} out
                    </td>
                    <td className="px-2 py-1">{p.pitch_name ?? p.pitch_type ?? "—"}</td>
                    <td className="px-2 py-1">{p.events ?? p.description ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{p.release_speed ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{p.launch_speed ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{p.launch_angle ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{p.estimated_ba ?? "—"}</td>
                    <td className="px-2 py-1 font-mono">{p.estimated_woba ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Нет данных Statcast.</p>
        )}
      </div>
    </div>
  );
}
