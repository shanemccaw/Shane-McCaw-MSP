import React from "react";
import type { CSSProperties } from "react";

/**
 * Assets copied from the design bundle live in public/war-room/, which Vite serves
 * at the app's base URL. msp-portal requires BASE_PATH (vite.config.ts) and is served
 * under /portal, so this must go through BASE_URL — a root-absolute "/war-room/"
 * resolves above the base and 404s everywhere except a base of "/".
 */
const ASSET_BASE = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}war-room/`;

type ImageSlotProps = {
  id?: string;
  src?: string;
  /** Design shapes: rect | rounded | circle | pill. */
  shape?: string;
  radius?: string | number;
  alt?: string;
  style?: CSSProperties;
};

function radiusFor(shape: string | undefined, radius: string | number | undefined): string {
  if (shape === "circle") return "50%";
  if (shape === "pill") return "9999px";
  if (shape === "rect") return "0";
  if (radius === undefined || radius === "") return "12px";
  return typeof radius === "number" ? `${radius}px` : /\D/.test(radius) ? radius : `${radius}px`;
}

/**
 * Port of the design bundle's `<image-slot>` custom element.
 *
 * In the design tool the slot is a drop target that persists a user-supplied image to a
 * sidecar file. None of that applies here — in the portal it is simply the avatar frame,
 * so this renders the resolved image and falls back to an empty tinted well when a
 * participant has no photo (which is the prototype's own unfilled appearance).
 */
export function ImageSlot({ src, shape, radius, alt, style }: ImageSlotProps): React.ReactElement {
  const resolved = !src ? "" : /^(https?:|data:|\/)/.test(src) ? src : ASSET_BASE + src;
  const borderRadius = radiusFor(shape, radius);

  return (
    <div
      style={{
        overflow: "hidden",
        flex: "none",
        background: "rgba(30,41,59,.75)",
        ...style,
        borderRadius,
      }}
    >
      {resolved ? (
        <img
          src={resolved}
          alt={alt ?? ""}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius }}
        />
      ) : null}
    </div>
  );
}
