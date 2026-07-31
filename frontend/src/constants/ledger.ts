import type { F5OddsStage } from "@/types";

export const LEDGER_TRACKS: Array<{ id: F5OddsStage; label: string }> = [
  { id: "prematch", label: "Прематч" },
  { id: "inn1", label: "1 ИНН" },
  { id: "inn2", label: "2 ИНН" },
];

export const TRACK_LABELS: Record<F5OddsStage, string> = {
  prematch: "Прематч",
  inn1: "После 1 инн",
  inn2: "После 2 инн",
};
