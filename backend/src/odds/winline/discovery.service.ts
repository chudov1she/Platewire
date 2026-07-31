import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright';

export type WinlineEventMeta = {
  event_id: number;
  team1: string;
  team2: string;
  league: string;
  start_time: number;
  is_live: boolean;
  href: string;
};

function isNoiseToken(t: string): boolean {
  const low = t.toLowerCase().trim();
  if (
    [
      'live',
      'лайв',
      'сегодня',
      'завтра',
      'бейсбол',
      'baseball',
      'mlb',
      'сша',
      'usa',
    ].includes(low)
  ) {
    return true;
  }
  return /^[\d:./\-+]+$/.test(t);
}

function related(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  return al.includes(bl) || bl.includes(al);
}

function pickTeams(parts: string[], text: string): [string, string] {
  const lines = (text || '')
    .split(/[\n\r]+/)
    .map((ln) => ln.trim())
    .filter(
      (ln) =>
        ln &&
        !isNoiseToken(ln) &&
        !/^[\d:./\-+]+$/.test(ln) &&
        ln.length >= 2,
    );

  if (lines.length >= 4) {
    const home = `${lines[0]} ${lines[1]}`.trim().slice(0, 60);
    const away = `${lines[2]} ${lines[3]}`.trim().slice(0, 60);
    if (home && away && !related(home, away)) return [home, away];
  }
  if (lines.length >= 2 && !related(lines[0], lines[1])) {
    return [lines[0].slice(0, 60), lines[1].slice(0, 60)];
  }

  for (const pat of [/(.+?)\s+[-–—]\s+(.+)/, /(.+?)\s+vs\.?\s+(.+)/i]) {
    const m = (text || '').replace(/\n/g, ' ').match(pat);
    if (m) {
      const left = m[1].trim().slice(0, 60);
      const right = m[2]
        .trim()
        .split(/\s{2,}|\d{1,2}:\d{2}/)[0]
        .trim()
        .slice(0, 60);
      if (left.length >= 2 && right.length >= 2 && !related(left, right)) {
        return [left, right];
      }
    }
  }

  const rawTokens: string[] = [];
  for (const raw of parts) {
    const t = (raw || '').trim();
    if (t.length < 3 || t.length > 60 || isNoiseToken(t)) continue;
    if (!rawTokens.includes(t)) rawTokens.push(t);
  }

  const filtered: string[] = [];
  for (const t of [...rawTokens].sort((a, b) => b.length - a.length)) {
    if (filtered.some((kept) => related(t, kept))) continue;
    filtered.push(t);
  }
  const ordered = rawTokens.filter((t) => filtered.includes(t));
  if (ordered.length >= 2) {
    return [ordered[0].slice(0, 60), ordered[1].slice(0, 60)];
  }
  if (ordered.length === 1) return [ordered[0].slice(0, 60), ''];
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  return [cleaned.slice(0, 40) || 'event', ''];
}

type ScrapedLink = {
  id: number;
  parts: string[];
  text: string;
  href: string;
};

function scrapeEventLinksInPage(): ScrapedLink[] {
  const blocked = new Set(['ASIDE', 'NAV', 'HEADER', 'FOOTER']);
  const isBlocked = (el: Element | null) => {
    let cur: Element | null = el;
    while (cur && cur !== document.body) {
      if (blocked.has(cur.tagName)) return true;
      const cls =
        (cur.className && String(cur.className).toLowerCase()) || '';
      if (
        cls.includes('sidebar') ||
        cls.includes('aside') ||
        cls.includes('popular') ||
        cls.includes('top-event') ||
        cls.includes('topline') ||
        cls.includes('menu') ||
        cls.includes('nav')
      ) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  };

  const links = [...document.querySelectorAll('a[href*="/stavki/event/"]')];
  const out: ScrapedLink[] = [];
  const seen = new Set<number>();
  for (const a of links) {
    if (isBlocked(a)) continue;
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/stavki\/event\/(\d+)/);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);

    const teamNodes = [
      ...a.querySelectorAll(
        '[class*="team"], [class*="Team"], [class*="participant"], [class*="Competitor"]',
      ),
    ]
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 1 && t.length < 80);

    const parts = [...a.querySelectorAll('div,span')]
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t.length > 1 && t.length < 80);

    const text = ((a as HTMLElement).innerText || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    out.push({
      id,
      parts: [...new Set(teamNodes.length >= 2 ? teamNodes : parts)],
      text,
      href,
    });
  }
  return out;
}

@Injectable()
export class WinlineDiscoveryService {
  private readonly logger = new Logger(WinlineDiscoveryService.name);

  constructor(private readonly config: ConfigService) {}

  async discoverMlbEvents(): Promise<WinlineEventMeta[]> {
    const mlbUrl =
      this.config.get<string>('WINLINE_MLB_URL') ??
      'https://winline.ru/stavki/sport/bejsbol/ssha/mlb';
    const baseballUrl =
      this.config.get<string>('WINLINE_BASEBALL_URL') ??
      'https://winline.ru/stavki/sport/bejsbol';

    const metas: WinlineEventMeta[] = [];
    const seen = new Set<number>();

    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    try {
      const page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ru-RU',
      });
      await page.goto(mlbUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
        referer: baseballUrl,
      });
      await page.waitForTimeout(4500);
      try {
        await page.waitForSelector('a[href*="/stavki/event/"]', {
          timeout: 15_000,
        });
      } catch {
        /* empty */
      }

      const raw = await page.evaluate(scrapeEventLinksInPage);

      for (const row of raw) {
        const eid = Number(row.id);
        if (seen.has(eid)) continue;
        seen.add(eid);
        const [team1, team2] = pickTeams(row.parts, row.text);
        const isLive =
          (row.text || '').toLowerCase().includes('live') ||
          (row.text || '').toLowerCase().includes('лайв');
        metas.push({
          event_id: eid,
          team1,
          team2,
          league: 'MLB',
          start_time: 0,
          is_live: isLive,
          href: row.href || `/stavki/event/${eid}`,
        });
      }
    } finally {
      await browser.close();
    }

    this.logger.log(`discovery.mlb_ok events=${metas.length}`);
    return metas;
  }
}
