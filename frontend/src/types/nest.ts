/**
 * Exact 1:1 contracts for the Platewire NestJS backend (`/api/v1`).
 * These are the SOURCE OF TRUTH shapes — do not invent fields that the
 * backend does not actually serialize. See backend/src/**\/*.controller.ts
 * for the authoritative route list.
 */

export type UserStatus = "GUEST" | "USER" | "ADMIN";

export type SafeUser = {
  id: string;
  status: UserStatus;
  telegramId: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  telegramPhotoUrl: string | null;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthTokens = {
  accessToken: string;
  expiresIn: string;
  rememberMe: boolean;
  user: SafeUser;
};

// ——— Games ———

export type NestTeam = {
  id: string;
  mlb_team_id: number;
  name: string;
  abbreviation: string;
  team_name: string | null;
  location_name: string | null;
};

export type NestVenue = {
  id: string;
  mlb_venue_id: number;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
} | null;

export type NestGame = {
  id: string;
  mlb_game_pk: number;
  season: number | null;
  game_date_utc: string;
  official_date: string;
  status: string;
  status_detail: string | null;
  home_score: number | null;
  away_score: number | null;
  inning: number | null;
  inning_half: string | null;
  inning_state: string | null;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  day_night: string | null;
  scheduled_innings: number | null;
  weather_condition: string | null;
  weather_temp: string | null;
  weather_wind: string | null;
  winline_event_id: number | null;
  winline_flipped: boolean | null;
  fetched_at: string | null;
  home_team: NestTeam;
  away_team: NestTeam;
  venue: NestVenue;
};

export type GamesSlateResponse = {
  ok: true;
  date: string;
  count: number;
  games: NestGame[];
};

export type GameSyncResponse = GamesSlateResponse & {
  dates: string[];
  gamesUpserted: number;
};

export type GameOneResponse = { ok: true; game: NestGame };

// ——— Context ———

export type NestPlayerFeature = {
  role: "hitter" | "pitcher";
  season: number;
  ready: boolean;
  games_sample: number;
  as_of: string | null;
  source: string;
  season_ops: number | null;
  season_avg: number | null;
  season_obp: number | null;
  season_slg: number | null;
  season_era: number | null;
  season_whip: number | null;
  season_ip: number | null;
  season_games: number | null;
  season_games_started: number | null;
  l5_ops: number | null;
  l5_avg: number | null;
  l5_era: number | null;
  l5_whip: number | null;
  l5_ip: number | null;
  l5_games: number;
  l10_ops: number | null;
  l10_avg: number | null;
  l10_era: number | null;
  l10_whip: number | null;
  l10_ip: number | null;
  l10_games: number;
  fetched_at: string;
} | null;

export type NestUmpScorecard = {
  umpire_name: string;
  games_sample: number;
  overall_accuracy: number | null;
  accuracy_above_x: number | null;
  consistency: number | null;
  favor_abs_mean: number | null;
  total_run_impact_mean: number | null;
  weighted_score: number | null;
  called_pitches: number | null;
  called_correct: number | null;
  called_wrong: number | null;
  source: "umpscorecards";
  fetched_at: string;
  profile_url: string;
};

export type NestOfficialFeature = {
  ready: boolean;
  games_sample: number;
  as_of: string | null;
  source: string;
  k_rate: number | null;
  bb_rate: number | null;
  called_strike_rate: number | null;
  called_ball_rate: number | null;
  fetched_at: string | null;
  scorecard: NestUmpScorecard | null;
} | null;

export type NestContextLineupRow = {
  batting_order: number;
  mlb_player_id: number | null;
  full_name: string | null;
  xwoba: number | null;
  xslg: number | null;
  xba: number | null;
  barrel_batted_rate: number | null;
  hard_hit_percent: number | null;
  feature: NestPlayerFeature;
};

export type NestContextStarter = {
  mlb_player_id: number | null;
  full_name: string | null;
  savant: {
    era: number | null;
    whip: number | null;
    xwoba: number | null;
    games_started: number | null;
    ff_avg_speed: number | null;
  };
  feature: NestPlayerFeature;
} | null;

export type NestContextSide = {
  lineup: NestContextLineupRow[];
  starter: NestContextStarter;
};

export type NestGameContext = {
  ok: true;
  game_id: string;
  mlb_game_pk: number;
  has_lineup: boolean;
  has_probable: boolean;
  home: NestContextSide;
  away: NestContextSide;
  home_plate_umpire: {
    mlb_official_id: number;
    full_name: string;
    feature: NestOfficialFeature;
  } | null;
  officials: Array<{ role: string; mlb_official_id: number; full_name: string }>;
  sync?: {
    preview: { mlbGamePk: number; gameId: string | null; hasLineup: boolean; hasProbable: boolean; error?: string };
    players: { count: number; results: Array<{ mlb_player_id: number; role: string; skipped: boolean; ready: boolean }> };
    officials: { count: number; homePlateId: number | null };
  };
};

export type NestPlayerFeaturesResponse = {
  ok: true;
  player: {
    id: string;
    mlb_player_id: number;
    full_name: string;
    bat_side: string | null;
    pitch_hand: string | null;
    primary_position: string | null;
  };
  features: NonNullable<NestPlayerFeature>[];
};

export type NestOfficialFeaturesResponse = {
  ok: true;
  id: string;
  mlb_official_id: number;
  full_name: string;
  bio_fetched_at: string | null;
  feature: NestOfficialFeature;
};

// ——— Savant ———

export type NestSavantLineupRow = {
  side: string;
  batting_order: number;
  mlb_player_id: number | null;
  full_name: string | null;
  xwoba: number | null;
  xslg: number | null;
  xba: number | null;
  barrel_batted_rate: number | null;
  hard_hit_percent: number | null;
};

export type NestSavantPitcher = {
  mlb_player_id: number | null;
  full_name: string | null;
  era: number | null;
  whip: number | null;
  xwoba: number | null;
  games_started: number | null;
  ff_avg_speed: number | null;
};

export type NestSavantResponse = {
  ok: boolean;
  game_id: string;
  mlb_game_pk: number;
  has_lineup: boolean;
  has_probable: boolean;
  fetched_at: string | null;
  error?: string;
  home: { lineup: NestSavantLineupRow[]; pitchers: NestSavantPitcher[] };
  away: { lineup: NestSavantLineupRow[]; pitchers: NestSavantPitcher[] };
  gamefeed: {
    game_status: string | null;
    game_status_code: string | null;
    fetched_at: string;
    scoreboard: unknown;
    stats: unknown;
    current_play: unknown;
    top_performers: unknown;
  } | null;
};

export type NestStatcastPitch = {
  at_bat_number: number | null;
  pitch_number: number | null;
  batter_mlb_id: number | null;
  pitcher_mlb_id: number | null;
  pitch_type: string | null;
  pitch_name: string | null;
  events: string | null;
  description: string | null;
  inning: number | null;
  inning_half: string | null;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  release_speed: number | null;
  launch_speed: number | null;
  launch_angle: number | null;
  estimated_ba: number | null;
  estimated_woba: number | null;
  estimated_slg: number | null;
  bat_speed: number | null;
  fetched_at: string;
};

export type NestStatcastResponse = {
  ok: true;
  game_id: string;
  mlb_game_pk: number;
  total: number;
  limit: number;
  offset: number;
  pitches: NestStatcastPitch[];
};

// ——— Weather ———

export type NestWeatherObservation = {
  observed_at: string;
  relative_to_game: "pregame" | "live_window" | "postgame";
  temperature_f: number | null;
  apparent_temperature_f: number | null;
  humidity: number | null;
  dew_point_f: number | null;
  pressure_hpa: number | null;
  precipitation_in: number | null;
  cloud_cover: number | null;
  wind_speed_mph: number | null;
  wind_gusts_mph: number | null;
  wind_direction_deg: number | null;
  weather_code: number | null;
  condition_text: string | null;
  source: string;
  captured_at: string;
};

export type NestWeatherResponse = {
  ok: true;
  game_id: string;
  mlb_game_pk: number;
  count: number;
  summary: NestWeatherObservation | null;
  observations: NestWeatherObservation[];
};

// ——— Odds / F5 ———

export type NestF5Moneyline = { home: number; draw: number | null; away: number } | null;
export type NestF5Total = { line: number; over: number; under: number };
export type NestF5Handicap = { line: number; home: number | null; away: number | null };

export type F5OddsStage = "prematch" | "inn1" | "inn2";

export type NestF5Snapshot = {
  ok: boolean;
  captured_at: string;
  game_id: string;
  mlb_game_pk: number;
  winline_event_id: number;
  winline_flipped: boolean;
  stage: F5OddsStage;
  locked: boolean;
  moneyline: NestF5Moneyline;
  totals: NestF5Total[];
  handicaps: NestF5Handicap[];
  main_total: NestF5Total | null;
  main_handicap: NestF5Handicap | null;
  missing: string[];
  skipped?: boolean;
  skip_reason?: string;
  fresh?: boolean;
};

export type NestF5Tracks = {
  ok: true;
  game_id: string;
  mlb_game_pk: number;
  tracks: {
    prematch: NestF5Snapshot | null;
    inn1: NestF5Snapshot | null;
    inn2: NestF5Snapshot | null;
  };
};

export type NestWinlineMatch = {
  event_id: number;
  winline_event_id: number;
  team1: string;
  team2: string;
  league: string | null;
  is_live: boolean;
  href: string;
  url: string;
};

// ——— Formula ———

export type FormulaSpec = {
  version: string;
  base: string;
  parameters: {
    overround: number;
    prob_cap: number;
    value_threshold_pct: number;
    signal_value_pct: number;
    signal_roi_pct: number;
    margin_tie: number;
  };
  derived: Record<string, string>;
  lambda_home_mult: string;
  lambda_away_mult: string;
  notes: string[];
};

export type FormulaProductionResponse = {
  versionId: string;
  versionLabel: string;
  base: string;
  spec: FormulaSpec;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  availableEnvKeys: string[];
};

export type FormulaVersionListItem = {
  id: string;
  versionLabel: string;
  base: string;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  isProduction: boolean;
};

export type FormulaVersionDetail = FormulaVersionListItem & { spec: FormulaSpec };

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

export type ReadinessResult = {
  ready: boolean;
  score: number;
  hardGaps: string[];
  softGaps: string[];
  inputsReady: boolean;
  oddsOk: boolean;
  contextOk: boolean;
};

export type NestReadinessResponse = ReadinessResult & {
  gameId: string;
  track: F5OddsStage;
  marketsUsed: boolean;
  locked: boolean;
  context: { hasLineup: boolean; hasHomeSp: boolean; hasAwaySp: boolean };
};

export type InputSource = { value: number | string | null; source: string; ready?: boolean };

export type NestFormulaEval = {
  gameId: string;
  formulaVersionId: string | null;
  versionLabel: string;
  specVersion: string;
  dryRun: boolean;
  track: F5OddsStage;
  marketsUsed: boolean;
  locked: boolean;
  readiness: ReadinessResult;
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
  input_sources: Record<string, InputSource>;
  breakdown: {
    home: Record<string, number>;
    away: Record<string, number>;
    park_time: number;
    weather: number;
    ump: number;
    base_lambda_home: number;
    base_lambda_away: number;
    live: Record<string, number>;
    formula_env: Record<string, number>;
  };
  simulation_mode: string;
  formula_version: string;
};

// ——— Ledger ———

export type LedgerAction = "bet" | "pass";
export type LedgerResultStatus = "pending" | "win" | "loss" | "push";
export type ConfidenceTier = "low" | "medium" | "high";

export type NestLedgerEntry = {
  id: string;
  gameId: string;
  matchup: string;
  track: F5OddsStage;
  action: LedgerAction;
  pickMarket: string | null;
  pickSide: string | null;
  pickLine: number | null;
  pickLabel: string | null;
  decimalOdds: number | null;
  valuePct: number | null;
  roiPct: number | null;
  confidenceTier: ConfidenceTier | null;
  stakeUnits: number | null;
  resultStatus: LedgerResultStatus;
  profitUnits: number | null;
  excludedFromStats: boolean;
  f5HomeRuns: number | null;
  f5AwayRuns: number | null;
  riskFlags: string[];
  rationale: string | null;
  notifyBrief: string | null;
  versionLabel: string;
  gameDateUtc: string | null;
  capturedAt: string;
  settledAt: string | null;
};

export type NestLedgerEntryDetail = NestLedgerEntry & {
  aiTrace: {
    id: string;
    model: string;
    latencyMs: number;
    promptJson: unknown;
    rawOutputJson: unknown;
    createdAt: string;
  } | null;
};

export type NestLedgerStats = {
  days: number;
  total: number;
  pending: number;
  passed: number;
  wins: number;
  losses: number;
  pushes: number;
  winrate: number | null;
  profitUnits: number;
  stakedUnits: number;
  roiPct: number;
  byTrack: Record<string, { n: number; profit: number }>;
  byConfidence: Record<string, { n: number; profit: number }>;
  worstLosses: Array<{
    gameId: string;
    track: string;
    pickMarket: string | null;
    pickSide: string | null;
    profitUnits: number | null;
    resultStatus: string;
  }>;
  startingBankroll: number;
};

export type NestLedgerEquity = {
  startingBankroll: number;
  points: Array<{
    id: string;
    n: number;
    settledAt: string | null;
    matchup: string;
    track: string;
    pickLabel: string | null;
    profitUnits: number;
    resultStatus: string;
    bank: number;
  }>;
};

export type LedgerCaptureResponse = {
  captured: boolean;
  entry: (NestLedgerEntry & { captureReason?: string; lineupFingerprint?: string; spFingerprint?: string }) | null;
  reason: string;
  readiness?: ReadinessResult;
  materialChange?: boolean;
};

export type LedgerSettleGameResponse = { settled: number; skipped: number };
export type LedgerSettleBatchResponse = { games: number; settled: number };

// ——— AI / Agent ———

export type AgentProposalMetrics = {
  wins: number;
  losses: number;
  pushes: number;
  skipped: number;
  profit: number;
  roiPct: number;
  winrate: number;
  n: number;
};

export type NestAgentProposal = {
  id: string;
  status: "proposed" | "rejected" | "applied";
  title: string;
  rationale: string;
  patch: Record<string, unknown>;
  baselineVersionId: string;
  baselineMetrics: AgentProposalMetrics;
  proposedMetrics: AgentProposalMetrics;
  createdFormulaVersionId: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentCurationRunResponse = { message: string; toolsUsed: string[] };

export type NestAgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  createdAt: string;
};

export type AgentChatSendResponse = { message: string; toolsUsed: string[] };

// ——— Pipeline / ops ———

export type PipelineStatus = {
  ok: true;
  enabled: boolean;
  in_flight: number;
  open_stage_games: number;
  events_1h: number;
  recent: Array<{
    id: string;
    job: string;
    status: string;
    message: string | null;
    mlb_game_pk: number | null;
    game_id: string | null;
    duration_ms: number | null;
    created_at: string;
  }>;
};

export type PipelineTickResponse =
  | { ok: true; game_id: string; mlb_game_pk: number; status: string; completed: number; captured: string[]; errors: string[] }
  | { ok: false; message: string };

export type PipelineRunResponse = { ok: boolean; reason: string; processed: number; failed: number };
