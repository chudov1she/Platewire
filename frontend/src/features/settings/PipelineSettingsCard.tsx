"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeError } from "@/components/ui/feedback";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { loadPipelineStatus, runPipeline } from "@/lib/api";
import { copy } from "@/lib/copy";
import type { PipelineStatus } from "@/types";

const PIPELINE_REASONS = ["slate", "prematch", "stage_watch", "final_probe"] as const;

type PipelineReason = (typeof PIPELINE_REASONS)[number];

export function PipelineSettingsCard() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingReason, setPendingReason] = useState<PipelineReason | null>(null);

  async function reload() {
    setStatus(await loadPipelineStatus());
  }

  useEffect(() => {
    reload().catch((err) =>
      setError(err instanceof Error ? err.message : copy.settings.pipelineLoadFailed),
    );
    const timer = window.setInterval(() => void reload().catch(() => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function onConfirmRun() {
    if (!pendingReason) return;
    setRunning(true);
    try {
      await runPipeline(pendingReason);
      toast.success(`${copy.settings.pipelineStarted}: ${pendingReason}`);
      setPendingReason(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.pipelineFailed);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.settings.pipelineTitle}</CardTitle>
        <CardDescription>
          {status
            ? `enabled: ${status.enabled ? "да" : "нет"} · in-flight ${status.in_flight} · открытых треков ${status.open_stage_games} · событий за час ${status.events_1h}`
            : "…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? <NoticeError>{error}</NoticeError> : null}
        <div className="flex flex-wrap gap-2">
          {PIPELINE_REASONS.map((reason) => (
            <Button
              disabled={running}
              key={reason}
              onClick={() => setPendingReason(reason)}
              size="sm"
              type="button"
              variant="outline"
            >
              run {reason}
            </Button>
          ))}
        </div>
        <div className="grid gap-1">
          {status?.recent.map((r) => (
            <div
              className="flex items-center justify-between rounded border border-border/60 px-2 py-1 text-xs"
              key={r.id}
            >
              <span>
                {r.job} · {r.mlb_game_pk ?? "—"}
              </span>
              <span className="text-muted-foreground">
                {r.status} {r.duration_ms != null ? `· ${r.duration_ms}ms` : ""} ·{" "}
                {new Date(r.created_at).toLocaleTimeString("ru-RU")}
              </span>
            </div>
          ))}
        </div>

        <ConfirmApplyDialog
          confirmLabel={copy.settings.runPipeline}
          description={
            pendingReason ? (
              <>
                Запустить job{" "}
                <span className="font-mono text-foreground">{pendingReason}</span> прямо сейчас.
              </>
            ) : (
              "—"
            )
          }
          onConfirm={onConfirmRun}
          onOpenChange={(open) => {
            if (!open) setPendingReason(null);
          }}
          open={Boolean(pendingReason)}
          pending={running}
          title={copy.settings.confirmPipelineTitle}
        />
      </CardContent>
    </Card>
  );
}
