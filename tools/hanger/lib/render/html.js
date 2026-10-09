'use strict';
// HTML writer: formats the section model into ONE self-contained, printable page (A4).
// No external reference of any kind; charts are inline SVG that draws without script.
const { esc, ascii } = require('./format');
const { renderCharts } = require('./svg-charts');

const CSS = `
@page { size: A4; margin: 10mm 10mm 12mm 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.38; color: #000; background: #fff; }
.page { max-width: 190mm; margin: 0 auto; padding: 4px 2px; }
h1 { font-size: 17px; margin: 0 0 2px 0; overflow-wrap: anywhere; }
h2 { font-size: 13px; margin: 14px 0 5px 0; border-bottom: 2px solid #000; padding-bottom: 2px; }
h3 { font-size: 11.5px; margin: 10px 0 3px 0; }
.sub { font-size: 11px; margin: 0 0 6px 0; color: #222; }
.banner { border: 2px solid #000; border-left: 10px solid #000; padding: 6px 9px; margin: 6px 0; break-inside: avoid; page-break-inside: avoid; }
.banner.open-scope { background: #fff3cd; }
.banner .bt { font-weight: bold; letter-spacing: 0.05em; margin-bottom: 3px; }
.banner p { margin: 2px 0; overflow-wrap: anywhere; }
.finding { border: 2px solid #000; padding: 8px 10px; margin: 4px 0; break-inside: avoid; page-break-inside: avoid; }
.finding .head { font-size: 15px; font-weight: bold; margin-bottom: 4px; }
.finding p { margin: 3px 0; font-size: 12px; overflow-wrap: anywhere; }
table { border-collapse: collapse; font-size: 10px; margin: 4px 0; width: 100%; }
th, td { border: 1px solid #444; padding: 3px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
thead th { background: #eee; border-bottom: 2px solid #000; }
table.kv th { width: 26%; background: #f4f4f4; }
td.r { text-align: right; }
ul, ol { margin: 3px 0 3px 18px; padding: 0; }
li { margin: 1px 0; overflow-wrap: anywhere; }
.note, .muted { font-size: 10px; color: #222; }
.copyblock { border: 2px dashed #000; padding: 6px 9px; margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
.copyblock .ct { font-weight: bold; margin-bottom: 3px; }
.copyblock pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: Consolas, "Courier New", monospace; font-size: 10px; margin: 0; }
.chartkey { font-size: 10px; margin: 4px 0 8px 0; }
figure.chart { margin: 8px 0; break-inside: avoid; page-break-inside: avoid; }
figure.chart h3 { margin: 0 0 2px 0; }
figure.chart svg { display: block; width: 100%; height: auto; max-width: 100%; }
.caption { font-size: 9.5px; margin: 2px 0; color: #222; }
ul.legend { list-style: none; margin: 2px 0; padding: 0; font-size: 9.5px; display: flex; flex-wrap: wrap; gap: 2px 14px; }
ul.legend li { margin: 0; }
ul.legend svg { display: inline-block; width: 26px; height: 8px; vertical-align: middle; }
ul.legend .n { color: #444; }
details.datatable { font-size: 9.5px; margin: 2px 0; }
details.datatable table { font-size: 9px; width: auto; }
.noprint { margin: 6px 0; }
@media print {
  .noprint { display: none; }
  body { font-size: 10.5px; }
  .page { max-width: none; padding: 0; }
  tr { break-inside: avoid; }
  h2 { break-after: avoid; }
}
@media screen {
  body { background: #f2f2f2; }
  .page { background: #fff; padding: 10px 14px; margin: 10px auto; box-shadow: 0 0 4px #999; }
}`;

function table(b) {
  const th = b.head.map((h) => `<th>${esc(h)}</th>`).join('');
  const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table class="${esc(b.cls || '')}" data-rows="${b.rows.length}"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
}

function block(b, m, ctx) {
  switch (b.t) {
    case 'title': return `<h1>${esc(b.text)}</h1><p class="sub">${esc(b.sub)}</p>`;
    case 'banner': return `<div class="banner ${esc(b.cls)}"><div class="bt">${esc(b.title)}</div>${b.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`;
    case 'kv': return `<table class="kv"><tbody>${b.rows.map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
    case 'finding': return `<div class="finding" data-class="${esc(b.cls)}"><div class="head">${esc(b.head)}</div>${b.lines.map((l) => `<p class="fl">${esc(l)}</p>`).join('')}</div>`;
    case 'p': return `<p class="${esc(b.cls || '')}">${esc(b.text)}</p>`;
    case 'sub': return `<h3>${esc(b.text)}</h3>`;
    case 'ul': return `<ul class="${esc(b.cls || '')}">${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'ol': return `<ol>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`;
    case 'table': return table(b);
    case 'charts': return m.ex ? renderCharts(m.ex).html : '<p class="not-in-pack">Not in this file: charts need the trace.</p>';
    default: return '';
  }
}

// emailText: the exact text of the .email.txt draft, embedded as a copy block after section 3
function renderHtml(m, files = {}, emailText = null) {
  const parts = [];
  m.sections.forEach((s, i) => {
    parts.push(`<section id="sec-${esc(s.id)}" data-section="${esc(s.id)}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.blocks.map((b) => block(b, m, files)).join('\n')}</section>`);
    if (s.id === 'actions' && emailText) parts.push(`<div class="copyblock" id="email-draft"><div class="ct">Ready-to-send email draft (select and copy; the tool never sends anything)</div><pre id="email-text">${esc(emailText)}</pre></div>`);
  });
  const title = ascii(m.title);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">
<div class="noprint"><button type="button" onclick="window.print()">Print / save as PDF</button> <span class="muted">Everything on this page, including every chart, is drawn without script and prints.</span></div>
${parts.join('\n')}
</div>
</body>
</html>
`;
  return ascii(html);
}

module.exports = { renderHtml, CSS };
