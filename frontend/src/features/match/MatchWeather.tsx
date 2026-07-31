"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/page-loader";
import { loadGameWeather, refreshGameWeather } from "@/lib/api";
import type { NestWeatherObservation, NestWeatherResponse } from "@/types";

function ObsRow({ o }: { o: NestWeatherObservation }) {
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1.5">{new Date(o.observed_at).toLocaleString("ru-RU")}</td>
      <td className="px-2 py-1.5">{o.relative_to_game}</td>
      <td className="px-2 py-1.5 font-mono">{o.temperature_f ?? "—"}°F</td>
      <td className="px-2 py-1.5 font-mono">{o.apparent_temperature_f ?? "—"}°F</td>
      <td className="px-2 py-1.5 font-mono">{o.humidity ?? "—"}%</td>
      <td className="px-2 py-1.5 font-mono">{o.wind_speed_mph ?? "—"} mph</td>
      <td className="px-2 py-1.5 font-mono">{o.wind_gusts_mph ?? "—"} mph</td>
      <td className="px-2 py-1.5">{o.condition_text ?? "—"}</td>
      <td className="px-2 py-1.5 font-mono">{o.precipitation_in ?? "—"} in</td>
    </tr>
  );
}

export function MatchWeather({ gameId }: { gameId: string }) {
  const [data, setData] = useState<NestWeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGameWeather(gameId)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Не удалось загрузить погоду"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  async function onRefresh() {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await refreshGameWeather(gameId);
      setData(res);
      setNotice(res.sync.skipped ? `Пропущено: ${res.sync.reason}` : `Добавлено наблюдений: ${res.sync.observations}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить погоду");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <InlineLoader label="Погода" />;

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{data?.count ?? 0} наблюдений (Open-Meteo)</p>
        <Button disabled={refreshing} onClick={() => void onRefresh()} size="sm" type="button" variant="outline">
          {refreshing ? "…" : "Обновить"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}

      {data?.summary ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Текущее ({data.summary.relative_to_game})</p>
          <p className="mt-1">
            {data.summary.temperature_f}°F (ощущается {data.summary.apparent_temperature_f}°F) · {data.summary.condition_text} · ветер{" "}
            {data.summary.wind_speed_mph} mph {data.summary.wind_direction_deg != null ? `(${data.summary.wind_direction_deg}°)` : ""} · влажность{" "}
            {data.summary.humidity}%
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Нет наблюдений.</p>
      )}

      {data?.observations.length ? (
        <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead className="bg-muted/40">
              <tr>
                {["Время", "Окно", "Темп.", "Ощущ.", "Влажн.", "Ветер", "Порывы", "Условия", "Осадки"].map((h) => (
                  <th className="whitespace-nowrap px-2 py-1.5 font-semibold uppercase text-muted-foreground" key={h}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.observations.map((o, i) => (
                <ObsRow key={i} o={o} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
