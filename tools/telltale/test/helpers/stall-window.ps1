# Live-check helper (not part of `node --test`): a small Windows Forms window owned by this script that
#  - has a canary title (zztitlecanary<random>) so a leak of window titles would be detected,
#  - receives synthetic typing (a canary string) from a driver thread, so "recent input" exists,
#  - deliberately blocks its own UI thread (message loop) for -StallMs, -Times times, every -EverySec seconds.
# The driver types ONLY while this window is the foreground window; if the user switches away it stops typing.
# It never touches other applications. Output lines (stdout): READY, STALL <iso wall clock> <ms>, TYPED <n> <hasCanary>, DONE.
# Focus: the window takes the foreground at start (first 12 s, or throughout with -KeepFocus); if you switch away, typing stops.
# Usage: powershell -STA -NoProfile -File stall-window.ps1 -StallMs 1500 -Times 3 -EverySec 20
param(
  [switch]$KeepFocus, [int]$StallMs = 1500, [int]$Times = 3, [int]$EverySec = 20, [int]$WarmupSec = 6, [int]$DurationSec = 0,
  [string]$TitleCanary = '', [string]$TypeText = '', [int]$TypeEveryMs = 90, [int]$IdleFromSec = -1, [int]$IdleForSec = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not $TitleCanary) { $TitleCanary = 'zztitlecanary' + (-join ((97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })) }
if (-not $TypeText) { $TypeText = 'zzkeycanary' + (-join ((97..122) | Get-Random -Count 8 | ForEach-Object { [char]$_ })) }
if ($DurationSec -le 0) { $DurationSec = $WarmupSec + $Times * $EverySec + 4 }
Add-Type -Namespace Tt -Name Win -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'

$form = New-Object System.Windows.Forms.Form
$form.Text = $TitleCanary
$form.Width = 520; $form.Height = 220; $form.StartPosition = 'Manual'; $form.Left = 80; $form.Top = 80; $form.TopMost = $true
$tb = New-Object System.Windows.Forms.TextBox
$tb.Multiline = $true; $tb.Dock = 'Fill'; $tb.Font = New-Object System.Drawing.Font('Consolas', 10)
$form.Controls.Add($tb)
$form.Add_Shown({ $form.Activate(); $tb.Focus() | Out-Null })
$form.Show(); $form.Activate(); $tb.Focus() | Out-Null
$handle = $form.Handle
Write-Output ("READY pid={0} duration={1}s" -f $PID, $DurationSec); [Console]::Out.Flush()

# driver: a background runspace that injects synthetic typing only while this window is in the foreground
$state = [hashtable]::Synchronized(@{ stop = $false; sent = 0; loops = 0; fg = 0; last = ''; handle = $handle.ToInt64(); text = $TypeText; every = $TypeEveryMs; idleFrom = $IdleFromSec; idleFor = $IdleForSec; t0 = [DateTime]::UtcNow })
$rs = [runspacefactory]::CreateRunspace(); $rs.ApartmentState = 'STA'; $rs.Open()
$rs.SessionStateProxy.SetVariable('state', $state)
$ps = [powershell]::Create(); $ps.Runspace = $rs
[void]$ps.AddScript({
  Add-Type -Namespace Tt3 -Name Kb -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public System.IntPtr extra; }
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit)] public struct IU { [System.Runtime.InteropServices.FieldOffset(0)] public KI ki; [System.Runtime.InteropServices.FieldOffset(0)] public long pad1; [System.Runtime.InteropServices.FieldOffset(8)] public long pad2; [System.Runtime.InteropServices.FieldOffset(16)] public long pad3; [System.Runtime.InteropServices.FieldOffset(24)] public long pad4; }
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct IN { public uint type; public IU u; }
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, IN[] inputs, int size);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
public static uint TypeChar(char c) {
  IN[] a = new IN[2];
  a[0].type = 1; a[0].u.ki.scan = c; a[0].u.ki.flags = 4;
  a[1].type = 1; a[1].u.ki.scan = c; a[1].u.ki.flags = 4 | 2;
  return SendInput(2, a, System.Runtime.InteropServices.Marshal.SizeOf(typeof(IN)));
}
'@
  $i = 0
  while (-not $state.stop) {
    $el = ([DateTime]::UtcNow - $state.t0).TotalSeconds
    $state.loops++; $state.fg = [Tt3.Kb]::GetForegroundWindow().ToInt64()
    $idle = ($state.idleFrom -ge 0) -and ($el -ge $state.idleFrom) -and ($el -lt ($state.idleFrom + $state.idleFor))
    if (-not $idle -and [Tt3.Kb]::GetForegroundWindow().ToInt64() -eq $state.handle) {
      $c = $state.text[$i % $state.text.Length]; $i++
      $r = [Tt3.Kb]::TypeChar([char]$c); $state.last = "$r err=$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"; if ($r -gt 0) { $state.sent++ }
    }
    Start-Sleep -Milliseconds $state.every
  }
})
$async = $ps.BeginInvoke()

$script:stallsDone = 0
$script:start = [DateTime]::UtcNow
$script:lastFocusTry = [DateTime]::MinValue
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 40
$timer.Add_Tick({
  $el = ([DateTime]::UtcNow - $script:start).TotalSeconds
  # take the foreground for our own window (a background process may need a tap on a modifier key first)
  if ([Tt.Win]::GetForegroundWindow() -ne $form.Handle -and ([DateTime]::UtcNow - $script:lastFocusTry).TotalMilliseconds -gt 700 -and ($KeepFocus -or $el -lt 12)) {
    $script:lastFocusTry = [DateTime]::UtcNow
    [Tt.Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Tt.Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][Tt.Win]::SetForegroundWindow($form.Handle); $tb.Focus() | Out-Null
  }
  if ($script:stallsDone -lt $Times -and $el -ge ($WarmupSec + $script:stallsDone * $EverySec) -and [Tt.Win]::GetForegroundWindow() -eq $form.Handle) {
    $script:stallsDone++
    [Console]::Out.WriteLine(("STALL {0} {1}" -f [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $StallMs)); [Console]::Out.Flush()
    [System.Threading.Thread]::Sleep($StallMs)   # the UI thread's message loop is blocked here
  }
  if ($el -ge $DurationSec) { $script:captured = $tb.Text; $timer.Stop(); $form.Close() }
})
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$state.stop = $true
Start-Sleep -Milliseconds 300
$has = ([string]$script:captured).ToLowerInvariant().Contains($TypeText.ToLowerInvariant().Substring(0, 6))
Write-Output ("TYPED {0} {1}" -f $state.sent, $has)
if ($env:TT_STALL_DEBUG) { Write-Output ("DEBUG loops={0} fg={1} handle={2} last={3}" -f $state.loops, $state.fg, $state.handle, $state.last) }
if ($ps.InvocationStateInfo.Reason) { [Console]::Out.WriteLine('DRIVER-FAILED ' + $ps.InvocationStateInfo.Reason.Message) }
foreach ($e in $ps.Streams.Error) { [Console]::Out.WriteLine('DRIVER-ERROR ' + $e.ToString().Substring(0, [Math]::Min(160, $e.ToString().Length))) }
$ps.Stop(); $rs.Close()
Write-Output 'DONE'
