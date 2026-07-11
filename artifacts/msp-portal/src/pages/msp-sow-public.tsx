/**
 * Public MSP SOW viewer and signer.
 * Accessible via share token — no authentication required.
 * Route: /sow/:shareToken
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  XCircle,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicSow {
  sowId: string;
  title: string;
  description: string | null;
  amountCents: number;
  currency: string;
  status: "draft" | "sent" | "signed" | "paid" | "failed" | "expired";
  documentHtml: string | null;
  expiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  customerAgreementText?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ── Signature Canvas ──────────────────────────────────────────────────────────

interface SignatureCanvasProps {
  onSign: (signatureData: string, signerName: string) => Promise<void>;
  signing: boolean;
  alreadySigned: boolean;
  signerName?: string | null;
}

function SignatureCanvas({ onSign, signing, alreadySigned, signerName: existingName }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [name, setName] = useState(existingName ?? "");
  const [error, setError] = useState<string | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const { width } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width)) {
        canvas.width = Math.round(width);
        canvas.height = 130;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        setIsEmpty(true);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  function getPos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return null;
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDrawing(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0A2540";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPoint.current = pos;
    setIsDrawing(true);
    setIsEmpty(false);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!isDrawing) return;
    const pos = getPos(e);
    if (!pos) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !lastPoint.current) return;
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPoint.current = pos;
  }

  function stopDrawing() {
    setIsDrawing(false);
    lastPoint.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  }

  async function handleSign() {
    if (!name.trim()) { setError("Please enter your full legal name before signing."); return; }
    if (isEmpty) { setError("Please draw your signature before proceeding."); return; }
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    await onSign(canvas.toDataURL("image/png"), name.trim());
  }

  if (alreadySigned) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
        <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-green-400">Agreement Signed</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {existingName ? `Signed by ${existingName}.` : "This agreement has been signed."}{" "}
            Your service provider will be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest text-foreground mb-1.5">
          Full Legal Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full legal name"
          className="w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-foreground">
            Signature <span className="text-red-500">*</span>
          </label>
          <button className="text-xs text-muted-foreground hover:text-primary transition-colors" onClick={clearCanvas}>
            Clear
          </button>
        </div>
        <div
          ref={containerRef}
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/20 hover:border-primary/40 transition-colors touch-none select-none"
        >
          <canvas
            ref={canvasRef}
            className="block rounded-lg cursor-crosshair"
            style={{ height: "130px", width: "100%" }}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
        {isEmpty && <p className="text-xs text-muted-foreground mt-1">Draw your signature in the box above</p>}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}

      <Button className="w-full gap-2" onClick={() => void handleSign()} disabled={signing}>
        {signing ? (
          <><Loader2 className="size-4 animate-spin" /> Signing…</>
        ) : (
          <><FileSignature className="size-4" /> Sign Agreement</>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        By signing, you agree to the terms displayed above. This electronic signature carries the
        same legal weight as a handwritten signature.
      </p>
    </div>
  );
}

// ── SOW Document viewer ────────────────────────────────────────────────────────

function SowDocumentViewer({ html }: { html: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 space-y-0">
          <CardTitle className="text-sm">Statement of Work</CardTitle>
          <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setFullscreen(true)}>
            <ZoomIn className="size-3" /> Full screen
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0 overflow-hidden rounded-b-xl">
          <iframe
            srcDoc={html}
            title="Statement of Work"
            className="w-full border-0 rounded-b-xl"
            style={{ height: "420px" }}
            sandbox="allow-same-origin"
          />
        </CardContent>
      </Card>

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 bg-background border-b border-border shrink-0">
            <p className="text-sm font-semibold">Statement of Work</p>
            <Button variant="ghost" size="sm" onClick={() => setFullscreen(false)}>Close</Button>
          </div>
          <iframe srcDoc={html} title="Statement of Work" className="flex-1 border-0 bg-white" sandbox="allow-same-origin" />
        </div>
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MspSowPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();

  const [sow, setSow] = useState<PublicSow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const fetchSow = useCallback(async () => {
    if (!shareToken) return;
    const res = await fetch(`/api/public/sows/${encodeURIComponent(shareToken)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "Agreement not found.");
      return;
    }
    setSow((await res.json()) as PublicSow);
  }, [shareToken]);

  useEffect(() => {
    fetchSow().finally(() => setLoading(false));
  }, [fetchSow]);

  const handleSign = useCallback(
    async (signatureData: string, signerName: string) => {
      if (!shareToken) return;
      setSigning(true);
      try {
        const res = await fetch(`/api/public/sows/${encodeURIComponent(shareToken)}/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData, signerName }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error((data as { error?: string }).error ?? "Failed to sign. Please try again.");
          return;
        }
        toast.success("Agreement signed! Your service provider will be notified.");
        await fetchSow();
      } catch {
        toast.error("Something went wrong. Please try again.");
      } finally {
        setSigning(false);
      }
    },
    [fetchSow, shareToken],
  );

  const alreadySigned = sow?.status === "signed" || sow?.status === "paid";
  const isExpired = sow?.status === "expired";
  const isFailed = sow?.status === "failed";

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header */}
      <div className="border-b border-border bg-[#0A2540]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="size-7 rounded bg-[#0078D4] flex items-center justify-center shrink-0">
            <FileSignature className="size-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Managed Services Agreement</span>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {loading ? (
          <div className="space-y-4 pt-4">
            <Skeleton className="h-8 w-48 rounded-lg" />
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
        ) : error ? (
          <div className="pt-12 flex flex-col items-center justify-center text-center gap-3">
            <XCircle className="size-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground/60">
              This link may have expired or is no longer valid. Contact your service provider for a
              new link.
            </p>
          </div>
        ) : !sow ? null : (
          <>
            {/* Title */}
            <div className="pt-4">
              <h1 className="text-2xl font-bold tracking-tight">{sow.title}</h1>
              {sow.description && (
                <p className="text-muted-foreground text-sm mt-1">{sow.description}</p>
              )}
            </div>

            {/* Status + amount */}
            <div className="flex items-center gap-3 flex-wrap">
              {alreadySigned && (
                <Badge className="bg-green-500/10 border-green-500/30 text-green-400 text-xs px-2.5 py-1 h-auto border">
                  {sow.status === "paid" ? "Paid & Confirmed" : "Signed"}
                </Badge>
              )}
              {isExpired && (
                <Badge className="bg-muted text-muted-foreground/60 border-border text-xs px-2.5 py-1 h-auto border">
                  Expired
                </Badge>
              )}
              {sow.amountCents > 0 && (
                <Badge className="bg-muted text-muted-foreground border-border text-xs px-2 py-1 h-auto border">
                  {formatCurrency(sow.amountCents, sow.currency)}
                </Badge>
              )}
              {sow.expiresAt && !alreadySigned && !isExpired && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" /> Expires {relativeDate(sow.expiresAt)}
                </span>
              )}
            </div>

            {isExpired && (
              <div className="flex items-start gap-3 bg-muted/30 border border-border rounded-xl p-4">
                <XCircle className="size-5 text-muted-foreground/60 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">This agreement has expired</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Please contact your service provider to request a new agreement.
                  </p>
                </div>
              </div>
            )}

            {/* SOW document */}
            {sow.documentHtml && <SowDocumentViewer html={sow.documentHtml} />}

            {/* Customer agreement */}
            {sow.customerAgreementText && !alreadySigned && !isExpired && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Customer Agreement</CardTitle>
                  <CardDescription className="text-xs">
                    Please read the following before signing.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/20 border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">
                      {sow.customerAgreementText}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Signature section */}
            {!isExpired && !isFailed && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileSignature className="size-4 text-primary" />
                    {alreadySigned ? "Signature Recorded" : "Sign the Agreement"}
                  </CardTitle>
                  {!alreadySigned && (
                    <CardDescription className="text-xs">
                      By signing you confirm you have read and agree to the terms above.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <SignatureCanvas
                    onSign={handleSign}
                    signing={signing}
                    alreadySigned={alreadySigned}
                    signerName={sow.signerName}
                  />
                </CardContent>
              </Card>
            )}

            {sow.status === "paid" && (
              <Card className="border border-primary/30 bg-primary/5">
                <CardContent className="flex items-start gap-3 py-4 px-5">
                  <CheckCircle2 className="size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary">Agreement Confirmed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Payment has been received and your project is now active. Your service
                      provider will be in touch shortly with next steps.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
