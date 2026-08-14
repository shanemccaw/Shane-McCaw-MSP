using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// design_handoff_claude_cli_chat/README.md's "State Management" section, translated to
    /// C#. This is the first bound-MVVM code in BuildConsole (everything else in the app is
    /// imperative code-behind) — deliberately hand-rolled (no MVVM toolkit package) and
    /// scoped to just this one control, per the redesign plan.
    /// </summary>
    public abstract class ObservableObject : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler? PropertyChanged;

        protected bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
        {
            if (Equals(field, value)) return false;
            field = value;
            OnPropertyChanged(propertyName);
            return true;
        }

        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }

    /// <summary>Base type for one item in the transcript's <see cref="ChatPaneViewModel.Turns"/> — README: "UserMessage(text), AssistantParagraph(text, isStreaming), ToolGroup(...), StatusLine(...)".</summary>
    public abstract class TurnItem : ObservableObject
    {
    }

    public sealed class UserMessageTurn : TurnItem
    {
        public string Text { get; }
        public UserMessageTurn(string text) => Text = text;
    }

    /// <summary>
    /// Marker turn rendering just the "CLAUDE" role header (spec: the gradient sparkles tile
    /// + label). The spec's DOM groups an entire run of paragraphs/tool-groups/status-lines
    /// under ONE role header, not one per paragraph — this app's transcript is otherwise a
    /// flat append-only list (simplest for incremental streaming), so BuildWatchWindow
    /// inserts exactly one of these each time assistant output resumes after a user message
    /// (or at the very start), instead of repeating the header per line.
    /// </summary>
    public sealed class AssistantTurnStartTurn : TurnItem
    {
    }

    /// <summary>Extends the spec's plain AssistantParagraph with a Kind so today's color-coded error/done lines (LooksLikeError / "--- done ---" detection in BuildWatchWindow) keep their distinct signal — the spec's literal text only shows plain prose, but this existing functionality must be preserved (README: "Same information as today").</summary>
    public enum ParagraphKind { Normal, Error, Done }

    public sealed class AssistantParagraphTurn : TurnItem
    {
        private string _text = "";
        public string Text { get => _text; set => SetProperty(ref _text, value); }

        private bool _isStreaming;
        public bool IsStreaming { get => _isStreaming; set => SetProperty(ref _isStreaming, value); }

        public ParagraphKind Kind { get; init; } = ParagraphKind.Normal;
    }

    /// <summary>One kind of line in a rendered file-edit diff (Edit/Write/MultiEdit), built from the real tool-call `input`.</summary>
    public enum DiffLineKind { Context, Added, Removed, Meta }

    /// <summary>One line of a real file-edit diff — the verbatim text (with its "+"/"-"/"  " prefix) and its kind, so the view can tint it. Immutable.</summary>
    public sealed class DiffLine
    {
        public string Text { get; }
        public DiffLineKind Kind { get; }
        public DiffLine(string text, DiffLineKind kind) { Text = text; Kind = kind; }
    }

    /// <summary>
    /// One collapsed tool call's detail line. For a BuildConsole-owned interactive build this now
    /// carries the REAL detail parsed from the stream-json event (QueueWatcherService.ParseInteractiveEvents):
    /// the one-line <see cref="CommandPreview"/> (the Bash command / Read file_path / Grep pattern …),
    /// the tool's real <see cref="Output"/> (filled in when its matching tool_result event lands, keyed
    /// by <see cref="ToolUseId"/>), and — for Edit/Write/MultiEdit — a real colored <see cref="Diff"/>.
    /// A foreign/legacy file-tail build still only has the tool name available (the log FILE keeps the
    /// old "[tool: X]" flattening), so those fields stay null there — an honest boundary, nothing faked.
    /// Extends <see cref="ObservableObject"/> because <see cref="Output"/>/<see cref="IsError"/> fill in
    /// AFTER the chip is created (the tool_result arrives a beat later), so the expanded view updates live.
    /// </summary>
    public sealed class ToolDetailLine : ObservableObject
    {
        public string ToolName { get; }
        public string? ToolUseId { get; }
        public string? CommandPreview { get; }
        public bool HasCommand => !string.IsNullOrWhiteSpace(CommandPreview);

        /// <summary>Colored diff lines for a file-edit tool (Edit/Write/MultiEdit), else null. Known at creation time (from the tool_use `input`).</summary>
        public ObservableCollection<DiffLine>? Diff { get; init; }
        public bool HasDiff => Diff != null && Diff.Count > 0;

        private string? _output;
        /// <summary>The tool's real output — filled in when its tool_result event lands. Null until then.</summary>
        public string? Output { get => _output; set { if (SetProperty(ref _output, value)) OnPropertyChanged(nameof(HasOutput)); } }
        public bool HasOutput => !string.IsNullOrWhiteSpace(Output);

        private bool _isError;
        /// <summary>The tool reported an error (tool_result is_error) — the display tints the output.</summary>
        public bool IsError { get => _isError; set => SetProperty(ref _isError, value); }

        public ToolDetailLine(string toolName, string? toolUseId = null, string? commandPreview = null)
        {
            ToolName = toolName;
            ToolUseId = toolUseId;
            CommandPreview = commandPreview;
        }
    }

    public sealed class ToolGroupTurn : TurnItem
    {
        public ObservableCollection<ToolDetailLine> Details { get; } = new();

        private string _title = "";
        public string Title { get => _title; set => SetProperty(ref _title, value); }

        private string _summary = "";
        public string Summary { get => _summary; set => SetProperty(ref _summary, value); }

        /// <summary>"wrench" for a multi-tool run, "file-text" for a single Read — matches the two glyphs the spec names.</summary>
        private string _glyphKey = "wrench";
        public string GlyphKey { get => _glyphKey; set => SetProperty(ref _glyphKey, value); }

        private bool _isExpanded;
        public bool IsExpanded { get => _isExpanded; set => SetProperty(ref _isExpanded, value); }
    }

    /// <summary>The trailing live "running X…" row shown only while a slot is actively working. No per-call elapsed timer is shown (spec's "4.2s") — this app doesn't track per-tool-call timing, only overall run elapsed (already surfaced in the composer's status footer), so nothing is fabricated here.</summary>
    public sealed class StatusLineTurn : TurnItem
    {
        private string _activityText = "starting…";
        public string ActivityText { get => _activityText; set => SetProperty(ref _activityText, value); }

        private bool _spinning = true;
        public bool Spinning { get => _spinning; set => SetProperty(ref _spinning, value); }
    }

    /// <summary>Drives the composer footer's shape for a slot's current lifecycle stage.</summary>
    public enum ComposerMode
    {
        /// <summary>A BuildConsole-owned build with a real stdin — full input shell + Stop + Send.</summary>
        Interactive,
        /// <summary>Still running but this app doesn't own its stdin (a foreign/legacy build) — read-only, no input possible.</summary>
        ReadOnlyRunning,
        /// <summary>Done / Failed / Stale — input shell replaced by a Dismiss row.</summary>
        Terminal,
    }

    public sealed class ChatPaneViewModel : ObservableObject
    {
        // ── Header ───────────────────────────────────────────────────────
        private string _sessionLabel = "";
        public string SessionLabel { get => _sessionLabel; set => SetProperty(ref _sessionLabel, value); }

        private string _localLabel = "";
        public string LocalLabel { get => _localLabel; set => SetProperty(ref _localLabel, value); }

        private string _modelLabel = "";
        public string ModelLabel { get => _modelLabel; set => SetProperty(ref _modelLabel, value); }

        // Pill — brushes are set directly by BuildWatchWindow's state-transition code
        // (FindResource against Resources/ChatPaneBrushes.xaml), mirroring how the
        // pre-redesign code directly assigned Border/TextBlock brushes for each state.
        private Brush? _pillFill;
        public Brush? PillFill { get => _pillFill; set => SetProperty(ref _pillFill, value); }
        private Brush? _pillBorder;
        public Brush? PillBorder { get => _pillBorder; set => SetProperty(ref _pillBorder, value); }
        private Brush? _pillDot;
        public Brush? PillDot { get => _pillDot; set => SetProperty(ref _pillDot, value); }
        private Brush? _pillText;
        public Brush? PillText { get => _pillText; set => SetProperty(ref _pillText, value); }
        private string _pillLabel = "IDLE";
        public string PillLabel { get => _pillLabel; set => SetProperty(ref _pillLabel, value); }
        private bool _pillPulsing;
        public bool PillPulsing { get => _pillPulsing; set => SetProperty(ref _pillPulsing, value); }
        private string? _pillTooltip;
        public string? PillTooltip { get => _pillTooltip; set => SetProperty(ref _pillTooltip, value); }

        // ── Transcript ───────────────────────────────────────────────────
        public ObservableCollection<TurnItem> Turns { get; } = new();

        // ── Composer ─────────────────────────────────────────────────────
        private string _draft = "";
        public string Draft { get => _draft; set { if (SetProperty(ref _draft, value)) OnPropertyChanged(nameof(CanSend)); } }

        public bool CanSend => Mode == ComposerMode.Interactive && !string.IsNullOrWhiteSpace(Draft);

        private ComposerMode _mode = ComposerMode.ReadOnlyRunning;
        public ComposerMode Mode
        {
            get => _mode;
            set { if (SetProperty(ref _mode, value)) OnPropertyChanged(nameof(CanSend)); }
        }

        private bool _canStop;
        public bool CanStop { get => _canStop; set => SetProperty(ref _canStop, value); }

        private string _elapsedLabel = "";
        public string ElapsedLabel { get => _elapsedLabel; set => SetProperty(ref _elapsedLabel, value); }

        /// <summary>Real usage read from the CLI's own stream-json `usage` field (QueueWatcherService.GetContextTokens) — null (hides the footer segment) when not available, never fabricated.</summary>
        private long? _tokensUsed;
        public long? TokensUsed { get => _tokensUsed; set { if (SetProperty(ref _tokensUsed, value)) OnPropertyChanged(nameof(TokensLabel)); } }

        /// <summary>The standard Claude context-window size (a real model constant, not fetched per-build) shown as the fraction's denominator.</summary>
        private long? _tokenBudget;
        public long? TokenBudget { get => _tokenBudget; set { if (SetProperty(ref _tokenBudget, value)) OnPropertyChanged(nameof(TokensLabel)); } }

        public string? TokensLabel => TokensUsed.HasValue && TokenBudget.HasValue
            ? $"{FormatCount(TokensUsed.Value)} / {FormatCount(TokenBudget.Value)} tokens"
            : null;

        private static string FormatCount(long n) => n >= 1000 ? $"{n / 1000.0:0.#}k" : n.ToString();
    }
}
