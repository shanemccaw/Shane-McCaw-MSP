/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `ctxOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function ContextPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(2,6,23,.82);backdrop-filter:blur(10px)`)}>
      <div style={css(`width:100%;max-width:1080px;max-height:100%;overflow:auto;border-radius:20px;border:1px solid rgba(103,232,249,.3);background:linear-gradient(160deg,rgba(15,23,42,.97),rgba(2,6,23,.96));box-shadow:0 28px 70px rgba(2,6,23,.85);animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
        {" "}
        <div style={css(`display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
          <div style={css(`flex:1;min-width:0`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc`)}>
              {"Client context · assembled from your tenant"}
            </div>
            {" "}
            <div style={css(`font-size:20px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9;margin-top:3px`)}>
              <Txt v={v.ctx?.org} />
            </div>
            {" "}
            <div style={css(`font-size:11.5px;color:#94a3b8;margin-top:2px`)}>
              <Txt v={v.ctx?.industry} />{" · "}<Txt v={v.ctx?.seats} />
            </div>
            {" "}
          </div>
          <div style={css(`display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:340px`)}>
            {(v.ctx?.regs || []).map((r, rIdx) => (
              <React.Fragment key={rIdx}>
                {" "}
                <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:999px;color:#fca5a5;border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.1)`)}>
                  <Txt v={r} />
                </span>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <Hov as="button" onClick={v.onCtx} style={css(`flex:none;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
            <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
              <path d={"M18 6 6 18"} />
              <path d={"m6 6 12 12"} />
            </svg>
          </Hov>
        </div>
        {" "}
        <div style={css(`padding:16px 18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px`)}>
          <div style={css(`grid-column:1/-1;border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);padding:13px 15px`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-bottom:10px`)}>
              {"Who actually uses Copilot here"}
            </div>
            {" "}
            <div style={css(`display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px`)}>
              {(v.ctx?.personas || []).map((p, pIdx) => (
                <React.Fragment key={pIdx}>
                  {" "}
                  <div style={css(`border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(8,15,30,.7);padding:11px 12px;display:flex;flex-direction:column;gap:6px`)}>
                    <div style={css(`display:flex;align-items:baseline;gap:7px`)}>
                      <span style={css(`font-size:12.5px;font-weight:800;color:${p?.color}`)}>
                        <Txt v={p?.role} />
                      </span>
                      <span style={css(`font-size:9.5px;font-weight:700;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
                        <Txt v={p?.n} />
                      </span>
                    </div>
                    <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                      <Txt v={p?.tools} />
                    </div>
                    <div style={css(`font-size:11.5px;line-height:1.45;color:#cbd5e1;text-wrap:pretty`)}>
                      <Txt v={p?.use} />
                    </div>
                    <div style={css(`font-size:10.5px;line-height:1.4;color:#fca5a5;text-wrap:pretty`)}>
                      {"⚠ "}<Txt v={p?.risk} />
                    </div>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);padding:13px 15px;display:flex;flex-direction:column;gap:9px`)}>
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Sensitivity of what Copilot can reach"}
            </div>
            {(v.ctx?.sensitivity || []).map((s, sIdx) => (
              <React.Fragment key={sIdx}>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:10px`)}>
                  <span style={css(`flex:none;width:96px;font-size:11.5px;font-weight:600;color:#e2e8f0`)}>
                    <Txt v={s?.label} />
                  </span>
                  <span style={css(`flex:1;height:8px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden;display:block`)}>
                    <span style={css(`display:block;height:100%;width:${s?.pct}%;border-radius:99px;background:${s?.color}`)} />
                  </span>
                  <span style={css(`flex:none;width:34px;text-align:right;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:${s?.color}`)}>
                    <Txt v={s?.pct} />{"%"}
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
            <div style={css(`font-size:10.5px;color:#94a3b8`)}>
              <Txt v={v.ctx?.labelled} />
            </div>
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);padding:13px 15px;display:flex;flex-direction:column;gap:9px`)}>
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Collaboration patterns"}
            </div>
            {(v.ctx?.collab || []).map((c, cIdx) => (
              <React.Fragment key={cIdx}>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:10px`)}>
                  <span style={css(`flex:1;font-size:11.5px;color:#e2e8f0`)}>
                    <Txt v={c?.label} />
                  </span>
                  <span style={css(`flex:none;width:110px;height:8px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden;display:block`)}>
                    <span style={css(`display:block;height:100%;width:${c?.pct}%;border-radius:99px;background:#0078D4`)} />
                  </span>
                  <span style={css(`flex:none;width:34px;text-align:right;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:#7dd3fc`)}>
                    <Txt v={c?.pct} />{"%"}
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
            <div style={css(`font-size:10.5px;color:#fca5a5`)}>
              <Txt v={v.ctx?.collabNote} />
            </div>
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);padding:13px 15px;display:flex;flex-direction:column;gap:9px`)}>
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Tool usage · monthly active"}
            </div>
            {(v.ctx?.tools || []).map((t, tIdx) => (
              <React.Fragment key={tIdx}>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:10px`)}>
                  <span style={css(`flex:none;width:88px;font-size:11.5px;color:#e2e8f0`)}>
                    <Txt v={t?.label} />
                  </span>
                  <span style={css(`flex:1;height:8px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden;display:block`)}>
                    <span style={css(`display:block;height:100%;width:${t?.pct}%;border-radius:99px;background:#67E8F9`)} />
                  </span>
                  <span style={css(`flex:none;width:34px;text-align:right;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;color:#7dd3fc`)}>
                    <Txt v={t?.pct} />{"%"}
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5);padding:13px 15px;display:flex;flex-direction:column;gap:9px`)}>
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Outcome priorities · stated by you"}
            </div>
            {(v.ctx?.priorities || []).map((p, pIdx) => (
              <React.Fragment key={pIdx}>
                {" "}
                <div style={css(`display:flex;align-items:baseline;gap:10px`)}>
                  <span style={css(`flex:none;font-size:10px;font-weight:800;color:#0078D4;font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={p?.rank} />
                  </span>
                  <span style={css(`flex:1;font-size:12px;font-weight:600;color:#e2e8f0;text-wrap:pretty`)}>
                    <Txt v={p?.label} />
                  </span>
                  <span style={css(`flex:none;font-size:10px;font-weight:700;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={p?.metric} />
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(52,211,153,.28);background:rgba(16,185,129,.06);padding:13px 15px`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7;margin-bottom:10px`)}>
              {"Return model"}
            </div>
            {" "}
            <div style={css(`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px`)}>
              {(v.ctx?.roi || []).map((r, rIdx) => (
                <React.Fragment key={rIdx}>
                  {" "}
                  <div>
                    {" "}
                    <div style={css(`font-size:19px;font-weight:800;letter-spacing:-.02em;color:${r?.c};font-variant-numeric:tabular-nums`)}>
                      <Txt v={r?.v} />
                    </div>
                    {" "}
                    <div style={css(`font-size:9.5px;color:#94a3b8`)}>
                      <Txt v={r?.l} />
                    </div>
                    {" "}
                  </div>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
          </div>
          <div style={css(`border-radius:14px;border:1px solid rgba(248,113,113,.28);background:rgba(248,113,113,.06);padding:13px 15px`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5;margin-bottom:10px`)}>
              {"Security posture"}
            </div>
            {" "}
            <div style={css(`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px`)}>
              {(v.ctx?.security || []).map((r, rIdx) => (
                <React.Fragment key={rIdx}>
                  {" "}
                  <div>
                    {" "}
                    <div style={css(`font-size:19px;font-weight:800;letter-spacing:-.02em;color:${r?.c};font-variant-numeric:tabular-nums`)}>
                      <Txt v={r?.v} />
                    </div>
                    {" "}
                    <div style={css(`font-size:9.5px;color:#94a3b8`)}>
                      <Txt v={r?.l} />
                    </div>
                    {" "}
                  </div>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
          </div>
        </div>
        {" "}
      </div>
    </div>
    {" "}
    </>
  );
}
