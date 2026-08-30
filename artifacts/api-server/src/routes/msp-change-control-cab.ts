/**
 * msp-change-control-cab.ts — the Change Advisory Board (Git #1501): membership,
 * meetings, agenda, and the ECAB retroactive path.
 *
 * ── Why this lives on the MSP operator surface, not the customer portal ──────
 * A CAB is convened, chaired and minuted by the MSP — the same posture as
 * `msp-changes.ts` next to it. Membership can include customer-side people
 * (`cab_members.side = 'customer'`), and a member's identity is the same
 * `u<userId>` person id the #1496 approval ledger already uses, but scheduling
 * a meeting, building its agenda and recording its decisions are MSP actions.
 * Floors at `MSPOperator` + `resolveMspIdStrict`, matching every other
 * session-scoped `/msp/...` route with no `:mspId` in the URL.
 *
 * ── SCOPE STOP (Git #1501) ────────────────────────────────────────────────
 * This route, its store and its pure derivations are the full deliverable —
 * schema, migration, routes, Wire* interfaces. There is no UI to wire:
 * `artifacts/portal` has no pages and `Design/portal/` carries no export for
 * this surface. Nothing here is called from a page; it is proven against the
 * local database directly (see the build's bookend for the verification
 * queries run).
 *
 * ── One approval model ────────────────────────────────────────────────────
 * The `/agenda/:id/decision` endpoint is the only place a CAB decision is
 * recorded, and it writes through `recordAgendaDecision` in
 * `portal-cab-store.ts`, which calls the SAME `recordApproval` /
 * `recordRejection` the customer register uses (#1496). There is no second
 * approval table and no bespoke CAB decision state — see that file's header.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { logger } from "../lib/logger";
import {
  addOrUpdateMember,
  addAgendaItem,
  cancelMeeting,
  closeMeeting,
  deferAgendaItem,
  eligibleChangesForAgenda,
  getMeeting,
  listAgendaWithChanges,
  listMeetings,
  listMembers,
  recordAgendaDecision,
  removeMember,
  scheduleMeeting,
  startMeeting,
  updateAgendaItemNotes,
  type ApproverIdentity,
} from "../lib/portal-cab-store";
import { CAB_MEETING_TYPES, CAB_MEMBER_ROLES, CAB_MEMBER_SIDES, summarizeAgenda, toWireCabAgendaItem, toWireCabMeeting, toWireCabMember } from "../lib/portal-cab";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function mspContext(req: Request, res: Response): number | null {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return null;
  }
  return mspId;
}

/** The acting operator's identity for the #1496 approval store — always `msp` side from this surface. */
function operatorIdentity(req: Request): ApproverIdentity {
  const user = req.user!;
  return {
    personId: personIdForUser(user.id),
    name: (user.email ?? "").trim() || `User ${user.id}`,
    email: user.email ?? "",
    // No customer context on this surface — 0 is the established "no MSP/customer
    // context" sentinel elsewhere (resolveMspIdOrZero); resolveDelegatedAuthority
    // will never match a real delegation against it, which is correct: MSP-side
    // decisions are never made "on behalf of" a customer delegation.
    customerId: 0,
    role: "msp",
  };
}

// ── Membership ───────────────────────────────────────────────────────────────

const addMemberSchema = z.object({
  personId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  role: z.enum(CAB_MEMBER_ROLES).default("voting"),
  side: z.enum(CAB_MEMBER_SIDES),
  tenantId: z.string().trim().max(200).optional(),
  isEcab: z.boolean().default(false),
});

router.get("/msp/change-control/cab/members", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  try {
    const activeOnly = req.query.activeOnly !== "false";
    const ecabOnly = req.query.ecabOnly === "true";
    const rows = await listMembers(mspId, { activeOnly, ecabOnly });
    res.json({ members: rows.map(toWireCabMember) });
  } catch (err) {
    log.error({ err, mspId }, "GET /msp/change-control/cab/members failed");
    res.status(500).json({ error: "Failed to load CAB membership" });
  }
});

