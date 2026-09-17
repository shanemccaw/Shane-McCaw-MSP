/**
 * MSP Directory canvas — dispatches on `ctx.kind` to the right record
 * canvas. This is the "msp-directory" screen's `render`, i.e. what a screen contributes
 * per SHELL.md; the shell owns everything around it (tabs, ribbon, panels).
 */

import type { ScreenRenderContext } from "../../registry/types";
import type { DirectoryGroupRole } from "./dirTypes";
import { DirEmptyCanvas } from "./canvases/DirEmptyCanvas";
import { DirMspCanvas } from "./canvases/DirMspCanvas";
import { DirCustomerCanvas } from "./canvases/DirCustomerCanvas";
import { DirUserCanvas } from "./canvases/DirUserCanvas";
import { DirGroupCanvas } from "./canvases/DirGroupCanvas";
import { DirOuCanvas } from "./canvases/DirOuCanvas";

export function DirCanvas(ctx: ScreenRenderContext) {
  if (!ctx.kind || !ctx.recordId) return <DirEmptyCanvas />;

  switch (ctx.kind) {
    case "msp":
      return <DirMspCanvas mspId={Number(ctx.recordId)} />;
    case "customer":
      return <DirCustomerCanvas customerId={Number(ctx.recordId)} />;
    case "user":
      return <DirUserCanvas userId={Number(ctx.recordId)} />;
    case "group":
      return <DirGroupCanvas role={ctx.recordId as DirectoryGroupRole} />;
    case "ou":
      return <DirOuCanvas ouId={Number(ctx.recordId)} />;
    default:
      return <DirEmptyCanvas />;
  }
}
