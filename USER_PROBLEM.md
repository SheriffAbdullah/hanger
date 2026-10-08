# The Problem (convergence target after rival exploration)

Owner's words, kept verbatim in spirit: track usage patterns whenever something hangs
or doesn't. If nothing is hanging and things are fine, still know what is running.

## Must-haves (v0.5)
1. **Always-on baseline, not just incident traces.** Two modes: `watch` (light, continuous:
   per-interval RAM/commit/pages, top-group MB, power/battery) and `trace` (today's deep
   2s-bundle + spawn probes, triggered manually or when watch sees pressure).
2. **No unknown names.** Every process row resolves to a human identity:
   `Br-uxendm.exe → Brother printer utility (signed: Brother, path: ...)`,
   `MsMpEng.exe → Defender Antimalware`, `warp.exe → Warp terminal`, etc.
   Source: image publisher signature + known-utility map + command line + service host
   grouping (svchost -s splits). Unknown = flagged `unresolved`, never silently listed.
3. **Power truth every sample.** AC vs battery (plugged in?), scheme (Balanced / Best
   performance / HP Optimized + active GUID), `% of max frequency`, battery %.
   The claim to enable: "unplugged → X throttles; plugged in → still hangs, so not power."
4. **Hang-linked AND calm-linked evidence.** Same pack answers both:
   "at 11:47:03 spawn stalled 2.1s with commit 86% + node 753MB" AND
   "at 11:40 all green: 62%, top = Edge 900MB, AC + Best performance."

## Non-goals (manifesto stands)
No verdicts on deserving hardware. Numbers + reasons + RCA only.
Presentation frozen until data + computation hold up.

## Standing directives
- Widest surface: explore everything, fold later. Backend collects full-on;
  show/hide is the presentation layer's job.
- Capability-tiered collection: admin-gated signals are collected whenever the
  machine allows elevation (owner grants it, e.g. this HP ProBook) and skipped
  gracefully — same schema, `collection.tier: admin|user`, `unavailable` with
  reason, never a crash — where it doesn't. No admin-only hard dependency.
