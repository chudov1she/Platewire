"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { copy } from "@/lib/copy";
import type { FormulaVersionListItem } from "@/types";

export function FormulaVersionsList({
  versions,
  isAdmin,
  activatingId,
  pendingActivate,
  onRequestActivate,
  onConfirmActivate,
  onCancelActivate,
}: {
  versions: FormulaVersionListItem[];
  isAdmin: boolean;
  activatingId: string | null;
  pendingActivate: boolean;
  onRequestActivate: (id: string) => void;
  onConfirmActivate: () => void | Promise<void>;
  onCancelActivate: () => void;
}) {
  const target = versions.find((v) => v.id === activatingId) ?? null;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {copy.settings.versions} ({versions.length})
      </p>
      <div className="grid gap-1">
        {versions.map((v) => (
          <div
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
            key={v.id}
          >
            <div className="min-w-0">
              <span className="font-mono text-xs sm:text-sm">{v.versionLabel}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {v.createdBy} · {new Date(v.createdAt).toLocaleString("ru-RU")}
              </span>
              {v.notes ? <span className="ml-2 text-xs text-muted-foreground">{v.notes}</span> : null}
            </div>
            {v.isProduction ? (
              <Badge className="shrink-0" variant="outline">
                production
              </Badge>
            ) : isAdmin ? (
              <Button
                className="shrink-0"
                onClick={() => onRequestActivate(v.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                {copy.settings.activate}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <ConfirmApplyDialog
        confirmLabel={copy.settings.activate}
        description={
          target ? (
            <>
              Production будет переключён на версию{" "}
              <span className="font-mono text-foreground">{target.versionLabel}</span>. Текущая
              production-версия перестанет быть активной.
            </>
          ) : (
            "Выберите версию."
          )
        }
        onConfirm={onConfirmActivate}
        onOpenChange={(open) => {
          if (!open) onCancelActivate();
        }}
        open={Boolean(activatingId)}
        pending={pendingActivate}
        title={copy.settings.confirmActivateTitle}
      />
    </div>
  );
}
