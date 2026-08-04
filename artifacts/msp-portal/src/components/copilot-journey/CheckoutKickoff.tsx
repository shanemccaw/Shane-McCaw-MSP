/**
 * CheckoutKickoff.tsx — what the Checkout becomes once payment lands.
 *
 * This is deliberately not a receipt. A receipt closes a transaction; the whole
 * arc up to here has been about a tenant that is not flight-ready, and the last
 * screen the customer sees should read as the moment the work starts. Hence the
 * `cj-rise` entrance, the present tense in the headline, and a TODAY / WEEK 1 /
 * ONGOING list instead of an order number.
 *
 * WEEK 1 is bound to the real first phase of the signed scope rather than to
 * prose. The prototype's copy at that position IS Phase 1's title followed by
 * Phase 1's scope; on a live tenant those are whatever the platform's own SOW
 * document says, so the sentence is assembled from them and simply omitted when
 * no phase is known.
 */

import { Link } from "wouter";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";

import { BRAND, INK, MOTION, RADIUS, SEVERITY_ON_DARK } from "./journeyTokens.ts";

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
] as const;

/**
 * The design's sentence says "your N reports", where N is the length of
 * `JOURNEY_DESIGN_DOCUMENTS` — the DESIGN's list, which an earlier check of
 * `document_types` found no seeded type behind for several of its entries. So
 * the number is never taken from that constant here. It arrives as the
 * tenant's real `view.generation.total`, and the clause is dropped when that
 * is unknown rather than promising a report count this account does not
 * produce.
 */
function documentCountWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function StageRow({ when, children }: { readonly when: string; readonly children: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".1em",
          color: BRAND.teal,
          flex: "none",
          width: 74,
        }}
      >
        {when}
      </span>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.6, color: INK.bodyDark }}>
        {children}
      </p>
    </div>
  );
}

export function CheckoutKickoff({
  tenantName,
  paidLine,
  firstPhase,
  documentsHref,
  documentCount,
  receiptExpected,
  reducedMotion,
}: {
  readonly tenantName: string;
  /**
   * "$36,200 is paid in full and the engagement is open." — `null` when the
   * screen was reached on a Stripe return without the signed-scope handoff in
   * this tab, in which case the amount is genuinely not known here and the
   * sentence is dropped rather than approximated.
   */
  readonly paidLine: string | null;
  readonly firstPhase: { readonly title: string; readonly scope: string } | null;
  readonly documentsHref: string;
  /**
   * How many reports this tenant's assessment actually produces — the real
   * `view.generation.total`. `null` (or 0) when the platform has not said, in
   * which case the sentence names no number at all.
   */
  readonly documentCount: number | null;
  /**
   * Whether money actually moved. A receipt follows a charge, and the phased
   * plan makes none — `POST .../sow/checkout` records an
   * `awaiting_provider_setup` agreement without touching Stripe — so promising a
   * receipt there would name a document nobody will send.
   */
  readonly receiptExpected: boolean;
  readonly reducedMotion: boolean;
}) {
  const reportsClause =
    documentCount != null && documentCount > 0
      ? `filed alongside your ${documentCountWord(documentCount)} reports`
      : "filed with your assessment";
  const filingLine = receiptExpected
    ? `A receipt is on its way to the address on file, and your signed scope is ${reportsClause}.`
    : `Your signed scope is ${reportsClause}.`;
  return (
    <div
      style={{
        maxWidth: 660,
        margin: "0 auto",
        padding: "72px 24px 0",
        display: "flex",
        flexDirection: "column",
        gap: 30,
        animation: reducedMotion ? undefined : `cj-rise ${MOTION.kickoffMs}ms ease both`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "rgba(52,211,153,.12)",
            border: "1px solid rgba(52,211,153,.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={20} strokeWidth={2.4} color={SEVERITY_ON_DARK.healthy} aria-hidden="true" />
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(27px,3.2vw,38px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.14,
            color: BRAND.offWhite,
            textWrap: "pretty",
          }}
        >
          {`Remediation is underway on ${tenantName}.`}
        </h1>
        <p
          style={{
            margin: 0,
            maxWidth: "58ch",
            fontSize: 15.5,
            fontWeight: 500,
            lineHeight: 1.62,
            color: INK.bodyDark,
            textWrap: "pretty",
          }}
        >
          {paidLine ? `${paidLine} ` : ""}
          {filingLine}
        </p>
      </div>

      <div
        style={{
          border: "1px solid rgba(30,41,59,.95)",
          borderRadius: RADIUS.cardLarge,
          background: "rgba(15,23,42,.55)",
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: INK.micro,
          }}
        >
          What happens next
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {/* "expect an email within one business day" was the design's line, and
              nothing in the platform sends it — the assessment SOW routes emit no
              mail and no notification on signature or checkout, and the webhook
              deliberately does not raise `agreement_signed`. Promising a mail that
              never arrives is worse than promising nothing, so this says only what
              is true: a person picks it up, not a queue. */}
          <StageRow when="TODAY">
            Shane reviews your signed scope and confirms the Phase 1 window with you directly. A
            person picks this up, not a queue.
          </StageRow>
          {firstPhase ? (
            <StageRow when="WEEK 1">{`${firstPhase.title} starts: ${firstPhase.scope}`}</StageRow>
          ) : null}
          <StageRow when="ONGOING">
            Every phase is tracked against the findings that generated it. You will see each one
            move from open to closed, with the score change recorded as it lands.
          </StageRow>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {/* The design's primary action here opens the remediation tracker. That
              tracker is deferred to the next iteration — no route, no component,
              no per-phase progress store. It was previously drawn as a disabled
              button with the reason underneath; a disabled primary CTA is still a
              visible entry point that does nothing, at the single moment the
              customer is most trusting, so the button is gone and the tracking
              promise survives as the copy above ("every phase is tracked against
              the findings that generated it") plus the note below. The real,
              working action is promoted in its place. */}
          <Button
            asChild
            size="lg"
            style={{
              minWidth: 200,
              height: 44,
              background: BRAND.blue,
              color: BRAND.white,
              border: "none",
              borderRadius: RADIUS.control,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            <Link href={documentsHref}>Back to your findings</Link>
          </Button>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.55, color: INK.micro }}>
          Phase tracking opens once Shane confirms your Phase 1 window — it is not live on your
          account yet. Your reports and signed scope are available now.
        </span>
      </div>
    </div>
  );
}
