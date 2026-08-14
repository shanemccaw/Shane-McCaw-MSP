using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #864 follow-up — resolves a real favicon for a Web Tools popout entry (LinkedIn,
    /// Git, and anything Shane adds himself) instead of the generic Segoe MDL2 glyph. Fetches
    /// once per domain via Google's public favicon-resolution service (handles a site's real
    /// declared &lt;link rel="icon"&gt; without us having to parse HTML), caches the bytes to
    /// disk under %AppData%\BuildConsole\favicon-cache\, and re-serves the cached file on every
    /// later call — callers fall back to the existing glyph icon whenever this returns null.
    /// </summary>
    public static class FaviconCacheService
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };

        private static string CacheDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "favicon-cache");

        /// <summary>
        /// Returns a local file path to the cached favicon for <paramref name="toolUrl"/>'s
        /// domain, downloading and caching it first if this is the first time this domain has
        /// been seen. Returns null (never throws) if the URL can't be parsed or nothing could
        /// be fetched — callers should fall back to the generic glyph icon in that case.
        /// </summary>
        public static async Task<string?> GetIconPathAsync(string toolUrl)
        {
            if (string.IsNullOrWhiteSpace(toolUrl)) return null;

            string domain;
            try
            {
                var uri = new Uri(toolUrl, UriKind.Absolute);
                domain = uri.Host;
            }
            catch (UriFormatException)
            {
                return null;
            }

            if (string.IsNullOrWhiteSpace(domain)) return null;

            Directory.CreateDirectory(CacheDir);
            var cachePath = Path.Combine(CacheDir, SanitizeFileName(domain) + ".png");

            if (File.Exists(cachePath) && new FileInfo(cachePath).Length > 0)
                return cachePath;

            var fetched = await TryFetch($"https://www.google.com/s2/favicons?domain={domain}&sz=64");
            if (fetched == null)
                fetched = await TryFetch($"https://{domain}/favicon.ico");

            if (fetched == null || fetched.Length == 0)
                return null;

            try
            {
                await File.WriteAllBytesAsync(cachePath, fetched);
                return cachePath;
            }
            catch (IOException)
            {
                return null;
            }
        }

        private static async Task<byte[]?> TryFetch(string url)
        {
            try
            {
                using var response = await Http.GetAsync(url);
                if (!response.IsSuccessStatusCode) return null;
                var bytes = await response.Content.ReadAsByteArrayAsync();
                return bytes.Length > 0 ? bytes : null;
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                return null;
            }
        }

        private static string SanitizeFileName(string domain)
        {
            foreach (var c in Path.GetInvalidFileNameChars())
                domain = domain.Replace(c, '_');
            return domain;
        }
    }
}
