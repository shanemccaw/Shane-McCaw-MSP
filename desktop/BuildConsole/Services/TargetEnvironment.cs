namespace BuildConsole.Services
{
    /// <summary>
    /// Three-tier environment target system:
    /// Dev (Local) → Staging (Replit deployment) → Production (Live domain).
    /// Agent/protocol executions (shaneapp://) are hard-locked to Dev.
    /// Staging and Production are only reachable via explicit manual UI actions by Shane.
    /// </summary>
    public enum TargetEnvironment
    {
        Dev,
        Staging,
        Production
    }
}
