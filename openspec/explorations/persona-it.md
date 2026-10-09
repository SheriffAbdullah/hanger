# Persona: IT / Tech-ops (primary reader and customer)

## 1. Story (3 lines)
I run IT and tech-ops for a few hundred laptops: images, warranty, security policy, and the ticket queue. "My machine freezes sometimes" is the hardest ticket I get, because I cannot see it from my desk and the first report rarely says enough to act on.
The developer on the other end wants it fixed as much as I do; the hang is the shared problem. What I need is for the first ticket to arrive already holding the evidence, so I do not spend three round-trips asking for it.
I ask a developer to reproduce the freeze with Hanger running; the report comes back complete, scoped, and checkable. I do not run an agent on the fleet and I do not want one.

## 2. What I need from a report

**Must (a report is only useful with these):**
- System profile: model, serial or asset tag, RAM fitted, disk type and free space, OS build, BIOS, power plan, WSL limits. A trace without the machine it came from cannot be acted on.
- Reproduced under load, not a one-off screenshot: the hang table (time, length, what was running), plus calm periods from the same run so I can compare at-freeze against fine.
- Candidate causes ranked with a stated confidence and a "what would disprove this" line, and the signal each rule used. I want evidence I can check, not a verdict.
- Scope declaration audit: the declared scope (source, scope-file path and SHA-256, entries, match rule, always-monitored system set) first in the report, the out-of-scope load as an anonymous aggregate (counts and totals, never names), the collection tier (`user` or `admin`), and `unavailable` reasons. I can re-run the same scope file to reproduce; what is outside the scope is counted, never silent.
- Honest gaps: a signal that could not be collected says why, never a zero. Thresholds are stated and recorded in the report; JSON, Markdown and the email agree.

**Should:**
- Power truth per sample: AC or battery, scheme, battery percent, so a power-plan question is answered inside the report.
- The one-line "what IT can do" list, cheapest first, each tied to the rule that raised it. Suggested checks, not purchase advice.
- A ready-to-paste email draft whose numbers are verified against the JSON.

**Could:**
- Admin-tier signals when the collector could elevate: thermal throttling, disk health, driver faults, WER AppHang history (the tier is always labelled).
- Several reports over time for the same machine (`trend`) so a pattern is visible across tickets.

## 3. What would make me distrust a report (red flags)
- Unknown rows (`unresolved`) presented as fact, or out-of-scope memory missing from the aggregate totals: the numbers no longer add up.
- Thresholds unstated or changed between runs; JSON and Markdown disagree; averages with n=1; no calm baseline at all.
- Privacy slips: full command lines, usernames, hostnames or container names leaking despite `--anonymize`.
- A security product disabled to "improve the numbers". (The always-monitored system set keeps registered security products visible.)
- Non-goal: Hanger is not a software-compliance scanner and is not meant to see software the developer has not declared. It does not flag unsanctioned or unsigned software outside the declared scope; its legitimacy rests on declared scope plus anonymous aggregates. Hidden-software detection is deliberately out of scope.

## 4. How Hanger reaches me
1. **Collection on request.** I ask a developer to run `trace` (or `record`) while they reproduce the freeze. No fleet rollout, no telemetry, nothing leaves the machine until the developer sends the files.
2. **Complete first ticket.** One report (HTML, Markdown, JSON) plus an email draft: profile, scope, hang table, ranked causes, calm comparison, gaps. Often enough to act without a follow-up question.
3. **Scope audit instead of a policy gate.** I verify the declared scope, its file hash and the out-of-scope aggregate. Not a policy gate: no signature or allowlist check of software outside the declared scope (non-goal: not a compliance scanner).
