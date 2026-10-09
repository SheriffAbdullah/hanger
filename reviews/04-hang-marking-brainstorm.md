# 04. Marking a hang from anywhere: brainstorm

Date: 2026-10-08. Machine: HP ProBook 440 14 inch G9, Windows 11 Pro 26200, 12 logical CPUs, node v24.21.0.
Status: research only. No repo file other than this one was changed. Every experiment ran from the session scratchpad.

## 0. The problem today

- `lib/sampler/keycap-child.js` puts the terminal's stdin in raw mode and stamps each byte with `Date.now()` in a helper
  process. `K|ms` is a mark, `I|ms` is Ctrl+C, and `P|ms` is the phase key `p` (only when `HANGER_PHASE_KEY=1`).
  `hanger.js:1170` turns a mark into `{tSec, at}`, appends it to the stream, and prints `** user-mark`.
- The helper solved the old problem: a mark that the blocked main loop stamped up to 14 s late (review 02). It did not solve
  focus. Only the Warp window that runs hanger delivers keys to it. A user who is typing in VS Code, a browser or psql
  has to switch windows first. During the very stall we want to capture, they often can't.
- Gaps in the current marks:
  - They have no `kind`. Code always reads `hung` (`diagnosis/context.js:70`), although `tracking/spec.md` defines `hung|fine` plus a note.
  - They have no end, so a 10 s freeze yields one point.
  - The join is ±2 s to the nearest 2 s spawn probe. A mark pressed 4 s into a long freeze can miss.
  - A mark can't be made after the fact.

## 1. What this machine actually has

All of these were checked with read-only queries (`Get-PnpDevice -PresentOnly`, the Uninstall keys, Appx, the process list,
the consent store) plus three small experiments run from the scratchpad (section 1.3).

### 1.1 Hardware channels

