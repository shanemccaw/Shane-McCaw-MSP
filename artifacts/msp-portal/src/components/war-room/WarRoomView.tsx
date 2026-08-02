/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template lines 101-3622 - root stage)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "./runtime";
import { TopologyCanvas } from "./topology/TopologyCanvas";
import { ChatLogPanel } from "./panels/ChatLogPanel";
import { FlightToast } from "./panels/FlightToast";
import { DivePanel } from "./panels/DivePanel";
import { FindingCard } from "./panels/FindingCard";
import { DecisionsBoard } from "./panels/DecisionsBoard";
import { ReadinessPanel } from "./panels/ReadinessPanel";
import { LicensingDive } from "./panels/LicensingDive";
import { PillarDiveEngine } from "./panels/PillarDiveEngine";
import { PreludeScreen } from "./panels/PreludeScreen";
import { ArrivalOverlay } from "./panels/ArrivalOverlay";
import { PickOverlay } from "./panels/PickOverlay";
import { IntroPanel } from "./panels/IntroPanel";
import { ContextPanel } from "./panels/ContextPanel";
import { PillarGhost } from "./panels/PillarGhost";
import { SpeakerBubble } from "./panels/SpeakerBubble";
import { UserSpeakingBubble } from "./panels/UserSpeakingBubble";
import { QaPanel } from "./panels/QaPanel";
import { DemoPanel } from "./panels/DemoPanel";
import { QuantifiedPanel } from "./panels/QuantifiedPanel";
import { PayoffPanel } from "./panels/PayoffPanel";
import { ClosingPanel } from "./panels/ClosingPanel";
import { CardPanel } from "./panels/CardPanel";
import { PersonaPanel } from "./panels/PersonaPanel";
import { TopicPanel } from "./panels/TopicPanel";
import { BoardStrip } from "./panels/BoardStrip";
import { StagedChangesPanel2 } from "./panels/StagedChangesPanel2";
import { SowBoard } from "./panels/SowBoard";
import { PillarBoard } from "./panels/PillarBoard";
import { BoardPanel } from "./panels/BoardPanel";
import { InspectorPanel } from "./panels/InspectorPanel";
import { DocViewerPanel } from "./panels/DocViewerPanel";

