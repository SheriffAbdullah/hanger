'use strict';
// Static privacy check (scope "Input observation is not content capture"): the helper source and its bridge code contain no
// mechanism that receives other applications' input or reads content.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'lib', 'sampler');
const FILES = [path.join(root, 'input-helper', 'InputHelper.cs'), path.join(root, 'input-helper.js'), path.join(root, 'input-helper-build.js'), path.join(__dirname, '..', 'lib', 'input', 'report.js')];

// API-level patterns for: keyboard hooks, keyboard raw-input registration, per-key state polling, clipboard,
// microphone and camera capture, window-text reads, pointer position reads
const FORBIDDEN = [
  ['keyboard hook', /SetWindowsHook|WH_KEYBOARD|WH_MOUSE|LowLevelKeyboard/i],
  ['raw input registration', /RegisterRawInputDevices|GetRawInputData|RIDEV_|WM_INPUT\b/],
  ['per-key state polling', /GetAsyncKeyState|GetKeyState|GetKeyboardState|keybd_event|GetKeyNameText/],
  ['clipboard', /OpenClipboard|GetClipboardData|Clipboard\.Get|AddClipboardFormatListener|WM_CLIPBOARD/],
  ['microphone or camera', /waveIn|mciSend|capCreateCaptureWindow|MediaCapture|DirectShow|IAudioClient|MMDevice|avicap/i],
  ['window text read', /GetWindowText|InternalGetWindowText|WM_GETTEXT|GetWindowTextLength|AccessibleObjectFromWindow|AutomationElement/],
  ['pointer position', /GetCursorPos|GetPhysicalCursorPos|GetMessagePos|MOUSEHOOKSTRUCT/],
];

for (const [label, re] of FORBIDDEN) {
  test(`helper source and bridge contain no ${label} mechanism`, () => {
    for (const f of FILES) {
      const text = fs.readFileSync(f, 'utf8');
      const m = text.match(re);
      assert.strictEqual(m, null, `${path.basename(f)} matches ${re}: ${m && m[0]}`);
    }
  });
}

test('the helper source states the privacy rule at its top', () => {
  const head = fs.readFileSync(FILES[0], 'utf8').split('\n').slice(0, 14).join('\n');
  assert.match(head, /PRIVACY RULE/);
  assert.match(head, /never receives keystrokes/);
  assert.match(head, /out-of-scope/);
});

test('the helper keeps clock, writer and probe loop as separate duties', () => {
  const src = fs.readFileSync(FILES[0], 'utf8');
  for (const c of ['class Clock', 'class Writer', 'class ProbeLoop', 'class Scope']) assert.ok(src.includes(c), c);
});

test('the only stored foreground identity is the group, out-of-scope, or unknown (no process id or title field is written)', () => {
  const src = fs.readFileSync(FILES[0], 'utf8');
  assert.ok(!/\\"pid\\"|\\"title\\"|\\"exe\\"|\\"path\\"/i.test(src), 'no pid/title/exe/path field is written to the helper file');
  assert.match(src, /kind == "in-scope" \|\| kind == "system" \? Writer\.Esc\(group\) : "null"/);
});
