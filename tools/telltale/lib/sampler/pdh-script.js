'use strict';
// The session script. One PowerShell process, started once, loads a tiny C# wrapper over the Windows PDH counter
// API (pdh.dll, English counter names so the paths are the same on every display language) and then loops:
// one PdhCollectQueryData for ALL counters, one string out per tick. No cmdlet runs per tick, so the cost per
// tick is a few milliseconds (the Get-Counter cmdlet costs ~30 ms per tick and System.Diagnostics.PerformanceCounter
// ~6 ms per counter on the reference laptop).
//
// Protocol (see session.js): SKIP / READY at start, then BEGIN ... END blocks.
const BS = '\\';
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

const PDH_CS = `
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
public class TtPdh {
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string src, IntPtr user, out IntPtr q);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr q, string path, IntPtr user, out IntPtr c);
  [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr q);
  [StructLayout(LayoutKind.Sequential)] struct FmtValue { public uint CStatus; public double Val; }
  [DllImport("pdh.dll")] static extern uint PdhGetFormattedCounterValue(IntPtr c, uint fmt, out uint type, out FmtValue v);
  [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhExpandWildCardPath(string src, string path, char[] list, ref uint size, uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out long c, out long e, out long k, out long u);
  [StructLayout(LayoutKind.Sequential)] struct Pmc { public uint cb; public uint PageFaultCount; public UIntPtr PeakWs, Ws, QPeakPaged, QPaged, QPeakNonPaged, QNonPaged, Pagefile, PeakPagefile, PrivateUsage; }
  [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr h, out Pmc p, uint cb);
  [StructLayout(LayoutKind.Sequential)] struct Sps { public byte Ac, Flag, Pct, Sys; public uint Life, Full; }
  [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out Sps s);
  [DllImport("powrprof.dll")] static extern uint PowerGetEffectiveOverlayScheme(out Guid g);
  [DllImport("pdh.dll", EntryPoint = "PdhGetFormattedCounterArrayW")] static extern uint PdhGetArr(IntPtr c, uint fmt, ref uint size, ref uint count, IntPtr buf);
  // one cheap Win32 read: AC line | battery percent (255 unknown) | battery flag (128 = no system battery) | overlay scheme | system status (1 = energy saver)
  public string Pwr() {
    Sps s; string ac = "Unknown", flag = "", pct = "", sys = "";
    if (GetSystemPowerStatus(out s)) { ac = s.Ac == 1 ? "Online" : s.Ac == 0 ? "Offline" : "Unknown"; flag = s.Flag.ToString(); pct = s.Pct.ToString(); sys = s.Sys.ToString(); }
    string ov = ""; try { Guid g; if (PowerGetEffectiveOverlayScheme(out g) == 0) ov = g.ToString(); } catch (Exception) { }
    return ac + "|" + pct + "|" + flag + "|" + ov + "|" + sys;
  }
  IntPtr nodeH = IntPtr.Zero, helperH = IntPtr.Zero;
  // the tool's own cost without enumerating every process: cpu seconds | private bytes of this session | private bytes of the node parent
  // | cpu seconds and private bytes of the input helper (empty when there is none)
  public string Obs(uint nodePid, uint helperPid) {
    long c, e, k, u; Pmc m = new Pmc(); m.cb = (uint)Marshal.SizeOf(typeof(Pmc));
    IntPtr me = GetCurrentProcess();
    double cpu = 0; ulong priv = 0, npriv = 0;
    if (GetProcessTimes(me, out c, out e, out k, out u)) cpu = (k + u) / 1e7;
    if (GetProcessMemoryInfo(me, out m, m.cb)) priv = (ulong)m.PrivateUsage;
    if (nodeH == IntPtr.Zero) nodeH = OpenProcess(0x1010, false, nodePid);
    if (nodeH != IntPtr.Zero) { Pmc n = new Pmc(); n.cb = m.cb; if (GetProcessMemoryInfo(nodeH, out n, n.cb)) npriv = (ulong)n.PrivateUsage; }
    string hx = "|";
    if (helperPid != 0) {
      if (helperH == IntPtr.Zero) helperH = OpenProcess(0x1010, false, helperPid);
      if (helperH != IntPtr.Zero) {
        Pmc hm = new Pmc(); hm.cb = m.cb; long hc, he, hk, hu;
        if (GetProcessTimes(helperH, out hc, out he, out hk, out hu) && GetProcessMemoryInfo(helperH, out hm, hm.cb)) hx = ((hk + hu) / 1e7).ToString("R", CultureInfo.InvariantCulture) + "|" + hm.PrivateUsage;
      }
    }
    return cpu.ToString("R", CultureInfo.InvariantCulture) + "|" + priv + "|" + npriv + "|" + hx;
  }
  IntPtr q;
  List<IntPtr> cs = new List<IntPtr>();
  List<string> names = new List<string>();
  HashSet<string> seen = new HashSet<string>();
  public TtPdh() { PdhOpenQuery(null, IntPtr.Zero, out q); }
  public string[] Expand(string path) {
    uint size = 0;
    uint r = PdhExpandWildCardPath(null, path, null, ref size, 0);
    if (r != 0x800007D2 && r != 0) return new string[0];
    char[] buf = new char[size + 2];
    r = PdhExpandWildCardPath(null, path, buf, ref size, 0);
    if (r != 0) return new string[0];
    List<string> o = new List<string>();
    string all = new string(buf);
    foreach (string p in all.Split(new char[] { (char)0 }, StringSplitOptions.RemoveEmptyEntries)) o.Add(p);
    return o.ToArray();
  }
  public bool Add(string path) {
    string key = path.ToLowerInvariant();
    if (seen.Contains(key)) return true;
    IntPtr c;
    if (PdhAddEnglishCounter(q, path, IntPtr.Zero, out c) != 0) return false;
    seen.Add(key); cs.Add(c); names.Add(path);
    return true;
  }
  public int Count { get { return cs.Count; } }
  // ---- wildcard (dynamic-instance) counters: new processes / engines / adapters appear without a restart ----
  // reducer: proc = group instances by process name (strip #n), gpu = sum per adapter + engine type, raw = every instance
  class Fam { public int every = 1; public double avgMs = 0; public int dumps = 0; public double budgetMs; public double accMs = 0; public bool ran = false; public string name; }
  class Wild { public IntPtr h; public string path; public string reducer; public Fam fam; }
  Dictionary<string, Fam> fams = new Dictionary<string, Fam>();
  List<Wild> wl = new List<Wild>();
  int tick = 0;
  public bool AddWild(string path, string reducer, double budgetMs) {
    IntPtr c;
    if (PdhAddEnglishCounter(q, path, IntPtr.Zero, out c) != 0) return false;
    string fk = reducer + "|" + Cat(path); Fam fm; if (!fams.TryGetValue(fk, out fm)) { fm = new Fam(); fm.budgetMs = budgetMs; fm.name = Cat(path).TrimStart('\\\\'); fams[fk] = fm; }
    Wild w = new Wild(); w.h = c; w.path = path; w.reducer = reducer; w.fam = fm; wl.Add(w);
    return true;
  }
  static string Cat(string path) { int a = path.IndexOf('('); return a < 0 ? path : path.Substring(0, a); }
  static string Ctr(string path) { int b = path.LastIndexOf('\\\\'); return b < 0 ? path : path.Substring(b + 1); }
  static void Line(StringBuilder sb, string host, string cat, string inst, string counter, string val) {
    sb.Append("\\\\\\\\").Append(host).Append('\\\\').Append(cat).Append('(').Append(inst).Append(")\\\\").Append(counter).Append('=').Append(val).Append('\\n');
  }
  public string DumpWild(string host) {
    tick++;
    StringBuilder sb = new StringBuilder();
    HashSet<string> counted = new HashSet<string>();
    foreach (Wild w in wl) {
      if (w.fam.every > 1 && (tick % w.fam.every) != 0) continue;
      System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
      uint size = 0, count = 0;
      uint r = PdhGetArr(w.h, 0x200 | 0x8000, ref size, ref count, IntPtr.Zero);
      if (r != 0x800007D2 || size == 0) continue;
      IntPtr buf = Marshal.AllocHGlobal((int)size);
      try {
        r = PdhGetArr(w.h, 0x200 | 0x8000, ref size, ref count, buf);
        if (r != 0) continue;
        int isz = IntPtr.Size == 8 ? 24 : 16;
        string counter = Ctr(w.path), cat = Cat(w.path).TrimStart('\\\\').ToLowerInvariant();
        Dictionary<string, double> agg = new Dictionary<string, double>();
        Dictionary<string, int> cnt = new Dictionary<string, int>();
        for (int i = 0; i < (int)count; i++) {
          IntPtr it = new IntPtr(buf.ToInt64() + (long)i * isz);
          string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(it));
          uint st = (uint)Marshal.ReadInt32(it, IntPtr.Size);
          if (st != 0 && st != 1) continue;
          double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(it, IntPtr.Size == 8 ? 16 : 8));
          if (double.IsNaN(v) || double.IsInfinity(v) || name == null) continue;
          string key = name;
          if (w.reducer == "proc") {
            string lk = name.ToLowerInvariant();
            if (lk == "_total" || lk == "idle") continue;
            int hh = name.LastIndexOf('#');
            if (hh > 0 && hh < name.Length - 1) { bool dig = true; for (int j = hh + 1; j < name.Length; j++) if (!char.IsDigit(name[j])) dig = false; if (dig) key = name.Substring(0, hh); }
          } else if (w.reducer == "gpu") {
            int a = name.IndexOf("luid_"), e = name.LastIndexOf("_engtype_"), ph = name.IndexOf("_phys_");
            if (a < 0 || e < 0) continue;
            key = name.Substring(a, (ph > a ? ph : e) - a) + name.Substring(e);
          }
          if (w.reducer == "raw") { Line(sb, host, cat, key, counter, v.ToString("R", CultureInfo.InvariantCulture)); continue; }
          double cur; agg.TryGetValue(key, out cur); agg[key] = cur + v;
          int n; cnt.TryGetValue(key, out n); cnt[key] = n + 1;
        }
        if (w.reducer != "raw") {
          foreach (KeyValuePair<string, double> kv in agg) {
            Line(sb, host, cat, kv.Key, counter, kv.Value.ToString("R", CultureInfo.InvariantCulture));
            if (w.reducer == "proc" && counted.Add(kv.Key)) Line(sb, host, cat, kv.Key, "instances", cnt[kv.Key].ToString());
          }
        }
      } finally { Marshal.FreeHGlobal(buf); }
      w.fam.accMs += sw.Elapsed.TotalMilliseconds; w.fam.ran = true;
    }
    // bounded cost: a counter family over its budget is read every 2nd, 4th, 8th tick instead (the COST line records it)
    foreach (Fam fm in fams.Values) {
      if (!fm.ran) continue;
      fm.avgMs = fm.dumps == 0 ? fm.accMs : (fm.avgMs * 0.7 + fm.accMs * 0.3); fm.dumps++;
      if (fm.dumps >= 3 && fm.budgetMs > 0 && fm.avgMs > fm.budgetMs && fm.every < 8) { fm.every *= 2; fm.dumps = 0; }
      sb.Append("COST|").Append(fm.name).Append('|').Append(fm.accMs.ToString("0.0", CultureInfo.InvariantCulture)).Append('|').Append(fm.every).Append('\\n');
      fm.accMs = 0; fm.ran = false;
    }
    return sb.ToString();
  }
  public bool Collect() { return PdhCollectQueryData(q) == 0; }
  public string Dump(string host) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < cs.Count; i++) {
      uint t; FmtValue v;
      uint r = PdhGetFormattedCounterValue(cs[i], 0x200, out t, out v);
      if (r != 0 || (v.CStatus != 0 && v.CStatus != 1)) continue;
      if (double.IsNaN(v.Val) || double.IsInfinity(v.Val)) continue;
      sb.Append("\\\\\\\\").Append(host).Append(names[i]).Append('=').Append(v.Val.ToString("R", CultureInfo.InvariantCulture)).Append('\\n');
    }
    return sb.ToString();
  }
}
`;

