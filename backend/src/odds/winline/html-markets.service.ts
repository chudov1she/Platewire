import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium } from 'playwright';
import type { RawCategory } from './normalize.js';

export type HtmlMarketsResult = {
  event_id: number;
  team1: string;
  team2: string;
  categories: RawCategory[];
  source: string;
  href: string;
};

function parseOdd(text: string): number | null {
  const raw = (text || '').trim().replace(',', '.').replace('−', '-');
  if (!raw || ['-', '—', '–'].includes(raw)) return null;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < 1.01 || val > 500) return null;
  return Math.round(val * 1000) / 1000;
}

type ExtractedPage = {
  teams: { team1: string; team2: string };
  categories: Array<{
    group: string;
    title: string;
    rows: Array<{
      label: string;
      selections: Array<{ name: string; odd: string }>;
    }>;
  }>;
};

function extractMarketsInPage(): ExtractedPage {
  const clean = (s: string | null | undefined) =>
    (s || '').replace(/\s+/g, ' ').trim();
  const oddOf = (el: Element) => {
    const coef = el.querySelector(
      '.market-row-btn__coef, .odd-btn__coef, .coefficient',
    );
    const t = clean(coef ? coef.textContent : el.textContent);
    const m = t.match(/(\d+[.,]\d+|\d+)/);
    return m ? m[1].replace(',', '.') : '';
  };
  const nameOf = (el: Element) => {
    const name = el.querySelector(
      '.market-row-btn__text, .odd-btn__text, .odd-btn__name',
    );
    return clean(name ? name.textContent : '');
  };

  const teams = { team1: '', team2: '' };
  const headerTeams = document.querySelectorAll(
    '.marketbook-header [class*="team"], .marketbook-header__team, .event-header__team',
  );
  if (headerTeams.length >= 2) {
    teams.team1 = clean(headerTeams[0].textContent);
    teams.team2 = clean(headerTeams[1].textContent);
  }

  const categories: ExtractedPage['categories'] = [];

  const sticky = document.querySelectorAll('.bet-line__market-name');
  if (sticky.length) {
    const rows: ExtractedPage['categories'][0]['rows'] = [];
    for (const nameEl of sticky) {
      const wrap =
        nameEl.closest('[class*="bet-line"]') || nameEl.parentElement;
      const title = clean(nameEl.textContent);
      if (!title) continue;
      const btns = [
        ...(wrap || document).querySelectorAll('.odd-btn, .market-row-btn'),
      ].filter((b) => (wrap ? wrap.contains(b) : false));
      const selections = btns
        .map((b) => ({
          name:
            nameOf(b) ||
            clean(b.textContent).replace(/[\d.,]+$/, '').trim(),
          odd: oddOf(b),
        }))
        .filter((s) => s.odd);
      if (selections.length) {
        rows.push({ label: title, selections });
      }
    }
    if (rows.length) {
      categories.push({ group: 'Основное', title: 'Линия матча', rows });
    }
  }

  const marketNodes = [...document.querySelectorAll('.market')];
  for (const market of marketNodes) {
    const titleEl = market.querySelector(
      '.market-title, .market-header .market-title, h3, h4',
    );
    let title = clean(titleEl ? titleEl.textContent : '');
    title = title.split('\n')[0].trim();
    title = title.replace(/[Пп]1\s*[\d.].*$/, '').trim();
    if (!title || title.length > 120) continue;

    let group = '';
    const groupEl = market.closest('.market-group');
    if (groupEl) {
      const gt = groupEl.querySelector('.market-group__title');
      group = clean(gt ? gt.textContent : '');
    }

    const rows: ExtractedPage['categories'][0]['rows'] = [];
    const rowNodes = [...market.querySelectorAll('.market__row')];
    if (rowNodes.length) {
      for (const row of rowNodes) {
        const labelEl = row.querySelector('.market__row-text');
        let label = clean(labelEl ? labelEl.textContent : '');
        if (!label) label = title;
        const btns = [...row.querySelectorAll('.market-row-btn, .odd-btn')];
        const selections = btns
          .map((b) => ({
            name: nameOf(b),
            odd: oddOf(b),
          }))
          .filter((s) => s.name || s.odd);
        if (selections.length) {
          rows.push({ label, selections });
        }
      }
    } else {
      const btns = [...market.querySelectorAll('.market-row-btn, .odd-btn')];
      const selections = btns
        .map((b) => ({
          name: nameOf(b),
          odd: oddOf(b),
        }))
        .filter((s) => s.odd);
      if (selections.length) {
        rows.push({ label: title, selections });
      }
    }

    if (rows.length) {
      categories.push({ group, title, rows });
    }
  }

  return { teams, categories };
}

