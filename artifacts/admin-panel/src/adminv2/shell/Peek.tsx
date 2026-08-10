/**
 * Peek — handle it without leaving.
 *
 * Clicking a row in any ribbon gallery opens this rather than navigating. It is
 * principle 3 made concrete: a one-off task should not move you off what you
 * were doing.
 *
 * The anatomy is identical for all ten record kinds, and that sameness is the
 * feature — ten record types that feel like one control. A screen supplies a
 * `PeekModel`; it does not get to draw its own overlay.
 *
 * Geometry and colour are lifted from `Admin Shell.dc.html` (`pk.*`): centred,
 * 620px, 12px radius, a hero whose gradient is tinted by the record's own tone,
 * facts with the value ABOVE its label, horizontal edit rows, and a footer with
 * the quiet "Open it properly" on the left.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, PRIMARY_OVERLAY, SURFACE, TEXT, Z } from "../theme";
import type { PeekAction, PeekFact, PeekModel } from "../registry/types";

export interface PeekProps {
  model: PeekModel | null;
  /** Which action id is armed, if any. Armed state lives in shell state. */
  armedActionLabel: string | null;
  onArm: (label: string) => void;
  onClose: () => void;
}

/**
 * Decides which of the two fact treatments a value gets.
 *
 * The predicate is the design's own: a bare number (optionally prefixed by a
 * currency symbol and/or suffixed with %) is a number, and so is anything four
 * characters or shorter. Everything else is prose and wraps to two lines.
 *
 * handoff.md is explicit that forcing one treatment clips, which is why this is
 * a measurement rather than a per-call choice.
 */
export function isNumericFact(fact: PeekFact): boolean {
  if (fact.prose) return false;
  const value = fact.value.trim();
  return /^[$£€]?[\d.,]+%?$/.test(value) || value.length <= 4;
}

/** Tone helpers — the design composes hex + alpha suffixes directly. */
const alpha = (tone: string, hex: string) => `${tone}${hex}`;

