export function ledgerResultLabel(status: string): "WIN" | "LOSE" | "PUSH" | "PENDING" {
  const normalized = status.toLowerCase();
  if (normalized === "win") return "WIN";
  if (normalized === "lose" || normalized === "loss") return "LOSE";
  if (normalized === "push") return "PUSH";
  return "PENDING";
}

export function ledgerResultClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "win") return "font-bold text-emerald-400";
  if (normalized === "lose" || normalized === "loss") return "font-bold text-destructive";
  if (normalized === "push") return "font-bold text-amber-400";
  return "font-bold text-muted-foreground";
}
