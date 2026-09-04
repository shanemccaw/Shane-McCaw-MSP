namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #2783 — the generic rail-header "Send to Chat" contract. Any control hosted in the
    /// Chat Document Container's tool rail (<c>ChatDocumentContainer.ToolHost</c>) implements this
    /// to opt into a rail-header "Send to Chat" icon with zero per-tool rail-header wiring: the
    /// container checks <c>ToolHost.Content is IChatSendableTool</c> and calls
    /// <see cref="GetSendableContent"/> — nothing in the rail header itself needs to know which
    /// tool is currently hosted. First real implementer: <see cref="TerminalView"/>.
    /// </summary>
    public interface IChatSendableTool
    {
        /// <summary>The tool's current real output/selection to send into the active Claude chat's
        /// composer, or <c>null</c>/empty when there's genuinely nothing to send right now. Called
        /// fresh every time the rail header needs to know whether to show/enable the Send-to-Chat
        /// icon, and again immediately before the actual send — never cached.</summary>
        string? GetSendableContent();
    }
}
