/**
 * msp-support.ts  (Git #2672, part of #2570 "Feature: Requests and Support
 * Chat (MSP Console)")
 *
 * The MSP-operator counterpart to portal-customer-requests.ts (#1659/#1158)
 * — this is where the MSP actually responds to a customer-opened request or
 * a ShaneBot chat escalation. Both write through the identical
 * `zoho_desk_create_ticket` job into the same Zoho Desk department
 * (support-chat.ts's escalateToAdmin(), portal-customer-requests.ts's "Open
 * a Request"), so there is no separate escalation queue to build — the
 * operator's request list below IS the escalation queue; an escalated ticket
 * is identifiable by its `subject` ("Support escalation from <name>", set by
 * escalateToAdmin() in support-chat.ts) same as any other real field on the
 * ticket, not a fabricated "type" enum.
 *
 * Auth: requireRole("MSPOperator") on every route (MSPAdmin passes the same
 * gate — see requireRole's own role-hierarchy). mspId is read strictly from
 * the caller's own session (resolveMspIdStrict) — no :mspId in the URL and no
 * ?mspId= override, same discipline as msp-message-center.ts.
 *
 * Ownership: unlike the customer-scoped reads in portal-customer-requests.ts
 * (scoped to one Zoho Desk Contact), these routes are scoped to the caller's
 * MSP's own Zoho Desk org/department — see zoho-desk.ts's
 * listDeskTicketsForOrg()/getDeskTicketById()/getDeskTicketThreadForOperator()
 * docblocks for why that org header IS the ownership boundary here (a
 * foreign-MSP ticket id simply doesn't exist when queried through this MSP's
 * own org header).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger";
import { ZohoNotConnectedError, ZohoApiError } from "../lib/zoho-client.ts";
import {
  listDeskTicketsForOrg,
  getDeskTicketById,
  getDeskTicketThreadForOperator,
  enqueueZohoDeskWrite,
} from "../lib/zoho-desk.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "comms.support" });

const MAX_BODY = 5000;

function isZohoUnavailable(err: unknown): boolean {
  return err instanceof ZohoNotConnectedError;
}

// ── GET /api/msp/support/requests ───────────────────────────────────────────
// Every ticket under the caller's MSP's Zoho Desk org — customer-opened
// requests and chat escalations both live here, newest-modified first.
router.get("/msp/support/requests", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return;
  }

  const limit = Number(req.query["limit"] ?? 50);
  const offset = Number(req.query["offset"] ?? 0);

  try {
    const { tickets, count } = await listDeskTicketsForOrg(mspId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    res.json({ configured: true, requests: tickets, count });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      log.warn({ mspId }, "msp-support: Zoho Desk not connected — returning unconfigured state");
      res.json({ configured: false, requests: [], count: 0 });
      return;
    }
    log.error({ err, mspId }, "msp-support: list failed");
    res.status(500).json({ error: "We couldn't load requests right now. Please try again shortly." });
  }
});

// ── GET /api/msp/support/requests/:ticketId ─────────────────────────────────
// One ticket's detail + FULL conversation thread, including private agent
// notes a customer never sees (getDeskTicketThreadForOperator, unlike the
// customer route's getDeskTicketThread).
router.get("/msp/support/requests/:ticketId", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return;
  }
  const ticketId = String(req.params.ticketId ?? "").trim();
  if (!ticketId) {
    res.status(400).json({ error: "Missing request id" });
    return;
  }

  try {
    const ticket = await getDeskTicketById(ticketId, mspId);
    if (!ticket) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const thread = await getDeskTicketThreadForOperator(ticketId, mspId);
    res.json({ request: ticket, thread });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      res.status(503).json({ error: "Ticketing is not available right now." });
      return;
    }
    log.error({ err, mspId, ticketId }, "msp-support: detail failed");
    res.status(500).json({ error: "We couldn't load this request right now. Please try again shortly." });
  }
});

// ── POST /api/msp/support/requests/:ticketId/reply ──────────────────────────
// Operator reply. `isPublic: true` (default) is visible to the customer in
// their own portal thread; `isPublic: false` adds an internal-only note. No
// name-prefixing needed here (unlike the customer route) — Zoho already
// attributes a public comment to the connected agent, which for this route
// IS the operator actually replying.
router.post("/msp/support/requests/:ticketId/reply", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = resolveMspIdStrict(req);
  if (mspId === null) {
    res.status(403).json({ error: "MSP context required" });
    return;
  }
  const ticketId = String(req.params.ticketId ?? "").trim();
  const bodyIn = (req.body ?? {}) as Record<string, unknown>;
  const message = typeof bodyIn.message === "string" ? bodyIn.message.trim() : "";
  const isPublic = bodyIn.isPublic === false ? false : true;

  if (!ticketId) {
    res.status(400).json({ error: "Missing request id" });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "Please enter a message." });
    return;
  }

  try {
    const ticket = await getDeskTicketById(ticketId, mspId);
    if (!ticket) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const result = await enqueueZohoDeskWrite(
      "zoho_desk_add_comment",
      { ticketId, content: message.slice(0, MAX_BODY), isPublic },
      { mspId },
    );

    log.info({ mspId, ticketId, jobId: result.jobId, isPublic }, "msp-support: reply queued");
    res.status(202).json({
      queued: true,
      message: isPublic ? "Your reply has been added to the request." : "Your internal note has been added.",
    });
  } catch (err) {
    if (isZohoUnavailable(err)) {
      res.status(503).json({ error: "Ticketing is not available right now." });
      return;
    }
    if (err instanceof ZohoApiError) {
      log.error({ err: err.body, status: err.status, ticketId }, "msp-support: reply Zoho error");
      res.status(502).json({ error: "We couldn't add your reply right now. Please try again shortly." });
      return;
    }
    log.error({ err, mspId, ticketId }, "msp-support: reply failed");
    res.status(500).json({ error: "We couldn't add your reply right now. Please try again shortly." });
  }
});

export default router;