/** Root of the War Room stage: ambience layers, topology centre-piece and every overlay panel. */
export function WarRoomView({ v }: { v: any }) {
  return (
    <>
    <div style={css(`position:fixed;inset:0;display:flex;flex-direction:column;animation:${v.roomAnim};background:${v.pillarPulse?.wash};color:#e2e8f0;font-family:Inter,system-ui,sans-serif;overflow:hidden;transition:background 1200ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`position:absolute;inset:0;pointer-events:none;background:${v.ambience};transition:background 1200ms cubic-bezier(.22,1,.36,1)`)} />
      <div style={css(`position:absolute;inset:0;pointer-events:none;background:${v.pillarPulse?.bg};opacity:${v.pillarPulse?.base};animation:${v.pillarPulse?.anim};transition:background 1200ms cubic-bezier(.22,1,.36,1),opacity 900ms ease`)} />
      <div style={css(`position:absolute;inset:0;pointer-events:none;box-shadow:${v.pillarPulse?.rim};transition:box-shadow 1200ms cubic-bezier(.22,1,.36,1)`)} />
      <div style={css(`position:absolute;inset:0;pointer-events:none;opacity:.35;background-image:linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(ellipse 80% 70% at 50% 45%,#000,transparent 75%)`)} />
      <div style={css(`position:absolute;inset:0 0 52% 0;pointer-events:none;opacity:.55;background:linear-gradient(180deg,#03080f 0%,#040d1a 60%,#06172b 100%)`)} />
      <div style={css(`position:absolute;left:0;right:0;top:48%;height:1px;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(103,232,249,.55),transparent);box-shadow:0 0 26px rgba(103,232,249,.45)`)} />
      <div style={css(`position:absolute;left:-30%;right:-30%;top:48%;bottom:-14%;pointer-events:none;transform:translateX(${v.roomFar}) perspective(760px) rotateX(71deg);transition:transform 700ms cubic-bezier(.22,1,.36,1);transform-origin:top center;background-image:linear-gradient(rgba(103,232,249,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(103,232,249,.13) 1px,transparent 1px);background-size:82px 82px;mask-image:linear-gradient(to bottom,#000 4%,rgba(0,0,0,.35) 55%,transparent 92%)`)} />
      <div style={css(`position:absolute;left:0;top:0;bottom:0;width:24%;pointer-events:none;background:linear-gradient(90deg,rgba(2,6,23,.96),rgba(2,6,23,0));mask-image:linear-gradient(90deg,#000,transparent)`)} />
      <div style={css(`position:absolute;right:0;top:0;bottom:0;width:24%;pointer-events:none;background:linear-gradient(270deg,rgba(2,6,23,.96),rgba(2,6,23,0));mask-image:linear-gradient(270deg,#000,transparent)`)} />
      <div style={css(`position:absolute;left:50%;top:0;width:62%;height:34%;pointer-events:none;transform:translateX(-50%);background:radial-gradient(ellipse at 50% 0%,rgba(103,232,249,.16),transparent 68%);filter:blur(14px)`)} />
      <div style={css(`position:absolute;left:50%;top:8px;width:340px;height:5px;pointer-events:none;transform:translateX(-50%);border-radius:99px;background:linear-gradient(90deg,transparent,rgba(125,211,252,.75),transparent);box-shadow:0 0 34px rgba(103,232,249,.6)`)} />
      <div style={css(`position:absolute;left:50%;top:0;width:70%;height:64%;pointer-events:none;transform:translateX(-50%);background:linear-gradient(180deg,rgba(103,232,249,.09),transparent 72%);clip-path:polygon(42% 0,58% 0,96% 100%,4% 100%);filter:blur(16px)`)} />
      <div style={css(`position:absolute;left:6%;top:6%;width:3px;height:38%;pointer-events:none;border-radius:99px;background:linear-gradient(180deg,transparent,rgba(103,232,249,.5),transparent);animation:wr-breathe 6s ease-in-out infinite`)} />
      <div style={css(`position:absolute;right:6%;top:10%;width:3px;height:32%;pointer-events:none;border-radius:99px;background:linear-gradient(180deg,transparent,rgba(103,232,249,.4),transparent);animation:wr-breathe 7.5s ease-in-out infinite`)} />
      <div style={css(`position:absolute;left:14%;top:12%;width:34%;height:34%;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,120,212,.13),transparent 68%);filter:blur(28px);animation:wr-drift 22s ease-in-out infinite`)} />
      <div style={css(`position:absolute;right:12%;top:18%;width:30%;height:30%;pointer-events:none;background:radial-gradient(ellipse at center,rgba(103,232,249,.1),transparent 68%);filter:blur(30px);animation:wr-drift 27s ease-in-out infinite reverse`)} />
      <div style={css(`position:absolute;left:0;right:0;top:30%;height:120px;pointer-events:none;overflow:hidden`)}>
        {" "}
        <div style={css(`width:22%;height:100%;background:linear-gradient(90deg,transparent,rgba(125,211,252,.07),transparent);animation:wr-sweep 14s linear infinite`)} />
        {" "}
      </div>
      <div style={css(`position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 78% 68% at 50% 52%,transparent 42%,rgba(2,6,23,.35) 88%)`)} />
      <div style={css(`position:absolute;left:0;right:0;bottom:0;height:22%;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(2,6,23,.85));transform:translateX(${v.roomNear});transition:transform 700ms cubic-bezier(.22,1,.36,1)`)} />
      <div style={css(`position:fixed;right:18px;bottom:18px;z-index:140;display:flex;flex-direction:column;align-items:flex-end;gap:10px`)}>
        {v.chatOpenLog && <ChatLogPanel v={v} />}
        <Hov as="button" onClick={v.onToggleChatLog} style={css(`position:relative;width:52px;height:52px;border-radius:50%;border:1px solid rgba(103,232,249,.4);cursor:pointer;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(14px);box-shadow:0 16px 40px rgba(2,6,23,.7),0 0 30px rgba(0,120,212,.28);color:#7dd3fc;transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.85);color:#e0f2fe`)}>
          <svg width={"21"} height={"21"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.9"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"} />
          </svg>
          {v.chatHasCount && (
            <>
              {" "}
              <span style={css(`position:absolute;top:-3px;right:-3px;min-width:19px;height:19px;padding:0 5px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;color:#fff;background:#8B5CF6;box-shadow:0 0 14px rgba(139,92,246,.6)`)}>
                <Txt v={v.chatCount} />
              </span>
              {" "}
            </>
          )}
        </Hov>
      </div>
      {v.flight?.show && <FlightToast v={v} />}
      <main data-room={"true"} style={css(`position:relative;z-index:10;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) clamp(196px,17vw,266px);gap:14px;padding:14px 16px`)}>
        {/* CENTER STAGE */}
        <div style={css(`position:relative;z-index:2;display:flex;flex-direction:column;min-height:0;min-width:0`)}>
          <div style={css(`position:absolute;top:0;left:50%;transform:translateX(-50%);z-index:35;display:flex;flex-direction:column;align-items:center;gap:8px;opacity:${v.hostCardOpacity};pointer-events:${v.hostCardEvents};transition:opacity 320ms cubic-bezier(.22,1,.36,1)`)}>
            <div onClick={v.host?.onClick} style={css(`cursor:pointer;display:flex;align-items:center;gap:12px;padding:9px 16px 9px 10px;border-radius:16px;border:1px solid ${v.host?.border};background:${v.host?.bg};box-shadow:${v.host?.glow};transition:all 400ms cubic-bezier(.22,1,.36,1)`)}>
              <div style={css(`width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#0078D4,#67E8F9);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;animation:${v.host?.idle}`)}>
                {"SM"}
              </div>
              <div style={css(`line-height:1.3`)}>
                {" "}
                <div style={css(`font-size:13px;font-weight:700;color:#f1f5f9`)}>
                  {"Shane McCaw"}
                </div>
                {" "}
                <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#60a5fa`)}>
                  {"Lead M365 Architect · NASA"}
                </div>
                {" "}
                <div style={css(`margin-top:3px;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                  {"2026 Forum Award · Copilot at agency scale"}
                </div>
                {" "}
              </div>
            </div>
          </div>
          {v.diveOpen && <DivePanel v={v} />}
          {v.fcard?.show && <FindingCard v={v} />}
          {v.decisionsOpen && <DecisionsBoard v={v} />}
          {v.bangOpen && <ReadinessPanel v={v} />}
          {v.licOpen && <LicensingDive v={v} />}
          {v.govOpen && <PillarDiveEngine v={v} />}
          {v.preludeOpen && <PreludeScreen v={v} />}
          {v.arrivalShow && <ArrivalOverlay v={v} />}
          {v.pickShow && <PickOverlay v={v} />}
          {v.introOpen && <IntroPanel v={v} />}
          {v.ctxOpen && <ContextPanel v={v} />}
          <div style={css(`position:absolute;top:0;right:0;z-index:60;display:flex;align-items:center;gap:7px`)}>
            <Hov as="button" onClick={v.onCtx} style={css(`display:flex;align-items:center;gap:7px;height:32px;padding:0 13px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:#e2e8f0;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.72);backdrop-filter:blur(10px)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6)`)}>
              <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#7dd3fc"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                <path d={"M3 3v18h18"} />
                <path d={"m7 15 4-5 3 3 5-7"} />
              </svg>
              {"Client context "}
            </Hov>
            <Hov as="button" onClick={v.onOpenBoard} style={css(`display:flex;align-items:center;gap:8px;height:32px;padding:0 13px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:#e2e8f0;border:1px solid rgba(52,211,153,.5);background:rgba(6,12,26,.9);backdrop-filter:blur(10px)`)} hoverStyle={css(`border-color:#34d399`)}>
              <span style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                {"NOW"}
              </span>
              <span style={css(`font-size:13px;font-weight:800;color:#64748b;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.before} />
              </span>
              <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#475569"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                <path d={"M5 12h14M13 6l6 6-6 6"} />
              </svg>
              <span style={css(`font-size:15px;font-weight:800;color:${v.bang?.afterColor};font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.after} />
              </span>
            </Hov>
            <div style={css(`position:relative`)}>
              {" "}
              <Hov as="button" onClick={v.onTransportMenu} style={css(`display:flex;align-items:center;gap:8px;height:32px;padding:0 13px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:${v.transportColor};border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.78);backdrop-filter:blur(12px);transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65)`)}>
                <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                  <path d={v.transportIcon} />
                </svg>
                <Txt v={v.transportLabel} />{" "}
                <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`transform:rotate(${v.transportChevron});transition:transform 220ms cubic-bezier(.22,1,.36,1)`)}>
                  <path d={"M6 9l6 6 6-6"} />
                </svg>
              </Hov>
              {" "}
              {v.transportOpen && (
                <>
                  {" "}
                  <div style={css(`position:absolute;top:38px;right:0;z-index:200;width:250px;display:flex;flex-direction:column;padding:6px;border-radius:14px;border:1px solid rgba(103,232,249,.3);background:rgba(2,6,23,.97);backdrop-filter:blur(18px);box-shadow:0 22px 54px rgba(2,6,23,.85);animation:wr-rise 220ms cubic-bezier(.22,1,.36,1)`)}>
                    <Hov as="button" onClick={v.onTransport} style={css(`display:flex;align-items:center;gap:9px;height:34px;padding:0 11px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;text-align:left;color:${v.transportColor};border:none;background:transparent`)} hoverStyle={css(`background:rgba(0,120,212,.16)`)}>
                      <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                        <path d={v.transportIcon} />
                      </svg>
                      <Txt v={v.transportLabel} />{" "}
                    </Hov>
                    <div style={css(`height:1px;margin:5px 4px;background:rgba(30,41,59,.9)`)} />
                    <div style={css(`padding:5px 11px 4px;font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#475569`)}>
                      {"Skip to"}
                    </div>
                    {(v.transportJumps || []).map((j, jIdx) => (
                      <React.Fragment key={jIdx}>
                        {" "}
                        <Hov as="button" onClick={j?.onClick} style={css(`display:flex;align-items:center;gap:9px;height:32px;padding:0 11px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:600;text-align:left;color:${j?.color};border:none;background:${j?.bg}`)} hoverStyle={css(`background:rgba(0,120,212,.16)`)}>
                          <span style={css(`flex:none;width:7px;height:7px;border-radius:99px;background:${j?.dot}`)} />
                          <span style={css(`flex:1`)}>
                            <Txt v={j?.label} />
                          </span>
                        </Hov>
                        {" "}
                      </React.Fragment>
                    ))}
                  </div>
                  {" "}
                </>
              )}
              {" "}
            </div>
          </div>
          <div ref={v.setStage} style={css(`position:relative;flex:1;min-height:200px;overflow:visible;margin:0 0 -10px;display:flex;align-items:center;justify-content:center;overflow:visible`)}>
            <div style={css(`position:absolute;left:50%;top:50%;width:${v.tableSpan};height:${v.tableSpan};transform:translate(calc(-50% + ${v.parFar}),-38%) perspective(1500px) rotateX(74deg);pointer-events:none;transition:transform 500ms cubic-bezier(.22,1,.36,1)`)}>
              {" "}
              <div style={css(`position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at center,rgba(0,120,212,.26),rgba(103,232,249,.08) 48%,transparent 74%);filter:blur(16px)`)} />
              {" "}
              <div style={css(`position:absolute;inset:6%;border-radius:50%;background:linear-gradient(160deg,rgba(15,23,42,.9),rgba(2,6,23,.55) 55%,rgba(0,120,212,.12));backdrop-filter:blur(10px);border:1px solid rgba(103,232,249,.34);box-shadow:0 0 90px rgba(0,120,212,.3),inset 0 0 120px rgba(0,120,212,.18),inset 0 0 0 1px rgba(255,255,255,.03)`)} />
              {" "}
              <div style={css(`position:absolute;inset:6%;border-radius:50%;background:conic-gradient(from 0deg,rgba(103,232,249,.16),transparent 22%,rgba(103,232,249,.12) 48%,transparent 72%,rgba(103,232,249,.16));opacity:.55;mask-image:radial-gradient(circle,transparent 42%,#000 70%,transparent 96%)`)} />
              {" "}
              <div style={css(`position:absolute;inset:26%;border-radius:50%;border:1px solid rgba(103,232,249,.2)`)} />
              {" "}
              <div style={css(`position:absolute;inset:44%;border-radius:50%;border:1px solid rgba(103,232,249,.28);box-shadow:0 0 40px rgba(103,232,249,.35)`)} />
              {" "}
            </div>
            <div style={css(`position:absolute;left:50%;top:50%;width:${v.tableSpan};height:${v.tableSpan};transform:translate(calc(-50% + ${v.parFar}),-38%) perspective(1500px) rotateX(74deg) scale(1.12);pointer-events:none;border-radius:50%;background:radial-gradient(ellipse at center,rgba(103,232,249,.12),transparent 62%);filter:blur(26px);transition:transform 500ms cubic-bezier(.22,1,.36,1)`)} />
            {v.pillarGhost?.show && <PillarGhost v={v} />}
            <div style={css(`position:absolute;left:${v.boundaryX};top:${v.boundaryY};width:${v.boundarySize};height:${v.boundarySize};transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;z-index:1;border:1px dashed rgba(103,232,249,.16);box-shadow:0 0 44px rgba(0,120,212,.1) inset;transition:all 500ms cubic-bezier(.22,1,.36,1)`)} />
            {(v.seats || []).map((p, pIdx) => (
              <React.Fragment key={pIdx}>
                {" "}
                <div style={css(`position:absolute;left:${p?.seatX};top:${p?.seatY};transform:translate(-50%,-50%);z-index:2;display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;opacity:${p?.seatOpacity};transition:all 500ms cubic-bezier(.22,1,.36,1)`)}>
                  <div onClick={p?.onClick} style={css(`display:flex;flex-direction:column;align-items:center;gap:7px;cursor:pointer;pointer-events:auto`)}>
                    <div style={css(`position:relative;width:${p?.avatarSize};height:${p?.avatarSize};border-radius:50%;padding:3px;background:${p?.tile};box-shadow:${p?.seatGlow};transition:all 500ms cubic-bezier(.22,1,.36,1)`)}>
                      {" "}
                      <div style={css(`position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;background:rgba(6,12,26,.96);display:flex;align-items:center;justify-content:center`)}>
                        <span style={css(`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;letter-spacing:.02em;color:#e2e8f0;background:${p?.tile};opacity:.9`)}>
                          <Txt v={p?.initials} />
                        </span>
                        <ImageSlot id={p?.slotId} shape={"circle"} src={p?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                      </div>
                      {" "}
                      <span style={css(`position:absolute;top:-3px;right:-3px;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${p?.roleColor};box-shadow:0 0 12px ${p?.roleColor}aa`)}>
                        <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                          <path d={p?.badgeIcon} />
                        </svg>
                      </span>
                      {" "}
                    </div>
                    <div style={css(`display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;white-space:nowrap;border:1px solid ${p?.seatBorder};background:rgba(3,8,20,.9);box-shadow:${p?.plateGlow};transition:all 500ms cubic-bezier(.22,1,.36,1)`)}>
                      <span style={css(`width:7px;height:7px;border-radius:50%;background:${p?.roleColor};box-shadow:0 0 8px ${p?.roleColor}`)} />
                      <span style={css(`font-size:11px;font-weight:800;letter-spacing:.01em;color:${p?.nameColor}`)}>
                        <Txt v={p?.first} />
                      </span>
                    </div>
                    <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;color:${p?.roleCaption}`)}>
                      <Txt v={p?.roleShort} />
                    </div>
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
            <div ref={v.setMapBox} style={css(`position:relative;flex:none;width:${v.mapSize};height:${v.mapSize};flex:none;display:flex;align-items:center;justify-content:center;transform:${v.mapTransform};transition:transform 900ms cubic-bezier(.22,1,.36,1)`)}>
              <TopologyCanvas embed={true} findings={v.mapFindings} onFinding={v.onMapFinding} pillarBadges={v.mapBadges} onPillar={v.onMapPillar} scenario={v.mapScenario} baseline={v.mapBaseline} projected={v.mapProjected} focusNode={v.mapFocusNode} focusPillar={v.mapFocusPillar} sweep={v.mapSweep} pins={v.mapPins} blast={v.mapBlast} blastData={v.mapBlastData} outcome={v.mapOutcome} style={css(`width:100%;height:100%`)} />
            </div>
            {v.bubble && <SpeakerBubble v={v} />}
          </div>
          <div style={css(`position:relative;z-index:35;flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:10px;padding-top:4px`)}>
            {v.userSpeaking && <UserSpeakingBubble v={v} />}
            {v.qaOpen && <QaPanel v={v} />}
            {v.showDemo && <DemoPanel v={v} />}
            {v.showQuantified && <QuantifiedPanel v={v} />}
            {v.showPayoff && <PayoffPanel v={v} />}
            {v.closing && <ClosingPanel v={v} />}
            {v.card && <CardPanel v={v} />}
            {v.personaPanel && <PersonaPanel v={v} />}
            {v.topic && <TopicPanel v={v} />}
            <div style={css(`position:relative;display:flex;flex-direction:column;gap:8px;width:min(520px,100%);margin-left:auto`)}>
              <div style={css(`display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:14px;border:1px solid rgba(103,232,249,.3);background:linear-gradient(160deg,rgba(15,23,42,.88),rgba(2,6,23,.8));backdrop-filter:blur(14px);box-shadow:0 18px 48px rgba(2,6,23,.65),0 0 46px rgba(0,120,212,.16),inset 0 0 40px rgba(0,120,212,.06)`)}>
                <span style={css(`flex:none;display:flex;flex-direction:column;align-items:center;gap:3px`)}>
                  <span style={css(`width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#1e293b,#334155);border:1px solid rgba(103,232,249,.35);display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;color:#7dd3fc`)}>
                    {"YOU"}
                  </span>
                </span>
                <textarea value={v.draft} onChange={v.onDraft} onKeyDown={v.onDraftKey} rows={"1"} placeholder={v.composerPlaceholder} style={css(`flex:1;min-width:0;height:32px;max-height:80px;padding:7px 11px;border-radius:9px;resize:none;outline:none;font-family:inherit;font-size:12.5px;line-height:1.4;color:#e2e8f0;border:1px solid rgba(51,65,85,.7);background:rgba(2,6,23,.65)`)} />
                <Hov as="button" style={css(`flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7dd3fc;border:1px solid rgba(103,232,249,.28);background:rgba(2,6,23,.65)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6)`)}>
                  <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                    <path d={"M12 19v3"} />
                    <path d={"M19 10v2a7 7 0 0 1-14 0v-2"} />
                    <rect x={"9"} y={"2"} width={"6"} height={"13"} rx={"3"} />
                  </svg>
                </Hov>
                <Hov as="button" onClick={v.onSend} style={css(`flex:none;display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:#0078D4;box-shadow:0 8px 24px rgba(0,120,212,.35);transition:background 180ms ease`)} hoverStyle={css(`background:#2563eb`)}>
                  {"Send "}
                  <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                    <path d={"m22 2-7 20-4-9-9-4Z"} />
                    <path d={"M22 2 11 13"} />
                  </svg>
                </Hov>
              </div>
            </div>
          </div>
        </div>
        {/* RIGHT DOCK */}
        <div style={css(`position:relative;z-index:30;display:flex;flex-direction:column;gap:9px;min-height:0;max-height:calc(100% - 74px);overflow-y:auto;overflow-x:hidden;padding-right:4px`)}>
          {v.showBoard && <BoardStrip v={v} />}
          {v.gov?.staged?.show && <StagedChangesPanel2 v={v} />}
          {v.sowBoard?.show && <SowBoard v={v} />}
          {v.pillarBoard?.show && <PillarBoard v={v} />}
          {v.boardOpen && <BoardPanel v={v} />}
        </div>
        <div style={css(`position:absolute;inset:-20px;z-index:1;pointer-events:none;background:#01050f;opacity:${v.veilOpacity};transition:opacity 600ms cubic-bezier(.22,1,.36,1)`)} />
      </main>
      {/* NODE INSPECTOR */}
      {v.inspector && <InspectorPanel v={v} />}
      {v.docOpen && <DocViewerPanel v={v} />}
    </div>
    </>
  );
}
