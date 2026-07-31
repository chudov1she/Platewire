"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeError } from "@/components/ui/feedback";
import { PageLoader } from "@/components/ui/page-loader";
import { PageHero } from "@/components/layout/PageHero";
import { ApiError, loadPlayerFeatures, loadPlayerSavant } from "@/lib/api";
import type { NestPlayerFeaturesResponse } from "@/types";

function Stat({ label, value, digits = 3 }: { label: string; value: number | null | undefined; digits?: number }) {
  return (
    <div className="rounded bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div>{value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits)}</div>
    </div>
  );
}

export function PlayerRoute({ mlbPlayerId }: { mlbPlayerId: number }) {
  const [data, setData] = useState<NestPlayerFeaturesResponse | null>(null);
  const [recentSlots, setRecentSlots] = useState<Awaited<ReturnType<typeof loadPlayerSavant>>["recent_lineup_slots"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadPlayerFeatures(mlbPlayerId, { sync: true }), loadPlayerSavant(mlbPlayerId).catch(() => null)])
      .then(([features, savant]) => {
        setData(features);
        setRecentSlots(savant?.recent_lineup_slots ?? []);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [mlbPlayerId]);

  if (loading) return <PageLoader />;
  if (error || !data) return <NoticeError>{error ?? "Not found"}</NoticeError>;

  return (
    <div className="grid gap-4">
      <PageHero
        description={`MLB ${data.player.mlb_player_id}${data.player.primary_position ? ` · ${data.player.primary_position}` : ""}${
          data.player.bat_side ? ` · bats ${data.player.bat_side}` : ""
        }${data.player.pitch_hand ? ` · throws ${data.player.pitch_hand}` : ""}`}
        eyebrow="Игрок"
        title={data.player.full_name}
      />
      <Link className="text-xs text-muted-foreground hover:underline" href="/">
        ← К списку
      </Link>
      <div className="grid gap-3">
        {data.features.map((f, i) => (
          <Card className="ui-card border-border" key={i}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base capitalize">
                {f.role} · {f.season}
                <Badge variant={f.ready ? "default" : "secondary"}>{f.ready ? "ready" : "not ready"}</Badge>
                <span className="text-xs font-normal text-muted-foreground">
                  {f.source} · sample {f.games_sample} · as of {f.as_of ?? "—"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {f.role === "hitter" ? (
                <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
                  <Stat digits={3} label="Season OPS" value={f.season_ops} />
                  <Stat digits={3} label="Season AVG" value={f.season_avg} />
                  <Stat digits={3} label="Season OBP" value={f.season_obp} />
                  <Stat digits={3} label="Season SLG" value={f.season_slg} />
                  <Stat digits={3} label={`L5 OPS (${f.l5_games})`} value={f.l5_ops} />
                  <Stat digits={3} label="L5 AVG" value={f.l5_avg} />
                  <Stat digits={3} label={`L10 OPS (${f.l10_games})`} value={f.l10_ops} />
                  <Stat digits={3} label="L10 AVG" value={f.l10_avg} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
                  <Stat digits={2} label="Season ERA" value={f.season_era} />
                  <Stat digits={2} label="Season WHIP" value={f.season_whip} />
                  <Stat digits={0} label="Season IP" value={f.season_ip} />
                  <Stat digits={0} label="GS" value={f.season_games_started} />
                  <Stat digits={2} label={`L5 ERA (${f.l5_games})`} value={f.l5_era} />
                  <Stat digits={2} label="L5 WHIP" value={f.l5_whip} />
                  <Stat digits={2} label={`L10 ERA (${f.l10_games})`} value={f.l10_era} />
                  <Stat digits={2} label="L10 WHIP" value={f.l10_whip} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {!data.features.length ? <p className="text-sm text-muted-foreground">Нет feature rows</p> : null}
      </div>

      {recentSlots.length ? (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm">Последние появления в составе (Savant)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-xs">
            {recentSlots.map((s, i) => (
              <div className="flex flex-wrap justify-between gap-2 border-b border-border/60 py-1 last:border-0" key={i}>
                <span>
                  {s.official_date} · {s.side} · #{s.batting_order}
                </span>
                <span className="font-mono text-muted-foreground">
                  xwOBA {s.xwoba ?? "—"} · xSLG {s.xslg ?? "—"} · Barrel% {s.barrel_rate ?? "—"} · HardHit% {s.hard_hit_pct ?? "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
