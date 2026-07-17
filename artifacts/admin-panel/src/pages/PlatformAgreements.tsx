import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Upload, Eye, FileText, CheckCircle2, Clock } from "lucide-react";

interface Agreement {
  id: number;
  version: string;
  title: string;
  body: string;
  isCurrentVersion: boolean;
  publishedAt: string | null;
  createdAt: string;
}

async function fetchAgreements(fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<Agreement[]> {
  const res = await fetchWithAuth("/api/admin/platform-agreements");
  if (!res.ok) throw new Error("Failed to load agreements");
  const data = (await res.json()) as { agreements: Agreement[] };
  return data.agreements;
}

export default function PlatformAgreementsPage() {
  const { fetchWithAuth } = useAuth();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [preview, setPreview] = useState<Agreement | null>(null);

  const [newVersion, setNewVersion] = useState("");
  const [newTitle, setNewTitle] = useState("Platform MSA + DPA");
  const [newBody, setNewBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAgreements(await fetchAgreements(fetchWithAuth));
    } catch {
      setError("Failed to load agreements. Make sure you are logged in as an admin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!newVersion.trim() || !newBody.trim()) {
      setSaveError("Version and body are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetchWithAuth("/api/admin/platform-agreements", {
        method: "POST",
        body: JSON.stringify({ version: newVersion.trim(), title: newTitle.trim(), body: newBody.trim() }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setSaveError(d.error ?? "Failed to save");
        return;
      }
      setShowNew(false);
      setNewVersion("");
      setNewTitle("Platform MSA + DPA");
      setNewBody("");
      await load();
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(id: number) {
    setPublishing(id);
    try {
      const res = await fetchWithAuth(`/api/admin/platform-agreements/${id}/publish`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        alert(d.error ?? "Failed to publish");
        return;
      }
      await load();
    } finally {
      setPublishing(null);
    }
  }

  const current = agreements.find((a) => a.isCurrentVersion);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[#E6EDF3] text-lg font-semibold flex items-center gap-2">
            <FileText className="size-5 text-[#0078D4]" />
            Platform Agreements
          </h2>
          <p className="text-[#7D8590] text-sm mt-0.5">
            Manage versioned MSA + DPA clickwrap agreements shown to MSPs at signup.
            Publishing a new version does not affect prior accepted records.
          </p>
        </div>
        <Button
          onClick={() => setShowNew(true)}
          size="sm"
          className="bg-[#0078D4] hover:bg-[#106EBE] text-white shrink-0"
        >
          <Plus className="size-4 mr-1.5" />
          New Version
        </Button>
      </div>

      {/* Current version callout */}
      {current && (
        <div className="rounded-lg border border-green-800/40 bg-green-900/10 p-4 flex items-start gap-3">
          <CheckCircle2 className="size-4 text-green-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="text-green-300 font-medium">Active version: {current.version}</span>
            <span className="text-[#7D8590] ml-2">
              Published {current.publishedAt ? new Date(current.publishedAt).toLocaleDateString() : "—"}
            </span>
          </div>
        </div>
      )}

      {!current && !loading && (
        <div className="rounded-lg border border-yellow-800/40 bg-yellow-900/10 p-4 flex items-start gap-3">
          <Clock className="size-4 text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-sm text-yellow-300">
            No agreement is currently published. MSPs will not be gated at login until you publish a version.
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <div className="rounded-lg border border-[#30363D] bg-[#161B22] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#30363D] hover:bg-transparent">
              <TableHead className="text-[#7D8590]">Version</TableHead>
              <TableHead className="text-[#7D8590]">Title</TableHead>
              <TableHead className="text-[#7D8590]">Status</TableHead>
              <TableHead className="text-[#7D8590]">Created</TableHead>
              <TableHead className="text-[#7D8590] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-[#7D8590] py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : agreements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-[#7D8590] py-8">
                  No agreement versions yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              agreements.map((a) => (
                <TableRow key={a.id} className="border-[#30363D] hover:bg-[#1C2128]">
                  <TableCell className="text-[#E6EDF3] font-mono text-sm">{a.version}</TableCell>
                  <TableCell className="text-[#E6EDF3]">{a.title}</TableCell>
                  <TableCell>
                    {a.isCurrentVersion ? (
                      <Badge className="bg-green-900/30 text-green-400 border-green-800/50">
                        Current
                      </Badge>
                    ) : a.publishedAt ? (
                      <Badge variant="outline" className="text-[#7D8590] border-[#30363D]">
                        Superseded
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-yellow-500 border-yellow-800/50">
                        Draft
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-[#7D8590] text-sm">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#7D8590] hover:text-[#E6EDF3]"
                      onClick={() => setPreview(a)}
                    >
                      <Eye className="size-4 mr-1" />
                      Preview
                    </Button>
                    {!a.isCurrentVersion && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-[#0078D4] text-[#0078D4] hover:bg-[#0078D4]/10"
                        onClick={() => handlePublish(a.id)}
                        disabled={publishing === a.id}
                      >
                        <Upload className="size-4 mr-1" />
                        {publishing === a.id ? "Publishing…" : "Publish"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* New version dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-2xl bg-[#161B22] border-[#30363D] text-[#E6EDF3]">
          <DialogHeader>
            <DialogTitle>New Agreement Version</DialogTitle>
            <DialogDescription className="text-[#7D8590]">
              Paste the agreement text below. The new version starts as a draft — publish it to
              activate the clickwrap gate for new MSP logins.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[#7D8590] text-xs">Version *</Label>
                <Input
                  placeholder="e.g. v1.0, 2026-07"
                  value={newVersion}
                  onChange={(e) => setNewVersion(e.target.value)}
                  className="bg-[#0D1117] border-[#30363D] text-[#E6EDF3]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[#7D8590] text-xs">Title</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="bg-[#0D1117] border-[#30363D] text-[#E6EDF3]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#7D8590] text-xs">Agreement Body *</Label>
              <Textarea
                placeholder="Paste the full agreement text here (plain text or Markdown)…"
                rows={12}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                className="bg-[#0D1117] border-[#30363D] text-[#E6EDF3] font-mono text-sm resize-y"
              />
            </div>

            {saveError && (
              <Alert variant="destructive">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)} className="border-[#30363D]">
              Cancel
            </Button>
            <Button
              className="bg-[#0078D4] hover:bg-[#106EBE] text-white"
              onClick={handleCreate}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save Draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      {preview && (
        <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
          <DialogContent className="max-w-2xl bg-[#161B22] border-[#30363D] text-[#E6EDF3]">
            <DialogHeader>
              <DialogTitle>{preview.title} — v{preview.version}</DialogTitle>
              <DialogDescription className="text-[#7D8590]">
                Read-only preview of the agreement body
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto rounded-md border border-[#30363D] bg-[#0D1117] p-4">
              <pre className="text-sm text-[#E6EDF3] whitespace-pre-wrap font-sans leading-relaxed">
                {preview.body}
              </pre>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)} className="border-[#30363D]">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