// dynamic: [{path, reducer: 'proc'|'gpu'|'raw', budgetMs}] wildcard counters whose instances come and go
function buildSessionScript({ paths, dynamic = [], intervalS = 2, nodePid = process.pid, helperPid = 0, memoryExtras = true }) {
  const step = Math.round(intervalS * 1000);
  const lines = [
    `$ErrorActionPreference='SilentlyContinue'`,
    `$ci=[cultureinfo]::InvariantCulture`,
    `$hn=$env:COMPUTERNAME`,
    `$src=@'${PDH_CS}'@`,
    `Add-Type -TypeDefinition $src`,
    `$p=New-Object TtPdh`,
    `$want=@(${paths.map(psq).join(',')})`,
    `foreach ($path in $want) {`,
    `  if ($path.Contains('*')) {`,
    `    $got=$p.Expand($path); if ($got.Count -eq 0) { 'SKIP|' + $path + '|no instance matches'; continue }`,
    `    foreach ($g in $got) { [void]$p.Add($g) }`,
    `  } elseif (-not $p.Add($path)) { 'SKIP|' + $path + '|counter could not be created' }`,
    `}`,
    `foreach ($d in @(${dynamic.map((d) => psq(`${d.path}@${d.reducer}@${d.budgetMs || 0}`)).join(',')})) { $a=$d.Split('@'); if (-not $p.AddWild($a[0], $a[1], [double]$a[2])) { 'SKIP|' + $a[0] + '|counter could not be created' } }`,
  ];
  if (memoryExtras) {
    // standby-cache and lifetime counters differ by Windows build: discover them by name once
    lines.push(`foreach ($n in $p.Expand('${BS}Memory${BS}*')) { if ($n -match 'Standby|Long-Term Average') { [void]$p.Add($n) } }`);
  }
  lines.push(
    `'READY|' + $p.Count`,
    `[void]$p.Collect()`,
    `$sw=[Diagnostics.Stopwatch]::StartNew(); $k=0; $step=${step}`,
    `Start-Sleep -Milliseconds $step`,
    `while ($true) {`,
    `  $k++`,
    `  [void]$p.Collect()`,
    `  $sb=New-Object Text.StringBuilder`,
    `  [void]$sb.AppendLine('BEGIN|' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))`,
    `  [void]$sb.Append($p.Dump($hn))`,
    `  [void]$sb.Append($p.DumpWild($hn))`,
    `  try { [void]$sb.AppendLine('POWER|' + $p.Pwr()) } catch {}`,
    `  try { [void]$sb.AppendLine('OBS|' + $p.Obs(${nodePid}, ${Number(helperPid) || 0})) } catch {}`,
    `  [void]$sb.AppendLine('END')`,
    `  [Console]::Out.Write($sb.ToString()); [Console]::Out.Flush()`,
    `  $d=($k+1)*$step - $sw.ElapsedMilliseconds; if ($d -gt 0) { Start-Sleep -Milliseconds $d }`,
    `}`,
  );
  return lines.join('\n');
}

module.exports = { buildSessionScript, PDH_CS };
