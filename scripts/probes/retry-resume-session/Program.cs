using BuildConsole.Services;

// Git #3728 — real-data verification for the Retry fix.
//
// Reads a TSV of every real bt_build_queue row (id, title, resume_session_id, status) and
// replays each one through the REAL ResumeOnlyQueueRows classifier that BuildConsole itself
// uses, reporting what Retry would do before vs after the fix.
//
//   BEFORE: resumeSessionId was ALWAYS null, for every row, unconditionally.
//   AFTER : null for an ordinary row (start over, unchanged); the row's own session for a
//           resume-only row; refused outright when a resume-only row has no session left.

string path = args.Length > 0 ? args[0] : "rows.tsv";
if (!File.Exists(path))
{
    Console.Error.WriteLine($"no such file: {path}");
    return 2;
}

int total = 0, ordinary = 0, carried = 0, refused = 0;
var carriedRows = new List<string>();
var refusedRows = new List<string>();
var reclassified = new List<string>();

foreach (string line in File.ReadLines(path))
{
    if (line.Length == 0) continue;
    string[] f = line.Split('\t');
    if (f.Length < 4) continue;

    string id = f[0];
    string title = f[1];
    string resumeSessionId = f[2];
    string status = f[3];
    total++;

    bool resumeOnly = ResumeOnlyQueueRows.IsResumeOnlyTitle(title);

    if (!resumeOnly)
    {
        // Unchanged by this fix: still a genuine start-over from a self-contained prompt.
        ordinary++;
        continue;
    }

    if (string.IsNullOrWhiteSpace(resumeSessionId))
    {
        refused++;
        refusedRows.Add($"  #{id} [{status}] {Truncate(title, 58)}");
    }
    else
    {
        carried++;
        carriedRows.Add($"  #{id} [{status}] {Truncate(title, 58)} -> {resumeSessionId[..8]}…");
    }
    reclassified.Add(id);
}

Console.WriteLine($"rows replayed                                  {total}");
Console.WriteLine($"  ordinary  -> null (start over, UNCHANGED)    {ordinary}");
Console.WriteLine($"  resume-only, has session -> carried forward  {carried}");
Console.WriteLine($"  resume-only, no session  -> Retry REFUSED    {refused}");
Console.WriteLine();
Console.WriteLine($"behaviour changes for {reclassified.Count} of {total} rows "
                  + $"({100.0 * reclassified.Count / Math.Max(total, 1):F1}%); the other {ordinary} are untouched.");

if (refusedRows.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine("Rows the OLD Retry would have relaunched cold with a fragment as their whole prompt:");
    foreach (string r in refusedRows) Console.WriteLine(r);
}

if (carriedRows.Count > 0)
{
    Console.WriteLine();
    Console.WriteLine($"Rows that now re-deliver to their own session (showing up to 5 of {carriedRows.Count}):");
    foreach (string r in carriedRows.Take(5)) Console.WriteLine(r);
}

return 0;

static string Truncate(string s, int n) => s.Length <= n ? s : s[..n] + "…";
