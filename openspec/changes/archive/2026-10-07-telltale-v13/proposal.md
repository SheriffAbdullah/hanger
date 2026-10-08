# Change: telltale-v13 — printable + charts renderers (presentation)

## Why
Persona briefs demand a printable one-pager (manager) and visual timelines
(developer) rendered from the stable pack/trace schemas — without touching
collectors. Two renderer agents built them in parallel against frozen schemas.

## What Changes (presentation only, zero collector changes)
- `tools/telltale/render-print.js`: pack|trace JSON → self-contained printable HTML
  (A4 print CSS, STATE + reasons + HANGs + culprits + power + cost-with-basis +
  receipts + method footnote; no-JS safe; ASCII-only; offline)
- `tools/telltale/render-charts.js`: trace JSON → Apache ECharts 5.5.1 (pinned CDN)
  timeline + latency scatter + culprit bars + calm-vs-hang strip, every chart with
  table/noscript fallback for print/offline
