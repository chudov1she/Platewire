/** Telegram Mini App / WebApp helpers (client-side). */

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
  };
  ready: () => void;
  expand: () => void;
  themeParams?: Record<string, string>;
  colorScheme?: "light" | "dark";
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** True when running inside Telegram client as a Mini App with signed initData. */
export function isTelegramWebApp(): boolean {
  const wa = getTelegramWebApp();
  return Boolean(wa?.initData && wa.initData.length > 0);
}

export function prepareTelegramWebApp(): TelegramWebApp | null {
  const wa = getTelegramWebApp();
  if (!wa) return null;
  try {
    wa.ready();
    wa.expand();
  } catch {
    /* ignore */
  }
  return wa;
}