router.post("/msp/change-control/cab/members", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  if (parsed.data.side === "msp" && parsed.data.tenantId) {
    res.status(400).json({ error: "An MSP-side member attends board-wide and cannot be scoped to a single tenant" });
    return;
  }
  try {
    const member = await addOrUpdateMember(mspId, {
      personId: parsed.data.personId,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      side: parsed.data.side,
      tenantId: parsed.data.tenantId ?? null,
      isEcab: parsed.data.isEcab,
    });
    res.status(201).json({ member: toWireCabMember(member) });
  } catch (err) {
    log.error({ err, mspId }, "POST /msp/change-control/cab/members failed");
    res.status(500).json({ error: "Failed to add CAB member" });
  }
});

router.delete("/msp/change-control/cab/members/:id", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const memberId = Number(req.params.id);
  if (!Number.isInteger(memberId)) {
    res.status(400).json({ error: "Invalid member id" });
    return;
  }
  try {
    const removed = await removeMember(mspId, memberId);
    if (!removed) {
      res.status(404).json({ error: "Active CAB member not found" });
      return;
    }
    res.status(200).json({ removed: true });
  } catch (err) {
    log.error({ err, mspId, memberId }, "DELETE /msp/change-control/cab/members/:id failed");
    res.status(500).json({ error: "Failed to remove CAB member" });
  }
});

// ── Meetings ─────────────────────────────────────────────────────────────────

const scheduleMeetingSchema = z.object({
  meetingType: z.enum(CAB_MEETING_TYPES).default("cab"),
  scheduledFor: z.string().datetime(),
  chairPersonId: z.string().trim().max(64).optional(),
  chairName: z.string().trim().max(200).default(""),
  location: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(4_000).default(""),
});

router.get("/msp/change-control/cab/meetings", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  try {
    const meetings = await listMeetings(mspId);
    const withSummary = await Promise.all(
      meetings.map(async (m) => {
        const { items } = await listAgendaWithChanges(mspId, m.id);
        return toWireCabMeeting(m, summarizeAgenda(items.map((i) => i.row)));
      }),
    );
    res.json({ meetings: withSummary });
  } catch (err) {
    log.error({ err, mspId }, "GET /msp/change-control/cab/meetings failed");
    res.status(500).json({ error: "Failed to load CAB meetings" });
  }
});

router.post("/msp/change-control/cab/meetings", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const parsed = scheduleMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const meeting = await scheduleMeeting(mspId, {
      meetingType: parsed.data.meetingType,
      scheduledFor: new Date(parsed.data.scheduledFor),
      chairPersonId: parsed.data.chairPersonId ?? null,
      chairName: parsed.data.chairName,
      location: parsed.data.location,
      notes: parsed.data.notes,
    });
    res.status(201).json({ meeting: toWireCabMeeting(meeting, summarizeAgenda([])) });
  } catch (err) {
    log.error({ err, mspId }, "POST /msp/change-control/cab/meetings failed");
    res.status(500).json({ error: "Failed to schedule CAB meeting" });
  }
});

router.get("/msp/change-control/cab/meetings/:id", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  if (!Number.isInteger(meetingId)) {
    res.status(400).json({ error: "Invalid meeting id" });
    return;
  }
  try {
    const meeting = await getMeeting(mspId, meetingId);
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    const { items } = await listAgendaWithChanges(mspId, meetingId);
    res.json({
      meeting: toWireCabMeeting(meeting, summarizeAgenda(items.map((i) => i.row))),
      agenda: items.map((i) => toWireCabAgendaItem(i.row, i.change)),
    });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "GET /msp/change-control/cab/meetings/:id failed");
    res.status(500).json({ error: "Failed to load the meeting" });
  }
});

router.post("/msp/change-control/cab/meetings/:id/start", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  try {
    const meeting = await startMeeting(mspId, meetingId);
    if (!meeting) {
      res.status(409).json({ error: "Meeting not found or not in a startable state" });
      return;
    }
    res.json({ meeting: toWireCabMeeting(meeting, summarizeAgenda([])) });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "POST /msp/change-control/cab/meetings/:id/start failed");
    res.status(500).json({ error: "Failed to start the meeting" });
  }
});

