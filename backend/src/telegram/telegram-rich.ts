/** Telegram Bot API rich HTML tables + classic <pre> fallback. */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildHtmlTable(
  headers: string[],
  rows: Array<Array<string | number>>,
  opts: { bordered?: boolean } = {},
): string {
  const bordered = opts.bordered !== false;
  const attrs = bordered ? ' bordered' : '';
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = row.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table${attrs}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function tableHtmlToPreLines(tableHtml: string): string[] {
  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  const lines: string[] = [];
  for (const row of rows) {
    const cells = [...row[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (m) => m[1]!.replace(/<[^>]+>/g, '').trim(),
    );
    if (cells.length) lines.push(cells.join(' | '));
  }
  return lines.length ? lines : [tableHtml];
}

export type RichAlertPayload = {
  title: string;
  tableHtml: string;
  footer: string;
  fallbackHtml: string;
};

export function composeRichHtml(payload: {
  title: string;
  tableHtml: string;
  footer?: string;
}): string {
  const parts = [`<h3>${escapeHtml(payload.title)}</h3>`, payload.tableHtml];
  if (payload.footer) {
    parts.push(
      `<p>${escapeHtml(payload.footer).replace(/\n/g, '<br/>')}</p>`,
    );
  }
  return parts.join('\n');
}

export function composeFallbackPre(payload: {
  title: string;
  tableHtml: string;
  footer?: string;
}): string {
  const lines = [payload.title, '', ...tableHtmlToPreLines(payload.tableHtml)];
  if (payload.footer) {
    lines.push('', payload.footer);
  }
  return `<pre>${escapeHtml(lines.join('\n'))}</pre>`;
}
