using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace ShaneBuilder.Services;

// Git #2216 — README-ClaudeChat.md §6.8's "PowerShell" and "Terminal" mini panels.
// Shane's own 2026-09-02 decision on the issue: real live sessions, not scripted replies
// — running PowerShell/cmd from inside this app carries no more capability than opening
// either from the Start menu, since he already has full local access either way. So each
// session here is a genuine long-lived child process (powershell.exe or cmd.exe) with its
// stdin/stdout/stderr redirected, not a canned response table.
//
// A redirected console host doesn't echo the command you send it and gives no reliable
// "the command is done" signal on its own, so this wraps each RunAsync in a sentinel:
// after writing the real command we write a second line that echoes a random per-session
// marker, and treat every line up to that marker as this command's output. The UI (not
// the shell) is responsible for showing the command itself, in the prompt colour, before
// the output arrives — see TerminalLine.IsPrompt.

public sealed record TerminalLine(string Text, bool IsPrompt);

public enum TerminalSessionKind { PowerShell, Cmd }

public sealed class TerminalSession : IDisposable
{
    public TerminalSessionKind Kind { get; }
    public string PromptText => Kind == TerminalSessionKind.PowerShell ? "PS>" : "$";
    public bool IsRunning { get; private set; }
    public bool HasExited => _proc.HasExited;

    // Real scrollback for this one session — read by the panel that's currently showing it,
    // survives a tab switch because the TerminalSession itself is keyed by tab id by the
    // caller (MainWindow's _psSessionsByTab / _terminalSessionsByTab), not owned by any panel.
    public IReadOnlyList<TerminalLine> Lines => _lines;
    private readonly List<TerminalLine> _lines = new();

    public event Action? Updated;

    private readonly Process _proc;
    private readonly string _marker;
    private TaskCompletionSource<bool>? _pendingCommand;

    public TerminalSession(TerminalSessionKind kind)
    {
        Kind = kind;
        _marker = "SB2216_" + Guid.NewGuid().ToString("N");

        var psi = kind == TerminalSessionKind.PowerShell
            ? new ProcessStartInfo("powershell.exe", "-NoLogo -NoProfile -Command -")
            : new ProcessStartInfo("cmd.exe", "/Q /K prompt $G");
        psi.WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;

        _proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _proc.OutputDataReceived += (_, e) => { if (e.Data != null) OnLine(e.Data); };
        _proc.ErrorDataReceived += (_, e) => { if (e.Data != null) OnLine(e.Data); };
        _proc.Exited += (_, _) =>
        {
            _lines.Add(new TerminalLine($"(session ended — exit code {SafeExitCode()})", false));
            _pendingCommand?.TrySetResult(true);
            Updated?.Invoke();
        };

        _proc.Start();
        _proc.BeginOutputReadLine();
        _proc.BeginErrorReadLine();
    }

    private int SafeExitCode()
    {
        try { return _proc.ExitCode; } catch { return -1; }
    }

    private void OnLine(string line)
    {
        if (line.Contains(_marker))
        {
            IsRunning = false;
            _pendingCommand?.TrySetResult(true);
            Updated?.Invoke();
            return;
        }
        _lines.Add(new TerminalLine(line, false));
        Updated?.Invoke();
    }

    public async Task RunAsync(string command, int timeoutMs = 30000)
    {
        if (string.IsNullOrWhiteSpace(command) || IsRunning) return;

        // IsRunning flips BEFORE the first Updated notification (not after) so a caller that
        // disables its input box on that same notification can't race a second command in
        // before this one's completion marker is wired up — RunAsync tracks only one pending
        // command at a time per session.
        IsRunning = true;
        _lines.Add(new TerminalLine($"{PromptText} {command}", true));
        Updated?.Invoke();

        if (_proc.HasExited)
        {
            IsRunning = false;
            _lines.Add(new TerminalLine("(session has exited — close and reopen this panel for a new one)", false));
            Updated?.Invoke();
            return;
        }

        var tcs = new TaskCompletionSource<bool>();
        _pendingCommand = tcs;

        try
        {
            string markerLine = Kind == TerminalSessionKind.PowerShell
                ? $"Write-Output '{_marker}'"
                : $"echo {_marker}";
            await _proc.StandardInput.WriteLineAsync(command);
            await _proc.StandardInput.WriteLineAsync(markerLine);
            await _proc.StandardInput.FlushAsync();
        }
        catch (Exception ex)
        {
            IsRunning = false;
            _lines.Add(new TerminalLine($"(failed to send command: {ex.Message})", false));
            Updated?.Invoke();
            return;
        }

        var winner = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs));
        if (winner != tcs.Task)
        {
            IsRunning = false;
            _lines.Add(new TerminalLine($"(no response after {timeoutMs / 1000}s — the session may be waiting on interactive input it can't receive here)", false));
            Updated?.Invoke();
        }
    }

    public void Dispose()
    {
        try { if (!_proc.HasExited) _proc.Kill(entireProcessTree: true); } catch { /* best-effort teardown */ }
        try { _proc.Dispose(); } catch { /* already gone */ }
    }
}
