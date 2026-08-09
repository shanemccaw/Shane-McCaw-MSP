// @vitest-environment jsdom
/**
 * The Deploy Console's output colorizer: whole-line rules (diff +/-, git
 * status codes, headers) take priority over word-level rules (error/warn/
 * success, insertion/deletion counts), which only apply on lines that
 * matched no whole-line rule.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ACCENT, ACCENT_TEXT, TEXT } from "../theme";
import { ColorizedOutput } from "./colorizeOutput";

function lineColors(text: string): string[] {
  const { container } = render(<ColorizedOutput text={text} />);
  return Array.from(container.children).map((el) => (el as HTMLElement).style.color);
}

/** jsdom's computed `style.color` normalizes any hex it's given to rgb(). */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("ColorizedOutput", () => {
  it("colors a diff addition line green and a removal line red", () => {
    const [added, removed] = lineColors("+new line\n-old line");
    expect(added).toBe(rgb(ACCENT_TEXT.green));
    expect(removed).toBe(rgb(ACCENT_TEXT.danger));
  });

  it("does not mistake a diffstat +++/--- file marker for an add/remove line", () => {
    const [plus, minus] = lineColors("+++ b/file.ts\n--- a/file.ts");
    expect(plus).toBe(rgb(ACCENT.info));
    expect(minus).toBe(rgb(ACCENT.info));
  });

  it("colors real git status --short codes", () => {
    const [untracked, modified, added, deleted] = lineColors(
      "?? new-file.ts\n M edited.ts\nA  staged.ts\n D removed.ts",
    );
    expect(untracked).toBe(rgb(TEXT.dim));
    expect(modified).toBe(rgb(ACCENT.amber));
    expect(added).toBe(rgb(ACCENT_TEXT.green));
    expect(deleted).toBe(rgb(ACCENT_TEXT.danger));
  });

  it("colors the git status branch header", () => {
    const [branch] = lineColors("## main...origin/main");
    expect(branch).toBe(rgb(ACCENT.info));
  });

  it("highlights insertions and deletions within a diffstat summary line, leaving the rest plain", () => {
    const { container } = render(
      <ColorizedOutput text="2 files changed, 3 insertions(+), 1 deletion(-)" />,
    );
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("3 insertions(+)");
    expect((spans[0] as HTMLElement).style.color).toBe(rgb(ACCENT_TEXT.green));
    expect(spans[1].textContent).toBe("1 deletion(-)");
    expect((spans[1] as HTMLElement).style.color).toBe(rgb(ACCENT_TEXT.danger));
  });

  it("highlights error/failed in plain output text", () => {
    const { container } = render(<ColorizedOutput text="build failed: 2 errors found" />);
    const spans = Array.from(container.querySelectorAll("span")).map((s) => s.textContent);
    expect(spans).toContain("failed");
    expect(spans).toContain("errors");
  });

  it("keeps a blank line as a real line, not collapsed away", () => {
    const { container } = render(<ColorizedOutput text={"first\n\nthird"} />);
    expect(container.children).toHaveLength(3);
    expect(container.children[1].textContent).toBe(" ");
  });
});
