namespace BuildConsole.Services
{
    /// <summary>
    /// Shared token-count formatting for usage/cost UI. Extracted from
    /// Controls/BuildQueuePanel.xaml.cs (Git #1864) so the title bar's usage readout
    /// (MainWindow.xaml) and the Build Queue panel read the same numbers the same way,
    /// rather than maintaining two copies of the same formatting logic.
    ///
    /// The million-scale case previously used "0.1" as its format string, which is NOT a
    /// one-decimal-place specifier — a digit character other than '0'/'#' after the
    /// decimal point is a LITERAL, not a placeholder, and with zero real fractional
    /// placeholders .NET also drops the decimal separator entirely. For 4,735,276,258
    /// tokens that rendered "47351M tokens" instead of the intended "4735.3M tokens" — a
    /// real, verifiable formatting bug, fixed here as part of the extraction (Git #1864's
    /// own verification requires the readout to actually match usage-totals.json).
    /// </summary>
    public static class UsageFormat
    {
        public static string FormatTokens(long tokens) =>
            tokens >= 1_000_000 ? $"{tokens / 1_000_000.0:0.0}M tokens" :
            tokens >= 1_000 ? $"{tokens / 1_000.0:0}k tokens" :
            $"{tokens} tokens";
    }
}
