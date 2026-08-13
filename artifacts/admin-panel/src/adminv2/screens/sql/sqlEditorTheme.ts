/**
 * The CodeMirror surface theme shared by every SQL editor in this screen —
 * the docked `SqlEditorBody.tsx` and the floating `FloatingSqlConsole.tsx`.
 * One module so a fix to either (see the selection paint-order note below)
 * can never drift between the two editors again.
 *
 * `oneDark` (applied separately, via the `theme={oneDark}` prop on each
 * `<CodeMirror>`) is the base palette — without it CodeMirror falls back to
 * its default *light* theme almost everywhere, which is why the editor used
 * to render as a bright white box against the rest of this shell's dark
 * chrome. This override on top only repaints the couple of surfaces that
 * need to match `theme.ts` tokens exactly rather than oneDark's own dark
 * blue-grey.
 */

import { EditorView } from "@codemirror/view";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";

export const sqlEditorTheme = EditorView.theme(
  {
    "&": { backgroundColor: SURFACE.app, height: "100%" },
    ".cm-scroller": { fontFamily: FONT.mono, fontSize: "12.5px" },
    // No backgroundColor here, on purpose — see the note below. `&`'s own
    // background already shows through `.cm-content` (which paints nothing
    // of its own by default), so this still isn't a white box.
    ".cm-content": { caretColor: "#fff" },
    ".cm-gutters": { backgroundColor: SURFACE.app, borderRight: `1px solid ${LINE.subtle}`, color: TEXT.faintest },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,.03)" },
    // The actual reason selection stayed invisible through two color-only
    // fix attempts: CodeMirror's selection/cursor layers (`.cm-selectionLayer`,
    // `.cm-cursorLayer`) are DOM siblings of `.cm-content` appended straight
    // to `.cm-scroller` with a NEGATIVE z-index (`@codemirror/view`'s
    // `LayerView` — layer.above is false for selection, so it sinks behind
    // everything else in the stacking context `.cm-scroller` establishes),
    // deliberately so the highlight paints *behind* the text glyphs. That
    // only works when `.cm-content` itself has no background of its own —
    // giving it one (a prior version of this file did, redundantly matching
    // `&`'s background) paints an opaque layer ABOVE those negative-z-index
    // layers, fully hiding the selection rectangle no matter what color it
    // was set to. No color override was ever going to fix that — the fix is
    // not painting over the layer in the first place.
    ".cm-selectionBackground": { backgroundColor: `${ACCENT.info}4d` },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: `${ACCENT.info}66` },
    ".cm-tooltip, .cm-tooltip-autocomplete": { backgroundColor: SURFACE.overlay, border: `1px solid ${LINE.control}` },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: SURFACE.wellHover },
  },
  { dark: true },
);
