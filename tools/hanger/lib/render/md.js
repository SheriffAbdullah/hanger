'use strict';
// Markdown writer: formats the section model (lib/render/sections.js). Same section order as the HTML report.
const { ascii } = require('./format');
const { planPanels } = require('./svg-charts');

const cell = (s) => ascii(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head, rows) => [`| ${head.map(cell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

function block(b, m, files) {
  switch (b.t) {
    case 'title': return null;
    case 'banner': return `> **${ascii(b.title)}**\n${b.lines.map((l) => `> ${ascii(l)}`).join('\n>\n')}`;
    case 'kv': return table(['Item', 'Value'], b.rows);
    case 'finding': return `**${ascii(b.head)}**\n\n${b.lines.map((l) => `- ${ascii(l)}`).join('\n')}`;
    case 'p': return ascii(b.text);
    case 'sub': return `### ${ascii(b.text)}`;
    case 'ul': return b.items.map((i) => `- ${ascii(i)}`).join('\n');
    case 'ol': return b.items.map((i, k) => `${k + 1}. ${ascii(i)}`).join('\n');
    case 'table': return table(b.head, b.rows);
    case 'charts': {
      if (!m.ex) return 'Not in this file: charts need the trace.';
      const titles = planPanels(m.ex).map((p) => p.title);
      return `Charts (${titles.join(', ')}) are drawn on one shared clock in ${files.htmlName ? files.htmlName : 'the .report.html file'}. The values behind them are in the JSON report.`;
    }
    default: return '';
  }
}

function renderMarkdown(m, files = {}) {
  const out = [`# ${ascii(m.title)}`];
  const title = m.sections[0].blocks.find((b) => b.t === 'title');
  if (title) out.push(`_${ascii(title.sub)}_`);
  if (files.emailName) out.push(`Ready-to-send email draft: \`${files.emailName}\` (a draft file only; nothing is sent).`);
  m.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${ascii(s.title)}`);
    for (const b of s.blocks) { const t = block(b, m, files); if (t) out.push(t); }
  });
  return `${out.join('\n\n')}\n`;
}

module.exports = { renderMarkdown };
