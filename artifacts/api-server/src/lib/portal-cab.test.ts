/**
 * portal-cab.test.ts — the Change Advisory Board pure derivations (Git #1501).
 *
 * These decide what an agenda item is allowed to be, when a meeting can close,
 * and what a compiled set of minutes reads like. Pure over stored values, same
 * discipline as `portal-change-approvals.test.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  buildMinutes,
  canCloseMeeting,
  isMeetingOpen,
  isRetroactiveForMeetingType,
  meetingTypeForChangeClass,
  summarizeAgenda,
} from "./portal-cab";

describe("meetingTypeForChangeClass", () => {
  it("routes an emergency change to the ECAB", () => {
    expect(meetingTypeForChangeClass("emergency")).toBe("ecab");
  });
  it("routes a normal change to the standing CAB", () => {
    expect(meetingTypeForChangeClass("normal")).toBe("cab");
  });
});

describe("isRetroactiveForMeetingType", () => {
  it("every ECAB item is retroactive by definition", () => {
    expect(isRetroactiveForMeetingType("ecab")).toBe(true);
  });
  it("a standing CAB item is never retroactive", () => {
    expect(isRetroactiveForMeetingType("cab")).toBe(false);
  });
});

describe("isMeetingOpen", () => {
  it("scheduled and in_progress meetings are open", () => {
    expect(isMeetingOpen("scheduled")).toBe(true);
    expect(isMeetingOpen("in_progress")).toBe(true);
  });
  it("completed and cancelled meetings are closed", () => {
    expect(isMeetingOpen("completed")).toBe(false);
    expect(isMeetingOpen("cancelled")).toBe(false);
  });
});

describe("canCloseMeeting", () => {
  it("an empty agenda is closeable trivially", () => {
    expect(canCloseMeeting([])).toBe(true);
  });
  it("every item needing a recommendation blocks close", () => {
    expect(canCloseMeeting([{ recommendation: "approve" }, { recommendation: null }])).toBe(false);
  });
  it("approve/reject/defer on every item allows close", () => {
    expect(canCloseMeeting([{ recommendation: "approve" }, { recommendation: "reject" }, { recommendation: "defer" }])).toBe(true);
  });
});

describe("summarizeAgenda", () => {
  it("counts each bucket, and retroactive independently of recommendation", () => {
    const summary = summarizeAgenda([
      { recommendation: "approve", isRetroactive: true },
      { recommendation: "reject", isRetroactive: false },
      { recommendation: "defer", isRetroactive: false },
      { recommendation: null, isRetroactive: true },
    ]);
    expect(summary).toEqual({ total: 4, approved: 1, rejected: 1, deferred: 1, undecided: 1, retroactive: 2 });
  });
});

describe("buildMinutes", () => {
  const meeting = {
    meetingType: "cab" as const,
    scheduledFor: new Date("2026-09-01T14:00:00Z"),
    chairName: "Dana Ops",
    location: "Teams call",
  };

  it("names the standing board and states the chair/location", () => {
    const text = buildMinutes(meeting, []);
    expect(text).toContain("Change Advisory Board (CAB)");
    expect(text).toContain("Chair: Dana Ops");
    expect(text).toContain("Location: Teams call");
    expect(text).toContain("(no items on this agenda)");
  });

  it("names the emergency board for an ecab meeting", () => {
    const text = buildMinutes({ ...meeting, meetingType: "ecab" }, []);
    expect(text).toContain("Emergency Change Advisory Board (ECAB)");
  });

  it("lists agenda items in ordinal order with their recommendation, marking retroactive items", () => {
    const text = buildMinutes(meeting, [
      {
        ordinal: 2,
        change: { code: "CR-2026-102", title: "Revoke stale guest access" },
        presenterName: "Priya Raman",
        discussionNotes: "No objections.",
        recommendation: "approve",
        isRetroactive: false,
      },
      {
        ordinal: 1,
        change: { code: "CR-2026-101", title: "Tighten transport rule" },
        presenterName: "",
        discussionNotes: "",
        recommendation: "reject",
        isRetroactive: true,
      },
    ]);
    const idx101 = text.indexOf("CR-2026-101");
    const idx102 = text.indexOf("CR-2026-102");
    expect(idx101).toBeGreaterThan(-1);
    expect(idx102).toBeGreaterThan(idx101);
    expect(text).toContain("CR-2026-101 — Tighten transport rule [retroactive]");
    expect(text).toContain("Recommendation: REJECT");
    expect(text).toContain("Presented by: Priya Raman");
    expect(text).toContain("Discussion: No objections.");
  });

  it("shows UNDECIDED for a null recommendation", () => {
    const text = buildMinutes(meeting, [
      {
        ordinal: 1,
        change: { code: "CR-2026-103", title: "Pending item" },
        presenterName: "",
        discussionNotes: "",
        recommendation: null,
        isRetroactive: false,
      },
    ]);
    expect(text).toContain("Recommendation: UNDECIDED");
  });
});
