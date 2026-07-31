"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoticeError } from "@/components/ui/feedback";
import { PageLoader } from "@/components/ui/page-loader";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { FormulaVersionsList } from "@/features/settings/FormulaVersionsList";
import { useAuth } from "@/hooks/useAuth";
import {
  activateFormulaVersion,
  loadFormulaVersions,
  loadProductionFormula,
  putProductionFormula,
  validateFormulaSpec,
} from "@/lib/api";
import { copy } from "@/lib/copy";
import type { FormulaProductionResponse, FormulaSpec, FormulaVersionListItem } from "@/types";

type ParamKey = keyof FormulaSpec["parameters"];

const PARAM_FIELDS: { key: ParamKey; label: string; step?: string }[] = [
  { key: "overround", label: "Overround", step: "0.001" },
  { key: "prob_cap", label: "Prob cap", step: "0.01" },
  { key: "value_threshold_pct", label: "Value threshold %", step: "0.1" },
  { key: "signal_value_pct", label: "Signal value %", step: "0.1" },
  { key: "signal_roi_pct", label: "Signal ROI %", step: "0.1" },
  { key: "margin_tie", label: "Margin tie", step: "0.001" },
];

function cloneSpec(spec: FormulaSpec): FormulaSpec {
  return structuredClone(spec);
}

function stableSpecJson(spec: FormulaSpec): string {
  return JSON.stringify(spec);
}

function paramDiff(baseline: FormulaSpec, draft: FormulaSpec): string[] {
  const lines: string[] = [];
  for (const { key, label } of PARAM_FIELDS) {
    if (baseline.parameters[key] !== draft.parameters[key]) {
      lines.push(`${label}: ${baseline.parameters[key]} → ${draft.parameters[key]}`);
    }
  }
  if (baseline.lambda_home_mult !== draft.lambda_home_mult) {
    lines.push("lambda_home_mult изменён");
  }
  if (baseline.lambda_away_mult !== draft.lambda_away_mult) {
    lines.push("lambda_away_mult изменён");
  }
  if (JSON.stringify(baseline.derived) !== JSON.stringify(draft.derived)) {
    lines.push("derived изменён");
  }
  if (JSON.stringify(baseline.notes) !== JSON.stringify(draft.notes)) {
    lines.push("notes изменены");
  }
  return lines;
}

