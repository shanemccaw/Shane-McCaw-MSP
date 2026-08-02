/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `chatOpenLog`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt } from "../runtime";

export function ChatLogPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`width:330px;height:min(560px,72vh);border-radius:34px;padding:9px;background:linear-gradient(160deg,#1f2937,#0b1120);box-shadow:0 30px 80px rgba(2,6,23,.85),0 0 0 1px rgba(148,163,184,.18);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`position:relative;width:100%;height:100%;border-radius:27px;overflow:hidden;background:#000;display:flex;flex-direction:column`)}>
        <div style={css(`position:absolute;left:50%;top:7px;transform:translateX(-50%);width:86px;height:20px;border-radius:99px;background:#000;z-index:3`)} />
        <div style={css(`flex:none;padding:30px 14px 10px;background:rgba(28,28,30,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(84,84,88,.5);display:flex;align-items:center;gap:10px`)}>
          <button onClick={v.onToggleChatLog} style={css(`flex:none;width:24px;height:24px;border:none;background:transparent;color:#0a84ff;cursor:pointer;display:flex;align-items:center;justify-content:center`)}>
            <svg width={"16"} height={"16"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
              <path d={"m15 18-6-6 6-6"} />
            </svg>
          </button>
          <div style={css(`flex:1;text-align:center;line-height:1.25`)}>
            {" "}
            <div style={css(`font-size:13px;font-weight:700;color:#f2f2f7`)}>
              {"Copilot War Room"}
            </div>
            {" "}
            <div style={css(`font-size:10px;color:#8e8e93`)}>
              {"7 participants · live transcript"}
            </div>
            {" "}
          </div>
          <span style={css(`flex:none;width:24px`)} />
        </div>
        <div ref={v.setChatScroll} style={css(`flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 12px 18px;display:flex;flex-direction:column;gap:9px;background:#000`)}>
          {v.transcriptEmpty && (
            <>
              {" "}
              <div style={css(`margin:auto;text-align:center;font-size:11.5px;line-height:1.5;color:#636366`)}>
                {"Nothing said yet."}
                <br />
                {"Start the briefing and every line lands here."}
              </div>
              {" "}
            </>
          )}
          {(v.transcript || []).map((m, mIdx) => (
            <React.Fragment key={mIdx}>
              {" "}
              <div style={css(`display:flex;flex-direction:column;align-items:${m?.align};gap:3px`)}>
                {m?.showWho && (
                  <>
                    {" "}
                    <div style={css(`display:flex;align-items:center;gap:6px;padding-left:4px`)}>
                      <span style={css(`width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6.5px;font-weight:800;color:#fff;background:${m?.tile}`)}>
                        <Txt v={m?.initials} />
                      </span>
                      <span style={css(`font-size:9.5px;font-weight:600;color:#8e8e93`)}>
                        <Txt v={m?.name} />
                      </span>
                    </div>
                    {" "}
                  </>
                )}
                <div style={css(`max-width:82%;padding:8px 12px;border-radius:${m?.tailRadius};font-size:12.5px;line-height:1.42;color:${m?.bubbleColor};background:${m?.bubbleBg};text-wrap:pretty`)}>
                  <Txt v={m?.text} />
                </div>
                <span style={css(`font-size:8.5px;color:#636366;padding:0 5px`)}>
                  <Txt v={m?.stamp} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`flex:none;padding:9px 12px 14px;background:rgba(28,28,30,.92);border-top:1px solid rgba(84,84,88,.5);display:flex;align-items:center;gap:8px`)}>
          <div style={css(`flex:1;height:30px;border-radius:99px;border:1px solid rgba(99,99,102,.7);display:flex;align-items:center;padding:0 12px;font-size:11.5px;color:#636366`)}>
            {"iMessage"}
          </div>
          <span style={css(`flex:none;width:26px;height:26px;border-radius:50%;background:#0a84ff;display:flex;align-items:center;justify-content:center`)}>
            <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
              <path d={"m5 12 7-7 7 7"} />
              <path d={"M12 19V5"} />
            </svg>
          </span>
        </div>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