@Injectable()
export class WinlineHtmlMarketsService {
  private readonly logger = new Logger(WinlineHtmlMarketsService.name);
  private queue: Promise<void> = Promise.resolve();
  private active = 0;

  constructor(private readonly config: ConfigService) {}

  private get concurrency(): number {
    return Math.max(1, Number(this.config.get('FETCH_CONCURRENCY') ?? 3));
  }

  private get retries(): number {
    return Math.max(1, Number(this.config.get('ODDS_FETCH_RETRIES') ?? 3));
  }

  private get retryDelayMs(): number {
    return Math.max(
      0,
      Number(this.config.get('ODDS_RETRY_DELAY_SECONDS') ?? 1.5) * 1000,
    );
  }

  private get mlbUrl(): string {
    return (
      this.config.get<string>('WINLINE_MLB_URL') ??
      'https://winline.ru/stavki/sport/bejsbol/ssha/mlb'
    );
  }

  async fetchEventCategories(eventId: number): Promise<HtmlMarketsResult> {
    let lastErr: unknown;
    let lastEmpty: HtmlMarketsResult | null = null;
    const attempts = this.retries;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const data = await this.withConcurrency(() =>
          this.fetchOnce(eventId),
        );
        if (data.categories.length) return data;
        lastEmpty = data;
        this.logger.warn(
          `html.markets_empty event_id=${eventId} attempt=${attempt}/${attempts}`,
        );
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `html.markets_retry event_id=${eventId} attempt=${attempt}/${attempts} error=${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }

    if (lastEmpty) return lastEmpty;
    if (lastErr) throw lastErr;
    return {
      event_id: eventId,
      team1: '',
      team2: '',
      categories: [],
      source: 'html',
      href: `/stavki/sport/bejsbol/ssha/mlb/${eventId}`,
    };
  }

  private withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      while (this.active >= this.concurrency) {
        await this.queue;
      }
      this.active += 1;
      try {
        return await fn();
      } finally {
        this.active -= 1;
      }
    };
    const p = run();
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  private async fetchOnce(eventId: number): Promise<HtmlMarketsResult> {
    const url = `${this.mlbUrl.replace(/\/$/, '')}/${eventId}`;
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    try {
      const page = await browser.newPage({
        locale: 'ru-RU',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
        referer: this.mlbUrl,
      });
      try {
        await page.waitForSelector('.market, .bet-line__market-name', {
          timeout: 15_000,
        });
      } catch {
        /* empty */
      }
      await page.waitForTimeout(3500);

      const raw = await page.evaluate(extractMarketsInPage);

      const categories = this.normalizeCategories(raw.categories || []);
      const teams = raw.teams || { team1: '', team2: '' };
      this.logger.log(
        `html.markets_ok event_id=${eventId} categories=${categories.length}`,
      );
      return {
        event_id: eventId,
        team1: String(teams.team1 || ''),
        team2: String(teams.team2 || ''),
        categories,
        source: 'html',
        href: `/stavki/sport/bejsbol/ssha/mlb/${eventId}`,
      };
    } finally {
      await browser.close();
    }
  }

  private normalizeCategories(
    raw: Array<{
      group?: string;
      title?: string;
      rows?: Array<{
        label?: string;
        selections?: Array<{ name?: string; odd?: string | number | null }>;
      }>;
    }>,
  ): RawCategory[] {
    const out: RawCategory[] = [];
    const seen = new Set<string>();
    for (const cat of raw) {
      const title = String(cat.title || '').trim();
      if (!title) continue;
      const rowsOut: RawCategory['rows'] = [];
      for (const row of cat.rows || []) {
        const label = String(row.label || title).trim();
        const sels: RawCategory['rows'][0]['selections'] = [];
        for (const s of row.selections || []) {
          const name = String(s.name || '').trim();
          const odd = parseOdd(String(s.odd ?? ''));
          if (odd == null && !name) continue;
          sels.push({ name: name || '—', odd });
        }
        if (!sels.length) continue;
        rowsOut.push({ label, selections: sels });
      }
      if (!rowsOut.length) continue;
      const key = `${cat.group}|${title}|${rowsOut.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        group: String(cat.group || '').trim(),
        title,
        rows: rowsOut,
      });
    }
    return out;
  }
}
