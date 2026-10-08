# Tasks — telltale-v13

- [x] render-print.js (pack+trace, A4 CSS, no-JS safe, offline, ASCII-only)
- [x] render-charts.js (ECharts timeline/scatter/bars/strip + table fallbacks)
- [x] Verified: both sample JSONs render, tags balanced, fallbacks present (screenshot-reviewed via headless Chromium: hang labels staggered, legends bottomed, tables deduped, word-break fixed, detail deduped)
- [x] Wire `--print`/`--charts` into telltale.js modes (smoked: --print wrote .print.html)
- [x] Review; archive -- reviewed 2026-10-07 per reviews/01-03 (reviews/01-openspec-review.md, 02-data-layer-review.md, 03-inference-and-report-review.md); renderers re-specified by report-and-visualization; archived with --skip-specs
