using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Management.Automation;
using System.Management.Automation.Host;
using System.Security;
// UseWindowsForms is enabled in this project (for the screenshot tool), which pulls in
// System.Drawing — whose Size/Rectangle collide with PSHost's own. Alias to the PSHost types.
using Size = System.Management.Automation.Host.Size;
using Rectangle = System.Management.Automation.Host.Rectangle;

namespace MyArchitect.Services;

/// <summary>
/// Minimal hosted <see cref="PSHost"/> for the in-process console runspace (#3459). No console
/// window exists to receive Write-Host output, so this captures every line the runspace writes
/// through the host UI — including Connect-MgGraph's device-code sign-in instructions, which the
/// Graph SDK prints via the host UI rather than the output pipeline — into a real
/// <see cref="LineWritten"/> event a future Console UI panel (blocked on #3493) can subscribe to.
/// </summary>
public sealed class HostedConsolePSHost : PSHost
{
    private readonly Guid _instanceId = Guid.NewGuid();
    private readonly HostedConsolePSHostUserInterface _ui = new();

    public event Action<string>? LineWritten
    {
        add => _ui.LineWritten += value;
        remove => _ui.LineWritten -= value;
    }

    public override CultureInfo CurrentCulture => CultureInfo.CurrentCulture;
    public override CultureInfo CurrentUICulture => CultureInfo.CurrentUICulture;
    public override Guid InstanceId => _instanceId;
    public override string Name => "MyArchitectHostedConsole";
    public override PSHostUserInterface UI => _ui;
    public override Version Version => new(1, 0, 0);

    public override void EnterNestedPrompt() { }
    public override void ExitNestedPrompt() { }
    public override void NotifyBeginApplication() { }
    public override void NotifyEndApplication() { }
    public override void SetShouldExit(int exitCode) { }
}

/// <summary>Captures Write-Host/Write-*-Line calls made by cmdlets running in the hosted
/// runspace into a plain string event, since there is no real console to render them to.</summary>
internal sealed class HostedConsolePSHostUserInterface : PSHostUserInterface
{
    private readonly HostedConsolePSHostRawUserInterface _raw = new();

    public event Action<string>? LineWritten;

    public override PSHostRawUserInterface RawUI => _raw;

    public override void Write(string value) => LineWritten?.Invoke(value);

    public override void Write(ConsoleColor foregroundColor, ConsoleColor backgroundColor, string value) =>
        LineWritten?.Invoke(value);

    public override void WriteLine(string value) => LineWritten?.Invoke(value + Environment.NewLine);

    public override void WriteErrorLine(string value) => LineWritten?.Invoke("[error] " + value + Environment.NewLine);

    public override void WriteDebugLine(string message) => LineWritten?.Invoke("[debug] " + message + Environment.NewLine);

    public override void WriteProgress(long sourceId, ProgressRecord record) { }

    public override void WriteVerboseLine(string message) => LineWritten?.Invoke("[verbose] " + message + Environment.NewLine);

    public override void WriteWarningLine(string message) => LineWritten?.Invoke("[warning] " + message + Environment.NewLine);

    // No UI is wired up to answer an interactive prompt yet (#3459 is blocked on #3493 for that) —
    // fail loudly instead of hanging or fabricating an answer.
    public override Dictionary<string, PSObject> Prompt(string caption, string message, Collection<FieldDescription> descriptions) =>
        throw new NotSupportedException("Interactive Prompt() is not supported by the hosted console — no UI panel exists yet to answer it (#3459 blocked on #3493).");

    public override int PromptForChoice(string caption, string message, Collection<ChoiceDescription> choices, int defaultChoice) =>
        defaultChoice;

    public override PSCredential PromptForCredential(string caption, string message, string userName, string targetName) =>
        throw new NotSupportedException("Interactive credential prompts are not supported by the hosted console.");

    public override PSCredential PromptForCredential(string caption, string message, string userName, string targetName,
        PSCredentialTypes allowedCredentialTypes, PSCredentialUIOptions options) =>
        throw new NotSupportedException("Interactive credential prompts are not supported by the hosted console.");

    public override string ReadLine() =>
        throw new NotSupportedException("ReadLine is not supported by the hosted console — no interactive input surface exists yet.");

    public override SecureString ReadLineAsSecureString() =>
        throw new NotSupportedException("ReadLineAsSecureString is not supported by the hosted console.");
}

/// <summary>No real console window backs this host, so raw UI (buffer/cursor/window geometry)
/// is a plain in-memory stub sized to a conventional console — cmdlets that probe it (some
/// progress/formatting logic does) get sane, non-throwing answers instead of hitting a real
/// screen buffer that doesn't exist.</summary>
internal sealed class HostedConsolePSHostRawUserInterface : PSHostRawUserInterface
{
    public override ConsoleColor BackgroundColor { get; set; } = ConsoleColor.Black;
    public override ConsoleColor ForegroundColor { get; set; } = ConsoleColor.Gray;
    public override Size BufferSize { get; set; } = new(120, 3000);
    public override Coordinates CursorPosition { get; set; } = new(0, 0);
    public override int CursorSize { get; set; } = 25;
    public override bool KeyAvailable => false;
    public override Size MaxPhysicalWindowSize => new(120, 80);
    public override Size MaxWindowSize => new(120, 80);
    public override Coordinates WindowPosition { get; set; } = new(0, 0);
    public override Size WindowSize { get; set; } = new(120, 80);
    public override string WindowTitle { get; set; } = "MyArchitect Hosted Console";

    public override void FlushInputBuffer() { }

    public override BufferCell[,] GetBufferContents(Rectangle rectangle) => new BufferCell[0, 0];

    public override KeyInfo ReadKey(ReadKeyOptions options) =>
        throw new NotSupportedException("ReadKey is not supported by the hosted console — no interactive input surface exists yet.");

    public override void ScrollBufferContents(Rectangle source, Coordinates destination, Rectangle clip, BufferCell fill) { }

    public override void SetBufferContents(Rectangle rectangle, BufferCell fill) { }

    public override void SetBufferContents(Coordinates origin, BufferCell[,] contents) { }
}
