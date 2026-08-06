/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `preludeOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "../runtime";
import { useVersionInfo } from "../../../hooks/useVersionInfo";
import { resolvePreludeCustomerName } from "../warRoomIdentity";

export function PreludeScreen({ v }: { v: any }) {
  const versionInfo = useVersionInfo();
  return (
    <>
    {" "}
    <div style={css(`position:fixed;inset:0;z-index:300;display:flex;background:radial-gradient(120% 90% at 50% 0%,rgba(103,232,249,.2),rgba(6,10,30,.99) 62%);animation:${v.preludeAnim}`)}>
      <div style={css(`position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(90% 70% at 8% 4%,rgba(103,232,249,.3),rgba(0,0,0,0) 62%),radial-gradient(85% 75% at 96% 12%,rgba(236,72,153,.16),rgba(0,0,0,0) 58%),radial-gradient(110% 90% at 78% 104%,rgba(124,58,237,.28),rgba(0,0,0,0) 66%),radial-gradient(80% 60% at 40% 60%,rgba(37,99,235,.2),rgba(0,0,0,0) 70%),linear-gradient(160deg,#071726 0%,#0a1030 46%,#0d0a24 100%)`)}>
        <span style={css(`position:absolute;inset:-20%;z-index:0;pointer-events:none;background:conic-gradient(from 210deg at 50% 50%,rgba(103,232,249,.12),rgba(37,99,235,.1),rgba(124,58,237,.12),rgba(236,72,153,.09),rgba(103,232,249,.12));filter:blur(90px);opacity:.55;animation:wr-wmdrift 26s ease-in-out infinite`)} />
        <div style={css(`position:relative;z-index:10;height:2px;background:linear-gradient(90deg,transparent,#67e8f9,transparent);background-size:200% 100%;animation:wr-tipsheen 3.4s linear infinite`)} />
        {v.heroOpen && (
          <>
            {" "}
            <div style={css(`position:absolute;inset:0;z-index:6;pointer-events:none;overflow:hidden`)}>
              {" "}
              <div style={css(`position:absolute;left:14%;top:-12%;width:16%;height:96%;background:linear-gradient(180deg,rgba(59,130,246,.24),rgba(59,130,246,0));filter:blur(26px);animation:wr-beamsweep 11s ease-in-out infinite`)} />
              {" "}
              <div style={css(`position:absolute;left:44%;top:-16%;width:12%;height:104%;background:linear-gradient(180deg,rgba(139,92,246,.22),rgba(139,92,246,0));filter:blur(30px);animation:wr-beamsweep 14s ease-in-out 1.5s infinite`)} />
              {" "}
              <div style={css(`position:absolute;right:16%;top:-10%;width:14%;height:92%;background:linear-gradient(180deg,rgba(103,232,249,.2),rgba(103,232,249,0));filter:blur(28px);animation:wr-beamsweep 13s ease-in-out .8s infinite`)} />
              {" "}
              <div style={css(`position:absolute;left:50%;bottom:-16%;width:min(120%,900px);height:340px;transform:translate(-50%,0);border-radius:50%;background:radial-gradient(closest-side,rgba(59,130,246,.22),rgba(5,7,13,0) 72%)`)} />
              {" "}
              <div style={css(`position:absolute;left:50%;bottom:-4%;width:min(90%,640px);height:220px;border-radius:50%;border:1px solid rgba(103,232,249,.35);animation:wr-floorpulse 5.4s cubic-bezier(.22,1,.36,1) infinite`)} />
              {" "}
              <div style={css(`position:absolute;left:50%;bottom:-4%;width:min(90%,640px);height:220px;border-radius:50%;border:1px solid rgba(139,92,246,.28);animation:wr-floorpulse 5.4s cubic-bezier(.22,1,.36,1) 1.8s infinite`)} />
              {" "}
              <div style={css(`position:absolute;left:50%;bottom:-4%;width:min(90%,640px);height:220px;border-radius:50%;border:1px solid rgba(59,130,246,.22);animation:wr-floorpulse 5.4s cubic-bezier(.22,1,.36,1) 3.6s infinite`)} />
              {" "}
              {(v.dust || []).map((dd, ddIdx) => (
                <React.Fragment key={ddIdx}>
                  {" "}
                  <svg viewBox={"0 0 24 24"} fill={"none"} stroke={dd?.c} strokeWidth={"1.6"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`position:absolute;left:${dd?.x};bottom:${dd?.b};width:${dd?.s};height:${dd?.s};filter:drop-shadow(0 0 6px ${dd?.c});animation:wr-twinkle ${dd?.dur} ease-in-out ${dd?.delay} infinite`)}>
                    {" "}
                    <path d={"M12 2.5 14.2 8.9 20.6 11 14.2 13.1 12 19.5 9.8 13.1 3.4 11 9.8 8.9z"} />
                    {" "}
                  </svg>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
            </div>
            {" "}
            <div style={css(`position:relative;z-index:10;flex:1;min-height:0;display:grid;grid-template-columns:clamp(300px,26vw,380px) minmax(0,1fr) clamp(228px,19vw,282px);gap:clamp(14px,2vw,24px);padding:clamp(14px,2.4vh,26px) clamp(18px,3vw,46px)`)}>
              <div style={css(`position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;gap:clamp(10px,1.8vh,18px)`)}>
                <div style={css(`display:flex;align-items:center;gap:13px;animation:wr-rise 700ms cubic-bezier(.22,1,.36,1)`)}>
                  <div style={css(`position:relative;flex:none;width:clamp(58px,7vh,76px);height:clamp(58px,7vh,76px);transform-origin:50% 88%;animation:wr-speakgesture 4.4s cubic-bezier(.4,0,.35,1) infinite`)}>
                    {" "}
                    <span style={css(`position:absolute;inset:-18%;border-radius:50%;border:1px solid rgba(103,232,249,.28);animation:wr-ringpulse 4s cubic-bezier(.22,1,.36,1) infinite`)} />
                    {" "}
                    <span style={css(`position:absolute;inset:-38%;border-radius:50%;background:radial-gradient(closest-side,rgba(139,92,246,.5),rgba(5,7,13,0) 72%);animation:wr-holobreath 5s ease-in-out infinite`)} />
                    {" "}
                    <span style={css(`position:absolute;inset:0;border-radius:50%;overflow:hidden;border:1.5px solid rgba(103,232,249,.6);animation:wr-holoflicker 6s ease-in-out infinite,wr-speakglow 4.4s cubic-bezier(.4,0,.35,1) infinite`)}>
                      {" "}
                      <ImageSlot id={"hero-shane"} shape={"circle"} src={"avatars/shane.png"} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                      {" "}
                      <span style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(103,232,249,.18) 0px,rgba(103,232,249,.18) 1px,transparent 1px,transparent 4px);mix-blend-mode:screen`)} />
                      {" "}
                      <span style={css(`position:absolute;inset:0;pointer-events:none;background:linear-gradient(160deg,rgba(59,130,246,.3),rgba(139,92,246,.24));mix-blend-mode:color`)} />
                      {" "}
                      <span style={css(`position:absolute;left:0;right:0;height:24%;pointer-events:none;background:linear-gradient(180deg,rgba(165,243,252,0),rgba(165,243,252,.26),rgba(165,243,252,0));animation:wr-holoscan 3.2s linear infinite`)} />
                      {" "}
                    </span>
                    {" "}
                  </div>
                  <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:3px`)}>
                    <span style={css(`font-size:clamp(15px,1.6vw,19px);font-weight:800;letter-spacing:-.02em;color:#b3bfd2`)}>
                      {"Shane"}
                    </span>
                    <div style={css(`display:flex;align-items:center;gap:8px`)}>
                      <span style={css(`display:flex;align-items:center;gap:2px;height:11px`)}>
                        <span style={css(`width:2px;height:100%;border-radius:99px;background:#67e8f9;box-shadow:0 0 6px #67e8f9;animation:wr-voicebar .62s ease-in-out infinite`)} />
                        <span style={css(`width:2px;height:100%;border-radius:99px;background:#67e8f9;box-shadow:0 0 6px #67e8f9;animation:wr-voicebar .62s ease-in-out .1s infinite`)} />
                        <span style={css(`width:2px;height:100%;border-radius:99px;background:#a5f3fc;box-shadow:0 0 6px #67e8f9;animation:wr-voicebar .62s ease-in-out .2s infinite`)} />
                        <span style={css(`width:2px;height:100%;border-radius:99px;background:#67e8f9;box-shadow:0 0 6px #67e8f9;animation:wr-voicebar .62s ease-in-out .32s infinite`)} />
                        <span style={css(`width:2px;height:100%;border-radius:99px;background:#67e8f9;box-shadow:0 0 6px #67e8f9;animation:wr-voicebar .62s ease-in-out .44s infinite`)} />
                      </span>
                      <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9`)}>
                        {"Speaking"}
                      </span>
                    </div>
                  </div>
                </div>
                <div ref={v.setHeroThread} style={css(`flex:1;min-height:0;overflow-y:auto;overflow-x:clip;display:flex;flex-direction:column;justify-content:flex-start;gap:clamp(7px,1.2vh,12px);padding-right:6px;max-width:62ch`)}>
                  {(v.heroThread || []).map((hm, hmIdx) => (
                    <React.Fragment key={hmIdx}>
                      {" "}
                      <div style={css(`animation:wr-heroin 420ms cubic-bezier(.33,0,.2,1)`)}>
                        {" "}
                        {hm?.isShane && (
                          <>
                            {" "}
                            <div style={css(`display:flex;gap:10px;align-items:flex-start`)}>
                              <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;overflow:hidden;opacity:${hm?.avatarOp};border:1px solid rgba(103,232,249,.34);box-shadow:0 0 14px rgba(0,180,216,.24)`)}>
                                {" "}
                                <ImageSlot id={"hero-msg-shane"} shape={"rounded"} radius={"9"} src={"avatars/shane.png"} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                                {" "}
                              </span>
                              <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px`)}>
                                {hm?.showName && (
                                  <>
                                    {" "}
                                    <span style={css(`font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#67e8f9`)}>
                                      {"Shane McCaw"}
                                    </span>
                                    {" "}
                                  </>
                                )}
                                <div style={css(`align-self:flex-start;max-width:94%;padding:10px 14px;border-radius:${hm?.radius};border:1px solid ${hm?.border};background:${hm?.bg};box-shadow:${hm?.shadow}`)}>
                                  {" "}
                                  <span style={css(`display:block;font-size:${hm?.size};font-weight:${hm?.weight};letter-spacing:-.01em;line-height:1.5;color:${hm?.tone};text-shadow:${hm?.textGlow};text-wrap:pretty`)}>
                                    <Txt v={hm?.text} />
                                  </span>
                                  {" "}
                                </div>
                              </div>
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {hm?.isWrap && (
                          <>
                            {" "}
                            <div style={css(`position:relative;margin:6px 0;border-radius:16px;overflow:hidden;border:1px solid rgba(103,232,249,.32);background:linear-gradient(160deg,rgba(15,23,42,.94),rgba(2,6,23,.92));backdrop-filter:blur(14px);box-shadow:0 18px 50px rgba(2,6,23,.6),0 0 34px rgba(0,120,212,.14)`)}>
                              {" "}
                              <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,#67e8f9,transparent)`)} />
                              {" "}
                              <div style={css(`padding:14px 16px 10px;display:flex;flex-direction:column;gap:5px`)}>
                                <span style={css(`font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9`)}>
                                  {"What you told me"}
                                </span>
                                <span style={css(`font-size:12.5px;line-height:1.6;color:#a9b6c9;text-wrap:pretty`)}>
                                  {"Thanks for telling me about you — that's everything I need. Now let's go meet your personas and learn about your tenant."}
                                </span>
                              </div>
                              {" "}
                              <div style={css(`border-top:1px solid rgba(30,41,59,.9)`)}>
                                {" "}
                                {(hm?.wrapRows || []).map((wr, wrIdx) => (
                                  <React.Fragment key={wrIdx}>
                                    {" "}
                                    <div style={css(`display:flex;align-items:flex-start;gap:10px;padding:8px 16px;border-bottom:1px solid rgba(30,41,59,.55)`)}>
                                      <span style={css(`flex:none;width:88px;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748b;padding-top:2px`)}>
                                        <Txt v={wr?.l} />
                                      </span>
                                      <span style={css(`flex:1;min-width:0;font-size:11.5px;line-height:1.45;color:#b3bfd2;text-wrap:pretty`)}>
                                        <Txt v={wr?.v} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                                {" "}
                              </div>
                              {" "}
                              <div style={css(`padding:11px 16px;display:flex;justify-content:flex-end;background:rgba(2,6,23,.5)`)}>
                                <Hov as="button" onClick={v.onHeroEnter} style={css(`display:flex;align-items:center;gap:8px;height:34px;padding:0 17px;border-radius:99px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;color:#04283a;background:linear-gradient(120deg,#67e8f9,#a78bfa);box-shadow:0 0 26px rgba(103,232,249,.4)`)} hoverStyle={css(`filter:brightness(1.08)`)}>
                                  {" Let's go to the meeting room "}
                                  <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                    <path d={"M5 12h14M13 6l6 6-6 6"} />
                                  </svg>
                                </Hov>
                              </div>
                              {" "}
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {hm?.isProfile && (
                          <>
                            {" "}
                            <div style={css(`position:relative;margin:6px 0;border-radius:16px;overflow:hidden;border:1px solid rgba(103,232,249,.32);background:linear-gradient(160deg,rgba(15,23,42,.94),rgba(2,6,23,.92));backdrop-filter:blur(14px);box-shadow:0 18px 50px rgba(2,6,23,.6),0 0 34px rgba(0,120,212,.14)`)}>
                              {" "}
                              <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,#67e8f9,transparent)`)} />
                              {" "}
                              <div style={css(`display:flex;align-items:center;gap:13px;padding:14px 16px 12px`)}>
                                <span style={css(`flex:none;width:52px;height:52px;border-radius:14px;overflow:hidden;border:1px solid rgba(103,232,249,.4);box-shadow:0 0 22px rgba(0,180,216,.3)`)}>
                                  {" "}
                                  <ImageSlot id={"hero-profile-shane"} shape={"rounded"} radius={"13"} src={"avatars/shane.png"} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                                  {" "}
                                </span>
                                <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                                  <span style={css(`font-size:15px;font-weight:800;letter-spacing:-.02em;color:#b3bfd2`)}>
                                    {"Shane McCaw"}
                                  </span>
                                  <span style={css(`font-size:10.5px;font-weight:700;color:#7dd3fc`)}>
                                    {"Lead M365 Architect · NASA"}
                                  </span>
                                  <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                                    {"30 years in the Microsoft ecosystem"}
                                  </span>
                                </div>
                              </div>
                              {" "}
                              <div style={css(`padding:0 16px 12px`)}>
                                {" "}
                                <span style={css(`display:block;font-size:12px;line-height:1.6;color:#a9b6c9;text-wrap:pretty`)}>
                                  {"I wrote the governance framework NASA distributed agency-wide, and I deployed Copilot to the largest agency in the US federal government. My job today is not to sell you a licence — it is to show you what your own tenant already told us, and let the people who live in it do the talking."}
                                </span>
                                {" "}
                              </div>
                              {" "}
                              <div style={css(`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid rgba(30,41,59,.9)`)}>
                                <div style={css(`padding:10px 12px;border-right:1px solid rgba(30,41,59,.9)`)}>
                                  {" "}
                                  <div style={css(`font-size:16px;font-weight:800;color:#a8b4c8;font-variant-numeric:tabular-nums`)}>
                                    {"150+"}
                                  </div>
                                  {" "}
                                  <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                                    {"endpoints read"}
                                  </div>
                                  {" "}
                                </div>
                                <div style={css(`padding:10px 12px;border-right:1px solid rgba(30,41,59,.9)`)}>
                                  {" "}
                                  <div style={css(`font-size:16px;font-weight:800;color:#a8b4c8;font-variant-numeric:tabular-nums`)}>
                                    {"7"}
                                  </div>
                                  {" "}
                                  <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                                    {"pillars scored"}
                                  </div>
                                  {" "}
                                </div>
                                <div style={css(`padding:10px 12px`)}>
                                  {" "}
                                  <div style={css(`font-size:16px;font-weight:800;color:#a8b4c8;font-variant-numeric:tabular-nums`)}>
                                    {"9"}
                                  </div>
                                  {" "}
                                  <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                                    {"documents"}
                                  </div>
                                  {" "}
                                </div>
                              </div>
                              {" "}
                              <div style={css(`padding:9px 16px;border-top:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                                {" "}
                                <span style={css(`font-size:9.5px;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                                  {"read-only · nothing written · document contents never read"}
                                </span>
                                {" "}
                              </div>
                              {" "}
                              <div style={css(`display:flex;flex-wrap:wrap;gap:8px;padding:11px 16px;border-top:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.34)`)}>
                                <Hov as="button" onClick={hm?.onAsk} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:#9fb3cc;border:1px solid rgba(103,232,249,.28);background:rgba(2,6,23,.55)`)} hoverStyle={css(`color:#cfe6f5;border-color:rgba(103,232,249,.6)`)}>
                                  {"Ask a question"}
                                </Hov>
                                <span style={css(`flex:1`)} />
                                <Hov as="button" onClick={hm?.onGo} style={css(`flex:none;height:30px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#04283a;background:linear-gradient(135deg,#0078D4,#00B4D8);box-shadow:0 0 18px rgba(0,180,216,.32)`)} hoverStyle={css(`filter:brightness(1.12)`)}>
                                  {"Nice to meet you — let's continue"}
                                </Hov>
                              </div>
                              {" "}
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {hm?.isYou && (
                          <>
                            {" "}
                            <div style={css(`display:flex;gap:10px;align-items:flex-start`)}>
                              <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#bfdcec;border:1px solid rgba(103,232,249,.3);background:linear-gradient(135deg,rgba(30,41,59,.9),rgba(2,6,23,.9))`)}>
                                {"YOU"}
                              </span>
                              <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px`)}>
                                <span style={css(`font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7f8ca5`)}>
                                  {"You"}
                                </span>
                                <div style={css(`align-self:flex-start;max-width:94%;width:fit-content;padding:8px 15px;border-radius:4px 16px 16px 16px;border:1px solid rgba(103,232,249,.3);background:rgba(103,232,249,.1)`)}>
                                  {" "}
                                  <span style={css(`display:block;font-size:clamp(11.5px,1.1vw,13.5px);line-height:1.5;color:#bfdcec;text-wrap:pretty`)}>
                                    <Txt v={hm?.text} />
                                  </span>
                                  {" "}
                                </div>
                              </div>
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {hm?.neverScan && (
                          <>
                            {" "}
                            <div style={css(`position:relative;display:flex;flex-direction:column;gap:8px;padding:clamp(10px,1.4vh,14px) clamp(13px,1.4vw,17px);border-radius:14px;border:1px solid ${hm?.scan?.c}55;background:linear-gradient(140deg,${hm?.scan?.c}18,rgba(5,7,13,.6));backdrop-filter:blur(10px);box-shadow:0 0 44px ${hm?.scan?.c}2b;animation:${hm?.scan?.pulse}`)}>
                              <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,${hm?.scan?.c},transparent)`)} />
                              <div style={css(`display:flex;align-items:center;gap:9px`)}>
                                <span style={css(`flex:none;width:7px;height:7px;border-radius:99px;background:${hm?.scan?.c};box-shadow:0 0 12px ${hm?.scan?.c}`)} />
                                <span style={css(`flex:1;min-width:0;font-size:clamp(11.5px,1.15vw,13.5px);font-weight:800;letter-spacing:-.01em;color:#b3bfd2`)}>
                                  <Txt v={hm?.scan?.t} />{" — "}<Txt v={hm?.scan?.sub} />
                                </span>
                                <span style={css(`flex:none;font-size:8px;font-weight:800;letter-spacing:.14em;color:${hm?.scan?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                  <Txt v={hm?.scan?.state} />
                                </span>
                              </div>
                              <div style={css(`display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:4px 12px`)}>
                                {(hm?.scan?.checks || []).map((hc, hcIdx) => (
                                  <React.Fragment key={hcIdx}>
                                    {" "}
                                    <div style={css(`display:flex;align-items:center;gap:7px;opacity:${hc?.op};transition:opacity 600ms ease`)}>
                                      <span style={css(`flex:none;width:10px;height:10px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:1.2px solid ${hc?.c}`)}>
                                        <svg width={"6"} height={"6"} viewBox={"0 0 24 24"} fill={"none"} stroke={hc?.c} strokeWidth={"5"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`opacity:${hc?.tick}`)}>
                                          <path d={"M20 6L9 17l-5-5"} />
                                        </svg>
                                      </span>
                                      <span style={css(`flex:1;min-width:0;font-size:9.5px;color:${hc?.c};text-wrap:pretty`)}>
                                        <Txt v={hc?.v} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {hm?.scan?.findShow && (
                                <>
                                  {" "}
                                  <div style={css(`display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:7px;border-top:1px solid rgba(103,232,249,.18)`)}>
                                    <span style={css(`font-size:15px;font-weight:800;color:${hm?.scan?.scoreColor};font-variant-numeric:tabular-nums`)}>
                                      <Txt v={hm?.scan?.score} />
                                    </span>
                                    {(hm?.scan?.find || []).map((hf, hfIdx) => (
                                      <React.Fragment key={hfIdx}>
                                        {" "}
                                        <span style={css(`font-size:9px;font-weight:700;padding:3px 9px;border-radius:999px;color:${hm?.scan?.c};border:1px solid ${hm?.scan?.c}55;background:${hm?.scan?.c}14`)}>
                                          <Txt v={hf?.v} />
                                        </span>
                                        {" "}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                  {" "}
                                </>
                              )}
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                      </div>
                      {" "}
                    </React.Fragment>
                  ))}
                  {v.heroNever && (
                    <>
                      {" "}
                      <Hov as="button" onClick={v.onHeroEnter} style={css(`align-self:flex-start;display:flex;align-items:center;gap:9px;height:clamp(34px,4.2vh,40px);padding:0 clamp(17px,1.9vw,24px);border-radius:99px;border:none;cursor:pointer;font-family:inherit;font-size:clamp(12.5px,1.2vw,14px);font-weight:800;color:#04202a;background:linear-gradient(135deg,#67e8f9,#3B82F6);box-shadow:0 0 42px rgba(59,130,246,.55);animation:wr-heropulse 3s ease-in-out infinite`)} hoverStyle={css(`filter:brightness(1.1)`)}>
                        {" Take a look "}
                        <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                          <path d={"M5 12h14M13 6l6 6-6 6"} />
                        </svg>
                      </Hov>
                      {" "}
                    </>
                  )}
                </div>
                {v.heroHasOpts && (
                  <>
                    {" "}
                    <div style={css(`position:relative;display:flex;flex-direction:column;gap:9px;padding:clamp(12px,1.6vh,16px) clamp(14px,1.5vw,18px);border-radius:14px;border:1px solid rgba(103,232,249,.3);background:linear-gradient(140deg,rgba(103,232,249,.07),rgba(5,7,13,.55));backdrop-filter:blur(10px);box-shadow:0 0 50px rgba(59,130,246,.16);animation:wr-tilelock 560ms cubic-bezier(.22,1,.36,1)`)}>
                      <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,#67e8f9,transparent)`)} />
                      <div style={css(`display:flex;align-items:center;gap:8px`)}>
                        <span style={css(`width:5px;height:5px;border-radius:99px;background:#67e8f9;box-shadow:0 0 8px #67e8f9`)} />
                        <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#a5f3fc`)}>
                          <Txt v={v.heroOpts?.label || "Options"} />
                        </span>
                        <span style={css(`font-size:9px;font-weight:700;color:#a5b4fc;font-family:ui-monospace,Menlo,monospace`)}>
                          <Txt v={v.heroOpts?.count} />
                        </span>
                      </div>
                      <div style={css(`display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:7px`)}>
                        {(v.heroOpts?.items || []).map((ho, hoIdx) => (
                          <React.Fragment key={hoIdx}>
                            {" "}
                            <Hov as="div" onClick={ho?.onClick} style={css(`display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;cursor:pointer;border:1px solid ${ho?.border};background:${ho?.bg};box-shadow:${ho?.glow};transition:all 260ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6)`)}>
                              <span style={css(`position:relative;flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid rgba(103,232,249,.4);background:rgba(103,232,249,.1)`)}>
                                <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#a5f3fc"} strokeWidth={"1.9"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                  <path d={ho?.icon} />
                                </svg>
                              </span>
                              <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:1px`)}>
                                <span style={css(`font-size:11.5px;font-weight:700;color:${ho?.tone};text-wrap:pretty`)}>
                                  <Txt v={ho?.v} />
                                </span>
                                <span style={css(`font-size:9px;color:#a5b4fc;text-wrap:pretty`)}>
                                  <Txt v={ho?.d} />
                                </span>
                              </span>
                              <span style={css(`flex:none;width:15px;height:15px;border-radius:5px;display:flex;align-items:center;justify-content:center;border:1.5px solid rgba(103,232,249,.5);background:rgba(103,232,249,.12)`)}>
                                <svg width={"9"} height={"9"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#67e8f9"} strokeWidth={"3.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`opacity:${ho?.tick};transition:opacity 200ms ease`)}>
                                  <path d={"M20 6L9 17l-5-5"} />
                                </svg>
                              </span>
                            </Hov>
                            {" "}
                          </React.Fragment>
                        ))}
                      </div>
                      <div style={css(`height:32px;display:flex;align-items:center`)}>
                        <Hov as="button" onClick={v.heroOpts?.onConfirm} disabled={v.heroOpts?.notReady} style={css(`display:flex;align-items:center;gap:8px;height:32px;padding:0 16px;border-radius:99px;border:none;cursor:${v.heroOpts?.cursor};font-family:inherit;font-size:12px;font-weight:800;color:${v.heroOpts?.ctaText};background:${v.heroOpts?.ctaBg};box-shadow:${v.heroOpts?.ctaGlow};opacity:${v.heroOpts?.ctaOp};transition:all 300ms cubic-bezier(.33,0,.2,1)`)} hoverStyle={css(`filter:brightness(1.1)`)}>
                          {" "}<Txt v={v.heroOpts?.ctaLabel} />{" "}
                          <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                            <path d={"M5 12h14M13 6l6 6-6 6"} />
                          </svg>
                        </Hov>
                      </div>
                    </div>
                    {" "}
                  </>
                )}
                {v.heroDock?.show && (
                  <>
                    {" "}
                    <div style={css(`flex:none;display:flex;flex-direction:column;gap:7px;padding:10px 12px;margin-bottom:2px;border-radius:14px;border:1px solid rgba(103,232,249,.24);background:linear-gradient(160deg,rgba(15,23,42,.92),rgba(2,6,23,.9));backdrop-filter:blur(12px);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
                      <span style={css(`font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#5f6c85`)}>
                        <Txt v={v.heroDock?.lead} />
                      </span>
                      <div style={css(`display:flex;flex-wrap:wrap;gap:7px`)}>
                        {(v.heroDock?.chips || []).map((ch, chIdx) => (
                          <React.Fragment key={chIdx}>
                            {" "}
                            <Hov as="button" onClick={ch?.onClick} style={css(`height:30px;padding:0 14px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;white-space:nowrap;color:${ch?.color};border:1px solid ${ch?.border};background:${ch?.bg};transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`color:#dbe3ee;border-color:rgba(103,232,249,.7)`)}>
                              <Txt v={ch?.l} />
                            </Hov>
                            {" "}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    {" "}
                  </>
                )}
                {v.heroHintsShow && (
                  <>
                    {" "}
                    <div style={css(`display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px`)}>
                      {(v.heroHints || []).map((hh, hhIdx) => (
                        <React.Fragment key={hhIdx}>
                          {" "}
                          <Hov as="button" onClick={hh?.onClick} style={css(`height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:#9fd8ea;border:1px solid rgba(103,232,249,.34);background:rgba(0,120,212,.12);transition:all 200ms ease`)} hoverStyle={css(`color:#e0f2fe;border-color:rgba(103,232,249,.7);background:rgba(0,120,212,.24)`)}>
                            <Txt v={hh?.l} />
                          </Hov>
                          {" "}
                        </React.Fragment>
                      ))}
                    </div>
                    {" "}
                  </>
                )}
                <div style={css(`display:flex;align-items:center;gap:10px;padding:clamp(7px,1vh,10px) 10px clamp(7px,1vh,10px) clamp(16px,1.8vw,20px);border-radius:99px;border:1px solid rgba(103,232,249,.28);background:linear-gradient(100deg,rgba(59,130,246,.1),rgba(5,7,13,.5));backdrop-filter:blur(10px);box-shadow:0 0 44px rgba(59,130,246,.18);animation:wr-rise 700ms cubic-bezier(.22,1,.36,1) 1.2s backwards`)}>
                  <svg width={"15"} height={"15"} viewBox={"0 0 24 24"} fill={"none"} stroke={"rgba(103,232,249,.55)"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                    <path d={"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"} />
                  </svg>
                  {v.heroAsking && (
                    <>
                      {" "}
                      <input ref={v.setHeroInput} value={v.heroDraft} onChange={v.onHeroDraft} onKeyDown={v.onHeroKey} placeholder={v.heroPh} style={css(`flex:1;min-width:0;height:clamp(30px,4vh,38px);border:none;outline:none;background:transparent;font-family:inherit;font-size:clamp(12px,1.15vw,14px);color:#b3bfd2`)} />
                      {" "}
                      <Hov as="button" onClick={v.onHeroSend} style={css(`flex:none;display:flex;align-items:center;justify-content:center;width:clamp(34px,4.4vh,42px);height:clamp(34px,4.4vh,42px);border-radius:99px;border:1px solid rgba(103,232,249,.45);cursor:pointer;color:#a5f3fc;background:rgba(103,232,249,.12)`)} hoverStyle={css(`background:rgba(103,232,249,.24)`)}>
                        <svg width={"15"} height={"15"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                          <path d={"M5 12h14M13 6l6 6-6 6"} />
                        </svg>
                      </Hov>
                      {" "}
                    </>
                  )}
                </div>
                <span style={css(`padding-left:clamp(16px,1.8vw,22px);font-size:9.5px;color:#a5b4fc;text-wrap:pretty`)}>
                  {"Four minutes of questions, then a read-only scan across 150+ endpoints. Nothing is ever written to your tenant."}
                </span>
              </div>
              <div style={css(`position:relative;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:3px;border-radius:12px;border:1px solid rgba(148,163,184,.16)`)}>
                {(v.heroPillarStack || []).map((ps, psIdx) => (
                  <React.Fragment key={psIdx}>
                    {" "}
                    <div style={css(`position:relative;flex:1 1 0;min-height:0;display:flex;align-items:center;gap:9px;padding:6px 12px 6px 14px;overflow:hidden;background:${ps?.bg};border-left:3px solid ${ps?.edge};transition:all 600ms cubic-bezier(.22,1,.36,1)`)}>
                      <svg viewBox={"0 0 24 24"} fill={"none"} stroke={ps?.icon} strokeWidth={"1.1"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`position:absolute;right:14px;top:50%;transform:translateY(-50%);height:76%;width:auto;aspect-ratio:1;opacity:${ps?.iconOp};transition:opacity 600ms ease`)}>
                        <path d={ps?.glyph} />
                      </svg>
                      <div style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(115deg,rgba(255,255,255,.05) 0px,rgba(255,255,255,.05) 1px,transparent 1px,transparent 9px);opacity:${ps?.textureOp};transition:opacity 600ms ease`)} />
                      <div style={css(`position:absolute;right:-6%;top:50%;width:46%;height:210%;transform:translateY(-50%);border-radius:50%;pointer-events:none;background:radial-gradient(circle,${ps?.bloom},transparent 68%);transition:background 600ms ease`)} />
                      <div style={css(`position:absolute;inset:0;background:linear-gradient(90deg,rgba(2,6,23,.62),rgba(2,6,23,.12) 48%,rgba(2,6,23,0) 74%);pointer-events:none`)} />
                      <div style={css(`position:absolute;left:0;top:0;bottom:0;width:3px;background:${ps?.edge};box-shadow:${ps?.edgeGlow};transition:all 600ms ease`)} />
                      {ps?.live && (
                        <>
                          {" "}
                          <div style={css(`position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.16) 50%,transparent 70%);background-size:260% 100%;animation:wr-sheen 3.4s linear infinite`)} />
                          {" "}
                          <div style={css(`position:absolute;left:0;right:0;bottom:0;height:2px;pointer-events:none;background:linear-gradient(90deg,${ps?.edge},transparent 70%);opacity:.7`)} />
                          {" "}
                        </>
                      )}
                      {ps?.done && (
                        <>
                          {" "}
                          <div style={css(`position:absolute;left:0;right:0;bottom:0;height:2px;pointer-events:none;background:linear-gradient(90deg,${ps?.edge},transparent 60%);opacity:.6`)} />
                          {" "}
                        </>
                      )}
                      <div style={css(`position:relative;flex:none;width:56px;height:56px`)}>
                        {" "}
                        <svg viewBox={"0 0 44 44"} style={css(`width:100%;height:100%;transform:rotate(-90deg)`)}>
                          {" "}
                          <circle cx={"22"} cy={"22"} r={"18"} fill={"rgba(2,6,23,.55)"} stroke={"rgba(148,163,184,.22)"} strokeWidth={"4"} />
                          {" "}
                          <circle cx={"22"} cy={"22"} r={"18"} fill={"none"} stroke={ps?.dialColor} strokeWidth={"4"} strokeLinecap={"round"} strokeDasharray={ps?.dash} style={css(`filter:drop-shadow(0 0 6px ${ps?.dialColor});transition:stroke-dasharray 900ms cubic-bezier(.22,1,.36,1)`)} />
                          {" "}
                        </svg>
                        {" "}
                        <span style={css(`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:${ps?.dialText}`)}>
                          <Txt v={ps?.dialLabel} />
                        </span>
                        {" "}
                      </div>
                      <span style={css(`position:absolute;left:0;right:0;top:50%;transform:translateY(-50%) skewX(-11deg);padding:0 10px;text-align:center;font-size:clamp(18px,3.9vw,62px);font-weight:900;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;line-height:1;pointer-events:none;opacity:${ps?.labelOp};color:transparent;-webkit-text-stroke:.8px ${ps?.text};background:linear-gradient(100deg,transparent 18%,${ps?.text}14 50%,transparent 82%);-webkit-background-clip:text;background-clip:text;animation:${ps?.labelAnim};transition:opacity 700ms ease`)}>
                        <Txt v={ps?.label} />
                      </span>
                      {/* Four columns, as the design signed off — five only on a
                          card carrying a #489 licence-gap purchase link, so no
                          real stat is ever displaced to make room for it. */}
                      <div style={css(`position:relative;flex:1;min-width:0;display:grid;grid-template-columns:repeat(${ps?.statCols || 4},minmax(0,1fr));align-content:center;gap:4px;padding-left:2px`)}>
                        {(ps?.stats || []).map((st, stIdx) => (
                          <React.Fragment key={stIdx}>
                            {" "}
                            {/* A stat with an `href` is a purchase link, not a
                                measurement (#489): it opens Microsoft's own page
                                for the add-on this pillar's gapped checks need.
                                `rel="noopener noreferrer"` because this is an
                                outbound link from a page the customer is signed
                                into — a bare target="_blank" hands the opener
                                reference to the destination. */}
                            {st?.href ? (
                              <a href={st?.href} target={"_blank"} rel={"noopener noreferrer"} title={`${st?.v} — opens Microsoft's own page in a new tab`} style={css(`position:relative;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 7px;border-radius:9px;overflow:hidden;border:1px solid ${ps?.edge}66;background:rgba(2,6,23,.45);text-decoration:none;animation:wr-statslide 720ms cubic-bezier(.22,1,.36,1) ${st?.delay} both`)}>
                                <span style={css(`position:relative;max-width:100%;flex:none;font-size:11.5px;font-weight:800;line-height:1.15;color:${ps?.edge};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 10px ${ps?.statGlow}`)}>
                                  <Txt v={st?.v} />
                                </span>
                                <span style={css(`position:relative;max-width:100%;font-size:7.5px;font-weight:600;line-height:1.25;letter-spacing:.01em;color:${ps?.statL};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden`)}>
                                  <Txt v={st?.l} />
                                </span>
                              </a>
                            ) : (
                            <div style={css(`position:relative;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:4px 7px;border-radius:9px;overflow:hidden;border:none;background:transparent;animation:wr-statslide 720ms cubic-bezier(.22,1,.36,1) ${st?.delay} both`)}>
                              <span style={css(`position:relative;max-width:100%;flex:none;font-size:11.5px;font-weight:800;line-height:1.15;color:${ps?.statV};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 0 10px ${ps?.statGlow}`)}>
                                <Txt v={st?.v} />
                              </span>
                              <span style={css(`position:relative;max-width:100%;font-size:7.5px;font-weight:600;line-height:1.25;letter-spacing:.01em;color:${ps?.statL};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden`)}>
                                <Txt v={st?.l} />
                              </span>
                            </div>
                            )}
                            {" "}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
              <div style={css(`position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:9px;overflow-y:auto;overflow-x:hidden;padding-right:4px`)}>
                <div style={css(`flex:none;position:relative;border-radius:14px;border:1px solid rgba(52,211,153,.42);background:linear-gradient(165deg,rgba(6,25,20,.9),rgba(2,6,23,.94));backdrop-filter:blur(14px);box-shadow:0 12px 34px rgba(2,6,23,.6);padding:10px 12px;display:flex;flex-direction:column;gap:8px`)}>
                  <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                    <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;align-self:center;background:${v.heroScan?.tone};box-shadow:0 0 8px ${v.heroScan?.tone};animation:wr-blink 1.6s ease-in-out infinite`)} />
                    <span style={css(`flex:none;font-size:19px;font-weight:800;letter-spacing:-.03em;line-height:1;color:${v.heroScan?.tone};font-variant-numeric:tabular-nums`)}>
                      <Txt v={v.heroScan?.pct} />
                    </span>
                    <span style={css(`flex:1;min-width:0;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                      <Txt v={v.heroScan?.caption} />
                    </span>
                    <span style={css(`flex:none;font-size:8.5px;font-weight:800;color:${v.heroScan?.tone};font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={v.heroScan?.step} />
                    </span>
                  </div>
                  <div style={css(`position:relative;height:6px;border-radius:99px;background:rgba(148,163,184,.16);border:1px solid rgba(148,163,184,.34);box-shadow:0 0 12px rgba(148,163,184,.22),inset 0 1px 2px rgba(0,0,0,.5);overflow:hidden`)}>
                    {" "}
                    <span style={css(`position:absolute;left:0;top:0;bottom:0;width:${v.heroScan?.w};border-radius:99px;background:linear-gradient(90deg,#0078D4,${v.heroScan?.tone});box-shadow:0 0 14px ${v.heroScan?.tone}99;transition:width 900ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </div>
                </div>
                {v.heroDocs?.show && (
                  <>
                    {" "}
                    <div style={css(`flex:none;position:relative;border-radius:14px;border:1px solid rgba(167,139,250,.4);background:linear-gradient(165deg,rgba(23,16,45,.92),rgba(2,6,23,.94));backdrop-filter:blur(14px);box-shadow:0 12px 34px rgba(2,6,23,.6);padding:11px 12px;display:flex;flex-direction:column;gap:8px;animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
                      <div style={css(`display:flex;align-items:center;gap:8px`)}>
                        <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#a78bfa;box-shadow:0 0 8px #a78bfa;animation:wr-blink 1.6s ease-in-out infinite`)} />
                        <span style={css(`flex:1;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#c4b5fd`)}>
                          {"Generating documents"}
                        </span>
                        <span style={css(`flex:none;font-size:8.5px;font-weight:800;color:#c4b5fd;font-family:ui-monospace,Menlo,monospace`)}>
                          <Txt v={v.heroDocs?.count} />
                        </span>
                      </div>
                      <div style={css(`position:relative;height:5px;border-radius:99px;background:rgba(2,6,23,.85);overflow:hidden`)}>
                        {" "}
                        <span style={css(`position:absolute;left:0;top:0;bottom:0;width:${v.heroDocs?.w};border-radius:99px;background:linear-gradient(90deg,#6B4EFF,#a78bfa);transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                        {" "}
                      </div>
                    </div>
                    {" "}
                  </>
                )}
                <div style={css(`flex:none;position:relative;border-radius:18px;border:1px solid rgba(103,232,249,.42);background:linear-gradient(165deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(14px);box-shadow:0 18px 60px rgba(2,6,23,.7),0 0 40px rgba(103,232,249,.14);padding:15px 16px;display:flex;flex-direction:column;gap:12px;animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
                  <div style={css(`display:flex;align-items:flex-start;gap:9px`)}>
                    <span style={css(`flex:none;margin-top:4px;width:6px;height:6px;border-radius:99px;background:#67e8f9;box-shadow:0 0 10px #67e8f9;animation:wr-blink 1.6s ease-in-out infinite`)} />
                    <span style={css(`flex:1;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.25;color:#b3bfd2;text-wrap:pretty`)}>
                      {"Briefing whiteboard"}
                    </span>
                    <span style={css(`flex:none;font-size:9.5px;font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:#67e8f9`)}>
                      <Txt v={v.heroCount} />
                    </span>
                  </div>
                  <div style={css(`display:flex;flex-direction:column;gap:0`)}>
                    {(v.heroBoard || []).map((hs, hsIdx) => (
                      <React.Fragment key={hsIdx}>
                        {" "}
                        <div style={css(`display:flex;flex-direction:column;gap:3px;padding:7px 0;border-bottom:1px solid rgba(148,163,184,.1);animation:${hs?.anim};transition:all 420ms cubic-bezier(.22,1,.36,1)`)}>
                          <div style={css(`display:flex;align-items:center;gap:7px`)}>
                            <span style={css(`flex:none;width:18px;height:18px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:${hs?.iconBg};border:1px solid ${hs?.iconBd};transition:all 420ms cubic-bezier(.22,1,.36,1)`)}>
                              <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={hs?.stateColor} strokeWidth={"1.9"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                <path d={hs?.icon} />
                              </svg>
                            </span>
                            <span style={css(`flex:1;min-width:0;font-size:8.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:${hs?.tagColor};text-wrap:pretty`)}>
                              <Txt v={hs?.tag} />
                            </span>
                          </div>
                          <span style={css(`padding-left:25px;font-size:10.5px;font-weight:${hs?.weight};line-height:1.35;color:${hs?.ink};text-wrap:pretty`)}>
                            <Txt v={hs?.v} />
                          </span>
                        </div>
                        {" "}
                      </React.Fragment>
                    ))}
                  </div>
                  <span style={css(`font-size:10px;line-height:1.5;color:#64748b;text-wrap:pretty`)}>
                    {"Everything you tell me locks onto this board. It carries into the briefing and every document we generate."}
                  </span>
                </div>
              </div>
            </div>
            {" "}
          </>
        )}
        {v.chatOpen && (
          <>
            {" "}
            <div style={css(`position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;opacity:${v.chamberDim};transition:opacity 900ms ease`)}>
              {" "}
              <div style={css(`position:absolute;left:12%;top:-12%;width:14%;height:96%;background:linear-gradient(180deg,rgba(59,130,246,.18),rgba(59,130,246,0));filter:blur(28px);animation:wr-beamsweep 12s ease-in-out infinite`)} />
              {" "}
              <div style={css(`position:absolute;right:22%;top:-14%;width:12%;height:100%;background:linear-gradient(180deg,${v.scanBeam},rgba(5,7,13,0));filter:blur(30px);animation:wr-beamsweep 14s ease-in-out 1.2s infinite;transition:background 800ms ease`)} />
              {" "}
              <div style={css(`position:absolute;left:50%;bottom:-18%;width:min(110%,860px);height:300px;transform:translate(-50%,0);border-radius:50%;background:radial-gradient(closest-side,${v.scanGlow},rgba(5,7,13,0) 72%);transition:background 800ms ease`)} />
              {" "}
              {(v.dust || []).map((dc, dcIdx) => (
                <React.Fragment key={dcIdx}>
                  {" "}
                  <svg viewBox={"0 0 24 24"} fill={"none"} stroke={dc?.c} strokeWidth={"1.6"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`position:absolute;left:${dc?.x};bottom:${dc?.b};width:${dc?.s};height:${dc?.s};filter:drop-shadow(0 0 6px ${dc?.c});animation:wr-twinkle ${dc?.dur} ease-in-out ${dc?.delay} infinite`)}>
                    {" "}
                    <path d={"M12 2.5 14.2 8.9 20.6 11 14.2 13.1 12 19.5 9.8 13.1 3.4 11 9.8 8.9z"} />
                    {" "}
                  </svg>
                  {" "}
                </React.Fragment>
              ))}
              {" "}
            </div>
            {" "}
            <div style={css(`position:relative;z-index:10;height:2px;background:rgba(2,6,23,.9)`)}>
              {" "}
              <div style={css(`height:100%;width:${v.wiz?.progress};background:linear-gradient(90deg,#0078D4,#67e8f9);box-shadow:0 0 14px rgba(103,232,249,.7);transition:width 500ms cubic-bezier(.22,1,.36,1)`)} />
              {" "}
            </div>
            {" "}
            <div style={css(`position:relative;z-index:10;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
              <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#67E8F9`)}>
                <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                  <path d={"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2zM9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"} />
                </svg>
              </span>
              <div style={css(`flex:1 1 180px;min-width:0`)}>
                {" "}
                <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#67e8f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  {"Copilot assessment · opening conversation"}
                </div>
                {" "}
                <div style={css(`font-size:14px;font-weight:800;letter-spacing:-.02em;color:#b3bfd2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  {resolvePreludeCustomerName(v.customerName)}
                </div>
                {" "}
              </div>
              <span style={css(`flex:none;font-size:10px;font-weight:700;letter-spacing:.14em;padding:5px 11px;border-radius:999px;color:#67e8f9;border:1px solid rgba(103,232,249,.5);background:rgba(103,232,249,.14);font-family:ui-monospace,Menlo,monospace`)}>
                <Txt v={v.wiz?.stepLabel} />
              </span>
            </div>
            {" "}
            <div style={css(`position:relative;z-index:10;flex:1;min-height:0;display:grid;grid-template-columns:minmax(300px,1fr) minmax(280px,.86fr)`)}>
              <div ref={v.onbSetEl} style={css(`min-height:0;overflow-y:auto;padding:16px 18px 14px;display:flex;flex-direction:column;gap:13px;background:rgba(2,6,23,.55);border-right:1px solid rgba(30,41,59,.9)`)}>
                {(v.onbThread || []).map((om, omIdx) => (
                  <React.Fragment key={omIdx}>
                    {" "}
                    <div style={css(`display:flex;flex-direction:${om?.align};gap:10px;align-items:flex-start;animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
                      <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${om?.tile};box-shadow:0 0 16px ${om?.color}55`)}>
                        <ImageSlot id={om?.slot} shape={"rounded"} radius={"9"} src={om?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                      </span>
                      <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:5px`)}>
                        <span style={css(`font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${om?.color}`)}>
                          <Txt v={om?.name} />
                        </span>
                        {om?.isText && (
                          <>
                            {" "}
                            <div style={css(`align-self:flex-start;max-width:94%;padding:11px 14px;border-radius:14px;border:1px solid ${om?.border};background:${om?.bg};font-size:12.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                              <Txt v={om?.text} />
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isIntro && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:9px;padding:13px 14px;border-radius:14px;border:1px solid rgba(103,232,249,.5);background:linear-gradient(160deg,rgba(103,232,249,.13),rgba(2,6,23,.88))`)}>
                              <div style={css(`display:flex;align-items:center;gap:10px`)}>
                                <span style={css(`flex:none;width:44px;height:44px;border-radius:13px;overflow:hidden;background:linear-gradient(135deg,#0078D4,#67E8F9)`)}>
                                  {" "}
                                  <ImageSlot id={"onb-shane-hero"} shape={"rounded"} radius={"12"} src={"avatars/shane.png"} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                                  {" "}
                                </span>
                                <div style={css(`flex:1;min-width:0`)}>
                                  {" "}
                                  <div style={css(`font-size:13.5px;font-weight:800;color:#f1f5f9`)}>
                                    {"Shane McCaw"}
                                  </div>
                                  {" "}
                                  <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#67e8f9`)}>
                                    {"Lead M365 Architect · NASA"}
                                  </div>
                                  {" "}
                                </div>
                              </div>
                              <div style={css(`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px`)}>
                                <div style={css(`padding:9px 10px;border-radius:10px;background:rgba(2,6,23,.6)`)}>
                                  <div style={css(`font-size:14px;font-weight:800;color:#67e8f9`)}>
                                    {"2026"}
                                  </div>
                                  <div style={css(`font-size:8.5px;color:#94a3b8`)}>
                                    {"Forum Award"}
                                  </div>
                                </div>
                                <div style={css(`padding:9px 10px;border-radius:10px;background:rgba(2,6,23,.6)`)}>
                                  <div style={css(`font-size:14px;font-weight:800;color:#67e8f9`)}>
                                    {"150+"}
                                  </div>
                                  <div style={css(`font-size:8.5px;color:#94a3b8`)}>
                                    {"endpoints read"}
                                  </div>
                                </div>
                                <div style={css(`padding:9px 10px;border-radius:10px;background:rgba(2,6,23,.6)`)}>
                                  <div style={css(`font-size:14px;font-weight:800;color:#67e8f9`)}>
                                    {"7"}
                                  </div>
                                  <div style={css(`font-size:8.5px;color:#94a3b8`)}>
                                    {"pillars scored"}
                                  </div>
                                </div>
                              </div>
                              <span style={css(`font-size:10.5px;line-height:1.55;color:#94a3b8;text-wrap:pretty`)}>
                                {"Read-only throughout. Nothing is written to your tenant and document contents are never read."}
                              </span>
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isClusters && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:7px`)}>
                              {(om?.clusters || []).map((cl, clIdx) => (
                                <React.Fragment key={clIdx}>
                                  {" "}
                                  <Hov as="div" onClick={cl?.onClick} style={css(`display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;cursor:pointer;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.5);transition:all 220ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.7);background:rgba(103,232,249,.1)`)}>
                                    <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                                      <span style={css(`font-size:11.5px;font-weight:700;color:#e2e8f0`)}>
                                        <Txt v={cl?.l} />
                                      </span>
                                      <span style={css(`font-size:9.5px;color:#64748b;text-wrap:pretty`)}>
                                        <Txt v={cl?.d} />
                                      </span>
                                    </span>
                                    <span style={css(`flex:none;font-size:9px;font-weight:700;color:#67e8f9`)}>
                                      <Txt v={cl?.n} />
                                    </span>
                                  </Hov>
                                  {" "}
                                </React.Fragment>
                              ))}
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isPersonas && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:7px`)}>
                              {(om?.people || []).map((pe, peIdx) => (
                                <React.Fragment key={peIdx}>
                                  {" "}
                                  <div onClick={pe?.onClick} style={css(`display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;cursor:pointer;border:1px solid ${pe?.border};background:${pe?.bg};transition:all 220ms cubic-bezier(.22,1,.36,1)`)}>
                                    <span style={css(`flex:none;width:17px;height:17px;border-radius:6px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${pe?.border};background:rgba(2,6,23,.6)`)}>
                                      <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#67e8f9"} strokeWidth={"3.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`opacity:${pe?.tick};transition:opacity 200ms ease`)}>
                                        <path d={"m5 12 5 5L20 7"} />
                                      </svg>
                                    </span>
                                    <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                                      <span style={css(`font-size:11.5px;font-weight:700;color:${pe?.ink}`)}>
                                        <Txt v={pe?.p} />
                                      </span>
                                      <span style={css(`font-size:9.5px;color:#64748b;text-wrap:pretty`)}>
                                        <Txt v={pe?.d} />
                                      </span>
                                    </span>
                                    <span style={css(`flex:none;font-size:10px;font-weight:700;color:#94a3b8;font-variant-numeric:tabular-nums`)}>
                                      <Txt v={pe?.n} />
                                    </span>
                                  </div>
                                  {" "}
                                </React.Fragment>
                              ))}
                              <Hov as="button" onClick={om?.onConfirm} style={css(`align-self:flex-end;display:flex;align-items:center;gap:7px;height:32px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#04202a;background:#67e8f9;box-shadow:0 0 20px rgba(103,232,249,.4)`)} hoverStyle={css(`filter:brightness(1.1)`)}>
                                {" "}<Txt v={om?.pickedLabel} />{" "}
                                <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                  <path d={"M5 12h14M13 6l6 6-6 6"} />
                                </svg>
                              </Hov>
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isOutcomes && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:10px;padding:13px 14px;border-radius:14px;border:1px solid rgba(249,115,22,.5);background:linear-gradient(160deg,rgba(249,115,22,.12),rgba(2,6,23,.88))`)}>
                              <span style={css(`font-size:12.5px;font-weight:800;color:#f1f5f9`)}>
                                <Txt v={om?.outTitle} />{" — what changes"}
                              </span>
                              <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#FDBA74`)}>
                                  {"Outcomes"}
                                </span>
                                {(om?.outcomes || []).map((oc, ocIdx) => (
                                  <React.Fragment key={ocIdx}>
                                    {" "}
                                    <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                      <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#F97316"} strokeWidth={"3.2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none;margin-top:3px`)}>
                                        <path d={"m5 12 5 5L20 7"} />
                                      </svg>
                                      <span style={css(`flex:1;font-size:11px;line-height:1.5;color:#e2e8f0;text-wrap:pretty`)}>
                                        <Txt v={oc?.v} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              <div style={css(`display:flex;flex-direction:column;gap:5px;padding-top:8px;border-top:1px solid rgba(249,115,22,.25)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#FDBA74`)}>
                                  {"Use cases"}
                                </span>
                                <div style={css(`display:flex;flex-wrap:wrap;gap:5px`)}>
                                  {(om?.uses || []).map((uc, ucIdx) => (
                                    <React.Fragment key={ucIdx}>
                                      {" "}
                                      <span style={css(`font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:999px;color:#bbf7d0;border:1px solid rgba(249,115,22,.4);background:rgba(249,115,22,.1)`)}>
                                        <Txt v={uc?.v} />
                                      </span>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isQ && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:9px;padding:13px 14px;border-radius:14px;border:1px solid rgba(103,232,249,.45);background:linear-gradient(160deg,rgba(103,232,249,.1),rgba(2,6,23,.85))`)}>
                              <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9`)}>
                                <Txt v={om?.qNum} />
                              </span>
                              <span style={css(`font-size:13px;font-weight:800;color:#f1f5f9;text-wrap:pretty`)}>
                                <Txt v={om?.qText} />
                              </span>
                              <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                                {(om?.qOpts || []).map((qo, qoIdx) => (
                                  <React.Fragment key={qoIdx}>
                                    {" "}
                                    <Hov as="div" onClick={qo?.onClick} style={css(`padding:10px 12px;border-radius:10px;cursor:pointer;font-size:11.5px;font-weight:600;color:${qo?.ink};border:1px solid ${qo?.border};background:${qo?.bg};transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65)`)}>
                                      <Txt v={qo?.l} />
                                    </Hov>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                            {" "}
                          </>
                        )}
                        {om?.isScanCard && (
                          <>
                            {" "}
                            <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:8px;padding:13px 14px;border-radius:14px;border:1px solid rgba(103,232,249,.5);background:linear-gradient(160deg,rgba(103,232,249,.12),rgba(2,6,23,.9))`)}>
                              <div style={css(`display:flex;align-items:baseline;gap:9px;flex-wrap:wrap`)}>
                                <span style={css(`flex:1;min-width:0;font-size:12.5px;font-weight:800;color:#f1f5f9`)}>
                                  <Txt v={v.wiz?.scanLabel} />
                                </span>
                                <span style={css(`font-size:9.5px;font-weight:700;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                                  <Txt v={v.wiz?.elapsed} />
                                </span>
                                <span style={css(`font-size:17px;font-weight:800;color:#67e8f9;font-variant-numeric:tabular-nums`)}>
                                  <Txt v={v.wiz?.scanPct} />
                                </span>
                              </div>
                              <span style={css(`font-size:9.5px;line-height:1.5;color:#64748b;text-wrap:pretty`)}>
                                {"A full crawl takes between three and ten minutes depending on tenant size. You can leave this open — nothing times out."}
                              </span>
                              {(v.wiz?.scan || []).map((sc, scIdx) => (
                                <React.Fragment key={scIdx}>
                                  {" "}
                                  {sc?.showGrp && (
                                    <>
                                      {" "}
                                      <span style={css(`font-size:8px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#475569;padding-top:5px`)}>
                                        <Txt v={sc?.grp} />
                                      </span>
                                      {" "}
                                    </>
                                  )}
                                  {" "}
                                  <div style={css(`display:flex;align-items:center;gap:9px;opacity:${sc?.opacity};transition:opacity 320ms ease`)}>
                                    <span style={css(`flex:none;width:14px;height:14px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${sc?.ink}`)}>
                                      {sc?.isDone && (
                                        <>
                                          {" "}
                                          <svg width={"8"} height={"8"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#6ee7b7"} strokeWidth={"4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                            <path d={"m5 12 5 5L20 7"} />
                                          </svg>
                                          {" "}
                                        </>
                                      )}
                                      {sc?.isLive && (
                                        <>
                                          {" "}
                                          <span style={css(`width:5px;height:5px;border-radius:99px;background:#67e8f9;animation:wr-blink 1s ease-in-out infinite`)} />
                                          {" "}
                                        </>
                                      )}
                                    </span>
                                    <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:${sc?.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                      <Txt v={sc?.l} />
                                    </span>
                                    <span style={css(`flex:none;font-size:9px;color:#64748b;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                                      <Txt v={sc?.n} />
                                    </span>
                                  </div>
                                  {" "}
                                </React.Fragment>
                              ))}
                              {v.wiz?.scanDone && (
                                <>
                                  {" "}
                                  <Hov as="button" onClick={v.wiz?.onEnter} style={css(`align-self:flex-start;display:flex;align-items:center;gap:8px;height:36px;padding:0 17px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;color:#04202a;background:#67e8f9;box-shadow:0 0 26px rgba(103,232,249,.5);margin-top:4px`)} hoverStyle={css(`filter:brightness(1.1)`)}>
                                    {" Enter the briefing "}
                                    <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                      <path d={"M5 12h14M13 6l6 6-6 6"} />
                                    </svg>
                                  </Hov>
                                  {" "}
                                </>
                              )}
                            </div>
                            {" "}
                          </>
                        )}
                      </div>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
                {v.onbTyping?.show && (
                  <>
                    {" "}
                    <div style={css(`display:flex;align-items:center;gap:9px;padding-left:40px`)}>
                      <span style={css(`font-size:10.5px;font-weight:600;color:${v.onbTyping?.color}`)}>
                        <Txt v={v.onbTyping?.name} />
                      </span>
                      <span style={css(`display:flex;gap:3px`)}>
                        <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.onbTyping?.color};animation:wr-typedot 1.2s ease-in-out infinite`)} />
                        <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.onbTyping?.color};animation:wr-typedot 1.2s ease-in-out .18s infinite`)} />
                        <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.onbTyping?.color};animation:wr-typedot 1.2s ease-in-out .36s infinite`)} />
                      </span>
                    </div>
                    {" "}
                  </>
                )}
              </div>
              <div style={css(`position:relative;min-height:0;background:rgba(2,6,23,.5)`)}>
                {" "}
                <div style={css(`position:absolute;inset:0;overflow-y:auto;overflow-x:clip;padding:16px 16px;display:flex;flex-direction:column;gap:10px`)}>
                  <div style={css(`flex:0 0 auto;border-radius:15px;border:1px solid rgba(103,232,249,.45);background:linear-gradient(160deg,rgba(103,232,249,.13),rgba(2,6,23,.78));box-shadow:0 0 34px rgba(103,232,249,.18);overflow:hidden`)}>
                    {" "}
                    <div style={css(`display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid rgba(103,232,249,.24)`)}>
                      <span style={css(`width:6px;height:6px;border-radius:99px;background:#67e8f9;animation:wr-blink 1.5s ease-in-out infinite`)} />
                      <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#a5f3fc`)}>
                        {"Assessment setup"}
                      </span>
                      <span style={css(`font-size:9px;font-weight:700;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                        {"01 AUG 2026"}
                      </span>
                    </div>
                    {" "}
                    <div style={css(`padding:11px 13px;display:flex;flex-direction:column;gap:9px`)}>
                      {(v.onbSetup || []).map((os, osIdx) => (
                        <React.Fragment key={osIdx}>
                          {" "}
                          <div style={css(`display:flex;align-items:center;gap:9px;min-width:0`)}>
                            <span style={css(`flex:none;width:14px;height:14px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${os?.ink}`)}>
                              {os?.done && (
                                <>
                                  {" "}
                                  <svg width={"8"} height={"8"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#6ee7b7"} strokeWidth={"4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                    <path d={"m5 12 5 5L20 7"} />
                                  </svg>
                                  {" "}
                                </>
                              )}
                            </span>
                            <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:${os?.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                              <Txt v={os?.l} />
                            </span>
                            <span style={css(`flex:none;font-size:10px;font-weight:800;color:${os?.vInk};font-variant-numeric:tabular-nums;white-space:nowrap`)}>
                              <Txt v={os?.v} />
                            </span>
                          </div>
                          {" "}
                        </React.Fragment>
                      ))}
                    </div>
                    {" "}
                  </div>
                  {v.onbRoster?.show && (
                    <>
                      {" "}
                      <div style={css(`flex:0 0 auto;display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:13px;border:1px solid rgba(52,211,153,.4);background:rgba(16,185,129,.07)`)}>
                        <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                          {"Who will be in the room"}
                        </span>
                        {(v.onbRoster?.rows || []).map((rr, rrIdx) => (
                          <React.Fragment key={rrIdx}>
                            {" "}
                            <div style={css(`display:flex;align-items:baseline;gap:8px;min-width:0`)}>
                              <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#34d399`)} />
                              <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                <Txt v={rr?.p} />
                              </span>
                              <span style={css(`flex:none;font-size:9.5px;font-weight:700;color:#94a3b8;font-variant-numeric:tabular-nums`)}>
                                <Txt v={rr?.n} />
                              </span>
                            </div>
                            {" "}
                          </React.Fragment>
                        ))}
                      </div>
                      {" "}
                    </>
                  )}
                  {v.onbAnswers?.show && (
                    <>
                      {" "}
                      <div style={css(`flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:13px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                        <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                          {"What you have told me"}
                        </span>
                        {(v.onbAnswers?.rows || []).map((ar, arIdx) => (
                          <React.Fragment key={arIdx}>
                            {" "}
                            <div style={css(`display:flex;flex-direction:column;gap:1px`)}>
                              <span style={css(`font-size:9px;color:#64748b;text-wrap:pretty`)}>
                                <Txt v={ar?.q} />
                              </span>
                              <span style={css(`font-size:10.5px;font-weight:700;color:#a5f3fc;text-wrap:pretty`)}>
                                <Txt v={ar?.a} />
                              </span>
                            </div>
                            {" "}
                          </React.Fragment>
                        ))}
                      </div>
                      {" "}
                    </>
                  )}
                  <div style={css(`flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:13px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                    <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                      {"What happens next"}
                    </span>
                    <span style={css(`font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                      {"A read-only scan across 150+ endpoints, scored against seven pillars. Then a briefing with the people you just named, built on what it finds."}
                    </span>
                    <span style={css(`font-size:9.5px;line-height:1.5;color:#64748b;text-wrap:pretty`)}>
                      {"Nothing is written to your tenant. Document contents are never read."}
                    </span>
                  </div>
                </div>
                {" "}
              </div>
            </div>
            {" "}
          </>
        )}
        <div style={css(`position:relative;z-index:10;flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.72)`)}>
          <Hov as="button" onClick={v.wiz?.onSkip} style={css(`flex:none;height:32px;padding:0 12px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:600;color:#475569;border:none;background:transparent`)} hoverStyle={css(`color:#94a3b8`)}>
            {"Skip to the briefing"}
          </Hov>
          <Hov as="button" onClick={v.wiz?.onSimulate} style={css(`flex:none;height:32px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:#7dd3fc;border:1px solid rgba(0,180,216,.45);background:rgba(0,120,212,.14);display:flex;align-items:center;gap:6px`)} hoverStyle={css(`color:#e0f2fe;border-color:rgba(0,180,216,.8)`)}>
            <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
              <path d={"M6 4l14 8-14 8z"} />
            </svg>
            {"Simulate scan "}
          </Hov>
          <span style={css(`flex:1`)} />
          <span style={css(`font-size:10px;font-weight:700;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
            {`v${versionInfo.display}`}
          </span>
        </div>
      </div>
    </div>
    {" "}
    </>
  );
}
