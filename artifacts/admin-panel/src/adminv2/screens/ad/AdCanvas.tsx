/**
 * Active Directory canvas — dispatches on `ctx.kind` to the right record
 * canvas. This is the "ad" screen's `render`, i.e. what a screen contributes
 * per SHELL.md; the shell owns everything around it (tabs, ribbon, panels).
 */

import type { ScreenRenderContext } from "../../registry/types";
import type { DirectoryGroupRole } from "./adTypes";
import { AdEmptyCanvas } from "./canvases/AdEmptyCanvas";
import { AdMspCanvas } from "./canvases/AdMspCanvas";
import { AdCustomerCanvas } from "./canvases/AdCustomerCanvas";
import { AdUserCanvas } from "./canvases/AdUserCanvas";
import { AdGroupCanvas } from "./canvases/AdGroupCanvas";
import { AdOuCanvas } from "./canvases/AdOuCanvas";

export function AdCanvas(ctx: ScreenRenderContext) {
  if (!ctx.kind || !ctx.recordId) return <AdEmptyCanvas />;

  switch (ctx.kind) {
    case "msp":
      return <AdMspCanvas mspId={Number(ctx.recordId)} />;
    case "customer":
      return <AdCustomerCanvas customerId={Number(ctx.recordId)} />;
    case "user":
      return <AdUserCanvas userId={Number(ctx.recordId)} />;
    case "group":
      return <AdGroupCanvas role={ctx.recordId as DirectoryGroupRole} />;
    case "ou":
      return <AdOuCanvas ouId={Number(ctx.recordId)} />;
    default:
      return <AdEmptyCanvas />;
  }
}
