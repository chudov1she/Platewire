"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeError } from "@/components/ui/feedback";
import { PageLoader } from "@/components/ui/page-loader";
import { PageHero } from "@/components/layout/PageHero";
import { ApiError, loadOfficialFeatures } from "@/lib/api";
import type { NestOfficialFeaturesResponse } from "@/types";

function Stat({
  label,
  value,
  digits = 1,
  suffix = "",
}: {
  label: string;
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
}) {
  return (
    <div className="rounded bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div>
        {value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(digits)}${suffix}`}
      </div>
    </div>
  );
}

export function OfficialRoute({ mlbOfficialId }: { mlbOfficialId: number }) {
  const [data, setData] = useState<NestOfficialFeaturesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadOfficialFeatures(mlbOfficialId, { sync: true })
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [mlbOfficialId]);

  if (loading) return <PageLoader />;
  if (error || !data) return <NoticeError>{error ?? "Not found"}</NoticeError>;

  const f = data.feature;
  const sc = f?.scorecard ?? null;

  return (
    <div className="grid gap-4">
      <PageHero description={`Official MLB ${data.mlb_official_id}`} eyebrow="Судья" title={data.full_name} />
      <Link className="text-xs text-muted-foreground hover:underline" href="/">
        ← К списку
      </Link>
      <Card className="ui-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Statcast rates
            <Badge variant={f?.ready ? "default" : "secondary"}>
              {f?.ready ? "ready" : "not ready"}
            </Badge>
            {f ? (
              <span className="text-xs font-normal text-muted-foreground">
                {f.source} · sample {f.games_sample} · as of {f.as_of ?? "—"}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {f ? (
            <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
              <Stat
                label="Called strike%"
                suffix="%"
                value={f.called_strike_rate != null ? f.called_strike_rate * 100 : null}
              />
              <Stat
                label="Called ball%"
                suffix="%"
                value={f.called_ball_rate != null ? f.called_ball_rate * 100 : null}
              />
              <Stat label="K rate%" suffix="%" value={f.k_rate != null ? f.k_rate * 100 : null} />
              <Stat label="BB rate%" suffix="%" value={f.bb_rate != null ? f.bb_rate * 100 : null} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Нет Statcast feature</p>
          )}
        </CardContent>
      </Card>

      <Card className="ui-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            UmpScorecards
            {sc ? (
              <span className="text-xs font-normal text-muted-foreground">
                n={sc.games_sample} · updated {sc.fetched_at.slice(0, 10)}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sc ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-3">
                <Stat label="Accuracy" suffix="%" value={sc.overall_accuracy} />
                <Stat label="vs expected" digits={2} value={sc.accuracy_above_x} />
                <Stat label="Consistency" suffix="%" value={sc.consistency} />
                <Stat label="Favor |abs|" digits={2} value={sc.favor_abs_mean} />
                <Stat label="Run impact" digits={2} value={sc.total_run_impact_mean} />
                <Stat label="Weighted score" digits={1} value={sc.weighted_score} />
              </div>
              <p className="text-xs text-muted-foreground">
                Correct {sc.called_correct ?? "—"} / wrong {sc.called_wrong ?? "—"} · pitches{" "}
                {sc.called_pitches ?? "—"}
              </p>
              <a
                className="text-sm text-primary underline"
                href={sc.profile_url}
                rel="noreferrer"
                target="_blank"
              >
                Открыть профиль {sc.umpire_name} на umpscorecards.com
              </a>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Профиль UmpScorecards не сопоставлен по имени. Синхронизация каталога подтянется
              при следующем refresh контекста.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
