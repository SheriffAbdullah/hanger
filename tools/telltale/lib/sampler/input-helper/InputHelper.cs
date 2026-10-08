// telltale input-response helper (C#, .NET Framework 4, one file, no dependencies).
//
// PRIVACY RULE (read this before editing): this program observes ONLY the fact and time that input occurred (one
// system-wide "last input" timestamp that does not say which device or which key) and how long the foreground
// application takes to answer a trivial liveness request. It never receives keystrokes or pointer data, never reads
// window titles or document text, never touches the shared text buffer, and never records which application was in the
// foreground unless that application is in the declared scope or in the fixed system set; any other application is
// written as the literal "out-of-scope" with no name. Do not add a mechanism that receives other applications' input.
// test/input-helper-source.test.js searches this file for such mechanisms.
//
// Duties are kept in separate classes so a later duty (a global shortcut for user marks) can share the clock and writer:
//   Clock      monotonic + wall clock read together
//   Writer     the only writer: one JSON object per line, flushed per line, to the helper's own append-only file
//   ProbeLoop  the periodic wake: input-recent check, liveness request, classification, lateness, 10 s window records
//   Scope      foreground classification with the same semantics as lib/scope.js classifyForeground
//
// Control channel (stdin, one command per line): "set key=value", "scope-begin", "scope open=0|1",
// "scope entry name=<n> desc=0|1", "scope entry pattern=<p> desc=0|1", "scope system=<a,b,c>", "scope pinned=<pid,pid>",
// "scope-end", "go", "stop". stdin closing means the main process is gone: the helper writes input-end and exits.
// Self-test mode: "--classify" reads "name|pid" lines on stdin after the scope commands and prints "kind|group".
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace TelltaleInput
{
    static class Native
    {
        [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
        [DllImport("kernel32.dll")] public static extern uint GetTickCount();
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder sb, ref uint size);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] public static extern void GetSystemTimePreciseAsFileTime(out long fileTime);
        [DllImport("kernel32.dll")] public static extern bool QueryUnbiasedInterruptTime(out ulong ticks100ns);
        [DllImport("kernel32.dll")] public static extern bool SetProcessWorkingSetSize(IntPtr h, IntPtr min, IntPtr max);
        public const uint WM_NULL = 0, SMTO_BLOCK = 1, QUERY_LIMITED = 0x1000, DESKTOP_SWITCH = 0x100;
        public const int SM_REMOTESESSION = 0x1000, ERROR_ACCESS_DENIED = 5, ERROR_TIMEOUT = 1460;
    }

    // monotonic and wall clock read together; any later conversion is checkable against the anchor
    class Clock
    {
        readonly long freq = Stopwatch.Frequency;
        public readonly long AnchorMono;
        public readonly DateTime AnchorWall;
        public Clock() { AnchorMono = Stopwatch.GetTimestamp(); AnchorWall = WallNow(); }
        public static DateTime WallNow() { long ft; Native.GetSystemTimePreciseAsFileTime(out ft); return DateTime.FromFileTimeUtc(ft); }
        public long MonoTicks() { return Stopwatch.GetTimestamp(); }
        public double MonoMs() { return (Stopwatch.GetTimestamp() - AnchorMono) * 1000.0 / freq; }
        public double MsBetween(long a, long b) { return (b - a) * 1000.0 / freq; }
        public static string Iso(DateTime t) { return t.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture); }
    }

    // the only writer: one JSON object per line, flushed per line
    class Writer
    {
        readonly FileStream fs;
        readonly object gate = new object();
        public Writer(string path) { fs = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 1); }
        public void Line(string json)
        {
            byte[] b = Encoding.UTF8.GetBytes(json + "\n");
            lock (gate) { fs.Write(b, 0, b.Length); fs.Flush(); }
        }
        public void Close() { lock (gate) { try { fs.Close(); } catch (Exception) { } } }
        public static string Esc(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in s) { if (c == '"' || c == '\\') sb.Append('\\').Append(c); else if (c < 32) sb.Append(' '); else sb.Append(c); }
            return sb.Append('"').ToString();
        }
        public static string N(double v) { return Math.Round(v, 1).ToString("0.#", CultureInfo.InvariantCulture); }
    }

    // foreground classification with the semantics of lib/scope.js classifyForeground
    class Scope
    {
        public bool Open;
        public List<KeyValuePair<string, bool>> Names = new List<KeyValuePair<string, bool>>();
        public List<KeyValuePair<Regex, bool>> Patterns = new List<KeyValuePair<Regex, bool>>();
        public HashSet<string> System = new HashSet<string>();
        public HashSet<uint> Pinned = new HashSet<uint>();
        public bool HasDescendants;
        public static string Norm(string n)
        {
            if (n == null) return "";
            n = n.Trim().ToLowerInvariant();
            return n.EndsWith(".exe") ? n.Substring(0, n.Length - 4) : n;
        }
        public static Regex Glob(string g)
        {
            g = Norm(g);
            string esc = Regex.Replace(g, @"[.+^${}()|\[\]\\]", "\\$0").Replace("*", ".*").Replace("?", ".");
            return new Regex("^" + esc + "$", RegexOptions.IgnoreCase);
        }
        // kind: in-scope | system | out-of-scope | unknown ; group only for in-scope and system
        public void Classify(string exe, uint pid, out string kind, out string group)
        {
            string n = Norm(exe);
            kind = "unknown"; group = null;
            if (n.Length == 0) return;
            if (Open) { if (System.Contains(n)) { kind = "system"; } else { kind = "in-scope"; } group = n; return; }
            foreach (var e in Names) if (e.Key == n) { kind = "in-scope"; group = n; return; }
            foreach (var e in Patterns) if (e.Key.IsMatch(n)) { kind = "in-scope"; group = n; return; }
            if (System.Contains(n)) { kind = "system"; group = n; return; }
            if (HasDescendants && pid != 0 && Pinned.Contains(pid)) { kind = "in-scope"; group = n; return; }
            kind = "out-of-scope";
        }
    }

    // builds a Scope from control lines; the finished snapshot replaces the live one atomically
    class ScopeParser
    {
        Scope building; List<KeyValuePair<string, bool>> names; List<KeyValuePair<Regex, bool>> pats;
        public Scope Live = new Scope();
        // returns true when the line was a scope command
        public bool Feed(string line)
        {
            if (line == "scope-begin") { building = new Scope(); names = new List<KeyValuePair<string, bool>>(); pats = new List<KeyValuePair<Regex, bool>>(); return true; }
            if (line == "scope-end") { if (building != null) { building.Names = names; building.Patterns = pats; Live = building; building = null; } return true; }
            if (!line.StartsWith("scope ")) return false;
            if (building == null) return true;
            string body = line.Substring(6);
            if (body.StartsWith("open=")) building.Open = body.Substring(5) == "1";
            else if (body.StartsWith("system=")) { foreach (string x in body.Substring(7).Split(',')) if (x.Length > 0) building.System.Add(Scope.Norm(x)); }
            else if (body.StartsWith("pinned=")) { foreach (string x in body.Substring(7).Split(',')) { uint p; if (uint.TryParse(x, out p)) building.Pinned.Add(p); } }
            else if (body.StartsWith("entry "))
            {
                string e = body.Substring(6); bool desc = e.EndsWith(" desc=1"); int ix = e.LastIndexOf(" desc="); if (ix >= 0) e = e.Substring(0, ix);
                if (e.StartsWith("name=")) names.Add(new KeyValuePair<string, bool>(Scope.Norm(e.Substring(5)), desc));
                else if (e.StartsWith("pattern=")) pats.Add(new KeyValuePair<Regex, bool>(Scope.Glob(e.Substring(8)), desc));
                if (desc) building.HasDescendants = true;
            }
            return true;
        }
    }

    class Settings
    {
        public int StallMs = 250, RecentInputMs = 1000, MergeGapMs = 1000, LateMs = 200, TickMs = 250, TimeoutMs = 1000;
        public string OutFile = null, Build = "compiled";
    }

    class ProbeLoop
    {
        readonly Settings s; readonly ScopeParser scope; readonly Writer w; readonly Clock clock; readonly ManualResetEvent stop;
        // window accounting
        long winStartMono; DateTime winStartWall;
        double evalMs, idleMs, skipMs; int measured, stalls, fgChanged;
        List<double> lat = new List<double>(), late = new List<double>();
        Dictionary<string, int[]> groups = new Dictionary<string, int[]>();
        List<double[]> active = new List<double[]>();
        double activeStart = -1;
        // state
        string cls = "idle"; string skipReason = null; long lastAcct; DateTime skipStartWall; long skipStartMono;
        bool latePeriod; DateTime lateStart; double lateMax; int lateN;
        long lastUnbiased; long lastQpcAtWake;
        long resumeUntilMono;
        readonly Dictionary<uint, KeyValuePair<string, long>> nameCache = new Dictionary<uint, KeyValuePair<string, long>>();
        public ProbeLoop(Settings st, ScopeParser sc, Writer wr, Clock ck, ManualResetEvent stopEvt) { s = st; scope = sc; w = wr; clock = ck; stop = stopEvt; }

        string ExeName(uint pid)
        {
            KeyValuePair<string, long> c;
            long now = clock.MonoTicks();
            if (nameCache.TryGetValue(pid, out c) && clock.MsBetween(c.Value, now) < 5000) return c.Key;
            string name = null;
            IntPtr h = Native.OpenProcess(Native.QUERY_LIMITED, false, pid);
            if (h != IntPtr.Zero)
            {
                StringBuilder sb = new StringBuilder(520); uint size = 520;
                if (Native.QueryFullProcessImageName(h, 0, sb, ref size)) name = Path.GetFileName(sb.ToString());
                Native.CloseHandle(h);
            }
            if (nameCache.Count > 64) nameCache.Clear();
            nameCache[pid] = new KeyValuePair<string, long>(name, now);
            return name;
        }

        void StartWindow(long mono, DateTime wall) { winStartMono = mono; winStartWall = wall; evalMs = idleMs = skipMs = 0; measured = stalls = fgChanged = 0; lat.Clear(); late.Clear(); groups.Clear(); active.Clear(); activeStart = cls == "eval" ? 0 : -1; }

        static double Pct(List<double> v, double q) { if (v.Count == 0) return 0; var a = v.ToArray(); Array.Sort(a); int i = (int)Math.Ceiling(q * a.Length) - 1; if (i < 0) i = 0; return a[i]; }

        void FlushWindow(long endMono, DateTime endWall)
        {
            double dur = clock.MsBetween(winStartMono, endMono);
            if (activeStart >= 0) { active.Add(new double[] { activeStart, dur }); activeStart = cls == "eval" ? 0 : -1; }
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"type\":\"input-window\",\"from\":\"").Append(Clock.Iso(winStartWall)).Append("\",\"to\":\"").Append(Clock.Iso(endWall)).Append("\"");
            sb.Append(",\"durMs\":").Append(Writer.N(dur)).Append(",\"evalMs\":").Append(Writer.N(evalMs)).Append(",\"idleMs\":").Append(Writer.N(idleMs)).Append(",\"skipMs\":").Append(Writer.N(skipMs));
            sb.Append(",\"measured\":").Append(measured).Append(",\"stalls\":").Append(stalls).Append(",\"fgChanged\":").Append(fgChanged);
            sb.Append(",\"latMedianMs\":").Append(Writer.N(Pct(lat, 0.5))).Append(",\"latP95Ms\":").Append(Writer.N(Pct(lat, 0.95))).Append(",\"latMaxMs\":").Append(Writer.N(Pct(lat, 1.0)));
            sb.Append(",\"lateN\":").Append(late.Count).Append(",\"lateMedianMs\":").Append(Writer.N(Pct(late, 0.5))).Append(",\"lateP95Ms\":").Append(Writer.N(Pct(late, 0.95))).Append(",\"lateMaxMs\":").Append(Writer.N(Pct(late, 1.0)));
            sb.Append(",\"groups\":{");
            bool first = true;
            foreach (var g in groups) { if (!first) sb.Append(","); first = false; sb.Append(Writer.Esc(g.Key)).Append(":{\"n\":").Append(g.Value[0]).Append(",\"over\":").Append(g.Value[1]).Append("}"); }
            sb.Append("},\"active\":[");
            int cnt = 0;
            foreach (var a in active) { if (cnt >= 60) break; if (cnt > 0) sb.Append(","); sb.Append("[").Append(Writer.N(a[0])).Append(",").Append(Writer.N(a[1])).Append("]"); cnt++; }
            sb.Append("]}");
            w.Line(sb.ToString());
            StartWindow(endMono, endWall);
        }

        // attribute the time since the last accounting point to the current class, splitting at 10 s window edges
        void Account(long nowMono)
        {
            while (true)
            {
                long winEnd = winStartMono + (long)(10000.0 * Stopwatch.Frequency / 1000.0);
                long upTo = Math.Min(nowMono, winEnd);
                double d = clock.MsBetween(lastAcct, upTo);
                if (d > 0) { if (cls == "eval") evalMs += d; else if (cls == "skip") skipMs += d; else idleMs += d; }
                lastAcct = upTo;
                if (nowMono >= winEnd) { DateTime endWall = winStartWall.AddMilliseconds(10000.0); FlushWindow(winEnd, endWall); continue; }
                break;
            }
        }

        void SetClass(string next, string reason, long nowMono)
        {
            Account(nowMono);
            if (next == cls && reason == skipReason) return;
            DateTime nowWall = Clock.WallNow();
            if (cls == "eval" && activeStart >= 0 && next != "eval") { active.Add(new double[] { activeStart, clock.MsBetween(winStartMono, nowMono) }); activeStart = -1; }
            if (next == "eval" && cls != "eval") activeStart = clock.MsBetween(winStartMono, nowMono);
            if (cls == "skip") CloseSkip(nowMono, nowWall);
            if (next == "skip") { skipStartWall = nowWall; skipStartMono = nowMono; }
            cls = next; skipReason = next == "skip" ? reason : null;
        }
        void CloseSkip(long nowMono, DateTime nowWall)
        {
            if (clock.MsBetween(skipStartMono, nowMono) >= 500)
                w.Line("{\"type\":\"input-skip\",\"from\":\"" + Clock.Iso(skipStartWall) + "\",\"to\":\"" + Clock.Iso(nowWall) + "\",\"reason\":" + Writer.Esc(skipReason) + "}");
        }
        void CloseLate(DateTime endWall)
        {
            if (!latePeriod) return;
            w.Line("{\"type\":\"input-late\",\"startAt\":\"" + Clock.Iso(lateStart) + "\",\"endAt\":\"" + Clock.Iso(endWall) + "\",\"maxMs\":" + Writer.N(lateMax) + ",\"n\":" + lateN + "}");
            latePeriod = false;
        }

        // wake-lateness: overshoot of the sleep the helper itself requested (independent of the main process)
        void NoteWake(double overshootMs, DateTime wakeWall)
        {
            late.Add(overshootMs);
            if (overshootMs >= s.LateMs)
            {
                if (!latePeriod) { latePeriod = true; lateStart = wakeWall.AddMilliseconds(-overshootMs); lateMax = overshootMs; lateN = 1; }
                else { lateMax = Math.Max(lateMax, overshootMs); lateN++; }
                lateEnd = wakeWall;
            }
            else CloseLate(lateEnd);
        }
        DateTime lateEnd;

        public void Run()
        {
            long now0 = clock.MonoTicks();
            lastAcct = now0; StartWindow(now0, Clock.WallNow());
            ulong ub; Native.QueryUnbiasedInterruptTime(out ub); lastUnbiased = (long)ub; lastQpcAtWake = now0;
            bool remote = Native.GetSystemMetrics(Native.SM_REMOTESESSION) != 0;
            double overshoot = 0;
            while (!stop.WaitOne(0))
            {
                long t0 = clock.MonoTicks();
                DateTime wall0 = Clock.WallNow();
                // suspend and resume: monotonic time advanced much more than unbiased (awake) time
                ulong ubn; Native.QueryUnbiasedInterruptTime(out ubn);
                double dQpc = clock.MsBetween(lastQpcAtWake, t0), dUb = ((long)ubn - lastUnbiased) / 10000.0;
                lastQpcAtWake = t0; lastUnbiased = (long)ubn;
                if (dQpc - dUb > 2000) { resumeUntilMono = t0 + (long)(5000.0 * Stopwatch.Frequency / 1000.0); SuspendSpan(wall0, dQpc - dUb); overshoot = 0; }
                if (t0 < resumeUntilMono) { SetClass("skip", "suspend-resume", t0); Sleep(s.TickMs, ref overshoot, wall0); continue; }
                if (remote) { SetClass("skip", "remote-session", t0); Sleep(s.TickMs, ref overshoot, wall0); continue; }
                // input desktop: not openable on the lock screen or a secure prompt
                IntPtr dsk = Native.OpenInputDesktop(0, false, Native.DESKTOP_SWITCH);
                if (dsk == IntPtr.Zero) { SetClass("skip", "secure-desktop", t0); Sleep(s.TickMs, ref overshoot, wall0); continue; }
                Native.CloseDesktop(dsk);
                IntPtr hwnd = Native.GetForegroundWindow();
                if (hwnd == IntPtr.Zero) { SetClass("skip", "no-foreground", t0); Sleep(s.TickMs, ref overshoot, wall0); continue; }
                Native.LASTINPUTINFO li = new Native.LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(typeof(Native.LASTINPUTINFO));
                uint ageMs = 0;
                if (Native.GetLastInputInfo(ref li)) ageMs = unchecked(Native.GetTickCount() - li.dwTime); else ageMs = uint.MaxValue;
                if (ageMs > (uint)s.RecentInputMs) { SetClass("idle", null, t0); Sleep(s.TickMs, ref overshoot, wall0); continue; }
                // input is recent: evaluate this moment
                uint pid; Native.GetWindowThreadProcessId(hwnd, out pid);
                string exe = ExeName(pid);
                string kind, group; scope.Live.Classify(exe, pid, out kind, out group);
                bool helperLate = overshoot >= s.LateMs;
                IntPtr res; long q0 = clock.MonoTicks(); DateTime reqWall = Clock.WallNow();
                IntPtr ok = Native.SendMessageTimeout(hwnd, Native.WM_NULL, IntPtr.Zero, IntPtr.Zero, Native.SMTO_BLOCK, (uint)s.TimeoutMs, out res);
                int err = ok == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0;
                long q1 = clock.MonoTicks();
                double latency = clock.MsBetween(q0, q1);
                if (ok == IntPtr.Zero && err == Native.ERROR_ACCESS_DENIED) { SetClass("skip", "elevated-foreground", q1); Sleep(s.TickMs, ref overshoot, reqWall); continue; }
                SetClass("eval", null, t0);
                bool timedOut = ok == IntPtr.Zero;
                if (timedOut) latency = Math.Max(latency, s.TimeoutMs);
                if (Native.GetForegroundWindow() != hwnd) { fgChanged++; Account(q1); Sleep(s.TickMs - (int)Math.Min(s.TickMs, latency), ref overshoot, reqWall); continue; }
                measured++; lat.Add(latency);
                string gk = kind == "out-of-scope" ? "out-of-scope" : (kind == "unknown" ? "unknown" : group);
                int[] gc; if (!groups.TryGetValue(gk, out gc)) { gc = new int[2]; groups[gk] = gc; }
                gc[0]++;
                if (timedOut || latency >= s.StallMs)
                {
                    gc[1]++; stalls++;
                    bool hung = timedOut && Native.IsHungAppWindow(hwnd);
                    w.Line("{\"type\":\"input-stall-sample\",\"at\":\"" + Clock.Iso(reqWall) + "\",\"mono\":" + Writer.N(clock.MsBetween(clock.AnchorMono, q0)) + ",\"latencyMs\":" + Writer.N(latency) + ",\"timeout\":" + (timedOut ? "true" : "false")
                        + ",\"fg\":{\"kind\":" + Writer.Esc(kind) + ",\"group\":" + (kind == "in-scope" || kind == "system" ? Writer.Esc(group) : "null") + "},\"helperLate\":" + (helperLate ? "true" : "false") + ",\"osHung\":" + (hung ? "true" : "false") + "}");
                    Console.Out.WriteLine("S|" + Writer.N(latency) + "|" + kind + "|" + (kind == "in-scope" || kind == "system" ? group : ""));
                    Console.Out.Flush();
                }
                Sleep(s.TickMs - (int)Math.Min(s.TickMs, latency), ref overshoot, reqWall);
            }
            long end = clock.MonoTicks(); DateTime endWall = Clock.WallNow();
            Account(end);
            if (cls == "skip") CloseSkip(end, endWall);
            CloseLate(lateEnd == DateTime.MinValue ? endWall : lateEnd);
            if (activeStart >= 0) { active.Add(new double[] { activeStart, clock.MsBetween(winStartMono, end) }); activeStart = -1; }
            // final partial window
            if (clock.MsBetween(winStartMono, end) > 0) { winEndFlush(end, endWall); }
            w.Line("{\"type\":\"input-end\",\"at\":\"" + Clock.Iso(endWall) + "\",\"status\":\"orderly\"}");
        }
        void winEndFlush(long end, DateTime endWall) { FlushWindow(end, endWall); }

        void SuspendSpan(DateTime wakeWall, double sleptMs)
        {
            w.Line("{\"type\":\"input-skip\",\"from\":\"" + Clock.Iso(wakeWall.AddMilliseconds(-sleptMs)) + "\",\"to\":\"" + Clock.Iso(wakeWall.AddMilliseconds(5000)) + "\",\"reason\":\"suspend-resume\"}");
        }

        // sleep the remainder of the tick on the stop event; record how late the wake was
        void Sleep(int ms, ref double overshoot, DateTime wallForLate)
        {
            if (ms < 1) { overshoot = 0; return; }
            long a = clock.MonoTicks();
            stop.WaitOne(ms);
            long b = clock.MonoTicks();
            double over = Math.Max(0, clock.MsBetween(a, b) - ms);
            overshoot = over;
            NoteWake(over, Clock.WallNow());
        }
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            Settings st = new Settings(); ScopeParser sc = new ScopeParser();
            bool classifyMode = args.Length > 0 && args[0] == "--classify";
            string line;
            ManualResetEvent stop = new ManualResetEvent(false);
            bool go = false;
            Writer w = null;
            // configuration phase
            while ((line = Console.In.ReadLine()) != null)
            {
                line = line.Trim();
                if (line == "go") { go = true; break; }
                if (line == "stop") return 0;
                if (sc.Feed(line)) continue;
                if (line.StartsWith("set ")) SetKey(st, line.Substring(4));
            }
            if (classifyMode)
            {
                // remaining lines are "name|pid"
                string l2;
                while ((l2 = Console.In.ReadLine()) != null)
                {
                    int bar = l2.LastIndexOf('|'); uint pid = 0; string nm = l2;
                    if (bar >= 0) { uint.TryParse(l2.Substring(bar + 1), out pid); nm = l2.Substring(0, bar); }
                    string k, g; sc.Live.Classify(nm, pid, out k, out g);
                    Console.Out.WriteLine(k + "|" + (g == null ? "" : g));
                }
                return 0;
            }
            if (!go || st.OutFile == null) return 2;
            try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.BelowNormal; } catch (Exception) { }
            Clock clock = new Clock();
            w = new Writer(st.OutFile);
            w.Line("{\"type\":\"input-helper\",\"at\":\"" + Clock.Iso(clock.AnchorWall) + "\",\"mono\":0,\"build\":" + Writer.Esc(st.Build) + ",\"settings\":{\"stallMs\":" + st.StallMs + ",\"recentInputMs\":" + st.RecentInputMs + ",\"mergeGapMs\":" + st.MergeGapMs + ",\"lateMs\":" + st.LateMs + ",\"tickMs\":" + st.TickMs + ",\"timeoutMs\":" + st.TimeoutMs + "}}");
            // stdin watcher: closing stdin means the main process is gone; scope updates are accepted while running
            Thread reader = new Thread(delegate ()
            {
                string l3;
                try { while ((l3 = Console.In.ReadLine()) != null) { l3 = l3.Trim(); if (l3 == "stop") break; sc.Feed(l3); } } catch (Exception) { }
                stop.Set();
            });
            reader.IsBackground = true; reader.Start();
            Console.Out.WriteLine("R|ready"); Console.Out.Flush();
            try { Native.SetProcessWorkingSetSize(Process.GetCurrentProcess().Handle, (IntPtr)(-1), (IntPtr)(-1)); } catch (Exception) { }
            ProbeLoop loop = new ProbeLoop(st, sc, w, clock, stop);
            Thread t = new Thread(delegate ()
            {
                try { loop.Run(); }
                catch (Exception ex)
                {
                    // never die silently: the file says why the observation stopped
                    try { w.Line("{\"type\":\"input-end\",\"at\":\"" + Clock.Iso(Clock.WallNow()) + "\",\"status\":\"error\",\"reason\":" + Writer.Esc(ex.GetType().Name + ": " + ex.Message) + "}"); } catch (Exception) { }
                }
            });
            t.Priority = ThreadPriority.AboveNormal;
            t.Start();
            t.Join();
            w.Close();
            return 0;
        }
        static void SetKey(Settings st, string kv)
        {
            int i = kv.IndexOf('='); if (i < 0) return;
            string k = kv.Substring(0, i), v = kv.Substring(i + 1); int n;
            switch (k)
            {
                case "stallMs": if (int.TryParse(v, out n)) st.StallMs = n; break;
                case "recentInputMs": if (int.TryParse(v, out n)) st.RecentInputMs = n; break;
                case "mergeGapMs": if (int.TryParse(v, out n)) st.MergeGapMs = n; break;
                case "lateMs": if (int.TryParse(v, out n)) st.LateMs = n; break;
                case "tickMs": if (int.TryParse(v, out n)) st.TickMs = n; break;
                case "timeoutMs": if (int.TryParse(v, out n)) st.TimeoutMs = n; break;
                case "outFile": st.OutFile = v; break;
                case "build": st.Build = v; break;
            }
        }
    }
}
