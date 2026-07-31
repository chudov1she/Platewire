import { archiveUrl, defaultArchiveDate } from "@/lib/routes";
import { copy } from "@/lib/copy";

export type NavIconName = "home" | "archive" | "ledger" | "agent" | "settings";

export type NavItem = {
  id: string;
  to: string;
  label: string;
  shortLabel?: string;
  icon: NavIconName;
  end?: boolean;
  matchPrefix?: string;
  /** Extra path prefixes that keep this item active (nested routes). */
  activePrefixes?: string[];
};

/** Mobile bottom nav — settings lives in header */
export const MOBILE_NAV: NavItem[] = [
  {
    id: "home",
    to: "/",
    label: copy.nav.home,
    icon: "home",
    end: true,
    activePrefixes: ["/game", "/player", "/official", "/match"]
  },
  {
    id: "archive",
    to: archiveUrl(defaultArchiveDate()),
    label: copy.nav.archive,
    icon: "archive",
    matchPrefix: "/archive"
  },
  { id: "ledger", to: "/ledger", label: copy.nav.ledger, icon: "ledger", matchPrefix: "/ledger" },
  { id: "agent", to: "/agent", label: copy.nav.agent, icon: "agent", matchPrefix: "/agent" }
];

/** Desktop primary links (settings below separator in rail) */
export const DESKTOP_NAV: NavItem[] = [...MOBILE_NAV];

export const SETTINGS_NAV: NavItem = {
  id: "settings",
  to: "/settings",
  label: copy.nav.settings,
  icon: "settings",
  matchPrefix: "/settings"
};

export const PRIMARY_NAV = MOBILE_NAV;

export function isNavItemActive(pathname: string, item: NavItem) {
  if (item.activePrefixes?.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  if (item.matchPrefix) return pathname.startsWith(item.matchPrefix);
  if (item.end) return pathname === "/" || pathname === "";
  return pathname.startsWith(item.to);
}

/** Short section title for the header (mobile + desktop). */
export function sectionTitle(pathname: string): string {
  if (pathname.startsWith("/settings")) return copy.nav.settings;
  if (pathname.startsWith("/archive")) return copy.nav.archive;
  if (pathname.startsWith("/ledger")) return copy.nav.ledger;
  if (pathname.startsWith("/agent")) return copy.nav.agent;
  if (pathname.startsWith("/game") || pathname.startsWith("/match")) return copy.home.title;
  if (pathname.startsWith("/player") || pathname.startsWith("/official")) return copy.home.title;
  if (pathname === "/" || pathname === "") return copy.nav.home;
  return copy.brand;
}
