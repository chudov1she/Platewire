import { API_BASE } from "@/lib/config";
import { getAccessToken, setAccessToken } from "@/lib/auth-storage";
import type {
  AuthTokens,
  F5OddsStage,
  GameOneResponse,
  GameSyncResponse,
  GamesSlateResponse,
  NestF5Snapshot,
  NestF5Tracks,
  NestGame,
  NestGameContext,
  NestOfficialFeaturesResponse,
  NestPlayerFeaturesResponse,
  NestSavantResponse,
  NestStatcastResponse,
  NestWeatherResponse,
  NestWinlineMatch,
  PipelineRunResponse,
  PipelineStatus,
  PipelineTickResponse,
  SafeUser,
} from "@/types/nest";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function formatApiErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback || "Request failed";
  const rec = body as { message?: unknown; errors?: unknown };
  const errors = Array.isArray(rec.errors)
    ? rec.errors.filter((e): e is string => typeof e === "string")
    : [];
  let message = "";
  if (typeof rec.message === "string") message = rec.message;
  else if (Array.isArray(rec.message)) {
    message = rec.message.filter((m): m is string => typeof m === "string").join("; ");
  } else if (rec.message && typeof rec.message === "object") {
    const nested = rec.message as { message?: unknown; errors?: unknown };
    if (typeof nested.message === "string") message = nested.message;
    if (Array.isArray(nested.errors)) {
      errors.push(
        ...nested.errors.filter((e): e is string => typeof e === "string"),
      );
    }
  }
  if (errors.length) {
    const detail = errors.join("; ");
    return message ? `${message}: ${detail}` : detail;
  }
  return message || fallback || "Request failed";
}

function apiUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}/api/v1${p}`;
}

async function parseJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Превышен таймаут запроса (20с)", 0, null);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
  const body = await parseJson(res);
  if (!res.ok) {
    if (res.status === 401) setAccessToken(null);
    throw new ApiError(formatApiErrorMessage(body, res.statusText), res.status, body);
  }
  return body as T;
}

const getJson = <T>(path: string) => requestJson<T>(path);
const postJson = <T>(path: string, body?: unknown) =>
  requestJson<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patchJson = <T>(path: string, body?: unknown) =>
  requestJson<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

// ——— Auth ———

export async function login(loginName: string, password: string): Promise<AuthTokens> {
  const data = await postJson<AuthTokens>("/auth/login", { login: loginName, password });
  setAccessToken(data.accessToken);
  return data;
}

export async function loginWithTelegram(payload: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  rememberMe?: boolean;
}): Promise<AuthTokens> {
  const data = await postJson<AuthTokens>("/auth/telegram", {
    ...payload,
    rememberMe: payload.rememberMe ?? true,
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function loginWithTelegramWebApp(
  initData: string,
): Promise<AuthTokens> {
  const data = await postJson<AuthTokens>("/auth/telegram/webapp", {
    initData,
    rememberMe: true,
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function fetchMe(): Promise<SafeUser> {
  return getJson<SafeUser>("/auth/me");
}

// ——— Games ———

export async function loadGamesToday(): Promise<GamesSlateResponse> {
  return getJson<GamesSlateResponse>("/games/today");
}

export async function loadGamesByDate(date: string): Promise<GamesSlateResponse> {
  return getJson<GamesSlateResponse>(`/games?date=${encodeURIComponent(date)}`);
}

export async function syncGamesForDate(date?: string): Promise<GameSyncResponse> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return postJson<GameSyncResponse>(`/games/sync${q}`);
}

export async function loadGame(id: string, opts?: { refresh?: boolean }): Promise<NestGame> {
  const q = opts?.refresh ? "?refresh=1" : "";
  const body = await getJson<GameOneResponse>(`/games/${id}${q}`);
  return body.game;
}

// ——— Context ———

export async function loadGameContext(gameId: string): Promise<NestGameContext> {
  return getJson<NestGameContext>(`/games/${gameId}/context`);
}

export async function refreshGameContext(gameId: string): Promise<NestGameContext> {
  return postJson<NestGameContext>(`/games/${gameId}/context/refresh`);
}

export async function loadPlayerFeatures(mlbPlayerId: number, opts?: { sync?: boolean }): Promise<NestPlayerFeaturesResponse> {
  const q = opts?.sync ? "?sync=1" : "";
  return getJson<NestPlayerFeaturesResponse>(`/players/${mlbPlayerId}/features${q}`);
}

export async function loadOfficialFeatures(mlbOfficialId: number, opts?: { sync?: boolean }): Promise<NestOfficialFeaturesResponse> {
  const q = opts?.sync ? "?sync=1" : "";
  return getJson<NestOfficialFeaturesResponse>(`/officials/${mlbOfficialId}/features${q}`);
}

// ——— Savant ———

export async function loadGameSavant(gameId: string): Promise<NestSavantResponse> {
  return getJson<NestSavantResponse>(`/games/${gameId}/savant`);
}

export async function loadGameStatcast(gameId: string, opts?: { limit?: number; offset?: number }): Promise<NestStatcastResponse> {
  const q = new URLSearchParams();
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.offset) q.set("offset", String(opts.offset));
  const qs = q.toString();
  return getJson<NestStatcastResponse>(`/games/${gameId}/savant/statcast${qs ? `?${qs}` : ""}`);
}

export async function refreshGameSavant(gameId: string, layers = "preview,gamefeed,statcast"): Promise<NestSavantResponse> {
  return postJson<NestSavantResponse>(`/games/${gameId}/savant/refresh?layers=${encodeURIComponent(layers)}`);
}

export async function loadPlayerSavant(mlbPlayerId: number) {
  return getJson<{
    ok: true;
    player: { id: string; mlb_player_id: number; full_name: string; bat_side: string | null; pitch_hand: string | null; primary_position: string | null };
    recent_lineup_slots: Array<{
      game_id: string; mlb_game_pk: number; official_date: string; game_status: string; side: string;
      batting_order: number; xwoba: number | null; xslg: number | null; xba: number | null;
      barrel_rate: number | null; hard_hit_pct: number | null;
    }>;
  }>(`/players/${mlbPlayerId}`);
}

// ——— Weather ———

export async function loadGameWeather(gameId: string): Promise<NestWeatherResponse> {
  return getJson<NestWeatherResponse>(`/games/${gameId}/weather`);
}

export async function refreshGameWeather(gameId: string): Promise<NestWeatherResponse & { sync: { gameId: string; observations: number; skipped?: boolean; reason?: string } }> {
  return postJson(`/games/${gameId}/weather/refresh`);
}

// ——— Odds / F5 ———

export async function loadGameF5Tracks(gameId: string): Promise<NestF5Tracks> {
  return getJson<NestF5Tracks>(`/games/${gameId}/odds/f5`);
}

export async function loadGameF5Track(gameId: string, stage: F5OddsStage): Promise<NestF5Snapshot> {
  return getJson<NestF5Snapshot>(`/games/${gameId}/odds/f5?stage=${stage}`);
}

export async function refreshGameF5(
  gameId: string,
  opts?: { stage?: F5OddsStage; force?: boolean; forceRebind?: boolean },
): Promise<NestF5Snapshot> {
  return postJson<NestF5Snapshot>(`/games/${gameId}/odds/f5`, {
    force: opts?.force,
    force_rebind: opts?.forceRebind,
    stage: opts?.stage,
  });
}

export async function refreshGameFullOdds(gameId: string, opts?: { forceRebind?: boolean }) {
  return postJson(`/games/${gameId}/odds`, { force_rebind: opts?.forceRebind });
}

export async function listWinlineMatches(opts?: { refresh?: boolean }): Promise<{ ok: true; updated_at: string; count: number; matches: NestWinlineMatch[] }> {
  const q = opts?.refresh ? "?refresh=1" : "";
  return getJson(`/odds/winline/matches${q}`);
}

// ——— Pipeline / ops ———

export async function loadPipelineStatus(): Promise<PipelineStatus> {
  return getJson<PipelineStatus>("/ops/pipeline");
}

export async function tickPipeline(body: { game_id?: string; mlb_game_pk?: number }): Promise<PipelineTickResponse> {
  return postJson<PipelineTickResponse>("/ops/pipeline/tick", body);
}

export async function runPipeline(reason: "slate" | "prematch" | "stage_watch" | "final_probe"): Promise<PipelineRunResponse> {
  return postJson<PipelineRunResponse>("/ops/pipeline/run", { reason });
}

// ——— Users (admin) ———

export async function loadUsers(): Promise<SafeUser[]> {
  return getJson<SafeUser[]>("/users");
}

export async function createUser(body: { login?: string; password?: string; telegramId?: string; telegramUsername?: string; displayName?: string; avatarUrl?: string; status?: "GUEST" | "USER" }): Promise<SafeUser> {
  return postJson<SafeUser>("/users", body);
}

export async function setUserStatus(id: string, status: "GUEST" | "USER"): Promise<SafeUser> {
  return patchJson<SafeUser>(`/users/${id}/status`, { status });
}

export async function setUserCredentials(id: string, login: string, password: string): Promise<SafeUser> {
  return patchJson<SafeUser>(`/users/${id}/credentials`, { login, password });
}
