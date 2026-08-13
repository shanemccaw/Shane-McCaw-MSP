import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
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
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  XCircle,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MspSow {
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
  customerAgreementSnapshotText?: string | null;
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
            {existingName ? `Signed by ${existingName}.` : "You have signed this agreement."}{" "}
            The project will begin once payment is confirmed.
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
          <><Loader2 className="size-4 animate-spin" /> Signing agreement…</>
        ) : (
          <><FileSignature className="size-4" /> Sign & Authorise Payment</>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        By signing, you authorise the scope of work and associated fees. Your MSP's card on file
        will be charged once this signature is recorded.
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

// ── Status badge ──────────────────────────────────────────────────────────────

function SowStatusBadge({ status }: { status: MspSow["status"] }) {
  const map: Record<MspSow["status"], { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
    sent: { label: "Pending Signature", className: "bg-amber-500/10 border-amber-500/30 text-amber-400" },
    signed: { label: "Signed — Awaiting Payment", className: "bg-green-500/10 border-green-500/30 text-green-400" },
    paid: { label: "Paid & Confirmed", className: "bg-primary/10 border-primary/30 text-primary" },
    failed: { label: "Payment Failed", className: "bg-red-500/10 border-red-500/30 text-red-400" },
    expired: { label: "Expired", className: "bg-muted text-muted-foreground/60 border-border" },
  };
  const { label, className } = map[status] ?? map.draft;
  return (
    <Badge className={`text-xs px-2.5 py-1 h-auto border ${className}`}>{label}</Badge>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function MspCustomerSowPage() {
  const { sowId } = useParams<{ sowId: string }>();
  const { fetchWithAuth } = useAuth();

  const [sow, setSow] = useState<MspSow | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);

  const fetchSow = useCallback(async () => {
    if (!sowId) return;
    const res = await fetchWithAuth(`/api/msp/sows/${sowId}`);
    if (!res.ok) return;
    const data = (await res.json()) as MspSow;
    setSow(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sowId]);

  useEffect(() => {
    fetchSow().finally(() => setLoading(false));
  }, [fetchSow]);

  const handleSign = useCallback(
    async (signatureData: string, signerName: string) => {
      if (!sowId) return;
      setSigning(true);
      try {
        const res = await fetchWithAuth(`/api/msp/sows/${sowId}/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData, signerName }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error((data as { error?: string }).error ?? "Failed to sign. Please try again.");
          return;
        }
        toast.success("Agreement signed! Payment is being processed.");
        await fetchSow();
      } catch {
        toast.error("Something went wrong. Please try again.");
      } finally {
        setSigning(false);
      }
    },
    [fetchSow, fetchWithAuth, sowId],
  );

  const alreadySigned = sow?.status === "signed" || sow?.status === "paid";
  const isFailed = sow?.status === "failed";
  const isExpired = sow?.status === "expired";

  return (
    <AppShell title="Project Agreement">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Back nav */}
        <div>
          <Link href="/customer-home">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground -ml-1 mb-4">
              <ArrowLeft className="size-4" /> Back to Home
            </Button>
          </Link>
          <h2 className="text-xl font-bold tracking-tight">Project Statement of Work</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Review the scope and terms, then sign to authorise the project and initiate payment.
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
        ) : !sow ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <FileSignature className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Agreement not found</p>
              <p className="text-xs text-muted-foreground/60">This agreement may no longer be accessible.</p>
              <Link href="/customer-home">
                <Button variant="outline" size="sm" className="mt-2">Back to Home</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Status + amount */}
            <div className="flex items-center gap-3 flex-wrap">
              <SowStatusBadge status={sow.status} />
              {sow.amountCents > 0 && (
                <Badge className="bg-muted text-muted-foreground border border-border text-xs px-2 py-1 h-auto">
                  {formatCurrency(sow.amountCents, sow.currency)}
                </Badge>
              )}
              {sow.signedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" /> Signed {relativeDate(sow.signedAt)}
                </span>
              )}
              {sow.expiresAt && sow.status === "sent" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" /> Expires {relativeDate(sow.expiresAt)}
                </span>
              )}
            </div>

            {/* Expired / Failed banners */}
            {isExpired && (
              <div className="flex items-start gap-3 bg-muted/30 border border-border rounded-xl p-4">
                <XCircle className="size-5 text-muted-foreground/60 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">This SOW has expired</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Please contact your service provider to request a new agreement.
                  </p>
                </div>
              </div>
            )}
            {isFailed && (
              <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                <XCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-400">Payment failed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your signature was recorded, but payment could not be processed. Your service
                    provider will contact you to resolve this.
                  </p>
                </div>
              </div>
            )}

            {/* SOW Document */}
            {sow.documentHtml ? (
              <SowDocumentViewer html={sow.documentHtml} />
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <FileSignature className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Document not yet available</p>
                </CardContent>
              </Card>
            )}

            {/* Customer Agreement clickwrap */}
            {sow.customerAgreementSnapshotText && !alreadySigned && !isExpired && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Customer Agreement</CardTitle>
                  <CardDescription className="text-xs">
                    Read the following agreement before signing.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/20 border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">
                      {sow.customerAgreementSnapshotText}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Signature section — only for sent/draft SOWs */}
            {!isExpired && !isFailed && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileSignature className="size-4 text-primary" />
                    {alreadySigned ? "Your Signature" : "Sign the Agreement"}
                  </CardTitle>
                  {!alreadySigned && (
                    <CardDescription className="text-xs">
                      By signing you confirm you have read and agree to the statement of work above.
                      Payment will be charged to your MSP's card on file.
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

            {/* Post-signature — awaiting payment */}
            {sow.status === "signed" && (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="py-4 px-5">
                  <p className="text-sm font-medium mb-1">What happens next?</p>
                  <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                    <li>Your signature has been securely recorded.</li>
                    <li>Payment is being processed against your MSP's card on file.</li>
                    <li>Once confirmed, your project will be activated on your dashboard.</li>
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Paid confirmation */}
            {sow.status === "paid" && (
              <Card className="border border-primary/30 bg-primary/5">
                <CardContent className="flex items-start gap-3 py-4 px-5">
                  <CheckCircle2 className="size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary">Project Confirmed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Payment has been received and your project is now active. Check your home
                      dashboard for project status and next steps.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
