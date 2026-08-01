/**
 * Agent Markdown → Telegram delivery formats.
 *
 * Primary path: Bot API 10.1+ sendRichMessage with `markdown` (native GFM
 * tables, headings, lists, details, math, …).
 * Fallback: rich HTML with real <table> tags.
 * Last resort: classic sendMessage HTML (tables as <pre>).
 */

import { buildHtmlTable, escapeHtml } from './telegram-rich.js';

export function escapeTelegramHtml(text: string): string {
  return escapeHtml(text);
}

type Segment =
  | { type: 'fence'; lang: string; code: string }
  | { type: 'table'; lines: string[] }
  | { type: 'text'; text: string };

/** Split markdown into fenced code / pipe-tables / free text. */
export function splitMarkdownSegments(md: string): Segment[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Segment[] = [];
  let i = 0;
  let textBuf: string[] = [];

  const flushText = () => {
    if (!textBuf.length) return;
    out.push({ type: 'text', text: textBuf.join('\n') });
    textBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^```([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushText();
      const lang = fence[1] ?? '';
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        code.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({ type: 'fence', lang, code: code.join('\n') });
      continue;
    }

    if (isTableStart(lines, i)) {
      flushText();
      const tableLines: string[] = [];
      while (i < lines.length && looksLikeTableRow(lines[i]!)) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      out.push({ type: 'table', lines: tableLines });
      continue;
    }

    textBuf.push(line);
    i += 1;
  }
  flushText();
  return out;
}

function looksLikeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (/^\|?[\s:-]+\|[\s|:-]*$/.test(t)) return true;
  return t.startsWith('|') || t.endsWith('|') || /\|.+\|/.test(t);
}

function isTableStart(lines: string[], i: number): boolean {
  const a = lines[i]?.trim() ?? '';
  const b = lines[i + 1]?.trim() ?? '';
  if (!looksLikeTableRow(a)) return false;
  if (/^\|?[\s:-]+\|[\s|:-]*$/.test(b)) return true;
  return looksLikeTableRow(b);
}

function parseTableCells(row: string): string[] {
  let t = row.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function isSeparatorRow(row: string): boolean {
  return /^[\s|:-]+$/.test(row.trim()) && row.includes('-');
}

function tableRows(tableLines: string[]): string[][] {
  return tableLines
    .filter((l) => !isSeparatorRow(l))
    .map(parseTableCells)
    .filter((r) => r.length > 0);
}

/** Native Bot API 10.1+ HTML table (same shape as bet alerts). */
export function markdownTableToHtml(tableLines: string[]): string {
  const rows = tableRows(tableLines);
  if (!rows.length) {
    return `<pre>${escapeHtml(tableLines.join('\n'))}</pre>`;
  }
  const headers = rows[0]!;
  const body = rows.slice(1);
  return buildHtmlTable(headers, body, { bordered: true });
}

/** Classic sendMessage fallback: monospace <pre> grid. */
export function markdownTableToPre(tableLines: string[]): string {
  const rows = tableRows(tableLines);
  if (!rows.length) {
    return `<pre>${escapeHtml(tableLines.join('\n'))}</pre>`;
  }
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(1, ...rows.map((r) => Array.from(r[c] ?? '').length)),
  );
  const pad = (cell: string, w: number) => {
    const chars = Array.from(cell);
    if (chars.length >= w) return cell;
    return cell + ' '.repeat(w - chars.length);
  };
  const fmt = (r: string[]) =>
    widths.map((w, i) => pad(r[i] ?? '', w)).join('  ');
  const lines = rows.map(fmt);
  if (rows.length >= 1) {
    const rule = widths.map((w) => '-'.repeat(w)).join('  ');
    lines.splice(1, 0, rule);
  }
  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}

/** Inline markdown → HTML tags (text already not in code/pre). */
export function formatInlineMarkdown(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    const i = codes.length;
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000C${i}\u0000`;
  });

  s = escapeHtml(s);

  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${url.replace(/"/g, '')}">${label}</a>`,
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_]+)__/g, '<b>$1</b>');
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
  s = s.replace(
    /(^|[^a-zA-Z0-9_])_([^_\n]+)_(?![a-zA-Z0-9_])/g,
    '$1<i>$2</i>',
  );
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, n: string) => codes[Number(n)] ?? '');

  return s;
}

type TextMode = 'rich' | 'classic';

function formatTextBlock(text: string, mode: TextMode): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = formatInlineMarkdown(para.join(' '));
    out.push(mode === 'rich' ? `<p>${joined}</p>` : joined);
    para = [];
  };

  const flushList = () => {
    if (!listKind || !listItems.length) {
      listKind = null;
      listItems = [];
      return;
    }
    if (mode === 'rich') {
      const tag = listKind === 'ul' ? 'ul' : 'ol';
      out.push(
        `<${tag}>${listItems.map((i) => `<li>${i}</li>`).join('')}</${tag}>`,
      );
    } else {
      out.push(...listItems);
    }
    listKind = null;
    listItems = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      flushPara();
      flushList();
      if (mode === 'classic') out.push('');
      continue;
    }

    const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(h[1]!.length, 6);
      const body = formatInlineMarkdown(h[2]!);
      out.push(mode === 'rich' ? `<h${level}>${body}</h${level}>` : `<b>${body}</b>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      flushList();
      out.push(mode === 'rich' ? '<hr/>' : '────────');
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ul) {
      flushPara();
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul';
      const item = formatInlineMarkdown(ul[1]!);
      listItems.push(mode === 'rich' ? item : `• ${item}`);
      continue;
    }

    const ol = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (ol) {
      flushPara();
      if (listKind && listKind !== 'ol') flushList();
      listKind = 'ol';
      const item = formatInlineMarkdown(ol[2]!);
      listItems.push(mode === 'rich' ? item : `${ol[1]}. ${item}`);
      continue;
    }

    const bq = /^>\s?(.*)$/.exec(trimmed);
    if (bq) {
      flushPara();
      flushList();
      out.push(
        `<blockquote>${formatInlineMarkdown(bq[1] || ' ')}</blockquote>`,
      );
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();

  return out
    .join(mode === 'rich' ? '\n' : '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fenceToHtml(lang: string, code: string): string {
  const escaped = escapeHtml(code);
  if (lang) {
    return `<pre><code class="language-${escapeHtml(lang)}">${escaped}</code></pre>`;
  }
  return `<pre>${escaped}</pre>`;
}

/** Markdown → Bot API 10.1 rich HTML (native tables, headings, lists). */
export function markdownToRichHtml(md: string): string {
  const segments = splitMarkdownSegments(md.trim());
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'fence') {
      parts.push(fenceToHtml(seg.lang, seg.code));
    } else if (seg.type === 'table') {
      parts.push(markdownTableToHtml(seg.lines));
    } else if (seg.text.trim()) {
      parts.push(formatTextBlock(seg.text, 'rich'));
    }
  }
  return parts.join('\n').trim() || `<p>${escapeHtml(md)}</p>`;
}

/** Markdown → classic sendMessage HTML (tables as <pre>). */
export function markdownToTelegramHtml(md: string): string {
  const segments = splitMarkdownSegments(md.trim());
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'fence') {
      parts.push(`<pre>${escapeHtml(seg.code)}</pre>`);
    } else if (seg.type === 'table') {
      parts.push(markdownTableToPre(seg.lines));
    } else if (seg.text.trim()) {
      parts.push(formatTextBlock(seg.text, 'classic'));
    }
  }
  return parts.join('\n\n').trim() || escapeHtml(md);
}
