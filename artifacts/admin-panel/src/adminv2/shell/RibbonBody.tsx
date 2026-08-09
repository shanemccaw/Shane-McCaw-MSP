/**
 * Ribbon body — the control surface itself.
 *
 * Group anatomy (handoff.md section 3): a group may carry a `combos` picker, a
 * `large` button, `small` stacked commands, and a `row`. When a group has both
 * a combo and a row, the combo sits left and the row stacks vertically beside
 * it.
 *
 * The body is 108px and the group caption gets 17px of that. Growing the body
 * without growing the caption budget clips the caption — that is why both live
 * in `METRICS` rather than as literals here.
 */

import { useRef, type CSSProperties } from "react";
import { FONT, LINE, METRICS, SURFACE, TEXT, WASH } from "../theme";
import type { GallerySpec, RibbonCombo, RibbonCommand, RibbonGroup } from "../registry/types";
import { getLiveRibbonEntry, useLiveRibbonVersion } from "./liveRibbon";

export interface RibbonBodyProps {
  open: boolean;
  groups: RibbonGroup[];
  /** Called when a gallery-bearing command is pressed, with the button's screen rect. */
  onOpenGallery?: (spec: GallerySpec, anchor: { left: number; top: number }) => void;
}

function largeStyle(on: boolean): CSSProperties {
  return {
    width: 68,
    minHeight: 64,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    padding: "6px 3px",
    background: on ? WASH.selected : "transparent",
    border: `1px solid ${on ? WASH.selectedBorder : "transparent"}`,
    borderRadius: 4,
    color: TEXT.strong,
    cursor: "pointer",
    fontFamily: FONT.sans,
    fontSize: 11,
    lineHeight: 1.25,
    textAlign: "center",
    transition: "background 150ms, border-color 150ms",
  };
}

function smallStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px 3px 5px",
    background: on ? WASH.selected : "transparent",
    border: `1px solid ${on ? WASH.selectedBorder : "transparent"}`,
    borderRadius: 4,
    color: TEXT.strong,
    cursor: "pointer",
    fontFamily: FONT.sans,
    fontSize: 11.5,
    whiteSpace: "nowrap",
    transition: "background 150ms, border-color 150ms",
  };
}

function CommandButton({
  command,
  variant,
  onOpenGallery,
}: {
  command: RibbonCommand;
  variant: "large" | "small" | "row";
  onOpenGallery?: RibbonBodyProps["onOpenGallery"];
}) {
  useLiveRibbonVersion();
  const overlay = command.liveKey ? getLiveRibbonEntry(command.liveKey) : undefined;
  const label = overlay?.label ?? command.label;
  const color = overlay?.color ?? command.color;

  const Icon = command.icon;
  const on = overlay?.active ?? !!command.active;
  const iconSize = variant === "large" ? 24 : variant === "small" ? 15 : 14;
  const strokeWidth = variant === "large" ? 1.5 : 1.7;
  const ref = useRef<HTMLButtonElement>(null);

  function handleClick() {
    if (command.gallery && onOpenGallery) {
      // Drop the panel from the button's bottom-left, so a gallery always
      // appears under the control that opened it.
      const rect = ref.current?.getBoundingClientRect();
      onOpenGallery(command.gallery, {
        left: rect?.left ?? 0,
        top: (rect?.bottom ?? 0) + 4,
      });
      return;
    }
    command.onSelect();
  }

  return (
    <button
      ref={ref}
      className="av2-cmd"
      title={command.title ?? label}
      disabled={command.disabled}
      aria-haspopup={command.gallery ? "dialog" : undefined}
      onClick={handleClick}
      style={variant === "large" ? largeStyle(on) : smallStyle(on)}
    >
      <Icon
        size={iconSize}
        strokeWidth={strokeWidth}
        color={color ?? TEXT.quiet}
        style={{ flex: "none" }}
      />
      <span style={{ textWrap: "pretty" } as CSSProperties}>{label}</span>
      {command.live !== undefined && command.live !== "" && (
        <span
          style={{
            fontSize: variant === "large" ? 13 : 11,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: color ?? TEXT.primary,
          }}
        >
          {command.live}
        </span>
      )}
    </button>
  );
}

function ComboButton({ combo }: { combo: RibbonCombo }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: TEXT.groupLabel, whiteSpace: "nowrap" }}>
        {combo.label}
      </span>
      <button
        className="av2-cmd"
        onClick={combo.onSelect}
        title={combo.title ?? combo.label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 108,
          maxWidth: 160,
          height: 24,
          padding: "0 8px",
          background: SURFACE.well,
          border: `1px solid ${LINE.control}`,
          borderRadius: 4,
          color: TEXT.primary,
          fontFamily: FONT.sans,
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          {combo.value}
        </span>
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flex: "none", opacity: 0.7 }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

function Group({
  group,
  onOpenGallery,
}: {
  group: RibbonGroup;
  onOpenGallery?: RibbonBodyProps["onOpenGallery"];
}) {
  const combos = group.combos ?? [];
  const row = group.row ?? [];
  const large = group.large ?? [];
  const small = group.small ?? [];
  const hasCombo = combos.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 10px",
        borderRight: `1px solid ${LINE.group}`,
        flex: "none",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, flex: 1 }}>
        {(hasCombo || row.length > 0) && (
          <div
            style={{
              display: "flex",
              // A combo pushes the row into a vertical stack beside it; without
              // one the row is an ordinary horizontal run of commands.
              flexDirection: hasCombo ? "row" : "column",
              alignItems: "flex-start",
              gap: hasCombo ? 8 : 3,
            }}
          >
            {combos.map((combo) => (
              <ComboButton key={combo.label} combo={combo} />
            ))}
            {row.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: hasCombo ? "column" : "row",
                  gap: hasCombo ? 1 : 3,
                }}
              >
                {row.map((command) => (
                  <CommandButton key={command.label} command={command} variant="row" onOpenGallery={onOpenGallery} />
                ))}
              </div>
            )}
          </div>
        )}

        {large.map((command) => (
          <CommandButton key={command.label} command={command} variant="large" onOpenGallery={onOpenGallery} />
        ))}

        {small.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {small.map((command) => (
              <CommandButton key={command.label} command={command} variant="small" onOpenGallery={onOpenGallery} />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          flex: "none",
          height: METRICS.ribbonGroupCaption,
          display: "flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          fontSize: 10.5,
          color: TEXT.groupLabel,
        }}
      >
        {group.label}
      </div>
    </div>
  );
}

export function RibbonBody({ open, groups, onOpenGallery }: RibbonBodyProps) {
  return (
    <div
      style={{
        flex: "none",
        overflow: "hidden",
        background: SURFACE.app,
        height: open ? METRICS.ribbonBody : 0,
        transition: "height 200ms ease",
      }}
    >
      <div
        data-noscrollbar="true"
        role="toolbar"
        aria-label="Ribbon commands"
        style={{
          display: "flex",
          alignItems: "stretch",
          height: METRICS.ribbonBody,
          padding: "5px 6px 0",
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {groups.map((group, index) => (
          <Group key={`${group.label}:${index}`} group={group} onOpenGallery={onOpenGallery} />
        ))}
      </div>
    </div>
  );
}
