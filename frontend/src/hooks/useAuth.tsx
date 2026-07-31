"use client";

import React from "react";
import Script from "next/script";
import { TELEGRAM_BOT_USERNAME } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/page-loader";
import {
  fetchMe,
  login as apiLogin,
  loginWithTelegram as apiLoginTelegram,
  loginWithTelegramWebApp as apiLoginWebApp,
  ApiError,
} from "@/lib/api";
import { getAccessToken, setAccessToken } from "@/lib/auth-storage";
import { copy } from "@/lib/copy";
import {
  isTelegramWebApp,
  prepareTelegramWebApp,
} from "@/lib/telegram-webapp";
import type { SafeUser } from "@/types";

type TelegramWidgetUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onPlatewireTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

type SessionAuth = {
  authenticated: boolean;
  user: SafeUser | null;
};

type AuthContextValue = {
  status: SessionAuth | null;
  loading: boolean;
  user: SafeUser | null;
  isAdmin: boolean;
  inTelegram: boolean;
  login: (login: string, password: string) => Promise<void>;
  loginWithTelegram: (payload: TelegramWidgetUser) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

export const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

async function bootstrapSession(): Promise<SessionAuth> {
  const existing = getAccessToken();
  if (existing) {
    try {
      const user = await fetchMe();
      return { authenticated: true, user };
    } catch {
      setAccessToken(null);
    }
  }

  // Inside Telegram Mini App — auto-auth via signed initData (no form).
  prepareTelegramWebApp();
  if (isTelegramWebApp()) {
    const initData = window.Telegram!.WebApp!.initData;
    try {
      const data = await apiLoginWebApp(initData);
      return { authenticated: true, user: data.user };
    } catch (err) {
      // Guest / invalid — leave unauthenticated; AuthGate shows TG-specific UI.
      if (err instanceof ApiError && err.status === 403) {
        return { authenticated: false, user: null };
      }
      throw err;
    }
  }

  return { authenticated: false, user: null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<SessionAuth | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [inTelegram, setInTelegram] = React.useState(false);
  const [scriptReady, setScriptReady] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await bootstrapSession();
      setInTelegram(isTelegramWebApp());
      setStatus(next);
    } catch {
      setAccessToken(null);
      setStatus({ authenticated: false, user: null });
      setInTelegram(isTelegramWebApp());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!scriptReady) return;
    void refresh();
  }, [scriptReady, refresh]);

  // Fallback if script already present (HMR / cached).
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      setScriptReady(true);
    }
    const t = window.setTimeout(() => setScriptReady(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const login = React.useCallback(async (loginName: string, password: string) => {
    setLoading(true);
    try {
      const data = await apiLogin(loginName, password);
      setStatus({ authenticated: true, user: data.user });
    } finally {
      setLoading(false);
    }
  }, []);

  const loginWithTelegram = React.useCallback(async (payload: TelegramWidgetUser) => {
    setLoading(true);
    try {
      const data = await apiLoginTelegram(payload);
      setStatus({ authenticated: true, user: data.user });
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = React.useCallback(() => {
    setAccessToken(null);
    setStatus({ authenticated: false, user: null });
  }, []);

  const user = status?.user ?? null;
  const isAdmin = user?.status === "ADMIN";

  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <AuthContext.Provider
        value={{
          status,
          loading,
          user,
          isAdmin,
          inTelegram,
          login,
          loginWithTelegram,
          logout,
          refresh,
        }}
      >
        {children}
      </AuthContext.Provider>
    </>
  );
}

function TelegramLoginWidget({
  onAuth,
  disabled,
}: {
  onAuth: (user: TelegramWidgetUser) => void;
  disabled?: boolean;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const onAuthRef = React.useRef(onAuth);
  onAuthRef.current = onAuth;

  React.useEffect(() => {
    if (disabled) return;
    const host = hostRef.current;
    if (!host) return;

    window.onPlatewireTelegramAuth = (user) => {
      onAuthRef.current(user);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onPlatewireTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    host.replaceChildren(script);

    return () => {
      delete window.onPlatewireTelegramAuth;
      host.replaceChildren();
    };
  }, [disabled]);

  return (
    <div
      className="flex min-h-10 w-full justify-center [&_iframe]:max-w-full"
      ref={hostRef}
    />
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, loading, login, loginWithTelegram, inTelegram, refresh } =
    useAuth();
  const [loginName, setLoginName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  if (!status?.authenticated) {
    // Inside Telegram Mini App — no login/password panel; ID comes from initData.
    if (inTelegram) {
      return (
        <div className="flex min-h-dvh items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">{copy.brand}</h1>
            <p className="text-sm text-muted-foreground">
              Telegram ID получен, но доступа ещё нет (гость). Попроси админа
              выдать USER/ADMIN и нажми «Повторить».
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void refresh().finally(() => setBusy(false));
              }}
            >
              Повторить
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold">{copy.brand}</h1>
            <p className="text-sm text-muted-foreground">
              Вход в браузере. В Telegram Mini App авторизация автоматическая.
            </p>
          </div>

          <TelegramLoginWidget
            disabled={busy}
            onAuth={async (tgUser) => {
              setBusy(true);
              setError(null);
              try {
                await loginWithTelegram(tgUser);
              } catch (err) {
                const msg =
                  err instanceof ApiError
                    ? err.message
                    : "Ошибка входа через Telegram";
                setError(
                  /guest|pending|approval/i.test(msg)
                    ? "Аккаунт ещё гость — нужен апрув админа."
                    : msg,
                );
              } finally {
                setBusy(false);
              }
            }}
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <button
            className="w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
            type="button"
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Скрыть вход по паролю" : "Войти логином и паролем"}
          </button>

          {showPassword ? (
            <form
              className="space-y-4 border-t border-border pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await login(loginName, password);
                } catch (err) {
                  setError(
                    err instanceof ApiError ? err.message : "Ошибка входа",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="login">Логин</Label>
                <Input
                  id="login"
                  value={loginName}
                  onChange={(e) => setLoginName(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Вход…" : "Войти"}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
