/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `introOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "../runtime";

export function IntroPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;top:50%;right:6px;transform:translateY(-50%);width:min(430px,54%);max-height:96%;z-index:110;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid rgba(103,232,249,.32);background:linear-gradient(160deg,rgba(15,23,42,.97),rgba(2,6,23,.95));backdrop-filter:blur(16px);box-shadow:0 26px 66px rgba(2,6,23,.82),0 0 60px rgba(0,120,212,.18);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:center;gap:9px;padding:10px 14px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc`)}>
          {"Introductions"}
        </span>
        <span style={css(`flex:1`)} />
        <Hov as="button" onClick={v.onPickSkip} style={css(`flex:none;height:24px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
          {"Skip"}
        </Hov>
      </div>
      <div style={css(`flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:12px`)}>
        <div style={css(`display:flex;align-items:center;gap:12px`)}>
          <span style={css(`flex:none;width:64px;height:64px;border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;background:${v.intro?.tile};border:2px solid ${v.intro?.color};box-shadow:0 0 26px ${v.intro?.color}66`)}>
            <ImageSlot id={v.intro?.slot} shape={"rounded"} radius={"16"} src={v.intro?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
          </span>
          <div style={css(`flex:1;min-width:0`)}>
            {" "}
            <div style={css(`font-size:18px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
              <Txt v={v.intro?.name} />
            </div>
            {" "}
            <div style={css(`font-size:11px;font-weight:600;color:${v.intro?.color}`)}>
              <Txt v={v.intro?.tenure} />
            </div>
            {" "}
            <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#475569;margin-top:3px`)}>
              {"Owns · "}<Txt v={v.intro?.pillar} />
            </div>
            {" "}
          </div>
        </div>
        <div style={css(`font-size:13px;line-height:1.55;color:#e2e8f0;text-wrap:pretty;padding-left:11px;border-left:2px solid ${v.intro?.color}`)}>
          <Txt v={v.intro?.line} />
        </div>
        <div style={css(`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:11px 12px;border-radius:12px;border:1px solid rgba(103,232,249,.22);background:rgba(0,120,212,.07)`)}>
          {(v.intro?.stat || []).map((st, stIdx) => (
            <React.Fragment key={stIdx}>
              {" "}
              <div>
                {" "}
                <div style={css(`font-size:17px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9;font-variant-numeric:tabular-nums`)}>
                  <Txt v={st?.v} />
                </div>
                {" "}
                <div style={css(`font-size:9px;line-height:1.3;color:#94a3b8`)}>
                  <Txt v={st?.l} />
                </div>
                {" "}
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
            {"Lives in"}
          </span>
          <span style={css(`font-size:11.5px;font-weight:600;color:#cbd5e1`)}>
            <Txt v={v.intro?.lives} />
          </span>
          <span style={css(`font-size:11.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
            <Txt v={v.intro?.day} />
          </span>
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5`)}>
            {"Where it hurts"}
          </span>
          {(v.intro?.pains || []).map((p, pIdx) => (
            <React.Fragment key={pIdx}>
              {" "}
              <div style={css(`display:flex;gap:9px;align-items:baseline;padding:8px 11px;border-radius:10px;border:1px solid rgba(248,113,113,.22);background:rgba(248,113,113,.06)`)}>
                <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#f87171`)} />
                <span style={css(`flex:1;font-size:11.5px;font-weight:700;color:#f1f5f9;text-wrap:pretty`)}>
                  <Txt v={p?.head} />
                </span>
                <span style={css(`flex:none;max-width:45%;font-size:10px;color:#94a3b8;text-align:right;text-wrap:pretty`)}>
                  <Txt v={p?.sub} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`display:flex;gap:9px;align-items:baseline;padding:9px 12px;border-radius:10px;border:1px solid rgba(52,211,153,.26);background:rgba(16,185,129,.07)`)}>
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7`)}>
            {"Wants"}
          </span>
          <span style={css(`flex:1;font-size:11.5px;line-height:1.45;color:#d1fae5;text-wrap:pretty`)}>
            <Txt v={v.intro?.wants} />
          </span>
        </div>
      </div>
      <div style={css(`display:flex;align-items:center;gap:8px;padding:11px 14px;border-top:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
        <Hov as="button" onClick={v.onIntroBackToRoom} style={css(`flex:none;height:32px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
          {"Hear from someone else"}
        </Hov>
        <span style={css(`flex:1;font-size:10px;color:#64748b`)}>
          {"Ask them anything below — the room waits for you."}
        </span>
        <Hov as="button" onClick={v.onIntroBegin} style={css(`flex:none;height:34px;padding:0 16px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;color:#fff;background:#0078D4;box-shadow:0 8px 22px rgba(0,120,212,.35)`)} hoverStyle={css(`background:#2563eb`)}>
          {"I've met everyone — begin"}
        </Hov>
      </div>
    </div>
    {" "}
    </>
  );
}
