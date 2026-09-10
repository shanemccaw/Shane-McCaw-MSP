using System;
using System.Runtime.InteropServices;

namespace MyArchitect.Services;

/// <summary>
/// Thin wrapper over the Windows Data Protection API (DPAPI) via P/Invoke to <c>crypt32.dll</c>
/// (<c>CryptProtectData</c>/<c>CryptUnprotectData</c>). Used to encrypt the Credential Vault file
/// (#3461) at rest, bound to the current Windows user account
/// (<see cref="CRYPTPROTECT_UI_FORBIDDEN"/>, CurrentUser scope) — the file cannot be decrypted on
/// another machine or by another Windows user.
///
/// P/Invoke rather than the <c>System.Security.Cryptography.ProtectedData</c> NuGet package
/// deliberately: it needs zero added dependency (no restore/download — Git #1987 bandwidth
/// constraint) and is fully in-box on Windows.
/// </summary>
internal static class DpapiProtector
{
    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    // CRYPTPROTECT_UI_FORBIDDEN — never show a UI prompt (headless-safe).
    private const int CRYPTPROTECT_UI_FORBIDDEN = 0x1;

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DATA_BLOB pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        ref DATA_BLOB pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        ref DATA_BLOB pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    /// <summary>DPAPI-encrypts <paramref name="plaintext"/> for the current Windows user.</summary>
    public static byte[] Protect(byte[] plaintext)
    {
        var inBlob = new DATA_BLOB();
        var outBlob = new DATA_BLOB();
        var handle = GCHandle.Alloc(plaintext, GCHandleType.Pinned);
        try
        {
            inBlob.cbData = plaintext.Length;
            inBlob.pbData = handle.AddrOfPinnedObject();

            if (!CryptProtectData(ref inBlob, "MyArchitect Credential Vault", IntPtr.Zero,
                    IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob))
            {
                throw new InvalidOperationException(
                    $"DPAPI CryptProtectData failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            return CopyAndFree(ref outBlob);
        }
        finally
        {
            handle.Free();
        }
    }

    /// <summary>DPAPI-decrypts data produced by <see cref="Protect"/> for the current Windows
    /// user. Throws if the current user/machine is not the one that encrypted it.</summary>
    public static byte[] Unprotect(byte[] ciphertext)
    {
        var inBlob = new DATA_BLOB();
        var outBlob = new DATA_BLOB();
        var handle = GCHandle.Alloc(ciphertext, GCHandleType.Pinned);
        try
        {
            inBlob.cbData = ciphertext.Length;
            inBlob.pbData = handle.AddrOfPinnedObject();

            if (!CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero,
                    IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob))
            {
                throw new InvalidOperationException(
                    $"DPAPI CryptUnprotectData failed (Win32 {Marshal.GetLastWin32Error()}).");
            }

            return CopyAndFree(ref outBlob);
        }
        finally
        {
            handle.Free();
        }
    }

    private static byte[] CopyAndFree(ref DATA_BLOB blob)
    {
        try
        {
            var managed = new byte[blob.cbData];
            Marshal.Copy(blob.pbData, managed, 0, blob.cbData);
            return managed;
        }
        finally
        {
            if (blob.pbData != IntPtr.Zero)
            {
                LocalFree(blob.pbData);
            }
        }
    }
}
