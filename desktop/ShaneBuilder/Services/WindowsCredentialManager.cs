using System;
using System.Runtime.InteropServices;

namespace ShaneBuilder.Services;

/// <summary>Git #2204 — real Windows Credential Manager access via advapi32 P/Invoke
/// (<c>CredWriteW</c>/<c>CredReadW</c>/<c>CredDeleteW</c>). No NuGet package: CLAUDE.md's
/// bandwidth-is-a-real-constraint rule (Git #1987) applies to every new dependency, not just
/// pnpm, and these three exports are all this needs. Every secret <see cref="SettingsStoreService"/>
/// hands the Settings UI (API tokens, gated-profile passwords, secret-shaped env var values) is
/// written here as a real <c>CRED_TYPE_GENERIC</c> entry under this machine's own Windows
/// credential store — visible in Windows' own Credential Manager control panel, not a JSON file
/// in the repo or under source control.</summary>
public static class WindowsCredentialManager
{
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredWriteW([In] ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredReadW(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredDeleteW(string target, int type, int flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    private static string TargetName(string key) => "ShaneBuilder:" + key;

    /// <summary>Writes (or overwrites) a secret. Returns false on any real Win32 failure rather
    /// than throwing — callers report that honestly instead of crashing the Settings page.</summary>
    public static bool Write(string key, string value)
    {
        var bytes = System.Text.Encoding.Unicode.GetBytes(value ?? "");
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = TargetName(key),
                CredentialBlobSize = bytes.Length,
                CredentialBlob = blob,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                UserName = "ShaneBuilder",
                Comment = "ShaneBuilder Settings — " + key,
            };
            return CredWriteW(ref cred, 0);
        }
        finally
        {
            Marshal.FreeHGlobal(blob);
        }
    }

    /// <summary>Real read. Null means no credential is stored under this key yet (not an error) —
    /// callers fall back to an empty/unset value, never a fabricated one.</summary>
    public static string? Read(string key)
    {
        if (!CredReadW(TargetName(key), CRED_TYPE_GENERIC, 0, out var ptr))
            return null;
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return "";
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
            return System.Text.Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            CredFree(ptr);
        }
    }

    /// <summary>Deletes the credential. A missing credential is not an error — Windows' own
    /// "not found" failure is swallowed the same way a no-op clear would be.</summary>
    public static void Delete(string key)
    {
        CredDeleteW(TargetName(key), CRED_TYPE_GENERIC, 0);
    }
}
