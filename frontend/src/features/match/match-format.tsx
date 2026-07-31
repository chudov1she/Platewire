import { Badge } from "@/components/ui/badge";
import { DISPLAY_TIME_ZONE, DISPLAY_TIME_ZONE_LABEL } from "@/lib/config";
import type { Stage } from "@/lib/board";
import { cn } from "@/lib/utils";
import type { NestGame } from "@/types";

export function abbr(value: string | null | undefined) {
  if (!value) return "TBD";
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function formatDateTime(value: string | null) {
  if (!value) return "TBD";
  return `${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value))} ${DISPLAY_TIME_ZONE_LABEL}`;
}

export function formatDateOnly(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(`${value}T12:00:00Z`));
}

export function countdownLabel(value: string | null, nowMs: number, stage?: Stage) {
  if (!value) return "TBD";
  if (stage === "live" || stage === "final") return "стартовал";
  const diffMs = new Date(value).getTime() - nowMs;
  if (!Number.isFinite(diffMs)) return "TBD";
  if (diffMs <= 0) return "00:00:00";
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}д ${clock}` : clock;
}

const STAGE_LABELS: Record<Stage, string> = {
  future: "до матча",
  live: "live",
  final: "финал",
};

export function stageLabel(stage: Stage) {
  return STAGE_LABELS[stage] ?? stage;
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge
      className={cn(
        "h-auto w-fit rounded-md border-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        stage === "live" && "bg-emerald-500/20 text-emerald-300",
        stage === "final" && "bg-muted text-muted-foreground",
        stage === "future" && "bg-secondary text-secondary-foreground",
      )}
      variant="secondary"
    >
      {stage === "live" ? "Live" : stageLabel(stage)}
    </Badge>
  );
}

const HALF_LABELS: Record<string, string> = {
  top: "верх",
  bottom: "низ",
  middle: "середина",
  end: "конец",
};

export function inningLabel(game: NestGame) {
  if (!game.inning) return game.status_detail ?? "до матча";
  const halfKey = (game.inning_half ?? "").trim().toLowerCase();
  const half = HALF_LABELS[halfKey] ?? game.inning_half ?? "";
  return half ? `${half} ${game.inning}` : `инн ${game.inning}`;
}

export function countLabel(game: NestGame) {
  const { balls, strikes, outs, inning } = game;
  if (balls === null && strikes === null && outs === null) {
    if (inning != null || game.status === "LIVE") return "идёт";
    return "не начался";
  }
  return `${balls ?? 0}-${strikes ?? 0} · ${outs ?? 0} out`;
}

export function weatherOneLiner(game: NestGame) {
  const parts: string[] = [];
  if (game.weather_temp) parts.push(game.weather_temp);
  if (game.weather_condition) parts.push(game.weather_condition);
  if (game.weather_wind) parts.push(game.weather_wind);
  return parts.length ? parts.join(" · ") : "нет данных";
}