| Channel | Present here? | Evidence / note |
|---|---|---|
| Keyboard | yes | `HID Keyboard Device` x2, `Standard 101/102-Key ... for HP Hotkey Support`, `HotKeyServiceUWP` running. Physical Pause / Scroll Lock keys **not verified** (most 14" HP layouts lack dedicated keys) |
| Touchpad | yes | `HID-compliant touch pad`, `I2C HID Device` |
| Mouse | yes | `HID-compliant mouse` (could be the touchpad collection or an external mouse; not distinguished) |
| Consumer-control / radio keys (volume, mic mute, airplane) | yes | 8x `HID-compliant consumer control device`, `HID-compliant wireless radio controls`, `Intel(R) HID Event Filter` |
| Microphone | yes | `Microphone Array (Intel Smart Sound Technology for Digital Microphones)`; consent store `Allow` |
| Webcam | yes | `HP HD Camera`; consent store `Allow` |
| Fingerprint | yes | `ELAN WBF Fingerprint Sensor` (Windows Biometric Framework) |
| Bluetooth | yes | `Intel(R) Wireless Bluetooth(R)` radio. No paired devices showed in the PnP query |
| Phone companion | yes (software) | `Microsoft.YourPhone` (Phone Link) installed |
| Lid / power / sleep buttons | yes | `ACPI Lid`, `ACPI Fixed Feature Button` (power), `ACPI Sleep Button` |
| AC / battery | yes | `Microsoft AC Adapter`, `ACPI-Compliant Control Method Battery` |
| Accelerometer / gyro / ambient light / hinge / presence | **no** | No `Sensor`-class device at all. The only match was `Intel GNA Scoring Accelerator` (a neural accelerator, not a sensor). Tap-the-laptop via an accelerometer is **impossible on this machine** |
| Keyboard LEDs | partly | Caps / Num / Scroll toggle states are readable (`GetKeyState`: all 0 now). Which LEDs the G9 physically has (caps, mute, mic-mute) was **not verified** |
| External USB HID (foot pedal, macro pad) | none attached | One `USB Composite Device` (probably the camera). Any HID keyboard-class pedal works with no driver |

### 1.2 Software environment relevant to the choice

- Windows PowerShell 5.1 and pwsh are both in **FullLanguage** mode. Execution policy: LocalMachine RemoteSigned, MachinePolicy undefined.
- `Add-Type` compiles C# using the in-box .NET Framework compiler. An **unsigned exe compiled into the user temp folder ran
  without being blocked** (no AppLocker or WDAC block seen, HP Wolf / Sure Sense did not interfere). One observation only; IT policy could change it.
- Security stack: HP Wolf Security, Sure Sense AV (`sselam`), HP ActivityMonitor filter drivers (`BrCow`, `BrFilter`), Defender.
  This matters because **low-level keyboard hooks and keyboard raw-input sinks are classic keylogger APIs**. EDR products
  score them as suspicious. `RegisterHotKey` is not in that class. (I did not test whether Sure Sense flags a hook; I inferred the risk.)
- PowerToys is running (FancyZones, Peek, PowerLauncher, ShortcutGuide, Awake, AlwaysOnTop), so global-shortcut conflicts are a real risk. Warp is the terminal.

### 1.3 Experiments run here (scratchpad only)

1. **Hotkey availability** (`RegisterHotKey` then immediately `UnregisterHotKey`, with `MOD_NOREPEAT`):
   - Free: `Ctrl+Alt+H`, `Ctrl+Shift+Alt+H`, `Ctrl+Alt+Pause`, `Pause`, `ScrollLock`, `F24`, `Ctrl+Alt+F12`, `Win+Alt+H`, `Ctrl+Win+Alt+H`, `Win+F12`.
   - Taken: `Win+Shift+H`.
2. **Does the hotkey keep its press time while the receiver is stalled?** I registered `F24` and injected one F24 press
   with `keybd_event`. The hotkey consumes it, so no app saw it. The receiving thread then slept 0 ms or 3000 ms before
   reading its queue. Results:
   - stall 0 ms: `MSG.time - injectTick = 0 ms`; retrieved 62 ms later.
   - **stall 3000 ms: `MSG.time - injectTick = 0 ms`; retrieved 3015 ms later.**
   - So the OS stamps `WM_HOTKEY` when the raw-input thread handles the key, not when our process reads it.
     **The press time survives a stall of the receiving process.** Resolution is the 15.6 ms system tick.
3. **Passive-detector cost**: a compiled .NET Framework exe looped every 250 ms for 15 s. Each tick called
   `GetLastInputInfo`, `GetForegroundWindow`, `SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG, 1000 ms)` and `IsHungAppWindow`.
   - Measured CPU was **0.0 ms** over 15 s. That is below the 15.6 ms accounting granularity, so the cost is under 0.1% of one CPU.
   - Footprint: WS 14.9 MB, private 12.2 MB.
   - Foreground WM_NULL round trip: 0 to 1 ms while calm.
   - For comparison, a long-lived `powershell.exe` doing the same work costs WS 84 MB, private 66 MB, plus ~0.6 s to compile at startup.
   - `DwmGetCompositionTimingInfo(NULL)` failed with both struct packings I tried. A desktop-frame heartbeat is therefore **unverified** here.

## 2. Channel inventory and assessment

Legend:
- **FG-indep** = works while another app has focus.
- **Survives stall** = the capture still happens during the stall *and* is stamped at event time, not at recovery.
- Overhead is against the 2% of one logical CPU budget (`sampling/spec.md`).

| # | Channel | FG-indep | Survives stall / event-time stamp | Privacy / keylogger-ness | FP / FN risk | Elevation | Overhead | Zero install | Accessibility / discoverability | Evidence value |
|---|---|---|---|---|---|---|---|---|---|---|
| A | **Global hotkey via `RegisterHotKey`** in a tiny helper exe (e.g. `Ctrl+Alt+Shift+H`; press again = over) | yes | **yes, verified**: MSG.time = press time even with a 3 s receiver stall. Fails only if the OS raw-input thread itself is starved (then the cursor freezes too) | sees **only its own combo**, never other keys. Not a keylogger primitive | FP: accidental chord (low with 3 modifiers). FN: user forgets. Conflict: combo already taken -> registration fails at start, fall back to a list | none | ~0 (blocked in `GetMessage`) | yes (in-box compiler) | two hands on a 3-modifier chord is hard for some users. Remappable. Printed at start | high: deliberate, timestamped, plus the delivery lag (B) |
| B | **Mark delivery lag** (receivedAt minus MSG.time) as a free stall measurement | n/a | yes, by construction | none | low | none | 0 | yes | n/a | medium: it shows *our* process was starved. Corroborates A |
| C | **USB foot pedal / macro pad** emitting F13 to F24 (or the chord) -> same A path | yes | yes (same as A) | as A | very low (dedicated key) | none | 0 | no (~10-20 USD hardware, no driver) | best for one-handed users and for people who type continuously | high |
| D | **Passive "input without response" detector**: `GetLastInputInfo` advanced in the last 1 s AND the foreground window's `SendMessageTimeout(WM_NULL)` round trip exceeds a threshold or times out (plus `IsHungAppWindow` at 5 s) | yes | partial: it runs on its own high-priority thread. If our thread is starved, the oversleep of its own 250 ms tick is recorded as `helperLag`. Start and end come from the probe tick | records **no key content and no key count**, only "input arrived in this 250 ms tick". Foreground identity must pass the scope filter (section 4.4) | FN: an app-logic wait while the UI pumps messages (psql waiting on Postgres inside a responsive Warp; IDE language-server lag). FP: a modal dialog's nested loop still answers, so low. UIPI to an elevated foreground window is **unverified** | none | <0.1% measured. It probes only when input is recent, so idle costs ~0 | yes | needs no action. Great for recall | high when it agrees with A and the spawn probe. It measures what the user feels (UI lag) better than spawn latency |
| E | **Helper heartbeat lag** (oversleep of a 250 ms high-priority timer) | yes | yes (the lag is measured on wake) | none | FP: CPU-busy but responsive. FN: UI-thread-only stalls | none | ~0 | yes | n/a | medium: scheduler / paging stall indicator, like the old loop-lag |
| F | **Topmost no-activate click target** (`WS_EX_TOPMOST|NOACTIVATE|TOOLWINDOW`, ~24 px, draggable) | yes (no focus steal) | yes: `WM_LBUTTONDOWN` carries MSG.time from the raw-input thread | none | low. Accidental click possible | none | ~0 | yes | mouse users, discoverable. Costs screen space | high (as A) |
| G | **Tray icon** (left-click = mark, menu = "it was a hang N s ago", "it's over") | yes | **no for event time**: Explorer relays the click, so a hung Explorer delays it. Good for retro marks | none | low | none | ~0 | yes | very discoverable | medium (live), good for retro |
| H | **Hot corner / mouse slam** (cursor polled with `GetCursorPos`, dwell 1 s in a chosen corner) | yes | poll-stamped: a starved helper stamps late. The cursor itself keeps moving in a stall | none | FP: corners double as Show Desktop / close button. Medium | none | low (10 Hz poll) | yes | touchpad users. Hidden gesture, low discoverability | medium |
| I | **Mouse shake** via raw mouse input with `INPUTSINK` | yes | event-stamped (WM_INPUT time) | mouse motion only. Still a global input sink | FP: medium | none | medium (1 kHz mice flood messages) | yes | moderate | medium |
| J | **Low-level keyboard hook (`WH_KEYBOARD_LL`)**, for double-tap Ctrl, Caps x3 or key-mash | yes | event-stamped (`KBDLLHOOKSTRUCT.time`). But a hook that does not return within `LowLevelHooksTimeout` is **silently removed** during a stall | **sees every keystroke: keylogger-class.** EDR (Sure Sense / Defender) may flag it | Ctrl x2 FP: medium; mashing FP: high | none | low to medium (every key system-wide passes through us, adding latency to every app) | yes | very ergonomic | high, but the trust cost is unacceptable. **Reject** |
| K | **Raw keyboard input sink** | yes | event-stamped | keylogger-class, same as J | | none | medium | yes | | **Reject** |
| L | **Terminal key (today)** | **no** | yes (child stamps at read) | none | low | none | ~0 | yes | needs focus | high, when available |
| M | **CLI `hanger mark [--ago 20] [--over] [--note ..]`** from any shell, or a `tt-mark` alias | needs some shell with focus | no: it is retro by nature | note text is user-authored; warn not to paste secrets | low | none | 0 | yes | discoverable in README | medium (retro) |
| N | **Phone companion** (QR code -> local page, big button) | yes | **phone-side time is independent of the laptop stall**: best stamp possible, needs clock-offset handshake | LAN listener. Exposes a port | low | an inbound firewall rule usually needs admin / IT on a managed laptop | low | no install on laptop, but needs a firewall exception | good for one-handed users | high if the offset is measured. Operationally heavy. Stretch goal |
| O | **Mic-mute / volume key** (watch endpoint mute state via Core Audio callback) | yes | no: the audio service delivers the callback when it runs, so it is stamped late | side effect: it mutes the mic (bad in meetings) | medium | none | low | yes | already a physical key | low |
| P | **Unplug AC as a signal** | yes | power events delayed | none | low | none | 0 | yes | | **Reject**: it changes the power state the diagnosis studies (battery rule) |
| Q | **Lid / power button** | yes | no | none | | changing power-button behaviour needs settings | 0 | | | **Reject**: sleeps the machine |
| R | **Fingerprint touch** | WBF capture without a prompt needs focus (system pool) or a privileged pool | no | biometric | | yes for a private pool | | | | **Reject** |
| S | **Voice phrase** (System.Speech grammar "hanger hang") | yes | no: the audio pipeline starves in exactly these stalls, and the recognizer CPU is non-trivial | **always-open mic.** The mic indicator shows; speech near confidential calls | FP: medium; FN: high in noise | none | over budget likely (unverified) | yes (SAPI in-box) | good for motor-impaired users | low. Opt-in only, if ever |
| T | **Knock / clap via mic RMS threshold** (no audio stored) | yes | no (audio starvation) | open mic, even if no audio is kept | FP: high | none | low to medium | yes | | low |
| U | **Webcam gesture** | yes | no | camera on: unacceptable | | | high | | | **Reject** |
| V | **Clipboard sentinel** (copy the word `HANG`) | yes | no | requires reading the clipboard, which holds passwords and tokens | | none | low | yes | | **Reject** |
| W | **File-touch / drop file** (`echo > %LOCALAPPDATA%\hanger\mark`) | needs a shell | no (FS watcher latency) | none | low | none | ~0 | yes | | low, superseded by M |
| X | **Accelerometer tap** | n/a | | | | | | | | **Not available**: no sensor on this G9 |
| Y | **OS hang evidence** (Event 1002, DWM ghost window, `IsHungAppWindow`) | yes | after the fact. Threshold 5 s, coarser than 2-3 s freezes | already scope-filtered in `notresponding.js` | FN high for short freezes | none | ~0 | yes | n/a | medium (already a confirmation source) |
| Z | **ETW Win32k input-delay / UI-delay events** | yes | event-stamped by the kernel | provider payloads can include window and process info, so filter in memory | low | real-time ETW session needs admin or Performance Log Users | low to medium | yes | n/a | high. **Admin-tier option**, unverified here |

## 3. Ranked recommendation

| Rank | Mechanism | Role | Why |
|---|---|---|---|
| 1 | **A: global hotkey in an independent helper exe, stamped with the OS message time** (+ B delivery lag) | primary, "hang NOW" / "it's over" | Works from any app. Its timestamp survives a stall (verified here). Sees only its own chord, needs no admin, costs ~0 CPU and ~12 MB, and needs no install |
| 2 | **D + E: passive input-without-response detector + heartbeat lag** | automatic, no user action | Measures the felt symptom (UI not answering while the user is interacting). Raises recall, corroborates marks, and validates the spawn-probe proxy. Measured cost <0.1% |
| 3 | **F: topmost no-activate click target**, plus **C: pedal/macro pad** mapped to F13 to F24 | backup / accessibility | Same event-time guarantee as A. F suits mouse users and avoids chords; C suits one-handed users and constant typists |
| 4 | **G: tray menu + M: CLI `hanger mark --ago`** | retro-marking and discoverability | The system has recovered by then, so event time isn't needed. The user declares an offset with an uncertainty |
| 5 | **L: terminal key** (keep as is) | legacy | Already works when Warp has focus |
| 6 | N phone companion | stretch | Best clock independence, but needs a firewall exception on a managed laptop |
| 7 | H hot corner, I mouse shake | optional gestures | Discoverability and FP issues |
| - | J / K hooks, S / T mic, U camera, V clipboard, O / P / Q / R repurposed hardware | rejected | Keylogger-class, open mic or camera, read secrets, or side effects on the very state being measured |

**Default chord proposal:** `Ctrl+Alt+Shift+H` ("H for hang"), registered with `MOD_NOREPEAT`. If registration fails, try the
fallback list `Ctrl+Alt+Shift+J`, `Ctrl+Alt+F12`, `Pause`, then `F13` to `F24` (pedal). The active chord is printed at start
and recorded in the report. Avoid `Win+` combos: Microsoft reserves them, and `Win+Shift+H` is already taken here.
- First press opens a hang episode (`kind: hung`).
- A press while an episode is open closes it (`kind: over`).
- An open episode with no second press closes itself after 120 s as `end: unknown`, or at the end of passive-detector stall evidence if that comes first. The `endSource` field records which.
- An optional second chord, `Ctrl+Alt+Shift+F`, records `fine` (a calm anchor).

**Retro mark:**
- Tray menu: "It froze 10 / 20 / 30 / 60 s ago" plus a "lasted ~N s" picker.
- CLI: `hanger mark --ago 20s [--for 8s] [--note "psql"]`, which talks to the helper over a named pipe; with no helper running it appends to the sidecar.
- Retro marks carry `uncertaintyS` (default ±5 s, or ±25% of `ago`, whichever is larger). They join with that window.
- They are counted separately from live marks. They never feed "precision" in the same bucket as event-stamped marks.

## 4. Design details

### 4.1 Process model

- `hanger.js` spawns `hanger-input-helper.exe` next to the existing keycap child. The exe is compiled once by
  Windows PowerShell 5.1 `Add-Type -OutputAssembly` from C# source shipped in `lib/sampler/`, and cached by source hash in
  `%LOCALAPPDATA%\hanger\bin\`. That folder is outside OneDrive and outside `reports/`.
- If compiling or running fails, the run continues with the terminal key only. The report records
  `input.helper: unavailable (<reason>)`. Optional fallback: a long-lived `powershell.exe` doing the same work (84 MB; it must
  fit the 150 MB private budget; record it).
- Inside the helper:
  - **Thread 1, hotkey loop.** Owns `RegisterHotKey` and the topmost click target. It only calls `GetMessage`, reads
    `MSG.time`, and does a non-blocking write. It never blocks on anything else.
  - **Thread 2, passive detector.** Runs a 250 ms tick at `THREAD_PRIORITY_HIGHEST`. `SendMessageTimeout` (which can block
    up to its timeout) runs only here.
  - **Thread 3, writer.** Appends JSON lines to a sidecar file with a flush after each line, and also writes to stdout for the parent.
- Working-set hardening:
  - Call `SetProcessWorkingSetSizeEx` with a small hard minimum (Users hold `SeIncreaseWorkingSetPrivilege` by default; **unverified here**).
  - Keep the binary tiny so the helper is not paged out during memory-pressure stalls.
  - Even if it is paged out, the press time is still correct, because the OS stamps the message, not us.

### 4.2 Timestamps

- **Press time** = `MSG.time`: a 32-bit `GetTickCount` value stamped by the raw-input thread.
- **Wall-clock conversion** uses an anchor `(tick64, QPC, wallPrecise)` that the helper captures at start and every 10 s
  while healthy, with `GetSystemTimePreciseAsFileTime`. Then `pressWall = anchorWall + (pressTick - anchorTick32)`, with
  wrap handled. The record stores the raw tick, the anchor and `anchorAgeMs` (provenance, in line with the metric-record style).
- **Delivery lag** = helper receive time minus press time. It is its own signal: a lag ≥ 500 ms means the helper was starved at that moment.
- The parent **never re-stamps** a mark. Its own `Date.now()` is kept only as `parentReceivedAt`.

### 4.3 Record shapes (stream + sidecar `reports/hanger-<stamp>.input.jsonl`)

```
{type:"mark", v:2, kind:"hung"|"over"|"fine", source:"hotkey"|"pedal"|"click"|"terminal-key"|"tray"|"cli",
 episodeId, pressAt, pressTick, clock:{anchorAt, anchorTick, anchorAgeMs}, deliveryLagMs, parentReceivedAt,
 retro:null|{agoS, forS, uncertaintyS}, note:null|"..."}

{type:"input-stall", startAt, endAt, durationMs, maxRoundTripMs, timeouts, osHung:boolean,
 inputTicks /* count of 250 ms ticks with any input, never key counts or content */,
 foreground:"in-scope:<group>"|"out-of-scope"|"unknown", helperLagMaxMs}

{type:"input-helper", chord:"Ctrl+Alt+Shift+H", registered:true|false, fallbackUsed, reason, wsMB, cpuMs}
```

`recover` merges the sidecar. Because the helper writes it, marks survive a stuck or crashed main process.

### 4.4 Privacy / not-a-keylogger rules (these become SHALLs)

1. No API that receives other keys: no `WH_KEYBOARD_LL`, no keyboard raw input, no `GetAsyncKeyState` polling loop.
   The only key information the tool ever gets is that its own registered chord was pressed.
2. `GetLastInputInfo` gives one timestamp (keyboard, mouse or touch, undistinguished). Store only per-tick booleans or counts of active ticks.
3. Foreground identity:
   - The helper sends the foreground PID to the parent **over the pipe only, in memory**.
   - The parent resolves it through the scope resolver and writes `in-scope:<group>` or `out-of-scope`.
   - It never writes the PID, name or window title of an out-of-scope app (`scope/spec.md`).
   - The helper never reads window titles and never writes PIDs to the sidecar.
4. No microphone, camera or clipboard access, ever, in the default tool. A voice option, if anyone wants one, is a separate opt-in that is off by default and documented.
5. Notes are free text that the user typed on purpose. The CLI warns that notes go into the shareable report.

### 4.5 Joining the diagnosis

- **Mark episodes.** A `hung` mark plus its `over` (or auto-end) forms the window [start, end].
  - A probe hang inside [start - 2 s, end + 2 s] gets the confirmation `user-mark`.
  - A point mark (no end) keeps the current ±2 s rule.
  - Retro marks use ± `uncertaintyS` and give `user-mark-retro`.
- **New confirmation source `input-unresponsive`**: an `input-stall` interval that overlaps the hang ±2 s. This sits beside
  `os-not-responding` and `workload-probe`. `probe-only` stays when none applies.
- **Proxy validation** (`diagnosis/spec.md`):
  - Keep precision and recall against live `hung` marks with n.
  - Add the same pair against `input-stall` intervals, labelled "proxy vs passive".
  - Report retro-mark recall separately.
  - Episode-level recall = episodes containing at least one detected hang ÷ episodes.
- **Mark corroboration**: each `hung` mark is labelled `corroborated` when an `input-stall` or `deliveryLagMs ≥ 500`
  overlaps it, or when a probe hang overlaps it. Otherwise it is `uncorroborated`. That case is still shown, and it is
  evidence that the instruments miss this kind of freeze (it feeds "what this cannot see").
- **Confidence**: the confirmation-share component counts `user-mark` and `input-unresponsive` at full weight and `user-mark-retro` at half weight, with the weights recorded.
- **Charts** draw episodes as bands (start to end), point marks as ticks, retro marks as hatched spans, and input-stall intervals as a strip under the freeze strip.

### 4.6 Things that will still be missed (state them in the report)

- A wait inside the app while its UI keeps pumping messages. Example: psql blocked on Postgres inside a responsive Warp.
  The passive detector can't see it. Only a mark or a workload probe can.
- A stall in the OS raw-input thread itself. If the cursor freezes, the press is stamped when the input thread runs again.
  The delivery lag will be small, but the mark is late.
- Secure-desktop / UAC / lock-screen moments.
- An elevated foreground app (WM_NULL across integrity levels may be blocked: **unverified**). Record `foreground: unknown`.

## 5. OpenSpec change sketch: `global-hang-marking`

### proposal.md (outline)
- **Why:** marks only work when the terminal has focus. Freezes happen in other apps. Marks have no kind and no end, and can't be made afterwards. The proxy can't be validated without marks.
- **What changes:**
  - A helper process with a global chord stamped by OS input time.
  - Episode start and end.
  - Retro marks (tray + CLI).
  - A topmost click target and pedal support.
  - A passive input-without-response detector.
  - New confirmation sources.
  - Privacy guarantees.
- **Impact:** specs `sampling`, `tracking`, `diagnosis`, `evidence-persistence`, `scope`, `report-views`, `metrics`; code `lib/sampler/` (new helper + bridge), `hanger.js`, `diagnosis/context.js`, `render/`, `recover`.

### Spec deltas (requirements + scenarios in outline)

**sampling: MODIFIED "Input capture is independent of collection"**
- SHALL capture marks from a global chord while any application has focus. Each mark's time SHALL be the OS input
  timestamp of the press, within one system tick (≤ 16 ms), regardless of how long the helper or the main process was stalled.
- Scenario *Mark from another app*: GIVEN VS Code has focus WHEN the user presses the chord at 10:00:05.000 THEN a `hung` mark with `pressAt` 10:00:05.000 ±16 ms and `source: hotkey` is stored.
- Scenario *Helper stalled*: GIVEN the helper's message thread is blocked for 3 s WHEN the chord is pressed at t THEN `pressAt` = t ±16 ms AND `deliveryLagMs` ≥ 3000.
- Scenario *Chord taken*: GIVEN another app owns the chord WHEN the run starts THEN the next fallback chord is registered, printed, and recorded in `input-helper`.
- Scenario *Helper unavailable*: GIVEN the helper can't be compiled or started THEN the run continues with the terminal key, AND the report states `input.helper: unavailable` with the reason.

**sampling: ADDED "Passive input-without-response detector"**
- SHALL record an `input-stall` interval when user input occurred within the last 1 s and the foreground window failed
  to answer a no-op message within `--ui-lag` (default 250 ms, provisional, cited as a guess). It SHALL probe only while
  input is recent, and its cost SHALL count toward the observer budget.
- Scenarios: *Typing into a frozen window*; *Idle user, no probes sent*; *Out-of-scope foreground is anonymous*; *Elevated foreground recorded unknown*.

**tracking: MODIFIED "User ground-truth marks"**
- Kinds `hung | over | fine`. Sources `hotkey | pedal | click | terminal-key | tray | cli`. Episode pairing. 120 s auto-end with `endSource`. Retro marks with `agoS`, `forS`, `uncertaintyS`.
- Scenarios: *Start/end episode*; *Auto-end at 120 s*; *Retro mark 20 s ago joins a hang at -18 s*; *Retro mark counted separately*.

**diagnosis: MODIFIED "Hang confirmation sources"** and **"Hang proxy validated against user marks"**
- Add `input-unresponsive` and `user-mark-retro`. Episodes join over [start - 2 s, end + 2 s]. Add corroboration labels. Add proxy vs passive precision and recall with n.
- Scenarios: *Episode confirms two hangs*; *Uncorroborated mark appears under "what this cannot see"*; *Retro mark half weight in confidence*.

**evidence-persistence: ADDED "Marks survive the main process"**
- The helper SHALL append marks to a sidecar flushed per line. `recover` SHALL merge it.
- Scenario: *Main process killed during a stall; the mark is present after recover*.

**scope: ADDED "Input capture is not a keylogger"**
- SHALL NOT install keyboard hooks or keyboard raw-input sinks, read other keys, read window titles, read the clipboard,
  or open the microphone or camera. Foreground identity follows the out-of-scope rule.
- Scenarios: *Static check: the helper source contains no `SetWindowsHookEx` / `RIDEV_INPUTSINK` for keyboard / `GetAsyncKeyState` loop*; *Out-of-scope foreground never named*.

**report-views: MODIFIED annotations**: episode bands, retro hatching, input-stall strip, chord legend.

### tasks.md (outline)
1. Helper source (C#, .NET Framework 4.x): hotkey thread, writer thread, anchor clock, sidecar. Build-and-cache via `Add-Type -OutputAssembly`. Fallback chain.
2. `lib/sampler/input-helper.js` bridge (like `keycap.js`): spawn, parse lines, pass the scope PID set or a resolver round trip for the foreground.
3. Episode state machine + auto-end. `kind` support end to end (this also fixes the review 01 gap).
4. Passive detector thread with an input-gated WM_NULL probe, heartbeat lag, interval coalescing, and a `--ui-lag` threshold in the citations table.
5. Topmost no-activate click target (opt-in `--mark-button`), and F13 to F24 pedal registration.
6. Retro: `hanger mark` CLI over a named pipe, sidecar fallback, and a tray menu (optional, phase 2).
7. Diagnosis join (`context.js`): episodes, retro, `input-unresponsive`, corroboration, proxy vs passive.
8. Renderers: bands, strip, legend. Finding line counts.
9. `recover` merges the sidecar. Schema changelog entry.
10. Tests:
    - Inject the chord with `SendInput` into a test helper with a forced 3 s stall, and assert `pressAt` ±16 ms. This mirrors the scratchpad experiment.
    - Fake detector input for the passive detector.
    - Static privacy grep.
    - Join fixtures.
11. Budget check: helper CPU and private bytes go into `sampling.observer`.
12. README: "Mark a freeze from anywhere: Ctrl+Alt+Shift+H, press again when it's back; `hanger mark --ago 20s` afterwards."

## 6. Open questions for the owner

1. **The chord.** Is `Ctrl+Alt+Shift+H` acceptable, or is there a combo your IDE, Warp or PowerToys uses? Should we steal a key with no other use, such as `Pause`, if the G9 has it (**unverified**)?
2. **Can the tool compile and run a helper exe** from `%LOCALAPPDATA%` on this managed laptop, and is IT OK with that? It worked once here. Should we ship the C# source and compile at first run (as proposed), or ask IT to allow-list a signed binary?
3. **Is a passive detector that looks at "which app is in front"** acceptable? It records only in-scope group names or `out-of-scope`.
4. **The UI-lag threshold.** 250 ms ("feels janky") or closer to the 800 ms hang threshold? Should marks calibrate it after a few runs?
5. **Episode end.** Two presses of one chord, or two chords (`H` hang / `J` back)? Auto-end at 120 s?
6. **Retro marks.** Should they be allowed to raise confidence at all, or only recall?
7. **On-press feedback.** A console line in Warp only (delayed during a stall), a tray-icon colour change, or a short beep? I recommend a silent default and tray colour, because audio and console are both delayed in a stall.
8. **Accessibility.** Should the click target or a pedal mapping be offered by default for users who can't do a 3-key chord?
9. **Admin tier.** Should we explore an ETW Win32k input-delay session (event-stamped by the kernel) for IT-run captures? Not verified here.
10. **Phone companion.** Worth a firewall-exception request to IT, or out of scope?

## 7. Unverified on this hardware (be explicit)

- Physical Pause / Scroll Lock keys, and which keyboard LEDs exist.
- The DWM frame heartbeat (the API call failed here).
- WM_NULL to an elevated foreground window.
- Whether the HP Sure Sense / Defender EDR flags a keyboard hook. Inferred; not tested, and not needed if we follow the recommendation.
- `SetProcessWorkingSetSizeEx` hard-minimum behaviour.
- Hotkey behaviour when the raw-input thread itself stalls. Theory only: a real stall reproduction is needed.
- That the passive detector actually fires on a real freeze. Its cost was measured; its sensitivity was not (no freeze happened during the 15 s test).
