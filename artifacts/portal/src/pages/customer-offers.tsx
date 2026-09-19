import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth-context";
import {
  useAcceptOffer,
  useLatestPresentation,
  useOffers,
  useOffersLiveUpdates,
  useOpenSowDocument,
  usePresentation,
  useRejectOffer,
  useSignPresentation,
} from "@/lib/offers-sow-api";
import type { WireCustomerOffer, WirePresentationDetail, WireSowPhase } from "@/lib/offers-sow-types";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/shell/PageContainer";

/**
 * Offers and SOW Acceptance (#3997, Feature #1657). Adapted from
 * `Design/portal/design_handoff_full_site/screens/Offers and SOW Acceptance.dc.html`
 * per that package's own instruction to recreate the reference using this
 * codebase's React + Tailwind + shadcn/ui patterns (not port `support.js`),
 * wired per
 * `Design/portal/design_handoff_full_site/docs/offers-and-sow-acceptance-contract-pack.md`
 * against the real, live `portal-offers.ts` / `portal-presentations.ts` routes.
 *
 * Deliberate divergences from the design mock, all because the mock invents
 * client-side data the real reads don't provide (the internal "what this page
 * deliberately does not do" disclosure the design carried for these has been
 * removed from the customer-facing render per #4451; the divergences remain
 * real regardless):
 *   - The customer-safe offer projection (contract pack §1) strips
 *     `service_class`, so this page cannot tell a project offer from a
 *     non-project one and shows one accepted-offer note for both, instead of
 *     the mock's project-specific "a SOW is being generated" copy.
 *   - `/sign`'s response field is genuinely `effectivePrice` in dollars
 *     (#2511 fixed this by renaming the field, not just documenting the
 *     bug) — this page binds to the total already shown on the page rather
 *     than trusting a second price from the sign response either way.
 *   - No platform-agreement gate: contract pack §9b's finding is that
 *     `platform/agreement/current` is Shane's MSP-tenant MSA/DPA, not a
 *     customer offer-acceptance concept, and no customer terms-acceptance
 *     endpoint exists to record one — so none is faked here.
 */