export function Peek({ model, armedActionLabel, onArm, onClose }: PeekProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  /**
   * Local echo of what you have typed.
   *
   * `edits[].onChange` writes through to the record, but the record is a
   * screen's state and the peek is rendered by the shell, so nothing guarantees
   * the new value comes back this render. Without a local draft the input
   * appears to revert as you type. The shell remounts this component per record
   * (see Shell.tsx), so the drafts reset on their own.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /** Whether a `datetime` edit's collapsed custom-time input is expanded. Keyed by edit key, same reset-on-remount reasoning as `drafts` above. */
  const [customTimeOpen, setCustomTimeOpen] = useState<Record<string, boolean>>({});

  // aria-modal hides everything behind this from assistive tech, so focus has
  // to come with it. Without this the first Tab lands on the title bar the
  // screen reader can no longer see.
  useEffect(() => {
    if (!model) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, [model !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model) return null;

  /** Keeps Tab inside the dialog while it owns the screen. */
  function onDialogKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const tone = model.tone ?? ACCENT.info;
  const eyebrow = (model.eyebrow ?? model.kind).toUpperCase();
  const Icon = model.icon;

  return (
    <>
      <div
        className="av2-scrim-in"
        onPointerDown={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z.peekBackdrop,
          background: "rgba(6,10,14,.62)",
          backdropFilter: "blur(2px)",
        }}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="av2-overlay-centre"
        role="dialog"
        aria-modal="true"
        aria-label={`${eyebrow}: ${model.title}`}
        style={{
          position: "fixed",
          zIndex: Z.peek,
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(620px, 92vw)",
          maxHeight: "min(640px, 86vh)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 12,
          border: `1px solid ${LINE.control}`,
          background: SURFACE.app,
          boxShadow: "0 32px 80px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        {/* ── Hero ── */}
        <div
          style={{
            flex: "none",
            padding: "20px 20px 0",
            background: `linear-gradient(160deg, ${alpha(tone, "10")}, ${SURFACE.app} 62%)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div
              style={{
                flex: "none",
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 11,
                border: `1px solid ${alpha(tone, "38")}`,
                background: alpha(tone, "1a"),
                color: tone,
              }}
            >
              <Icon size={20} strokeWidth={1.7} />
            </div>

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".13em",
                  textTransform: "uppercase",
                  color: tone,
                }}
              >
                {eyebrow}
              </span>
              <span
                style={{
                  fontSize: 21,
                  fontWeight: 700,
                  letterSpacing: "-.02em",
                  lineHeight: 1.2,
                  color: TEXT.primary,
                  textWrap: "pretty",
                } as CSSProperties}
              >
                {model.title}
              </span>
              {model.sub && (
                <span
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: TEXT.groupLabel,
                    textWrap: "pretty",
                  } as CSSProperties}
                >
                  {model.sub}
                </span>
              )}
            </div>

            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 7 }}>
              {model.tag && (
                <span
                  style={{
                    flex: "none",
                    whiteSpace: "nowrap",
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: `1px solid ${model.tagTone ?? LINE.control}`,
                    background: model.tagTone ? alpha(model.tagTone, "16") : "transparent",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: model.tagTone ?? TEXT.dimmer,
                  }}
                >
                  {model.tag}
                </span>
              )}
              <button
                className="av2-ghost"
                onClick={onClose}
                title="Close · Esc"
                aria-label="Close"
                style={{
                  flex: "none",
                  width: 26,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: 0,
                  borderRadius: 5,
                  color: TEXT.caption,
                  cursor: "pointer",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={14}
                  height={14}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          {model.facts && model.facts.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 20,
                marginTop: 18,
                padding: "15px 2px 16px",
                borderTop: `1px solid ${LINE.quiet}`,
                flexWrap: "wrap",
              }}
            >
              {model.facts.map((fact) => {
                const numeric = isNumericFact(fact);
                return (
                  <div
                    key={fact.label}
                    style={{
                      // Numbers hug their width; prose is given a column to wrap in.
                      flex: numeric ? "0 1 auto" : "1 1 110px",
                      minWidth: numeric ? 64 : 96,
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    {/* Value above label — the design's order, and it reads as a
                        figure with a caption rather than a form field. */}
                    <span
                      style={
                        numeric
                          ? {
                              fontSize: 19,
                              fontWeight: 800,
                              letterSpacing: "-.025em",
                              lineHeight: 1,
                              whiteSpace: "nowrap",
                              color: fact.color ?? TEXT.primary,
                            }
                          : ({
                              fontSize: 12.5,
                              fontWeight: 600,
                              letterSpacing: "-.005em",
                              lineHeight: 1.35,
                              color: fact.color ?? TEXT.strong,
                              wordBreak: "break-word",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            } as CSSProperties)
                      }
                    >
                      {fact.value}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: TEXT.metaAlt,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {fact.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div data-noscrollbar="true" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 0 4px" }}>
          {model.note && (
            <div
              style={{
                margin: "14px 20px 0",
                padding: "9px 13px",
                borderRadius: 8,
                border: "1px solid rgba(127,174,145,.32)",
                background: "rgba(127,174,145,.1)",
                fontSize: 12,
                color: ACCENT_TEXT.green,
              }}
            >
              {model.note}
            </div>
          )}

          {model.edits && model.edits.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "16px 20px 4px",
              }}
            >
              <SectionRule label="Edit it here" />
              {model.edits.map((edit) => (
                <div
                  key={edit.key}
                  style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}
                >
                  <label
                    htmlFor={`peek-${edit.key}`}
                    style={{
                      flex: "0 0 108px",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 11.5,
                      color: TEXT.groupLabel,
                    }}
                  >
                    {edit.label}
                  </label>
                  {edit.datetime ? (
                    <DatetimeEdit
                      value={drafts[edit.key] ?? edit.value}
                      onChange={(next) => {
                        setDrafts((d) => ({ ...d, [edit.key]: next }));
                        edit.onChange(next);
                      }}
                      open={!!customTimeOpen[edit.key]}
                      onToggleOpen={() =>
                        setCustomTimeOpen((s) => ({ ...s, [edit.key]: !s[edit.key] }))
                      }
                    />
                  ) : edit.options ? (
                    <button
                      id={`peek-${edit.key}`}
                      onClick={() => {
                        const options = edit.options!;
                        const current = drafts[edit.key] ?? edit.value;
                        const next = options[(options.indexOf(current) + 1) % options.length]!;
                        setDrafts((d) => ({ ...d, [edit.key]: next }));
                        edit.onChange(next);
                      }}
                      title={`Cycles through: ${edit.options.join(", ")}`}
                      style={{
                        ...editBase(edit.mono),
                        cursor: "pointer",
                        textAlign: "left",
                        color: ACCENT.info,
                      }}
                    >
                      {drafts[edit.key] ?? edit.value}
                    </button>
                  ) : edit.area ? (
                    <textarea
                      id={`peek-${edit.key}`}
                      value={drafts[edit.key] ?? edit.value}
                      onChange={(event) => { const v = event.target.value; setDrafts((d) => ({ ...d, [edit.key]: v })); edit.onChange(v); }}
                      style={{
                        ...editBase(edit.mono),
                        height: 74,
                        padding: "9px 11px",
                        lineHeight: 1.55,
                        flex: "1 1 100%",
                      }}
                    />
                  ) : (
                    <input
                      id={`peek-${edit.key}`}
                      value={drafts[edit.key] ?? edit.value}
                      onChange={(event) => { const v = event.target.value; setDrafts((d) => ({ ...d, [edit.key]: v })); edit.onChange(v); }}
                      style={editBase(edit.mono)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {model.body && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "16px 20px 4px",
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  letterSpacing: ".11em",
                  textTransform: "uppercase",
                  color: TEXT.metaAlt,
                }}
              >
                {model.body.title}
              </span>
              <pre
                data-noscrollbar="true"
                style={{
                  margin: 0,
                  padding: "13px 15px",
                  borderRadius: 9,
                  border: `1px solid ${LINE.quiet}`,
                  background: SURFACE.root,
                  fontFamily: FONT.mono,
                  fontSize: 11,
                  lineHeight: 1.7,
                  color: ACCENT_TEXT.neutral,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 180,
                  overflow: "auto",
                }}
              >
                {model.body.content}
              </pre>
            </div>
          )}

          {model.list && model.list.rows.length > 0 && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 1, padding: "18px 0 14px" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "0 20px" }}>
                <span
                  style={{
                    flex: "none",
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: ".11em",
                    textTransform: "uppercase",
                    color: TEXT.metaAlt,
                  }}
                >
                  {model.list.title}
                </span>
                <div style={{ flex: 1, height: 1, background: LINE.quiet }} />
                <span style={{ flex: "none", fontSize: 11, color: TEXT.faintest }}>
                  {model.list.rows.length}
                </span>
              </div>

              {model.list.rows.map((row) => (
                <div
                  key={row.id}
                  className={row.onSelect ? "av2-row" : undefined}
                  onClick={row.onSelect}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 20px",
                    borderBottom: `1px solid ${LINE.subtle}`,
                    cursor: row.onSelect ? "pointer" : "default",
                  }}
                >
                  {row.mark && (
                    <span
                      style={{
                        flex: "none",
                        minWidth: 52,
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        padding: "3px 8px",
                        borderRadius: 5,
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        background: alpha(row.tone ?? TEXT.caption, "1e"),
                        color: row.tone ?? TEXT.caption,
                      }}
                    >
                      {row.mark}
                    </span>
                  )}
                  <div
                    style={{
                      flex: "1 1 160px",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12.5,
                        color: TEXT.strong,
                      }}
                    >
                      {row.name}
                    </span>
                    {row.sub && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 11,
                          color: TEXT.metaAlt,
                        }}
                      >
                        {row.sub}
                      </span>
                    )}
                  </div>
                  {row.right && (
                    <span
                      style={{
                        flex: "none",
                        whiteSpace: "nowrap",
                        fontFamily: FONT.mono,
                        fontSize: 11,
                        color: TEXT.metaAlt,
                      }}
                    >
                      {row.right}
                    </span>
                  )}
                  {row.onSelect && (
                    <span style={{ flex: "none", fontSize: 15, color: "#5f5d5b" }}>›</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "13px 20px",
            borderTop: `1px solid ${LINE.quiet}`,
            background: SURFACE.chrome,
            borderRadius: "0 0 12px 12px",
          }}
        >
          {model.open && (
            <button
              onClick={() => {
                const open = model.open;
                onClose();
                open?.();
              }}
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                padding: "7px 0",
                border: 0,
                background: "transparent",
                color: TEXT.metaAlt,
                fontFamily: FONT.sans,
                fontSize: 11.5,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              {model.openLabel ?? "Open it properly"}
            </button>
          )}

          <div style={{ flex: 1, minWidth: 4 }} />

          {(model.actions ?? []).map((action) => (
            <ActionButton
              key={action.label}
              action={action}
              armed={armedActionLabel === action.label}
              onArm={() => onArm(action.label)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function editBase(mono?: boolean): CSSProperties {
  return {
    flex: "1 1 150px",
    minWidth: 0,
    height: 30,
    padding: "0 11px",
    borderRadius: 6,
    border: `1px solid ${LINE.control}`,
    background: SURFACE.root,
    color: TEXT.strong,
    outline: "none",
    fontFamily: mono ? FONT.mono : FONT.sans,
    fontSize: 12.5,
  };
}

// ─── Datetime edit (Git #711) ──────────────────────────────────────────────
//
// ADHD-friendly single-tap scheduling: quick-pick chips resolve straight to
// an ISO datetime and write through immediately, same as every other
// `PeekEdit`. No calendar grid, no typing as the primary path — typing only
// exists behind the collapsed "Pick a different time" toggle, via the one
// `datetime-local` input already used elsewhere in the app
// (`SimulatorOverridesPanel.tsx`'s Expires At field), given `color-scheme:
// dark` so its native popup doesn't render white-on-white against this
// theme.

function startOfDayAt(date: Date, hours: number, minutes = 0): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Always strictly in the future — 7 days out if `from` is itself a Monday. */
function nextMonday(from: Date): Date {
  const diff = (8 - from.getDay()) % 7 || 7;
  return addDays(from, diff);
}

function quickPicks(now: Date): Array<{ label: string; date: Date }> {
  const picks: Array<{ label: string; date: Date }> = [];
  const todayFivePm = startOfDayAt(now, 17, 0);
  if (todayFivePm.getTime() > now.getTime()) picks.push({ label: "Today 5pm", date: todayFivePm });
  picks.push({ label: "Tomorrow 9am", date: startOfDayAt(addDays(now, 1), 9, 0) });
  const thisAfternoon = startOfDayAt(now, 14, 0);
  if (thisAfternoon.getTime() > now.getTime()) picks.push({ label: "This afternoon", date: thisAfternoon });
  picks.push({ label: "Next Monday 9am", date: startOfDayAt(nextMonday(now), 9, 0) });
  return picks;
}

/** `datetime-local` inputs read/write local wall-clock time with no zone — this is the one conversion point. */
function isoToLocalInputValue(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPlain(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DatetimeEdit({
  value,
  onChange,
  open,
  onToggleOpen,
}: {
  value: string;
  onChange: (next: string) => void;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const picks = quickPicks(new Date());
  const plain = formatPlain(value);

  return (
    <div style={{ flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {picks.map((pick) => (
          <button
            key={pick.label}
            type="button"
            onClick={() => onChange(pick.date.toISOString())}
            style={{
              flex: "none",
              padding: "5px 11px",
              borderRadius: 999,
              border: `1px solid ${alpha(ACCENT.info, "38")}`,
              background: alpha(ACCENT.info, "12"),
              color: ACCENT_TEXT.neutral,
              fontFamily: FONT.sans,
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            {pick.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleOpen}
          style={{
            flex: "none",
            padding: "5px 11px",
            borderRadius: 999,
            border: `1px solid ${LINE.control}`,
            background: "transparent",
            color: TEXT.metaAlt,
            fontFamily: FONT.sans,
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          {open ? "Hide custom time" : "Pick a different time"}
        </button>
      </div>

      {open && (
        <input
          type="datetime-local"
          value={isoToLocalInputValue(value)}
          onChange={(event) => {
            const local = event.target.value;
            if (!local) return;
            const parsed = new Date(local);
            if (Number.isNaN(parsed.getTime())) return;
            onChange(parsed.toISOString());
          }}
          style={{ ...editBase(false), flex: "none", width: 220, colorScheme: "dark" } as CSSProperties}
        />
      )}

      <span style={{ fontSize: 11.5, color: TEXT.metaAlt }}>
        {plain || "Not scheduled yet"}
      </span>
    </div>
  );
}

function SectionRule({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
      <span
        style={{
          flex: "none",
          fontSize: 9.5,
          fontWeight: 800,
          letterSpacing: ".11em",
          textTransform: "uppercase",
          color: TEXT.metaAlt,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: LINE.quiet }} />
    </div>
  );
}

function ActionButton({
  action,
  armed,
  onArm,
}: {
  action: PeekAction;
  armed: boolean;
  onArm: () => void;
}) {
  const primary = action.tone === "primary";
  const danger = action.tone === "danger";

  return (
    <button
      onClick={() => {
        // Armed in place — no second dialog. The user does not want to be taken
        // away from what they were doing for a one-off.
        if (action.confirm && !armed) {
          onArm();
          return;
        }
        action.onSelect();
      }}
      title={
        action.confirm
          ? armed
            ? "Press again to do it. There is no undo."
            : "You will get one more press to change your mind."
          : action.label
      }
      style={{
        flex: "none",
        whiteSpace: "nowrap",
        padding: "8px 17px",
        borderRadius: 6,
        fontFamily: FONT.sans,
        fontSize: 12.5,
        cursor: "pointer",
        fontWeight: primary || armed ? 600 : 500,
        border: primary
          ? 0
          : `1px solid ${danger ? "rgba(229,122,122,.35)" : LINE.control}`,
        background: primary ? PRIMARY_OVERLAY : armed ? "rgba(229,122,122,.16)" : "transparent",
        color: primary ? "#fff" : danger ? ACCENT_TEXT.danger : TEXT.quieter,
        transition: "background 120ms",
      }}
    >
      {armed ? `${action.label} — press again` : action.label}
    </button>
  );
}