router.post("/msp/change-control/cab/meetings/:id/close", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  try {
    const result = await closeMeeting(mspId, meetingId);
    if (!result.ok) {
      res.status(result.code).json({ error: result.error });
      return;
    }
    const { items } = await listAgendaWithChanges(mspId, meetingId);
    res.json({ meeting: toWireCabMeeting(result.meeting, summarizeAgenda(items.map((i) => i.row))) });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "POST /msp/change-control/cab/meetings/:id/close failed");
    res.status(500).json({ error: "Failed to close the meeting" });
  }
});

router.post("/msp/change-control/cab/meetings/:id/cancel", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  try {
    const meeting = await cancelMeeting(mspId, meetingId);
    if (!meeting) {
      res.status(409).json({ error: "Meeting not found or already closed" });
      return;
    }
    res.json({ meeting: toWireCabMeeting(meeting, summarizeAgenda([])) });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "POST /msp/change-control/cab/meetings/:id/cancel failed");
    res.status(500).json({ error: "Failed to cancel the meeting" });
  }
});

// ── Agenda ───────────────────────────────────────────────────────────────────

router.get("/msp/change-control/cab/meetings/:id/eligible-changes", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  try {
    const meeting = await getMeeting(mspId, meetingId);
    if (!meeting) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    const eligible = await eligibleChangesForAgenda(mspId, meeting.meetingType);
    res.json({ eligible });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "GET .../eligible-changes failed");
    res.status(500).json({ error: "Failed to load eligible changes" });
  }
});

const addAgendaItemSchema = z.object({
  changeRequestId: z.number().int().positive(),
  presenterName: z.string().trim().max(200).default(""),
});

router.post("/msp/change-control/cab/meetings/:id/agenda", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const meetingId = Number(req.params.id);
  const parsed = addAgendaItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await addAgendaItem(mspId, meetingId, parsed.data.changeRequestId, parsed.data.presenterName);
    if (!result.ok) {
      res.status(result.code).json({ error: result.error });
      return;
    }
    res.status(201).json({ item: result.item });
  } catch (err) {
    log.error({ err, mspId, meetingId }, "POST .../agenda failed");
    res.status(500).json({ error: "Failed to add the agenda item" });
  }
});

const updateAgendaItemSchema = z.object({
  presenterName: z.string().trim().max(200).optional(),
  discussionNotes: z.string().trim().max(4_000).optional(),
});

router.patch("/msp/change-control/cab/agenda/:id", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const agendaItemId = Number(req.params.id);
  const parsed = updateAgendaItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const row = await updateAgendaItemNotes(mspId, agendaItemId, parsed.data);
    if (!row) {
      res.status(404).json({ error: "Agenda item not found" });
      return;
    }
    res.json({ item: row });
  } catch (err) {
    log.error({ err, mspId, agendaItemId }, "PATCH /msp/change-control/cab/agenda/:id failed");
    res.status(500).json({ error: "Failed to update the agenda item" });
  }
});

const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2_000).default(""),
});

router.post("/msp/change-control/cab/agenda/:id/decision", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const agendaItemId = Number(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await recordAgendaDecision(mspId, agendaItemId, parsed.data.decision, operatorIdentity(req), parsed.data.note);
    if (!result.ok) {
      res.status(result.code).json({ error: result.error });
      return;
    }
    log.info({ mspId, agendaItemId, decision: parsed.data.decision, complete: result.complete }, "cab: decision recorded via route");
    res.status(200).json({ item: result.item, complete: result.complete });
  } catch (err) {
    log.error({ err, mspId, agendaItemId }, "POST .../decision failed");
    res.status(500).json({ error: "Failed to record the decision" });
  }
});

const deferSchema = z.object({ deferredToMeetingId: z.number().int().positive().nullable().default(null) });

router.post("/msp/change-control/cab/agenda/:id/defer", requireAuth, requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = mspContext(req, res);
  if (mspId === null) return;
  const agendaItemId = Number(req.params.id);
  const parsed = deferSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await deferAgendaItem(mspId, agendaItemId, parsed.data.deferredToMeetingId);
    if (!result.ok) {
      res.status(result.code).json({ error: result.error });
      return;
    }
    res.json({ item: result.item });
  } catch (err) {
    log.error({ err, mspId, agendaItemId }, "POST .../defer failed");
    res.status(500).json({ error: "Failed to defer the agenda item" });
  }
});

export default router;
