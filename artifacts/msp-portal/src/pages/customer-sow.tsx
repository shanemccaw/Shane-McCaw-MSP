import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
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
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
  deliveryDate?: string | null;
}

interface PresentationData {
  id: number;
  status: string;
  totalPrice: number | null;
  createdAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  sowPricingLines?: SowPhase[] | null;
  scopedPhaseIds?: string[] | null;
  clientUserId: number | null;
  shareToken?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ── Inline Signature Canvas ────────────────────────────────────────────────────

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

  // Keep canvas pixel dimensions in sync with its CSS size
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const { width } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width)) {
        canvas.width = Math.round(width);
        canvas.height = 130;
        // Clear after resize — strokes would be distorted
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
    if (!name.trim()) {
      setError("Please enter your full legal name before signing.");
      return;
    }
    if (isEmpty) {
      setError("Please draw your signature before proceeding.");
      return;
    }
    setError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    await onSign(dataUrl, name.trim());
  }

  if (alreadySigned) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-start gap-3">
        <CheckCircle2 className="size-5 text-green-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-green-400">Agreement Signed</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {existingName ? `Signed by ${existingName}.` : "You have signed this agreement."}{" "}
            The engagement will proceed once payment is confirmed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Name field */}
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

      {/* Canvas */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-foreground">
            Signature <span className="text-red-500">*</span>
          </label>
          <button
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
            onClick={clearCanvas}
          >
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
        {isEmpty && (
          <p className="text-xs text-muted-foreground mt-1">
            Draw your signature in the box above
          </p>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <Button
        className="w-full gap-2"
        onClick={() => void handleSign()}
        disabled={signing}
      >
        {signing ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing agreement…
          </>
        ) : (
          <>
            <FileSignature className="size-4" />
            Sign Agreement
          </>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center">
        By signing, you agree to the terms displayed above. This electronic signature carries
        the same legal weight as a handwritten signature.
      </p>
    </div>
  );
}

// ── SOW Document viewer ────────────────────────────────────────────────────────

function SowDocumentViewer({
  presentationId,
  accessToken,
}: {
  presentationId: number;
  accessToken: string | null;
}) {
  const { fetchWithAuth } = useAuth();
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    fetchWithAuth(`/api/portal/presentations/${presentationId}/sow-document`)
      .then(async (res) => {
        if (!res.ok) return;
        const text = await res.text();
        setHtml(text);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  if (loading) {
    return <Skeleton className="h-80 w-full rounded-xl" />;
  }

  if (!html) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <FileSignature className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">SOW document not yet available</p>
          <p className="text-xs text-muted-foreground/60">
            Your statement of work will appear here once generated.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 space-y-0">
          <CardTitle className="text-sm">Statement of Work</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setFullscreen(true)}
          >
            <ZoomIn className="size-3" />
            Full screen
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0 overflow-hidden rounded-b-xl">
          <iframe
            srcDoc={html}
            title="Statement of Work"
            className="w-full border-0 rounded-b-xl"
            style={{ height: "400px" }}
            sandbox="allow-same-origin"
          />
        </CardContent>
      </Card>

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 bg-background border-b border-border shrink-0">
            <p className="text-sm font-semibold">Statement of Work</p>
            <Button variant="ghost" size="sm" onClick={() => setFullscreen(false)}>
              Close
            </Button>
          </div>
          <iframe
            srcDoc={html}
            title="Statement of Work"
            className="flex-1 border-0 bg-white"
            sandbox="allow-same-origin"
          />
        </div>
      )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerSowPage() {
  const { id } = useParams<{ id: string }>();
  const presentationId = parseInt(id ?? "", 10);
  const { fetchWithAuth, accessToken } = useAuth();
  const [, navigate] = useLocation();

  const [presentation, setPresentation] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);

  const fetchPresentation = useCallback(async () => {
    if (isNaN(presentationId)) return;
    const res = await fetchWithAuth(`/api/portal/presentations/${presentationId}`);
    if (!res.ok) return;
    const data = (await res.json()) as PresentationData;
    setPresentation(data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  useEffect(() => {
    if (isNaN(presentationId)) {
      setLoading(false);
      return;
    }
    fetchPresentation().finally(() => setLoading(false));
  }, [fetchPresentation, presentationId]);

  const handleSign = useCallback(
    async (signatureData: string, signerName: string) => {
      setSigning(true);
      try {
        const res = await fetchWithAuth(`/api/portal/presentations/${presentationId}/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signatureData, signerName }),
        });
        if (!res.ok) {
          toast.error("Failed to sign. Please try again.");
          return;
        }
        toast.success("Agreement signed successfully!");
        await fetchPresentation();
      } catch {
        toast.error("Something went wrong. Please try again.");
      } finally {
        setSigning(false);
      }
    },
    [fetchPresentation, fetchWithAuth, presentationId],
  );

  if (isNaN(presentationId)) {
    return (
      <AppShell title="Agreement">
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Invalid agreement ID.</p>
        </div>
      </AppShell>
    );
  }

  const alreadySigned =
    presentation?.status === "signed" || presentation?.status === "paid";

  return (
    <AppShell title="Review & Sign Agreement">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Back nav */}
        <div>
          <Link href="/customer-diagnostics">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground -ml-1 mb-4">
              <ArrowLeft className="size-4" />
              Back to Diagnostics
            </Button>
          </Link>
          <h2 className="text-xl font-bold tracking-tight">Engagement Agreement</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Review your statement of work and sign the engagement agreement below.
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-48 rounded-lg" />
            <Skeleton className="h-80 w-full rounded-xl" />
            <Skeleton className="h-60 w-full rounded-xl" />
          </div>
        ) : !presentation ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <FileSignature className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Agreement not found</p>
              <p className="text-xs text-muted-foreground/60">
                This agreement may no longer be accessible.
              </p>
              <Link href="/customer-diagnostics">
                <Button variant="outline" size="sm" className="mt-2">
                  Back to Diagnostics
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Status banner */}
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  presentation.status === "paid"
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : presentation.status === "signed"
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                }`}
              >
                {alreadySigned ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <Clock className="size-4 shrink-0" />
                )}
                <span className="font-medium">
                  {presentation.status === "paid"
                    ? "Engagement confirmed — payment received"
                    : presentation.status === "signed"
                    ? "Agreement signed — awaiting payment confirmation"
                    : "Pending your signature"}
                </span>
              </div>

              {presentation.totalPrice != null && presentation.totalPrice > 0 && (
                <Badge className="bg-muted text-muted-foreground border border-border text-xs px-2 py-1 h-auto">
                  {formatCurrency(Number(presentation.totalPrice))}
                </Badge>
              )}

              {presentation.signedAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" />
                  Signed {relativeDate(presentation.signedAt)}
                </span>
              )}
            </div>

            {/* SOW Document */}
            <SowDocumentViewer
              presentationId={presentationId}
              accessToken={accessToken}
            />

            {/* Pricing summary (if phases available) */}
            {presentation.sowPricingLines && presentation.sowPricingLines.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Engagement Scope & Pricing</CardTitle>
                  <CardDescription className="text-xs">
                    Selected phases and investment breakdown
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {presentation.sowPricingLines
                        .filter((p) => p.selected)
                        .map((phase) => (
                          <tr key={phase.id}>
                            <td className="py-2 text-foreground font-medium pr-4">
                              {phase.title}
                              {phase.description && (
                                <span className="block text-[11px] text-muted-foreground font-normal mt-0.5">
                                  {phase.description}
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-right font-semibold text-foreground whitespace-nowrap">
                              {formatCurrency(phase.price)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                    {presentation.totalPrice != null && (
                      <tfoot>
                        <tr className="border-t-2 border-border">
                          <td className="pt-2 font-bold text-foreground">Total Investment</td>
                          <td className="pt-2 text-right font-extrabold text-foreground whitespace-nowrap">
                            {formatCurrency(Number(presentation.totalPrice))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </CardContent>
              </Card>
            )}

            {/* Signature section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileSignature className="size-4 text-primary" />
                  {alreadySigned ? "Your Signature" : "Sign the Agreement"}
                </CardTitle>
                {!alreadySigned && (
                  <CardDescription className="text-xs">
                    By signing you acknowledge that you have read and agree to the statement of
                    work and terms above.
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <SignatureCanvas
                  onSign={handleSign}
                  signing={signing}
                  alreadySigned={alreadySigned}
                  signerName={presentation.signerName}
                />
              </CardContent>
            </Card>

            {/* Post-signature instructions */}
            {alreadySigned && presentation.status !== "paid" && (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="py-4 px-5">
                  <p className="text-sm font-medium mb-1">What happens next?</p>
                  <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                    <li>Your signed agreement has been securely recorded.</li>
                    <li>
                      Your MSP will reach out to confirm payment details and schedule a
                      kick-off meeting.
                    </li>
                    <li>
                      Once payment is confirmed, your engagement projects will be activated and
                      visible on your home dashboard.
                    </li>
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Confirmed engagement */}
            {presentation.status === "paid" && (
              <Card className="border border-primary/30 bg-primary/5">
                <CardContent className="flex items-start gap-3 py-4 px-5">
                  <CheckCircle2 className="size-5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-primary">Engagement Confirmed</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your Microsoft 365 modernisation engagement is confirmed and underway.
                      Visit your home dashboard to track project progress.
                    </p>
                    <Link href="/customer-home">
                      <Button size="sm" variant="outline" className="mt-3 gap-2">
                        View Project Progress
                        <ArrowLeft className="size-3 rotate-180" />
                      </Button>
                    </Link>
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
