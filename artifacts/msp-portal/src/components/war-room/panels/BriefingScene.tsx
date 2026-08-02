/**
 * BriefingScene.tsx — #332 (War Room epic #302).
 *
 * The scene between the scan finishing and the room filling up: Shane introduces
 * himself and explains how the next twenty minutes work, then the personas the
 * whole conversation is about to be framed around are put in front of the
 * customer one at a time to confirm or correct.
 *
 * This is NOT ported design source — there is no prototype for this screen — so
 * unlike its sibling panels it is typechecked rather than `@ts-nocheck`. It keeps
 * the room's visual language (the `css()` declaration strings, the holographic
 * Shane avatar, the prelude's gradient stage) so it reads as the same product,
 * but every value it renders is resolved in `renderVals()` under `v.brief`, the
 * same contract every other panel has.
 *
 * All state, cycle counting and the completion gate live in `warRoomBriefing.ts`.
 * Nothing in here decides anything.
 */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "../runtime";

/** The holographic Shane bust the prelude uses, at the size this scene wants. */
function ShaneAvatar({ size }: { size: string }) {
  return (
    <div style={css(`position:relative;flex:none;width:${size};height:${size};transform-origin:50% 88%;animation:wr-speakgesture 4.4s cubic-bezier(.4,0,.35,1) infinite`)}>
      <span style={css(`position:absolute;inset:-18%;border-radius:50%;border:1px solid rgba(103,232,249,.28);animation:wr-ringpulse 4s cubic-bezier(.22,1,.36,1) infinite`)} />
      <span style={css(`position:absolute;inset:-38%;border-radius:50%;background:radial-gradient(closest-side,rgba(139,92,246,.5),rgba(5,7,13,0) 72%);animation:wr-holobreath 5s ease-in-out infinite`)} />
      <span style={css(`position:absolute;inset:0;border-radius:50%;overflow:hidden;border:1.5px solid rgba(103,232,249,.6);animation:wr-holoflicker 6s ease-in-out infinite`)}>
        <ImageSlot id={"brief-shane"} shape={"circle"} src={"avatars/shane.png"} alt={"Shane McCaw"} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
        <span style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(103,232,249,.18) 0px,rgba(103,232,249,.18) 1px,transparent 1px,transparent 4px);mix-blend-mode:screen`)} />
        <span style={css(`position:absolute;inset:0;pointer-events:none;background:linear-gradient(160deg,rgba(59,130,246,.3),rgba(139,92,246,.24));mix-blend-mode:color`)} />
        <span style={css(`position:absolute;left:0;right:0;height:24%;pointer-events:none;background:linear-gradient(180deg,rgba(165,243,252,0),rgba(165,243,252,.26),rgba(165,243,252,0));animation:wr-holoscan 3.2s linear infinite`)} />
      </span>
    </div>
  );
}

const PRIMARY_BTN = `display:inline-flex;align-items:center;gap:9px;height:38px;padding:0 22px;border-radius:99px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:800;color:#04202a;background:linear-gradient(135deg,#67e8f9,#3B82F6);box-shadow:0 0 34px rgba(59,130,246,.45)`;
const GHOST_BTN = `display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 18px;border-radius:99px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;color:#9aa8c2;border:1px solid rgba(103,232,249,.3);background:rgba(2,6,23,.55)`;

/** One paragraph of a tutorial beat / persona profile. */
function Line({ text, tone }: { text: unknown; tone?: string }) {
  return (
    <p style={css(`margin:0;font-size:14px;line-height:1.72;color:${tone || "#c7d3e6"}`)}>
      <Txt v={text} />
    </p>
  );
}

/** A labelled block inside the persona profile card. */
function ProfileRow({ label, text, tint }: { label: string; text: unknown; tint?: string }) {
  return (
    <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
      <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${tint || "#64748b"}`)}>
        {label}
      </div>
      <Line text={text} />
    </div>
  );
}

export function BriefingScene({ v }: { v: any }) {
  const b = v.brief || {};
  const p = b.person || null;

  return (
    <div data-briefing={"true"} style={css(`position:fixed;inset:0;z-index:300;display:flex;background:radial-gradient(120% 90% at 50% 0%,rgba(103,232,249,.2),rgba(6,10,30,.99) 62%);animation:${b.anim}`)}>
      <div style={css(`position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(90% 70% at 8% 4%,rgba(103,232,249,.28),rgba(0,0,0,0) 62%),radial-gradient(85% 75% at 96% 12%,rgba(236,72,153,.14),rgba(0,0,0,0) 58%),radial-gradient(110% 90% at 78% 104%,rgba(124,58,237,.26),rgba(0,0,0,0) 66%),linear-gradient(160deg,#071726 0%,#0a1030 46%,#0d0a24 100%)`)}>
        <span style={css(`position:absolute;inset:-20%;z-index:0;pointer-events:none;background:conic-gradient(from 210deg at 50% 50%,rgba(103,232,249,.12),rgba(37,99,235,.1),rgba(124,58,237,.12),rgba(236,72,153,.09),rgba(103,232,249,.12));filter:blur(90px);opacity:.5;animation:wr-wmdrift 26s ease-in-out infinite`)} />
        <div style={css(`position:relative;z-index:10;height:2px;background:linear-gradient(90deg,transparent,#67e8f9,transparent);background-size:200% 100%;animation:wr-tipsheen 3.4s linear infinite`)} />

        {/* ── Header: who is talking, and where in the scene we are ─────────── */}
        <div style={css(`position:relative;z-index:10;display:flex;align-items:center;gap:14px;padding:clamp(14px,2.2vh,22px) clamp(20px,4vw,58px) 0`)}>
          <ShaneAvatar size={"clamp(46px,5.4vh,60px)"} />
          <div style={css(`flex:1;min-width:0;line-height:1.35`)}>
            <div style={css(`font-size:14.5px;font-weight:800;color:#f1f5f9`)}>{"Shane McCaw"}</div>
            <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa`)}>
              {"Lead M365 Architect · NASA"}
            </div>
          </div>
          <div style={css(`display:flex;flex-direction:column;align-items:flex-end;gap:7px;min-width:190px`)}>
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc`)}>
              <Txt v={b.stepLabel} />
            </div>
            <div style={css(`width:190px;height:3px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
              <div style={css(`height:100%;width:${b.progressPct};border-radius:99px;background:linear-gradient(90deg,#67e8f9,#8B5CF6);box-shadow:0 0 18px rgba(103,232,249,.55);transition:width 520ms cubic-bezier(.22,1,.36,1)`)} />
            </div>
          </div>
        </div>

        {/* ── Stage 1: Shane's introduction / tutorial ──────────────────────── */}
        {b.stage === "intro" && (
          <div style={css(`position:relative;z-index:10;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:clamp(14px,3vh,34px) clamp(20px,4vw,58px)`)}>
            <div key={b.beat?.id} style={css(`width:100%;max-width:820px;display:flex;flex-direction:column;gap:clamp(14px,2.2vh,22px);animation:wr-rise 460ms cubic-bezier(.22,1,.36,1)`)}>
              <div style={css(`font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#7dd3fc`)}>
                <Txt v={b.beat?.tag} />
              </div>
              <div style={css(`font-size:clamp(24px,3.2vw,36px);font-weight:800;letter-spacing:-.025em;line-height:1.15;color:#f8fafc`)}>
                <Txt v={b.beat?.title} />
              </div>
              <div style={css(`display:flex;flex-direction:column;gap:13px;max-width:720px`)}>
                {(b.beat?.lines || []).map((line: unknown, i: number) => (
                  <Line key={i} text={line} />
                ))}
              </div>
              <div style={css(`display:flex;align-items:center;gap:14px;margin-top:clamp(6px,1.4vh,14px)`)}>
                <Hov as="button" onClick={b.onBeatNext} style={css(PRIMARY_BTN)} hoverStyle={css(`filter:brightness(1.09)`)}>
                  <Txt v={b.beatNextLabel} />
                  <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                    <path d={"M5 12h14M13 6l6 6-6 6"} />
                  </svg>
                </Hov>
                {b.canBeatBack && (
                  <Hov as="button" onClick={b.onBeatBack} style={css(GHOST_BTN)} hoverStyle={css(`color:#e2e8f0;border-color:rgba(103,232,249,.6)`)}>
                    {"Back"}
                  </Hov>
                )}
                <div style={css(`display:flex;align-items:center;gap:6px;margin-left:auto`)}>
                  {(b.beatDots || []).map((dot: any, i: number) => (
                    <span key={i} style={css(`width:${dot?.w};height:5px;border-radius:99px;background:${dot?.bg};transition:all 320ms cubic-bezier(.22,1,.36,1)`)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Stage 2: the persona confirmation loop ────────────────────────── */}
        {b.stage === "personas" && (
          <div style={css(`position:relative;z-index:10;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(230px,20vw,300px);gap:clamp(16px,2.4vw,32px);padding:clamp(14px,2.6vh,28px) clamp(20px,4vw,58px)`)}>
            <div style={css(`min-width:0;min-height:0;display:flex;flex-direction:column;gap:13px;overflow:auto`)}>
              <Line text={b.shaneLine} tone={"#9fb3cd"} />

              {p && (
                <div key={p.key} style={css(`display:flex;flex-direction:column;gap:15px;border-radius:20px;border:1px solid ${p.border};background:linear-gradient(158deg,rgba(15,23,42,.92),rgba(2,6,23,.9));box-shadow:0 26px 64px rgba(2,6,23,.6);padding:clamp(16px,2.4vh,24px) clamp(18px,2vw,26px);animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
                  <div style={css(`display:flex;align-items:flex-start;gap:13px`)}>
                    <div style={css(`flex:none;width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#04202a;background:linear-gradient(135deg,#67E8F9,#8B5CF6)`)}>
                      <Txt v={p.initials} />
                    </div>
                    <div style={css(`flex:1;min-width:0`)}>
                      <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc`)}>
                        <Txt v={p.position} />
                      </div>
                      <div style={css(`font-size:21px;font-weight:800;letter-spacing:-.02em;color:#f8fafc;margin-top:2px`)}>
                        <Txt v={p.name} />
                      </div>
                    </div>
                    <span style={css(`flex:none;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border-radius:99px;color:${p.badgeInk};border:1px solid ${p.badgeBorder};background:${p.badgeBg}`)}>
                      <Txt v={p.badge} />
                    </span>
                  </div>

                  <div style={css(`height:1px;background:linear-gradient(90deg,rgba(103,232,249,.35),transparent)`)} />

                  {p.showOwnWords && (
                    <div style={css(`border-radius:14px;border:1px solid rgba(52,211,153,.35);background:rgba(16,64,52,.28);padding:13px 15px;display:flex;flex-direction:column;gap:6px`)}>
                      <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                        {"In your words"}
                      </div>
                      <Line text={p.ownWords} tone={"#d1fae5"} />
                    </div>
                  )}

                  <ProfileRow label={"How I've read it"} text={p.headline} tint={"#7dd3fc"} />
                  <ProfileRow label={"Day to day"} text={p.dayToDay} />
                  <ProfileRow label={"Where Copilot lands"} text={p.copilotFit} />
                  <ProfileRow label={"What to watch for"} text={p.watchFor} tint={"#fca5a5"} />

                  {/* Confirm / reject — the loop's only two answers. */}
                  {p.showChoices && (
                    <div style={css(`display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:4px`)}>
                      <Hov as="button" onClick={b.onConfirm} style={css(PRIMARY_BTN)} hoverStyle={css(`filter:brightness(1.09)`)}>
                        <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                          <path d={"M20 6 9 17l-5-5"} />
                        </svg>
                        {"That's us"}
                      </Hov>
                      <Hov as="button" onClick={b.onReject} style={css(GHOST_BTN)} hoverStyle={css(`color:#fca5a5;border-color:rgba(248,113,113,.55)`)}>
                        {"Not quite"}
                      </Hov>
                      <span style={css(`font-size:11px;color:#64748b`)}>
                        <Txt v={p.attemptNote} />
                      </span>
                    </div>
                  )}

                  {/* Rejected: regenerate, or describe it yourself. */}
                  {p.rejected && (
                    <div style={css(`display:flex;flex-direction:column;gap:12px;border-radius:16px;border:1px solid rgba(248,113,113,.3);background:rgba(60,10,20,.24);padding:14px 16px;animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
                      <Line text={p.rejectLine} tone={"#fecdd3"} />
                      <div style={css(`display:flex;align-items:center;gap:11px;flex-wrap:wrap`)}>
                        {p.canRegen && (
                          <Hov as="button" onClick={b.onRegenerate} style={css(`${GHOST_BTN};color:#7dd3fc;border-color:rgba(103,232,249,.5)`)} hoverStyle={css(`color:#e0f2fe;border-color:rgba(103,232,249,.85)`)}>
                            <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                              <path d={"M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"} />
                            </svg>
                            <Txt v={p.regenLabel} />
                          </Hov>
                        )}
                        {!b.describeOpen && (
                          <Hov as="button" onClick={b.onDescribeOpen} style={css(`${GHOST_BTN};color:#c4b5fd;border-color:rgba(167,139,250,.5)`)} hoverStyle={css(`color:#ede9fe;border-color:rgba(167,139,250,.85)`)}>
                            {"Let me describe it"}
                          </Hov>
                        )}
                      </div>

                      {b.describeOpen && (
                        <div style={css(`display:flex;flex-direction:column;gap:9px`)}>
                          <textarea
                            value={b.describeDraft}
                            onChange={b.onDescribeDraft}
                            placeholder={p.describePlaceholder}
                            rows={4}
                            style={css(`width:100%;resize:vertical;border-radius:12px;border:1px solid rgba(167,139,250,.45);background:rgba(2,6,23,.7);color:#e2e8f0;font-family:inherit;font-size:13.5px;line-height:1.6;padding:11px 13px;outline:none`)}
                          />
                          <div style={css(`display:flex;align-items:center;gap:11px;flex-wrap:wrap`)}>
                            <Hov
                              as="button"
                              onClick={b.onDescribeSave}
                              disabled={!b.describeValid}
                              style={css(`${PRIMARY_BTN};opacity:${b.describeValid ? "1" : ".4"};cursor:${b.describeValid ? "pointer" : "not-allowed"}`)}
                              hoverStyle={css(`filter:brightness(${b.describeValid ? "1.09" : "1"})`)}
                            >
                              {"Use my description"}
                            </Hov>
                            <Hov as="button" onClick={b.onDescribeCancel} style={css(GHOST_BTN)} hoverStyle={css(`color:#e2e8f0`)}>
                              {"Cancel"}
                            </Hov>
                            <span style={css(`font-size:11px;color:#64748b`)}>
                              <Txt v={b.describeHint} />
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Every persona settled — the only path to the room. */}
              {b.complete && (
                <div style={css(`display:flex;flex-direction:column;gap:14px;border-radius:20px;border:1px solid rgba(103,232,249,.4);background:linear-gradient(150deg,rgba(8,42,60,.72),rgba(2,6,23,.86));padding:clamp(16px,2.4vh,24px) clamp(18px,2vw,26px);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
                  <div style={css(`font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#7dd3fc`)}>
                    {"Ready"}
                  </div>
                  <Line text={b.closingLine} tone={"#dbeafe"} />
                  <div>
                    <Hov as="button" onClick={b.onEnter} style={css(`${PRIMARY_BTN};height:42px;font-size:13.5px;animation:wr-heropulse 3s ease-in-out infinite`)} hoverStyle={css(`filter:brightness(1.1)`)}>
                      {"Open the room"}
                      <svg width={"15"} height={"15"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                        <path d={"M5 12h14M13 6l6 6-6 6"} />
                      </svg>
                    </Hov>
                  </div>
                </div>
              )}
            </div>

            {/* Roster rail: who has been settled, and who is still coming. */}
            <div style={css(`min-width:0;display:flex;flex-direction:column;gap:9px;overflow:auto`)}>
              <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#64748b`)}>
                {"Your people"}
              </div>
              {(b.roster || []).map((r: any, i: number) => (
                <div key={i} style={css(`display:flex;align-items:center;gap:10px;border-radius:13px;border:1px solid ${r?.border};background:${r?.bg};padding:9px 11px;opacity:${r?.opacity};transition:all 320ms cubic-bezier(.22,1,.36,1)`)}>
                  <span style={css(`flex:none;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${r?.chipInk};background:${r?.chipBg}`)}>
                    <Txt v={r?.initials} />
                  </span>
                  <span style={css(`flex:1;min-width:0;font-size:12px;font-weight:700;color:${r?.ink};overflow:hidden;text-overflow:ellipsis;white-space:nowrap`)}>
                    <Txt v={r?.name} />
                  </span>
                  <span style={css(`flex:none;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${r?.stateInk}`)}>
                    <Txt v={r?.state} />
                  </span>
                </div>
              ))}
              {b.rosterEmpty && (
                <div style={css(`font-size:11.5px;line-height:1.6;color:#64748b`)}>
                  <Txt v={b.rosterEmptyNote} />
                </div>
              )}
            </div>
          </div>
        )}

        <div style={css(`position:relative;z-index:10;display:flex;align-items:center;gap:10px;padding:0 clamp(20px,4vw,58px) clamp(12px,2vh,20px);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#475569`)}>
          <span style={css(`width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 12px rgba(52,211,153,.8)`)} />
          <Txt v={b.footNote} />
        </div>
      </div>
    </div>
  );
}
