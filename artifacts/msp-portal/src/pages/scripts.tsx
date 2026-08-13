/**
 * Script Library page — MSP Portal.
 * Lists platform-published PowerShell scripts available for download.
 * Each script download generates a single-use token injected into the
 * script body so results can be auto-submitted to the ingestion endpoint.
 */

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, Code2, Search, Clock, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

interface LibraryScript {
  id: string;
  title: string;
  description: string | null;
  category: string;
  scriptType: string | null;
  schemaVersion: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface DownloadResult {
  tokenId: number;
  scriptTitle: string;
  scriptType: string;
  schemaVersion: string;
  expiresAt: string;
  scriptBody: string;
}

function ScriptCard({ script }: { script: LibraryScript }) {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<DownloadResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetchWithAuth(`/api/portal/scripts/${script.id}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        toast.error(err.error ?? "Download failed");
        return;
      }
      const data = (await res.json()) as DownloadResult;
      setDownloadResult(data);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy() {
    if (!downloadResult) return;
    await navigator.clipboard.writeText(downloadResult.scriptBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Script copied to clipboard");
  }

  function handleSaveFile() {
    if (!downloadResult) return;
    const blob = new Blob([downloadResult.scriptBody], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${script.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ps1`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Script downloaded");
  }

  return (
    <>
      <Card className="flex flex-col gap-0 border-border bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight">{script.title}</CardTitle>
            <Badge variant="secondary" className="shrink-0 capitalize text-xs">
              {script.category}
            </Badge>
          </div>
          {script.description && (
            <CardDescription className="text-sm line-clamp-2">{script.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="pb-2 flex-1">
          {script.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {script.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs py-0 px-1.5 h-5">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
            {script.scriptType && <div>Type: <span className="text-foreground/80">{script.scriptType}</span></div>}
            {script.schemaVersion && <div>Schema: <span className="text-foreground/80">v{script.schemaVersion}</span></div>}
          </div>
        </CardContent>
        <CardFooter className="pt-2">
          <Button
            size="sm"
            className="w-full gap-2"
            onClick={handleDownload}
            disabled={downloading}
          >
            <Download className="size-3.5" />
            {downloading ? "Generating…" : "Download Script"}
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={!!downloadResult} onOpenChange={(open) => { if (!open) setDownloadResult(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="size-4 text-primary" />
              {downloadResult?.scriptTitle}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 text-xs">
              <Clock className="size-3" />
              Token expires: {downloadResult ? new Date(downloadResult.expiresAt).toLocaleString() : ""}
              <span className="text-muted-foreground">· Single-use · Results auto-submitted on run</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 border border-border">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <span className="text-xs font-mono text-muted-foreground">PowerShell</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2" onClick={handleCopy}>
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1 px-2" onClick={() => setExpanded((e) => !e)}>
                    {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    {expanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
              </div>
              <pre className={`p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all ${expanded ? "" : "max-h-48 overflow-y-auto"}`}>
                {downloadResult?.scriptBody}
              </pre>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDownloadResult(null)}>
                Close
              </Button>
              <Button size="sm" className="gap-2" onClick={handleSaveFile}>
                <Download className="size-3.5" />
                Save as .ps1
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Run this script on the target tenant. It will automatically submit results to the platform when complete.
              The embedded token is single-use and expires in 72 hours.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ScriptLibraryPage() {
  const { fetchWithAuth } = useAuth();
  const [search, setSearch] = useState("");

  const { data: scripts, isLoading } = useQuery<LibraryScript[]>({
    queryKey: ["portal-scripts"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/scripts");
      if (!res.ok) throw new Error("Failed to fetch scripts");
      return res.json();
    },
  });

  const filtered = (scripts ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Script Library</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Platform-authored PowerShell scripts. Download a script to run on a customer tenant — results are automatically ingested.
            </p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search scripts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {search ? "No scripts match your search." : "No scripts are published yet."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((script) => (
              <ScriptCard key={script.id} script={script} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
