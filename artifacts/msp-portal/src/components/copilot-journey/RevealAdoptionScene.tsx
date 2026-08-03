/**
 * RevealAdoptionScene.tsx — Scene 8. White-Glove Copilot Adoption.
 *
 * A standalone scene, deliberately. It was first crammed into the Full Picture
 * close, where Scene 9's fit-to-viewport transform shrank the whole composition
 * to make room for it — so it now sizes independently, exactly like a pillar
 * scene, and shares none of Scene 9's scaling logic. Nothing here reads Scene
 * 9's row scale or its stage constants.
 *
 * No ring, no orb, no satellites. Typographic presence only, consistent with the
 * sparse register everywhere else — and no pricing or tier detail, which lives
 * exclusively in the SOW. This scene exists so a non-technical buyer sees the
 * option before they see a number.
 */

import { Sparkles } from "lucide-react";

import { BRAND, INK, RADIUS } from "./journeyTokens.ts";
import { ADOPTION_BLOCK_WINDOWS, blockReveal, clampWindow, easeOutCubic } from "./revealMath.ts";
import { ScrollCue } from "./JourneyPrimitives";

/** Same size class as the pillar headlines — this is a peer, not a footnote. */
const HEADLINE_SIZE = "clamp(30px,min(4.4vw,6.6vh),60px)";
const BODY_SIZE = "clamp(15px,min(1.5vw,2.5vh),19px)";

export function RevealAdoptionScene({
  progress,
  reduced,
}: {
  progress: number;
  reduced: boolean;
}) {
  const eyebrow = blockReveal(progress, ...ADOPTION_BLOCK_WINDOWS.eyebrow, reduced);
  const headline = blockReveal(progress, ...ADOPTION_BLOCK_WINDOWS.headline, reduced);
  const body = blockReveal(progress, ...ADOPTION_BLOCK_WINDOWS.body, reduced);
  const cueOpacity = easeOutCubic(clampWindow(progress, 0.46, 0.66));

  return (
    <section data-cj-scene="8" style={{ position: "relative", height: "240vh" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          alignItems: "center",
          // Left-anchored on the pillar scenes' own padding, so the eye does not
          // have to re-find the column after six identical scenes.
          padding: "0 9vw 0 clamp(52px,8vw,120px)",
          boxSizing: "border-box",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "26%",
            top: "44%",
            width: 620,
            height: 620,
            transform: "translate(-50%,-50%)",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,180,216,.10), rgba(2,6,23,0) 66%)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            maxWidth: 1180,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              opacity: eyebrow.o,
              transform: `translateY(${eyebrow.y}px)`,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: RADIUS.iconTile,
                background: "linear-gradient(135deg,rgba(0,120,212,.16),rgba(139,92,246,.16))",
                border: "1px solid rgba(0,180,216,.32)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <Sparkles size={17} strokeWidth={1.7} color={BRAND.teal} aria-hidden="true" />
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                color: BRAND.teal,
              }}
            >
              The add-on
            </span>
          </div>

          <h2
            style={{
              margin: 0,
              maxWidth: "20ch",
              fontSize: HEADLINE_SIZE,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.06,
              color: INK.headingDark,
              textWrap: "pretty",
              opacity: headline.o,
              transform: `translateY(${headline.y}px)`,
            }}
          >
            Remediation fixes your tenant. This is how your people actually use it.
          </h2>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              opacity: body.o,
              transform: `translateY(${body.y}px)`,
            }}
          >
            {/* The product name is a PILL, not bolded body text — it has to read
                as a named offering the buyer could ask for by name. */}
            <span
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                alignItems: "center",
                gap: 10,
                padding: "8px 15px",
                border: "1px solid rgba(0,180,216,.34)",
                borderRadius: RADIUS.pill,
                background: "linear-gradient(120deg,rgba(0,120,212,.14),rgba(139,92,246,.12))",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg,#3B82F6,${BRAND.teal})`,
                  flex: "none",
                }}
              />
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  color: INK.headingDark,
                  whiteSpace: "nowrap",
                }}
              >
                White-Glove Copilot Adoption
              </span>
            </span>

            <p
              style={{
                margin: 0,
                maxWidth: "62ch",
                fontSize: BODY_SIZE,
                fontWeight: 500,
                lineHeight: 1.55,
                color: INK.bodyDark,
                textWrap: "pretty",
              }}
            >
              A pilot cohort, plain-language change comms written from your own findings, a daily
              prompt drip in Teams, and live enablement sessions — measured on the same usage data
              that found the gap.
            </p>
          </div>

          <div style={{ paddingTop: 6, opacity: cueOpacity }}>
            <ScrollCue label="The full picture below" align="start" />
          </div>
        </div>
      </div>
    </section>
  );
}
