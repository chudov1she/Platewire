import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInlineMarkdown,
  markdownTableToHtml,
  markdownTableToPre,
  markdownToRichHtml,
  markdownToTelegramHtml,
} from '../telegram-markdown.js';

describe('telegram-markdown', () => {
  it('formats bold italic and code', () => {
    const html = formatInlineMarkdown('Это **важно** и `code` плюс *курсив*');
    assert.match(html, /<b>важно<\/b>/);
    assert.match(html, /<code>code<\/code>/);
    assert.match(html, /<i>курсив<\/i>/);
  });

  it('renders markdown tables as native HTML table', () => {
    const table = markdownTableToHtml([
      '| Market | Odds |',
      '| --- | --- |',
      '| Т 4.5 Б | 1.84 |',
    ]);
    assert.match(table, /<table\b/);
    assert.match(table, /<th>Market<\/th>/);
    assert.match(table, /<td>Т 4\.5 Б<\/td>/);
    assert.ok(!table.includes('<pre'));
  });

  it('classic fallback still uses pre grid', () => {
    const pre = markdownTableToPre([
      '| Market | Odds |',
      '| --- | --- |',
      '| Т 4.5 Б | 1.84 |',
    ]);
    assert.match(pre, /^<pre>/);
    assert.ok(!pre.includes('<table'));
  });

  it('rich HTML keeps native tables and headings', () => {
    const md = `## Итог
Ставим **over 4.5**.

| Market | Odds | Value |
| --- | --- | --- |
| Т 4.5 Б | 1.84 | +12% |

- readiness ок
- SP ERA высокий

\`\`\`
lambda=1.2
\`\`\`
`;
    const rich = markdownToRichHtml(md);
    assert.match(rich, /<h2>Итог<\/h2>/);
    assert.match(rich, /<table\b/);
    assert.match(rich, /<ul>/);
    assert.match(rich, /<li>readiness ок<\/li>/);
    assert.match(rich, /<pre>/);
    assert.match(rich, /lambda=1\.2/);
    assert.ok(!/<pre>[\s\S]*Market/.test(rich));
  });

  it('classic HTML still converts a full agent-style reply', () => {
    const md = `## Итог
Ставим **over 4.5**.

| Market | Odds | Value |
| --- | --- | --- |
| Т 4.5 Б | 1.84 | +12% |

- readiness ок
`;
    const html = markdownToTelegramHtml(md);
    assert.match(html, /<b>Итог<\/b>/);
    assert.match(html, /<b>over 4\.5<\/b>/);
    assert.match(html, /<pre>/);
    assert.match(html, /• readiness ок/);
  });
});
