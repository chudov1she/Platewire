import type { FormulaParameters, FormulaSpec } from './formula.types.js';

export function defaultParameters(): FormulaParameters {
  return {
    overround: 1.05,
    prob_cap: 0.92,
    value_threshold_pct: 65,
    signal_value_pct: 15,
    signal_roi_pct: 5,
    margin_tie: 0.5,
  };
}

export function defaultFormulaSpec(): FormulaSpec {
  return {
    version: 'custom-1',
    base: 'v42',
    parameters: defaultParameters(),
    derived: {},
    lambda_home_mult: '1.0',
    lambda_away_mult: '1.0',
    notes: [],
  };
}

function clampParam(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeFormulaSpec(raw: unknown): FormulaSpec {
  const base = defaultFormulaSpec();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Record<string, unknown>;
  const paramsIn =
    data.parameters && typeof data.parameters === 'object'
      ? (data.parameters as Record<string, unknown>)
      : {};

  const derivedRaw =
    data.derived && typeof data.derived === 'object'
      ? (data.derived as Record<string, unknown>)
      : {};
  const derived: Record<string, string> = {};
  for (const [k, v] of Object.entries(derivedRaw)) {
    if (typeof v === 'string') derived[k] = v;
  }

  return {
    version: typeof data.version === 'string' ? data.version : base.version,
    base: typeof data.base === 'string' ? data.base : base.base,
    parameters: {
      overround: clampParam(
        Number(paramsIn.overround ?? base.parameters.overround),
        1,
        1.2,
      ),
      prob_cap: clampParam(
        Number(paramsIn.prob_cap ?? base.parameters.prob_cap),
        0.5,
        0.99,
      ),
      value_threshold_pct: clampParam(
        Number(
          paramsIn.value_threshold_pct ?? base.parameters.value_threshold_pct,
        ),
        0,
        200,
      ),
      signal_value_pct: clampParam(
        Number(paramsIn.signal_value_pct ?? base.parameters.signal_value_pct),
        0,
        200,
      ),
      signal_roi_pct: clampParam(
        Number(paramsIn.signal_roi_pct ?? base.parameters.signal_roi_pct),
        0,
        200,
      ),
      margin_tie: clampParam(
        Number(paramsIn.margin_tie ?? base.parameters.margin_tie),
        0,
        2,
      ),
    },
    derived,
    lambda_home_mult:
      typeof data.lambda_home_mult === 'string'
        ? data.lambda_home_mult
        : base.lambda_home_mult,
    lambda_away_mult:
      typeof data.lambda_away_mult === 'string'
        ? data.lambda_away_mult
        : base.lambda_away_mult,
    notes: Array.isArray(data.notes)
      ? data.notes.filter((n): n is string => typeof n === 'string')
      : [],
  };
}

export function patchFormulaSpec(
  base: FormulaSpec,
  patch: Record<string, unknown>,
): FormulaSpec {
  const merged: Record<string, unknown> = {
    ...base,
    parameters: { ...base.parameters },
    derived: { ...base.derived },
  };
  if (patch.parameters && typeof patch.parameters === 'object') {
    merged.parameters = {
      ...(merged.parameters as object),
      ...(patch.parameters as object),
    };
  }
  if (patch.derived && typeof patch.derived === 'object') {
    merged.derived = {
      ...(merged.derived as object),
      ...(patch.derived as object),
    };
  }
  for (const key of [
    'version',
    'base',
    'lambda_home_mult',
    'lambda_away_mult',
    'notes',
  ] as const) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  return normalizeFormulaSpec(merged);
}

const DERIVED_KEY_RE = /^[A-Za-z0-9_]+$/;

export function validateDerivedKeys(
  derived: Record<string, string>,
): string | null {
  for (const key of Object.keys(derived)) {
    if (!DERIVED_KEY_RE.test(key)) {
      return `Invalid derived variable name: ${key}`;
    }
  }
  return null;
}
