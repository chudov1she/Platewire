export const LEAGUE_OPS = 0.72;
export const LEAGUE_ERA = 4.5;
export const FORMULA_BASE_V42 = 'v42';

export type FormulaParameters = {
  overround: number;
  prob_cap: number;
  value_threshold_pct: number;
  signal_value_pct: number;
  signal_roi_pct: number;
  margin_tie: number;
};

/**
 * Dynamic, human/AI-editable overlay on top of the deterministic v42 engine.
 * No ai_blend field here on purpose: the AI never nudges lambdas as a hidden
 * multiplier. Its only two levers are (1) proposing a patch to this spec via
 * the curation agent, and (2) the per-game bet/pass decision — both explicit,
 * auditable and human-activated for (1).
 */
export type FormulaSpec = {
  version: string;
  base: string;
  parameters: FormulaParameters;
  derived: Record<string, string>;
  lambda_home_mult: string;
  lambda_away_mult: string;
  notes: string[];
};

export type TeamInputs = {
  ops: number;
  team_era: number;
  sp_era: number;
  bull_era: number;
  fielding_pct: number;
  barrel_pct: number;
  hardhit_pct: number;
  gb_pct: number;
  lineup_gb_pct?: number | null;
  sprint_speed: number;
  form_win_pct?: number | null;
  offense_trend?: number | null;
  sp_fip?: number | null;
  sp_era_last7?: number | null;
  sp_ip_avg?: number | null;
  sp_k_pct?: number | null;
  sp_bb_pct?: number | null;
  sp_fps_pct?: number | null;
  oaa?: number | null;
  drs?: number | null;
};

export type LiveF5State = {
  completed_innings: number;
  home_score: number;
  away_score: number;
  home_sp_pitches?: number | null;
  away_sp_pitches?: number | null;
  away_runs_inning1?: number | null;
  home_runs_inning1?: number | null;
  inning?: number | null;
  inning_half?: string | null;
  f5_complete?: boolean;
};

export type MatchupInputs = {
  home: TeamInputs;
  away: TeamInputs;
  venue?: string | null;
  temperature_f?: number | null;
  humidity?: number | null;
  wind_speed_mph?: number | null;
  wind_direction_deg?: number | null;
  day_night?: string | null;
  /** Home-plate umpire display name (MLB). */
  ump_hp_name?: string | null;
  ump_strike_zone_pct?: number | null;
  /** UmpScorecards accuracy vs expected (percentage points). */
  ump_accuracy_above_x?: number | null;
  ump_consistency?: number | null;
  ump_favor_abs?: number | null;
  ump_run_impact?: number | null;
  ump_pitcher_bias?: number;
  h2h_home_edge?: number;
  live?: LiveF5State | null;
  seed?: number;
};

export type MarketLine = {
  market: 'moneyline' | 'total' | 'runline' | string;
  side: string;
  decimal_odds: number;
  line?: number | null;
};

export type ValueBet = {
  market: string;
  side: string;
  decimal_odds: number;
  implied_pct: number;
  model_prob: number;
  value_pct: number;
  roi_pct: number;
  line?: number | null;
};

export type After5Analysis = {
  lambda_home: number;
  lambda_away: number;
  expected_home_runs: number;
  expected_away_runs: number;
  expected_total: number;
  p_home_lead: number;
  p_tie: number;
  p_away_lead: number;
  p_over_4_5: number;
  avg_total: number;
  value_bets: ValueBet[];
  signals: ValueBet[];
  notes: string[];
  formula_version: string;
  breakdown: Record<string, unknown>;
  simulation_mode: string;
};

export type InputSource = {
  value: number | string | null;
  source: 'feature' | 'default' | 'odds' | 'open_meteo' | 'mlb_weather' | 'game' | 'umpscorecards';
  ready?: boolean;
};

export function defaultTeamInputs(): TeamInputs {
  return {
    ops: LEAGUE_OPS,
    team_era: LEAGUE_ERA,
    sp_era: LEAGUE_ERA,
    bull_era: LEAGUE_ERA,
    fielding_pct: 0.985,
    barrel_pct: 0.09,
    hardhit_pct: 0.38,
    gb_pct: 0.45,
    sprint_speed: 27,
  };
}
