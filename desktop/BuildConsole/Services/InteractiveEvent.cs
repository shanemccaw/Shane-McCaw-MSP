namespace BuildConsole.Services
{
    /// <summary>The kind of one renderable event parsed from a single --output-format stream-json line.</summary>
    public enum InteractiveEventKind
    {
        /// <summary>Assistant prose (a "text" content block) — or a raw stderr line. Rendered as a paragraph.</summary>
        AssistantText,
        /// <summary>A "tool_use" content block — the real tool name, its id, a one-line command preview, and the raw `input` JSON (for diff rendering).</summary>
        ToolCall,
        /// <summary>A "tool_result" block (carried on a later type:"user" event) — the real output text for a prior <see cref="ToolCall"/>, matched by <see cref="ResultForToolUseId"/>.</summary>
        ToolResult,
        /// <summary>The turn-ending "result" event — the "done" marker plus the final result text.</summary>
        TurnResult,
    }

    /// <summary>
    /// One structured, renderable event parsed from a single <c>--output-format stream-json</c>
    /// line (see <c>QueueWatcherService.ParseInteractiveEvents</c>). This is the full-fidelity
    /// replacement for the old flattened "[tool: X]" text line the Build Watch window used to
    /// reconstruct with a regex.
    ///
    /// The bug this fixes: <c>SummarizeStreamJsonLine</c> extracted ONLY a tool_use block's
    /// <c>name</c> (emitting "[tool: X]") and dropped its <c>input</c> entirely, and the whole
    /// tool_result event (a <c>type:"user"</c> line) fell through its <c>default</c> case as
    /// "noise" — so the tool-call bubbles could only ever show a bare tool name. The real
    /// stream-json events carry everything (confirmed by live capture): a tool_use block is
    /// <c>{id, name, input}</c> and a tool_result block is <c>{tool_use_id, content, is_error}</c>.
    /// This carries that real command/arguments (<see cref="CommandPreview"/> / <see cref="InputJson"/>)
    /// and real output (<see cref="Text"/> on a ToolResult) through to the Build Watch chip.
    ///
    /// The human-readable per-item log FILE (#802 BuildLogView + the foreign/legacy file-tail
    /// render path) is still fed the old <c>SummarizeStreamJsonLine</c> text in parallel and is
    /// unaffected; this structured stream is pulled only by the interactive Build Watch render.
    /// </summary>
    public sealed class InteractiveEvent
    {
        public InteractiveEventKind Kind { get; init; }

        // ── AssistantText / stderr, ToolResult output, TurnResult summary ──
        /// <summary>Assistant prose (AssistantText), the tool's real output (ToolResult), or the final result text (TurnResult).</summary>
        public string? Text { get; init; }

        /// <summary>For AssistantText: this was a stderr / obvious error line. For ToolResult: the tool reported an error (<c>is_error:true</c>). Lets the display tint it.</summary>
        public bool IsError { get; init; }

        // ── ToolCall ──
        public string? ToolName { get; init; }
        /// <summary>The tool_use id — the result correlates back to this call's chip via <see cref="ResultForToolUseId"/>.</summary>
        public string? ToolUseId { get; init; }
        /// <summary>One-line human summary of the call's key argument(s): the Bash command, the Read/Edit file_path, the Grep pattern, etc.</summary>
        public string? CommandPreview { get; init; }
        /// <summary>The tool call's raw <c>input</c> object JSON — the display parses this to render an Edit/Write/MultiEdit diff; null for non-tool-call events.</summary>
        public string? InputJson { get; init; }

        // ── ToolResult ──
        /// <summary>The tool_use id this result belongs to — the display matches it back to the ToolCall's chip to fill in its output.</summary>
        public string? ResultForToolUseId { get; init; }

        // ── TurnResult ──
        public int? DurationMs { get; init; }
    }
}
