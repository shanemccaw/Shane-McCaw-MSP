import { useState } from "react";
import { usePushSubscription } from "@/lib/usePushSubscription";

/**
 * Git #858 — Shane: "Paste it into my admin playground page that I can
 * access from my phone. It adds it to the queue." Parses the same
 * build-prompt block format used everywhere else in this project (see
 * ChatButtonInjector.cs's queueBuild()):
 *
 *   --model <model> --effort <effort> --title <issueNumber> [--blocked-by <N,N,...>]
 *
 *   <rest of the prompt body>
 *
 * and POSTs straight to the real queue endpoint
 * (POST /admin/build-tracker/extension/queue) that BuildConsole's own
 * QueueBuildAsync/QueueWatcherService.cs already polls.
 */
function parseBuildPromptBlock(raw: string): {
  model: string | null;
  effort: string | null;
  githubNumber: number | null;
  blockedByNumbers: number[] | null;
  body: string;
} | { error: string } {
  const text = raw.replace(/\r\n/g, "\n");
  const newlineIdx = text.indexOf("\n");
  const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);

  const flagRe = /--([\w-]+)\s+(\S+)/g;
  const flags: Record<string, string> = {};
  let matched: RegExpExecArray | null;
  while ((matched = flagRe.exec(firstLine)) !== null) flags[matched[1]] = matched[2];

  if (Object.keys(flags).length === 0 || firstLine.replace(/--([\w-]+)\s+(\S+)/g, "").trim() !== "") {
    return { error: "First line must be flags only, e.g. --model sonnet --effort high --title 858" };
  }
  if (!flags.title || !/^\d+$/.test(flags.title)) {
    return { error: "--title must be a plain GitHub issue number, e.g. --title 858" };
  }

  const bodyStart = newlineIdx === -1 ? "" : text.slice(newlineIdx + 1);
  const body = bodyStart.replace(/^\n+/, "").trim();
  if (!body) return { error: "Nothing found after the blank line — paste the prompt body too." };

  let blockedByNumbers: number[] | null = null;
  if (flags["blocked-by"]) {
    const parts = flags["blocked-by"].split(",").map((s) => s.trim()).filter(Boolean);
    const nums = parts.filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));
    if (nums.length !== parts.length) {
      return { error: `--blocked-by "${flags["blocked-by"]}" has a non-numeric entry — comma-separate issue numbers only.` };
    }
    blockedByNumbers = nums;
  }

  return {
    model: flags.model || null,
    effort: flags.effort || null,
    githubNumber: parseInt(flags.title, 10),
    blockedByNumbers,
    body,
  };
}

function QueueBuildSection() {
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<{ tone: "idle" | "success" | "error"; message: string }>({
    tone: "idle",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleQueue() {
    const parsed = parseBuildPromptBlock(raw);
    if ("error" in parsed) {
      setStatus({ tone: "error", message: parsed.error });
      return;
    }
    setSubmitting(true);
    setStatus({ tone: "idle", message: "" });
    try {
      const res = await fetch("/api/admin/build-tracker/extension/queue", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Git #${parsed.githubNumber}`,
          prompt: parsed.body,
          model: parsed.model,
          effort: parsed.effort,
          githubNumber: parsed.githubNumber,
          ...(parsed.blockedByNumbers ? { blockedByNumbers: parsed.blockedByNumbers } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus({ tone: "error", message: body?.error || `Failed to queue (HTTP ${res.status})` });
        return;
      }
      setStatus({ tone: "success", message: `Queued Git #${parsed.githubNumber}.` });
      setRaw("");
    } catch (err) {
      setStatus({ tone: "error", message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      <h2 className="text-white text-base font-semibold">Queue Build</h2>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"--model sonnet --effort high --title 858\n\nDo the thing..."}
        rows={10}
        className="w-full rounded-lg border border-white/20 bg-white/5 text-white text-sm p-3 font-mono leading-relaxed resize-y focus:outline-none focus:border-white/50"
      />
      <button
        onClick={() => void handleQueue()}
        disabled={submitting || !raw.trim()}
        className="w-full text-white text-base font-medium border border-white/30 rounded-lg px-6 py-3 hover:bg-white/10 transition-colors disabled:opacity-50"
      >
        {submitting ? "Queuing…" : "Queue Build"}
      </button>
      {status.tone !== "idle" && (
        <div
          role="status"
          className={`text-sm rounded-lg px-3 py-2 border ${
            status.tone === "success"
              ? "text-green-300 border-green-500/40 bg-green-500/10"
              : "text-red-300 border-red-500/40 bg-red-500/10"
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}

export default function ShanePlayground() {
  const { state, busy, handleEnable, handleDisable } = usePushSubscription();

  const label =
    state === "loading" ? "Loading…" :
    state === "unsupported" ? "Notifications unsupported" :
    state === "denied" ? "Notifications blocked" :
    state === "subscribed" ? "Disable Notifications" :
    "Allow Notifications";

  const disabled = busy || state === "loading" || state === "unsupported" || state === "denied";

  return (
    <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center gap-8 p-4">
      <button
        onClick={() => void (state === "subscribed" ? handleDisable() : handleEnable())}
        disabled={disabled}
        className="text-white text-lg font-medium border border-white/30 rounded-lg px-6 py-3 hover:bg-white/10 transition-colors disabled:opacity-50"
      >
        {label}
      </button>
      <QueueBuildSection />
    </div>
  );
}