function formatDollars(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCents(cents: number): string {
  return formatDollars(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const OFFER_STATE_STYLE: Record<WireCustomerOffer["state"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "border-status-blue/30 bg-status-blue/10 text-status-blue" },
  accepted: { label: "Accepted", className: "border-status-green/30 bg-status-green/10 text-status-green" },
  rejected: { label: "Declined", className: "border-muted-foreground/25 bg-muted/15 text-muted-foreground" },
  expired: { label: "Expired", className: "border-muted-foreground/25 bg-muted/15 text-muted-foreground" },
};

const PRES_STATUS_STYLE: Record<WirePresentationDetail["status"], { label: string; className: string }> = {
  draft: { label: "Awaiting your signature", className: "border-status-amber/30 bg-status-amber/10 text-status-amber" },
  signed: { label: "Signed", className: "border-status-green/30 bg-status-green/10 text-status-green" },
  paid: { label: "Paid", className: "border-status-green/30 bg-status-green/10 text-status-green" },
};

function offerWhenLabel(o: WireCustomerOffer): string {
  switch (o.state) {
    case "sent":
      return `sent ${formatDate(o.sentAt)}${o.expiresAt ? " · until " + formatDate(o.expiresAt) : ""}`;
    case "accepted":
      return `accepted ${formatDate(o.acceptedAt)}`;
    case "rejected":
      return `declined ${formatDate(o.closedAt)}`;
    case "expired":
      return `expired ${formatDate(o.expiresAt)}`;
    default:
      return "";
  }
}

export default function CustomerOffersPage() {
  const search = useSearch();
  const [tab, setTab] = useState<"offers" | "sow">(
    new URLSearchParams(search).get("tab") === "sow" ? "sow" : "offers",
  );

  return (
    <PageContainer>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Offers</h1>
        <span
          title="Work your provider has proposed, priced against what your tenant's signals actually show. Accept or decline from here; an accepted project offer gets a statement of work generated for you to sign."
          className="flex size-[17px] cursor-help items-center justify-center rounded-full border border-muted-foreground/35 text-[10px] font-bold text-muted-foreground"
        >
          i
        </span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "offers" | "sow")}>
        <TabsList>
          <TabsTrigger value="offers" data-testid="offers-tab-offers">
            Offers
          </TabsTrigger>
          <TabsTrigger value="sow" data-testid="offers-tab-sow">
            Statement of work
          </TabsTrigger>
        </TabsList>

        <TabsContent value="offers" className="flex flex-col gap-4">
          <OffersTab />
        </TabsContent>

        <TabsContent value="sow" className="flex flex-col gap-4">
          <SowTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

// ── Offers tab ───────────────────────────────────────────────────────────────

function OffersSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
          <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

function ErrorPanel({ title, message, onRetry, retrying }: { title: string; message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
      <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
        <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">{message}</span>
        <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={onRetry} disabled={retrying}>
          {retrying && <Loader2 className="size-3 animate-spin" />}
          Try again
        </Button>
      </div>
    </div>
  );
}

function OffersTab() {
  const { data: offers, isLoading, isError, error, refetch, isRefetching } = useOffers();
  const { connected } = useOffersLiveUpdates(() => void refetch());
  const acceptMutation = useAcceptOffer();
  const rejectMutation = useRejectOffer();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WireCustomerOffer | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!offers || offers.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !offers.some((o) => o.id === selectedId)) {
      setSelectedId(offers[0].id);
    }
  }, [offers, selectedId]);

  if (isLoading) return <OffersSkeleton />;

  if (isError) {
    return (
      <ErrorPanel
        title="Could not load your offers"
        message={(error as Error)?.message || "A failed read. Nothing is shown below because nothing could be fetched."}
        onRetry={() => void refetch()}
        retrying={isRefetching}
      />
    );
  }

  const selected = offers?.find((o) => o.id === selectedId) ?? null;

  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", connected ? "animate-pulse bg-status-green" : "bg-muted-foreground")} />
        {offers && offers.length === 0
          ? "Live — no offers sent"
          : connected
            ? "Live — updates arrive as they happen"
            : "Reconnecting…"}
      </div>

      {offers && offers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <span className="text-[13.5px] font-semibold text-foreground">No offers for you right now</span>
            <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
              This is a real read of your offers: none has been sent. Offers your provider is still
              drafting are not visible until sent, and this page updates on its own the moment one is.
            </span>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(240px, 320px) 1fr" }}>
          <div className="flex flex-col gap-2">
            {offers!.map((o) => {
              const style = OFFER_STATE_STYLE[o.state];
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedId(o.id)}
                  data-testid={`offer-card-${o.id}`}
                  className={cn(
                    "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors",
                    selectedId === o.id ? "border-primary/50 bg-primary/[.06]" : "border-border bg-muted/5 hover:bg-muted/10",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-foreground">{o.title}</span>
                    <Badge variant="outline" className={cn("flex-none", style.className)}>
                      {style.label}
                    </Badge>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold tabular-nums text-foreground">
                      {o.adjustedPriceCents === 0 ? "Priced per seat" : formatCents(o.adjustedPriceCents)}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">{offerWhenLabel(o)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <OfferDetail
              offer={selected}
              acceptMutation={acceptMutation}
              onReject={() => {
                setRejectTarget(selected);
                setRejectReason("");
              }}
            />
          )}
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Decline &quot;{rejectTarget?.title}&quot;?</DialogTitle>
            <DialogDescription>
              Declining is final for this offer — it moves to Declined and cannot be reopened. Your
              provider sees the decision straight away.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offer-reject-reason" className="text-[11px] text-muted-foreground">
              Reason <span className="text-muted-foreground/70">optional, free text</span>
            </Label>
            <Textarea
              id="offer-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value.slice(0, 2_000))}
              className="min-h-[70px] resize-y"
              placeholder="Not this quarter — budget is committed until January."
            />
          </div>
          {rejectMutation.isError && <p className="text-[12.5px] text-destructive">{(rejectMutation.error as Error).message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Keep it open
            </Button>
            <Button
              disabled={rejectMutation.isPending}
              onClick={() =>
                rejectTarget &&
                rejectMutation.mutate(
                  { offerId: rejectTarget.id, rejectionReason: rejectReason.trim() || undefined },
                  {
                    onSuccess: () => {
                      toast.success("Offer declined.");
                      setRejectTarget(null);
                    },
                    onError: (e) => toast.error((e as Error).message),
                  },
                )
              }
              data-testid="offer-reject-confirm"
            >
              {rejectMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Decline offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OfferDetail({
  offer,
  onReject,
  acceptMutation,
}: {
  offer: WireCustomerOffer;
  onReject: () => void;
  acceptMutation: ReturnType<typeof useAcceptOffer>;
}) {
  const style = OFFER_STATE_STYLE[offer.state];
  return (
    <Card className="h-fit">
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold tracking-tight text-foreground">{offer.title}</span>
            <Badge variant="outline" className={style.className}>
              {style.label}
            </Badge>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Sent {formatDate(offer.sentAt)}
            {offer.expiresAt ? ` · valid until ${formatDate(offer.expiresAt)}` : ""}
          </span>
        </div>

        {offer.rationale && (
          <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Why this is proposed</span>
            <span className="text-xs leading-relaxed text-foreground">{offer.rationale}</span>
          </div>
        )}

        <div className="flex items-baseline gap-2.5 border-t border-border/60 pt-3">
          <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
            {offer.adjustedPriceCents === 0 ? "Priced per seat" : formatCents(offer.adjustedPriceCents)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            the price adjusted to your tenant&apos;s signals; there is no other price behind it to show
          </span>
        </div>

        {offer.state === "sent" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <span className="max-w-[300px] text-[11px] text-muted-foreground">
              {offer.expiresAt ? `Open until ${formatDate(offer.expiresAt)}. After that it lapses on its own.` : "This offer has no expiry set."}
            </span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={onReject} data-testid="offer-decline">
              Decline
            </Button>
            <Button
              size="sm"
              disabled={acceptMutation.isPending}
              onClick={() =>
                acceptMutation.mutate(offer.id, {
                  onSuccess: () => toast.success("Offer accepted — your provider has been notified."),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
              data-testid="offer-accept"
            >
              {acceptMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Accept offer
            </Button>
          </div>
        )}

        {offer.state === "accepted" && (
          <div className="flex flex-col gap-1 rounded-xl border border-status-green/25 bg-status-green/[.06] p-3">
            <span className="text-[12.5px] font-semibold text-foreground">Accepted {formatDate(offer.acceptedAt)}</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              Your provider has been notified and will follow up. A project offer&apos;s statement of
              work appears under the Statement of work tab once it has been generated.
            </span>
          </div>
        )}

        {offer.state === "rejected" && (
          <div className="flex flex-col gap-1 rounded-xl border border-border p-3">
            <span className="text-[12.5px] font-semibold text-foreground">Declined {formatDate(offer.closedAt)}</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {offer.rejectionReason ? `Reason given: "${offer.rejectionReason}"` : "No reason given — that is allowed."}
            </span>
          </div>
        )}

        {offer.state === "expired" && (
          <span className="border-t border-border/60 pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            This offer lapsed on {formatDate(offer.expiresAt)} and can no longer be accepted or declined.
            Your provider can send a fresh one.
          </span>
        )}
      </CardContent>
    </Card>
  );
}

// ── Statement of work tab ────────────────────────────────────────────────────

function PhaseRow({ phase }: { phase: WireSowPhase }) {
  return (
    <div className={cn("flex items-start gap-3 border-t border-border/40 py-2", !phase.selected && "opacity-55")}>
      <span
        className={cn(
          "mt-0.5 flex size-[14px] flex-none items-center justify-center rounded border",
          phase.selected ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent",
        )}
      >
        {phase.selected && <Check className="size-2.5 text-primary-foreground" strokeWidth={3} />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12.5px] text-foreground">{phase.title}</span>
        <span className="text-[11px] leading-relaxed text-muted-foreground">{phase.description}</span>
      </div>
      <span className="w-[90px] flex-none text-right text-[12.5px] tabular-nums text-foreground">{formatDollars(phase.price)}</span>
    </div>
  );
}

function SignSection({
  signerName,
  onSignerNameChange,
  signMutation,
}: {
  signerName: string;
  onSignerNameChange: (v: string) => void;
  signMutation: ReturnType<typeof useSignPresentation>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const { width } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width)) {
        canvas.width = Math.round(width);
        canvas.height = 100;
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
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "currentColor";
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
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !pos || !lastPoint.current) return;
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

  function handleSign() {
    if (!signerName.trim()) {
      setFormError("Enter your full name before signing.");
      return;
    }
    if (isEmpty) {
      setFormError("Draw your signature before signing.");
      return;
    }
    setFormError(null);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureData = canvas.toDataURL("image/png");
    signMutation.mutate(
      { signatureData, signerName: signerName.trim() },
      {
        onSuccess: () => toast.success("Statement of work signed."),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
        Sign · full name and a drawn signature
      </span>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Input
          value={signerName}
          onChange={(e) => onSignerNameChange(e.target.value)}
          placeholder="Your full legal name"
          data-testid="sow-signer-name"
        />
        <div ref={containerRef} className="relative rounded-md border border-dashed border-border bg-muted/10 text-foreground">
          <canvas
            ref={canvasRef}
            className="block h-[100px] w-full cursor-crosshair touch-none rounded-md"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            data-testid="sow-signature-canvas"
          />
          {isEmpty && (
            <span className="pointer-events-none absolute inset-0 flex items-center px-3 text-[11px] italic text-muted-foreground">
              Draw your signature here
            </span>
          )}
        </div>
      </div>
      <button type="button" onClick={clearCanvas} className="w-fit text-[11px] text-muted-foreground hover:text-foreground">
        Clear signature
      </button>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="max-w-[420px] text-[11px] leading-relaxed text-muted-foreground">
          Signing records your name, signature and the time against this exact scope and price. Anyone
          signed in for your organization may sign. Payment is arranged separately and nothing is
          charged by signing.
        </span>
        <Button size="sm" className="ml-auto" onClick={handleSign} disabled={signMutation.isPending} data-testid="sow-sign-button">
          {signMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
          Sign statement of work
        </Button>
      </div>
      {formError && <p className="text-[12.5px] text-destructive">{formError}</p>}
    </div>
  );
}

function SowTab() {
  const { user } = useAuth();
  const { data: latest, isLoading: latestLoading, isError: latestError, error: latestErr, refetch: refetchLatest, isRefetching: latestRefetching } =
    useLatestPresentation();
  const presentationId = latest?.id ?? null;
  const {
    data: pres,
    isLoading: presLoading,
    isError: presError,
    error: presErr,
    refetch: refetchPres,
    isRefetching: presRefetching,
  } = usePresentation(presentationId);
  const signMutation = useSignPresentation(presentationId);
  const openDoc = useOpenSowDocument();
  const [signerName, setSignerName] = useState(user?.name ?? "");

  useEffect(() => {
    if (user?.name && !signerName) setSignerName(user.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);

  if (latestLoading) return <OffersSkeleton />;

  if (latestError) {
    return (
      <ErrorPanel
        title="Could not load your statement of work"
        message={(latestErr as Error)?.message || "A failed read."}
        onRetry={() => void refetchLatest()}
        retrying={latestRefetching}
      />
    );
  }

  if (!latest) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <span className="text-[13.5px] font-semibold text-foreground">No statement of work yet</span>
          <span className="max-w-[660px] text-xs leading-relaxed text-muted-foreground">
            This is a real read: no statement of work has been generated for you. Accepting a project
            offer generates one from your tenant&apos;s live signals — it appears here once ready.
          </span>
        </CardContent>
      </Card>
    );
  }

  if (presLoading || !pres) return <OffersSkeleton />;

  if (presError) {
    return (
      <ErrorPanel
        title="Could not load this statement of work"
        message={(presErr as Error)?.message || "A failed read."}
        onRetry={() => void refetchPres()}
        retrying={presRefetching}
      />
    );
  }

  const statusStyle = PRES_STATUS_STYLE[pres.status];
  const canSign = pres.status === "draft";

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
              <span className="text-[11px] font-semibold tracking-widest text-primary">STATEMENT OF WORK</span>
              <span className="text-base font-bold tracking-tight text-foreground">
                {pres.projectTitle ?? pres.workflowName ?? "Statement of work"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {[pres.clientName, "prepared by Shane McCaw Consulting", `version fingerprint ${pres.sowVersion}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <Badge variant="outline" className={statusStyle.className}>
              {statusStyle.label}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void openDoc(pres.id).then((err) => {
                  if (err) toast.error(err);
                })
              }
              data-testid="sow-open-document"
            >
              Open full document
              <ExternalLink className="size-3.5" />
            </Button>
          </div>

          <div className="flex flex-col border-t border-border/60">
            <div className="flex items-center gap-3 py-2">
              <span className="flex-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                Phases · {pres.selectedPhaseIds.length} of {pres.sowPhases.length} selected
              </span>
              <span className="w-[90px] flex-none text-right text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                Price
              </span>
            </div>
            {pres.sowPhases.map((ph) => (
              <PhaseRow key={ph.id} phase={ph} />
            ))}
            {pres.adjustmentLines.map((ad, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-border/40 py-2">
                <span className="w-[14px] flex-none" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xs text-foreground">{ad.title}</span>
                  <span className="text-[11px] leading-relaxed text-muted-foreground">{ad.description}</span>
                </div>
                <span className="w-[90px] flex-none text-right text-xs tabular-nums text-status-amber">
                  +{formatDollars(ad.price)}
                </span>
              </div>
            ))}
            <div className="flex items-baseline gap-3 border-t border-border pt-3">
              <span className="flex-1 text-xs text-muted-foreground">Selected phases plus adjustments currently firing</span>
              <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">{formatDollars(pres.totalPrice)}</span>
            </div>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
              Adjustment lines count only when the signal behind them is currently firing on your
              tenant — re-evaluated each time this page loads, not fixed when the document was
              written.
            </span>
          </div>

          {canSign ? (
            <SignSection signerName={signerName} onSignerNameChange={setSignerName} signMutation={signMutation} />
          ) : (
            <div className="flex flex-col gap-1 rounded-xl border border-status-green/25 bg-status-green/[.06] p-3">
              <span className="text-[12.5px] font-semibold text-foreground">
                Signed by {pres.signerName ?? "—"} · {formatDate(pres.signedAt)}
              </span>
              <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                {pres.status === "paid"
                  ? `Bound at ${formatDollars(pres.totalPrice)} for the phases ticked above. Payment is confirmed.`
                  : `Bound at ${formatDollars(pres.totalPrice)} for the phases ticked above. Payment is confirmed separately; this page will show "Paid" once it is.`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 pt-6">
          <span className="text-[13.5px] font-semibold text-foreground">Terms</span>
          {pres.contractBody ? (
            <>
              <span className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">{pres.contractBody}</span>
              <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
                These terms come from the service&apos;s own contract template with your name, the
                service, price and date filled in. No separate &quot;accept the platform
                agreement&quot; step is shown — that agreement is between the platform and your
                provider, not you, and there is no record it could write for you.
              </span>
            </>
          ) : (
            <span className="max-w-[720px] text-xs leading-relaxed text-muted-foreground">
              No contract template is linked to this service yet, so no terms text is shown here. No
              separate &quot;accept the platform agreement&quot; step exists either — that agreement is
              between the platform and your provider, not you.
            </span>
          )}
        </CardContent>
      </Card>
    </>
  );
}

