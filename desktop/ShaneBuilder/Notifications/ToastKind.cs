namespace ShaneBuilder
{
    /// <summary>
    /// Semantic flavour of a toast — drives the accent colour, icon glyph and default
    /// dwell time chosen by <see cref="ToastEngine"/> / <see cref="ToastCard"/>.
    /// </summary>
    public enum ToastKind
    {
        /// <summary>Neutral information (blue).</summary>
        Info,
        /// <summary>Something succeeded (green).</summary>
        Success,
        /// <summary>A precondition wasn't met / heads-up (amber).</summary>
        Warning,
        /// <summary>An operation genuinely failed (red).</summary>
        Error,
    }
}