export function FormulaSettingsCard() {
  const { isAdmin } = useAuth();
  const [production, setProduction] = useState<FormulaProductionResponse | null>(null);
  const [versions, setVersions] = useState<FormulaVersionListItem[]>([]);
  const [baseline, setBaseline] = useState<FormulaSpec | null>(null);
  const [draft, setDraft] = useState<FormulaSpec | null>(null);
  const [derivedText, setDerivedText] = useState("");
  const [notesText, setNotesText] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [pendingActivate, setPendingActivate] = useState(false);

  async function reload() {
    const [prod, vers] = await Promise.all([loadProductionFormula(), loadFormulaVersions(20)]);
    const spec = cloneSpec(prod.spec);
    setProduction(prod);
    setVersions(vers);
    setBaseline(cloneSpec(spec));
    setDraft(cloneSpec(spec));
    setDerivedText(JSON.stringify(spec.derived, null, 2));
    setNotesText(JSON.stringify(spec.notes, null, 2));
    setError(null);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : copy.settings.loadFailed))
      .finally(() => setLoading(false));
  }, []);

  const derivedParsed = useMemo(() => {
    try {
      const value = JSON.parse(derivedText) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false as const, error: "derived должен быть объектом" };
      }
      return { ok: true as const, value: value as Record<string, string> };
    } catch {
      return { ok: false as const, error: "Невалидный JSON в derived" };
    }
  }, [derivedText]);

  const notesParsed = useMemo(() => {
    try {
      const value = JSON.parse(notesText) as unknown;
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return { ok: false as const, error: "notes должен быть массивом строк" };
      }
      return { ok: true as const, value: value as string[] };
    } catch {
      return { ok: false as const, error: "Невалидный JSON в notes" };
    }
  }, [notesText]);

  const resolvedDraft = useMemo((): FormulaSpec | null => {
    if (!draft || !derivedParsed.ok || !notesParsed.ok) return null;
    return {
      ...draft,
      derived: derivedParsed.value,
      notes: notesParsed.value,
    };
  }, [draft, derivedParsed, notesParsed]);

  const dirty =
    Boolean(baseline && resolvedDraft) &&
    stableSpecJson(baseline!) !== stableSpecJson(resolvedDraft!);

  const advancedError =
    (!derivedParsed.ok ? derivedParsed.error : null) ??
    (!notesParsed.ok ? notesParsed.error : null);

  const changes = baseline && resolvedDraft ? paramDiff(baseline, resolvedDraft) : [];

  function setParam(key: ParamKey, raw: string) {
    if (!draft) return;
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setDraft({
      ...draft,
      parameters: { ...draft.parameters, [key]: num },
    });
  }

  function onReset() {
    if (!baseline) return;
    const next = cloneSpec(baseline);
    setDraft(next);
    setDerivedText(JSON.stringify(next.derived, null, 2));
    setNotesText(JSON.stringify(next.notes, null, 2));
  }

  async function onValidate() {
    if (!resolvedDraft) {
      toast.error(advancedError ?? "Невалидная форма");
      return;
    }
    setValidating(true);
    try {
      const res = await validateFormulaSpec(resolvedDraft);
      if (res.ok) toast.success(copy.settings.validOk);
      else toast.error(`${copy.settings.validFail}: ${res.errors.join("; ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.validFail);
    } finally {
      setValidating(false);
    }
  }

  function openApply() {
    setVersionLabel(`ui-${Date.now()}`);
    setApplyOpen(true);
  }

  async function onConfirmApply() {
    if (!resolvedDraft) return;
    setSaving(true);
    try {
      const label = versionLabel.trim() || `ui-${Date.now()}`;
      const saved = await putProductionFormula({
        spec: resolvedDraft,
        versionLabel: label,
        notes: "from settings UI",
      });
      toast.success(`${copy.settings.saved}: ${saved.versionLabel}`);
      setApplyOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmActivate() {
    if (!activatingId) return;
    setPendingActivate(true);
    try {
      const prod = await activateFormulaVersion(activatingId);
      toast.success(`${copy.settings.activated}: ${prod.versionLabel}`);
      setActivatingId(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.activateFailed);
    } finally {
      setPendingActivate(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10">
          <PageLoader />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.settings.formulaTitle}</CardTitle>
        <CardDescription>
          base {production?.base} · env keys: {production?.availableEnvKeys.length ?? 0}
          {production ? (
            <span className="ml-2 font-mono text-xs">v {production.versionLabel}</span>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? <NoticeError>{error}</NoticeError> : null}

        {draft ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {PARAM_FIELDS.map(({ key, label, step }) => (
              <div className="grid gap-1.5" key={key}>
                <Label htmlFor={`param-${key}`}>{label}</Label>
                <Input
                  disabled={!isAdmin}
                  id={`param-${key}`}
                  inputMode="decimal"
                  onChange={(e) => setParam(key, e.target.value)}
                  step={step}
                  type="number"
                  value={draft.parameters[key]}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <Button
            onClick={() => setAdvancedOpen((v) => !v)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {advancedOpen ? copy.settings.hideAdvanced : copy.settings.showAdvanced}
          </Button>
          {advancedOpen && draft ? (
            <div className="mt-2 grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lambda-home">lambda_home_mult</Label>
                <Input
                  disabled={!isAdmin}
                  id="lambda-home"
                  onChange={(e) => setDraft({ ...draft, lambda_home_mult: e.target.value })}
                  value={draft.lambda_home_mult}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lambda-away">lambda_away_mult</Label>
                <Input
                  disabled={!isAdmin}
                  id="lambda-away"
                  onChange={(e) => setDraft({ ...draft, lambda_away_mult: e.target.value })}
                  value={draft.lambda_away_mult}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="derived-json">derived (JSON)</Label>
                <Textarea
                  className="min-h-28 font-mono text-xs"
                  disabled={!isAdmin}
                  id="derived-json"
                  onChange={(e) => setDerivedText(e.target.value)}
                  spellCheck={false}
                  value={derivedText}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="notes-json">notes (JSON array)</Label>
                <Textarea
                  className="min-h-20 font-mono text-xs"
                  disabled={!isAdmin}
                  id="notes-json"
                  onChange={(e) => setNotesText(e.target.value)}
                  spellCheck={false}
                  value={notesText}
                />
              </div>
              {advancedError ? <NoticeError>{advancedError}</NoticeError> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={validating || !resolvedDraft} onClick={() => void onValidate()} type="button" variant="outline">
            {validating ? "…" : copy.settings.validate}
          </Button>
          {isAdmin ? (
            <>
              <Button disabled={!dirty} onClick={onReset} type="button" variant="ghost">
                {copy.settings.reset}
              </Button>
              <Button
                disabled={!dirty || !resolvedDraft || saving}
                onClick={openApply}
                type="button"
              >
                {copy.common.apply}
              </Button>
            </>
          ) : null}
          {dirty ? (
            <span className="text-xs text-muted-foreground">{copy.settings.unsaved}</span>
          ) : null}
        </div>

        <FormulaVersionsList
          activatingId={activatingId}
          isAdmin={isAdmin}
          onCancelActivate={() => setActivatingId(null)}
          onConfirmActivate={onConfirmActivate}
          onRequestActivate={setActivatingId}
          pendingActivate={pendingActivate}
          versions={versions}
        />

        <ConfirmApplyDialog
          confirmLabel={copy.common.apply}
          description={
            <>
              Черновик станет production. Текущая версия останется в истории, но перестанет быть
              активной.
              {changes.length ? (
                <ul className="mt-2 list-inside list-disc text-left text-foreground/90">
                  {changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">Изменений в параметрах не видно — проверьте advanced.</p>
              )}
            </>
          }
          onConfirm={onConfirmApply}
          onOpenChange={setApplyOpen}
          open={applyOpen}
          pending={saving}
          title={copy.settings.confirmApplyTitle}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="version-label">{copy.settings.versionLabel}</Label>
            <Input
              id="version-label"
              onChange={(e) => setVersionLabel(e.target.value)}
              value={versionLabel}
            />
          </div>
        </ConfirmApplyDialog>
      </CardContent>
    </Card>
  );
}
