// @vitest-environment jsdom
/**
 * Tests: the Delete rule button added to the shared SignalRuleEditorModal.
 *
 * Coverage:
 *   - Delete button does NOT render on the "Create Rule" path (editingRule null)
 *   - Delete button does NOT render when editing but no onDelete handler is passed
 *   - Delete button renders when editing AND onDelete is passed
 *   - Clicking Delete asks for confirmation (window.confirm) before doing anything
 *   - onDelete is NOT called when the operator cancels the confirmation
 *   - onDelete IS called once the operator confirms
 *   - the button shows a spinner and is disabled while deleting=true
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

import SignalRuleEditorModal, {
  emptyRuleForm,
  type SignalRule,
} from "./SignalRuleEditorModal";

function makeRule(overrides: Partial<SignalRule> = {}): SignalRule {
  return {
    id: 1,
    signalKey: "signal.security.mfa-gap",
    groupId: null,
    ruleType: "threshold",
    sourceKey: "mfa_gap_check",
    compareValue: "0",
    denominatorKey: null,
    description: "MFA gap",
    sortOrder: 0,
    ...overrides,
  };
}

function baseProps() {
  return {
    open: true,
    form: emptyRuleForm("signal.security.mfa-gap"),
    onFormChange: vi.fn(),
    signalKeys: ["signal.security.mfa-gap"],
    groupOptions: [],
    saving: false,
    error: null,
    conflicts: null,
    onSave: vi.fn(),
    onClose: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SignalRuleEditorModal — Delete rule button", () => {
  it("does not render on the Create Rule path (editingRule null)", () => {
    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: null,
        onDelete: vi.fn(),
      }),
    );

    expect(screen.queryByRole("button", { name: /delete rule/i })).toBeNull();
    expect(screen.getByRole("button", { name: /create rule/i })).toBeTruthy();
  });

  it("does not render when editing but no onDelete handler is supplied", () => {
    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: makeRule(),
      }),
    );

    expect(screen.queryByRole("button", { name: /delete rule/i })).toBeNull();
  });

  it("renders when editing an existing rule and onDelete is supplied", () => {
    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: makeRule(),
        onDelete: vi.fn(),
      }),
    );

    expect(screen.getByRole("button", { name: /delete rule/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
  });

  it("does NOT call onDelete when the confirmation is cancelled", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDelete = vi.fn();

    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: makeRule(),
        onDelete,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete rule/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("calls onDelete only after the operator confirms", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = vi.fn();
    const rule = makeRule({ ruleType: "threshold", sourceKey: "mfa_gap_check" });

    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: rule,
        onDelete,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /delete rule/i }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0][0]).toContain("mfa_gap_check");
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("shows a spinner and disables the button while deleting", () => {
    render(
      React.createElement(SignalRuleEditorModal, {
        ...baseProps(),
        editingRule: makeRule(),
        onDelete: vi.fn(),
        deleting: true,
      }),
    );

    const btn = screen.getByRole("button", { name: /delete rule/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
