// The signed-in JSON API the web app itself talks to.

import { config } from "../config.mjs";
import {
  HttpError,
  Router,
  badRequest,
  forbidden,
  notFound,
  parseCookies,
  readJson,
  readBody,
  redirect,
  sendJson,
  sendText,
  setCookie,
  tooMany,
  unauthorized,
} from "../http.mjs";
import * as ratelimit from "../auth/ratelimit.mjs";
import { SESSION_COOKIE, createSession, markSessionVerified, revokeAllSessions, revokeSession } from "../auth/sessions.mjs";
import { mintToken } from "../auth/tokens.mjs";
import { markSignedIn, recordAuthEvent } from "../core/users.mjs";
import * as credentials from "../core/credentials.mjs";
import * as webauthn from "../auth/webauthn.mjs";
import * as audit from "../core/audit.mjs";
import * as teslaCore from "../core/tesla.mjs";
import { TeslaError } from "../core/tesla.mjs";
import * as captures from "../core/captures.mjs";
import { runCaptureGrammar } from "../core/capture-grammar.mjs";
import * as catches from "../core/catches.mjs";
import * as categories from "../core/categories.mjs";
import * as contacts from "../core/contacts.mjs";
import * as dates from "../core/dates.mjs";
import * as documents from "../core/documents.mjs";
import * as entities from "../core/entities.mjs";
import * as federalHolidays from "../core/federal-holidays.mjs";
import * as lists from "../core/lists.mjs";
import * as locationState from "../core/location-state.mjs";
import * as mealPlan from "../core/meal-plan.mjs";
import * as media from "../core/media.mjs";
import * as incomeRules from "../core/income-rules.mjs";
import * as money from "../core/money.mjs";
import * as mcpTokens from "../core/mcp-tokens.mjs";
import * as pantry from "../core/pantry.mjs";
import * as widgetTokens from "../core/widget-tokens.mjs";
import { computeNextCard, renderWidgetPage } from "../core/widget.mjs";
import { headingHomeAvailability, triggerHeadingHome } from "../core/heading-home.mjs";
import * as medications from "../core/medications.mjs";
import * as nudges from "../core/nudges.mjs";
import * as people from "../core/people.mjs";
import * as pets from "../core/pets.mjs";
import * as places from "../core/places.mjs";
import * as plaid from "../core/plaid.mjs";
import * as pushSubscriptions from "../core/push-subscriptions.mjs";
import * as prices from "../core/prices.mjs";
import * as recipes from "../core/recipes.mjs";
import * as roomOrder from "../core/room-order.mjs";
import * as scan from "../core/scan.mjs";
import * as shares from "../core/shares.mjs";
import * as storeAisles from "../core/store-aisles.mjs";
import * as vault from "../core/vault.mjs";
import * as webpush from "../push/webpush.mjs";
import * as things from "../core/things.mjs";
import * as timers from "../core/timers.mjs";
import * as wins from "../core/wins.mjs";
import { orderItems } from "../core/shopping-order.mjs";
import * as vehicles from "../core/vehicles.mjs";

// Deliberately tight: this app has one real account, so a burst of failures is an attack, not a
// forgetful person.
const LOGIN_LIMIT_PER_IP = { limit: 20, windowMs: 15 * 60 * 1000 };
// Enrolment is the one path that creates a credential, so it is limited harder than sign-in.
const ENROLL_LIMIT_PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

function requireUser(ctx) {
  if (!ctx.session) throw unauthorized();
  return ctx.session.user;
}

/**
 * The critter daily-roll date key (Git #3119, "Shanes Life 14 - Critters.dc.html"): unpadded
 * Y-M-D from the SERVER's clock, never the client's -- the spec is explicit that the roll is
 * "evaluated once at first open from the server date" so every device shows the same critter for
 * a slot on a given day regardless of its own clock/timezone. Format matches the design's own
 * `d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()` exactly (no zero-padding) --
 * padding would change the hash input and roll a different critter than the design previewed.
 */
function serverDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** "$1,234.56" from a real DOLLAR amount (money.mjs's own `toDollars()` shape, already used
 *  throughout getGateStatus's response) -- matches the client's own `dollars()` formatter in
 *  public/app.js, duplicated here rather than shared because this module has no browser/server
 *  shared bundle to put it in. */
function fmtUsd(amount) {
  if (amount === null || amount === undefined) return "$0.00";
  return `$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Real per-room lit/dark state + subtitle for the Today "Rooms -- the house" grid (Git #3165,
 * README "Rooms -- the house" + "Lamp rules"). Every number here is a real read off the same
 * tables the room's own page already renders -- no fixture, no guessed state. `allDates`,
 * `tonight` and `groceries` are passed in from the /api/today handler that already computed them
 * (dates.listDates and the shopping-list read are real work; no reason to run either twice).
 *
 * Four rooms in the design's own grid -- Things, Lists, People, Pets -- are spec'd to "stay dark"
 * always (README: "the critter is asleep"), so those four only ever carry a real subtitle, never
 * a lit flag.
 *
 * `meds` and `pendingCaptures` back the Medicine and Inbox rooms (Git #3250) -- both used to be
 * the last two links on the flat `<nav class="tabs">` bar that #3165's house grid was supposed to
 * fully replace and never did; they're real rooms now, not a lingering flat bar sitting under it.
 *
 * Vault and Tesla (Git #3271) round the grid out to thirteen real rooms; Pantry (Git #3316) is
 * the fourteenth -- see the Pantry block below for its own real "something at 0 that isn't on
 * the run" lit rule.
 */
export async function roomsForToday(userId, { allDates, tonight, groceries, runItems, meds, pendingCaptures }) {
  const [
    thingsList, listsForUser, allPeople, allPets, recipeMatches, gate, recentWins,
    vaultCounts, documentList, vaultRevealOpen, documentRevealOpen,
    teslaStatus, teslaPrecondition, teslaScheduled, teslaShortfall,
    pantryItems,
  ] = await Promise.all([
    things.listThings(userId),
    lists.listListsForUser(userId),
    people.listPeople(userId),
    pets.listPets(userId),
    recipes.listRecipesWithMatch(userId),
    money.getGateStatus(userId),
    wins.listWins(userId, { limit: 1 }),
    vault.countsByKind(userId),
    documents.listDocuments(userId),
    vault.hasOpenReveal(userId),
    documents.hasOpenReveal(userId),
    teslaCore.connectionStatus(userId),
    teslaCore.getPreconditioningStatus(userId),
    teslaCore.listScheduledCommands(userId),
    teslaCore.getTodaysBatteryShortfall(userId),
    pantry.listPantryItems(userId),
  ]);

  // Shopping: "while items remain" -- the same openCount the Next card's own "home" case reads.
  const shopping = {
    lit: groceries.openCount > 0,
    subtitle: groceries.openCount > 0 ? `${groceries.openCount} on the run` : "Nothing on the run",
  };

  // Money: "while there is a decision, a shortfall or an urgent bill" -- checked in that order,
  // same priority the design's own three example lines imply (a real shortfall is more urgent
  // than an uncounted one-time event, which is more urgent than "money to spend").
  let money_;
  if (gate.isCovered === false) {
    money_ = { lit: true, subtitle: `short ${fmtUsd(gate.totalShortfall)}` };
  } else if ((gate.pendingEvents || []).length > 0) {
    const n = gate.pendingEvents.length;
    money_ = { lit: true, subtitle: `${n} thing${n === 1 ? "" : "s"} to decide` };
  } else if (gate.availableToSpend > 0) {
    money_ = { lit: true, subtitle: `${fmtUsd(gate.availableToSpend)} to spend` };
  } else {
    money_ = { lit: false, subtitle: "Nothing to decide right now" };
  }

  // Dates: "when something is today or tomorrow" -- due_in_days is dates.listDates' own real
  // field, already excluding done entries; federal holidays carry the same field so a holiday
  // due tomorrow lights the room too, same as any other date kind.
  const soon = allDates
    .filter((d) => d.due_in_days === 0 || d.due_in_days === 1)
    .sort((a, b) => a.due_in_days - b.due_in_days);
  const datesRoom = soon.length > 0
    ? { lit: true, subtitle: `${soon[0].title} ${soon[0].due_in_days === 0 ? "today" : "tomorrow"}` }
    : { lit: false, subtitle: "Nothing on the calendar soon" };

  // Recipes: "from 16:00 until dinner is done" -- server can only know the plan exists and the
  // hour, not whether Shane has actually finished cooking (that's Tonight/Cook mode's own
  // client-only state, never persisted -- see meal-plan.mjs's header comment); the client ORs
  // this with a live cook session before rendering, same as resolveNextKind() already does for
  // the Next card's own "dinner" case.
  const hour = new Date().getHours();
  const canMakeCount = recipeMatches.filter((r) => r.canMake).length;
  const recipesLit = hour >= 16 && hour < 21 && Boolean(tonight);
  const recipesRoom = recipesLit
    ? { lit: true, subtitle: `Dinner tonight · ${canMakeCount} you can make` }
    : { lit: false, subtitle: "Nothing planned right now" };

  // Things, Lists, People, Pets: spec'd to stay dark always -- real counts/names only, never a
  // lamp. People's subtitle is the README's own literal example wording ("{n} people · your
  // journal"), now real: people.listPeople() is #3157's own real read (person_entries count per
  // person already summed there; this just needs the roster size).
  const thingsRoom = {
    subtitle: thingsList.length > 0
      ? `${thingsList.length} spot${thingsList.length === 1 ? "" : "s"} remembered`
      : "Nothing remembered yet",
  };
  const listsRoom = {
    subtitle: listsForUser.length > 0
      ? listsForUser.slice(0, 3).map((l) => `${l.name} ${l.item_count}`).join(" · ")
      : "Nothing on the lists yet",
  };
  const peopleRoom = {
    subtitle: allPeople.length > 0 ? `${allPeople.length} ${allPeople.length === 1 ? "person" : "people"} · your journal` : "No one on file yet",
  };
  const petsRoom = {
    subtitle: allPets.length > 0 ? allPets.map((p) => p.name).join(", ") : "No pets yet",
  };

  // Wins (Git #3241 -- pulled out of Money into its own room): "lit" for 3 days after the most
  // recent real win, the same quiet-glow-then-fade feel a genuine relief moment deserves, not a
  // permanent trophy case. Subtitle shows that win's own real text while lit; once it fades the
  // room goes dark like Things/Lists/People/Pets, showing the real total instead -- never a
  // streak or percentage (Section 3/8 still applies here, this is a house-grid subtitle, not a
  // gamification mechanic).
  const mostRecentWin = recentWins[0] || null;
  let winsRoom;
  if (mostRecentWin) {
    const daysSince = Math.floor((Date.now() - new Date(mostRecentWin.happened_on).getTime()) / 86400000);
    winsRoom = daysSince <= 3
      ? { lit: true, subtitle: mostRecentWin.text }
      : { lit: false, subtitle: mostRecentWin.text };
  } else {
    winsRoom = { lit: false, subtitle: "Nothing logged yet" };
  }

  // Medicine (Git #3250 -- the Meds pill's own house room, superseding its old flat-tab-bar
  // access entirely): "lit while the morning batch is untaken, or after 8 pm while the bed batch
  // is untaken" (README "Medicine room"). `meds.batches` is medications.getMedsToday()'s own real
  // per-batch takenToday read -- the same shape the Meds pill already renders, no new query.
  // Batch names are Claude-assigned free text from natural-language capture, not a fixed enum
  // (Git #3279 -- Shane's real second batch is "night", which never matched the old literal
  // "evening"/"bed" === checks). Keyword-matched the same way medsDaypartRank() in
  // public/app.js already generalizes batch names, so the next real name ("bedtime", "PM",
  // etc.) doesn't hit this same gap again.
  const hourNow = hour;
  const medsBatches = meds?.batches || [];
  const morningBatch = medsBatches.find((b) => /morning/i.test(b.batch));
  const bedBatch = medsBatches.find((b) => /evening|night|bed|dinner/i.test(b.batch));
  const morningDue = Boolean(morningBatch && !morningBatch.takenToday);
  const bedDue = Boolean(bedBatch && !bedBatch.takenToday && hourNow >= 20);
  let medsRoom;
  if (morningDue || bedDue) {
    const due = morningDue ? morningBatch : bedBatch;
    const yours = due.items.filter((i) => !i.isPetCare).length;
    const pets_ = due.items.filter((i) => i.isPetCare).length;
    medsRoom = {
      lit: true,
      subtitle: pets_ > 0 ? `${yours} for you, ${pets_} for the pets` : `${yours} for you`,
    };
  } else if (bedBatch) {
    medsRoom = { lit: false, subtitle: "Before bed at 9" };
  } else {
    medsRoom = { lit: false, subtitle: "All taken today" };
  }

  // Inbox (Git #3250 -- the same house room, replacing the flat tab bar's own Inbox link):
  // "lit while anything is held" (README "Inbox room"), the same real pendingCaptures count
  // Today's own "N waiting in the inbox" card and the Idle Later moment both already use.
  const inboxRoom = pendingCaptures > 0
    ? { lit: true, subtitle: `${pendingCaptures} held for Claude` }
    : { lit: false, subtitle: "Nothing held" };

  // Vault (Git #3271, README "Vault is a room" -- "Tile: '{n} logins · {m} bill refs · {k}
  // documents', lit only while a reveal is open"). The count line is real regardless of lit
  // state; "lit" comes from vault.hasOpenReveal()/documents.hasOpenReveal() -- the real audited
  // 20-second reveal windows in vault_reveals and important_document_reveals, never a
  // client-trusted countdown. Documents live in their own real table (Git #3244) but the room
  // folds them into one tile, so both reveal trails have to be checked.
  const vaultRoom = {
    lit: vaultRevealOpen || documentRevealOpen,
    subtitle: `${vaultCounts.login} login${vaultCounts.login === 1 ? "" : "s"} · ${vaultCounts.bill_reference} bill ref${vaultCounts.bill_reference === 1 ? "" : "s"} · ${documentList.length} document${documentList.length === 1 ? "" : "s"}`,
  };

  // Tesla (Git #3271, README "Tesla is a room" -- "Tile rule: lit while preconditioning runs, a
  // trunk command is pending, or the commute check is short"), checked in that priority order.
  // Every read behind this is stored state (a real inbound webhook ping, a real scheduled-command
  // row, today's already-run housekeeping-sweep nudge) -- never a live Fleet API call, since
  // roomsForToday runs on every /api/today load and "reads wake the car" applies to a background
  // tile render exactly as much as an explicit visit to the room.
  let teslaRoom;
  if (!teslaStatus.connected) {
    teslaRoom = { lit: false, subtitle: "Not connected" };
  } else if (teslaPrecondition.active) {
    teslaRoom = { lit: true, subtitle: `Warming up · ${teslaPrecondition.minutesAgo} min` };
  } else if (teslaScheduled.length > 0) {
    const secondsLeft = Math.max(0, Math.round((new Date(teslaScheduled[0].scheduled_for).getTime() - Date.now()) / 1000));
    const mm = Math.floor(secondsLeft / 60);
    const ss = String(secondsLeft % 60).padStart(2, "0");
    teslaRoom = { lit: true, subtitle: `Trunk opens in ${mm}:${ss}` };
  } else if (teslaShortfall) {
    teslaRoom = { lit: true, subtitle: `${teslaShortfall.batteryRangeMiles} mi · charge tonight` };
  } else {
    // Connected, nothing due -- no live battery/range read here (that's the room's own on-demand
    // "Check now", never this background tile), so this stays a real "nothing to report" line
    // rather than a stale or fabricated number.
    teslaRoom = { lit: false, subtitle: "Nothing needs you" };
  }

  // Pantry (Git #3316, README "Room row": "Lit only while something is out and not yet on the
  // run"). "Bananas out at the Rental" (one item) -> "{n} out, not on the run" (several) ->
  // "{n} running low" (dark, nothing out) -> "{home} at Home · {rental} at the Rental" (dark,
  // nothing low either) -- checked in that priority order, the same real fallthrough the design's
  // own subtitle line describes. `runItems` is /api/today's own real shopping-list detail
  // (lists.getListDetail's `items`), already fetched for `groceries` above -- reused here rather
  // than queried twice.
  const outNotOnRun = pantryItems.filter((it) => it.quantity === 0 && !pantry.isPantryItemOnRun(it.name, runItems));
  const lowCount = pantryItems.filter((it) => it.quantity <= it.low_at).length;
  const homeCount = pantryItems.filter((it) => it.house === "Home").length;
  const rentalCount = pantryItems.filter((it) => it.house === "Rental").length;
  let pantryRoom;
  if (outNotOnRun.length === 1) {
    const only = outNotOnRun[0];
    pantryRoom = { lit: true, subtitle: `${only.name} out${only.house ? ` at ${pantry.placeName(only.house)}` : ""}` };
  } else if (outNotOnRun.length > 1) {
    pantryRoom = { lit: true, subtitle: `${outNotOnRun.length} out, not on the run` };
  } else if (lowCount > 0) {
    pantryRoom = { lit: false, subtitle: `${lowCount} running low` };
  } else {
    pantryRoom = { lit: false, subtitle: `${homeCount} at Home · ${rentalCount} at the Rental` };
  }

  return {
    shopping,
    money: money_,
    dates: datesRoom,
    recipes: recipesRoom,
    things: thingsRoom,
    lists: listsRoom,
    people: peopleRoom,
    pets: petsRoom,
    wins: winsRoom,
    meds: medsRoom,
    inbox: inboxRoom,
    vault: vaultRoom,
    tesla: teslaRoom,
    pantry: pantryRoom,
  };
}

/**
 * The Today tray's real "Later, by moment" balloons (Git #3164, README "Later, by moment"):
 * each moment is real state, checked in the design's own fixed order, and only appears while
 * its own real condition holds. `allDates` and `tonight` are passed in from the /api/today
 * handler that already computed them (dates.listDates and the meal-plan read are real work; no
 * reason to run either twice). `pendingCaptures` is the same real inbox count Today already
 * surfaces as "N waiting in the inbox" -- the design's own "Idle" moment ("N things to look at,
 * whenever") is that same real backlog, not a separate Review concept this app doesn't have.
 *
 * Dinner is a "does a real plan exist" read only -- whether Shane has actually finished cooking
 * tonight is Cook mode's own client-only state (mealSession, never persisted; see
 * meal-plan.mjs's header comment), so the client itself suppresses this moment once a live cook
 * session reports done, the same override roomsForToday()'s own Recipes room and
 * resolveNextKind()'s "dinner" case both already apply.
 */
export async function computeLaterMoments(userId, { allDates, tonight, pendingCaptures }) {
  const [headingOut, rentalJob] = await Promise.all([
    lists.getHeadingOutSignal(userId),
    contacts.getOpenRentalJob(userId),
  ]);

  // "Coming up -- a date within 14 days (line = first two 'title + when')". Overdue rows
  // (due_in_days < 0) are the Dates room's own concern, not a "coming up" moment.
  const comingUp = allDates
    .filter((d) => d.due_in_days != null && d.due_in_days >= 0 && d.due_in_days <= 14)
    .sort((a, b) => a.due_in_days - b.due_in_days)
    .slice(0, 2)
    .map((d) => ({ title: d.title, dueInDays: d.due_in_days, atDate: d.at_date instanceof Date ? d.at_date.toISOString().slice(0, 10) : d.at_date }));

  return {
    headingOut: headingOut ? { names: headingOut.names } : null,
    comingUp: comingUp.length > 0 ? comingUp : null,
    dinner: Boolean(tonight) ? { dishText: tonight.dishText } : null,
    rental: rentalJob ? { did: rentalJob.did, name: rentalJob.name } : null,
    idle: pendingCaptures > 0 ? { count: pendingCaptures } : null,
  };
}

export function buildApiRouter() {
  const router = new Router();

  // -- auth ---------------------------------------------------------------

  // Sign-in is a passkey assertion and nothing else. There is no /api/auth/login, no email
  // field and no password field anywhere in this app -- design handoff screen 1 draws exactly
  // two controls, "Continue with Face ID" and "Use a passkey from another device", and both of
  // them are this pair of routes.

  router.post("/api/auth/passkey/options", async (_req, res, _params, ctx) => {
    const gate = ratelimit.hit(`login:ip:${ctx.ip}`, LOGIN_LIMIT_PER_IP.limit, LOGIN_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      await recordAuthEvent({ event: "login_throttled", ip: ctx.ip, userAgent: ctx.userAgent });
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many sign-in attempts. Try again shortly.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }
    // No allowCredentials: the passkeys this app registers are discoverable (residentKey
    // "required"), so the authenticator itself resolves which account is signing in. That is
    // what removes the email field from the screen -- and it means this endpoint leaks nothing
    // about which accounts exist.
    const challenge = await webauthn.issueChallenge("authentication");
    return sendJson(res, 200, {
      challenge,
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
    });
  });

  router.post("/api/auth/passkey/verify", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const gate = ratelimit.hit(`login:ip:${ctx.ip}`, LOGIN_LIMIT_PER_IP.limit, LOGIN_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      await recordAuthEvent({ event: "login_throttled", ip: ctx.ip, userAgent: ctx.userAgent });
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many sign-in attempts. Try again shortly.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }

    // One message for every failure mode below, exactly as the password flow did: an unknown
    // credential and a bad signature must be indistinguishable from the outside.
    const refuse = "That passkey did not sign you in.";

    const consumed = await webauthn.consumeChallenge(body.challenge, "authentication");
    if (!consumed) {
      await recordAuthEvent({ event: "login_bad_assertion", ip: ctx.ip, userAgent: ctx.userAgent });
      throw unauthorized(refuse);
    }

    const credential = await credentials.findCredential(body.id);
    if (!credential || !credential.is_active) {
      await recordAuthEvent({
        email: credential?.email ?? null,
        userId: credential?.user_id ?? null,
        event: credential ? "login_inactive" : "login_unknown_credential",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw unauthorized(refuse);
    }

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      await recordAuthEvent({
        email: credential.email,
        userId: credential.user_id,
        event: "login_bad_assertion",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (!config.isProduction) console.error("[webauthn] assertion refused:", err.message);
      throw unauthorized(refuse);
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    await markSignedIn(credential.user_id);
    ratelimit.clear(`login:ip:${ctx.ip}`);

    const session = await createSession(credential.user_id, {
      userAgent: ctx.userAgent,
      ip: ctx.ip,
      credentialId: credential.credential_id,
    });
    await recordAuthEvent({
      email: credential.email,
      userId: credential.user_id,
      event: "login_ok",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.setSessionCookie(session.token, session.ttlSeconds);
    return sendJson(res, 200, {
      user: { id: credential.user_id, email: credential.email, name: credential.name },
      expiresAt: session.expiresAt,
    });
  });

  // -- enrolling a passkey ------------------------------------------------

  // Two ways in, and no third: a single-use enrolment token minted at a real terminal
  // (`npm run enroll-passkey`), or an already-signed-in session adding another device. There is
  // no self-service path, because in a passkey-only app that would be a password reset.
  async function resolveEnrollmentSubject(body, ctx) {
    if (body.token) {
      const pending = await credentials.peekEnrollment(body.token);
      if (!pending || !pending.is_active) {
        await recordAuthEvent({ event: "enroll_bad_token", ip: ctx.ip, userAgent: ctx.userAgent });
        throw unauthorized("That enrolment link is not valid any more. Mint a new one with `npm run enroll-passkey`.");
      }
      return { userId: pending.user_id, email: pending.email, name: pending.name, label: pending.label };
    }
    const user = requireUser(ctx);
    return { userId: user.id, email: user.email, name: user.name, label: body.label || "Passkey" };
  }

  router.post("/api/auth/enroll/options", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const gate = ratelimit.hit(`enroll:ip:${ctx.ip}`, ENROLL_LIMIT_PER_IP.limit, ENROLL_LIMIT_PER_IP.windowMs);
    if (!gate.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(gate.retryAfterMs / 1000)));
      throw tooMany("Too many enrolment attempts. Try again later.", {
        retryAfterSeconds: Math.ceil(gate.retryAfterMs / 1000),
      });
    }
    const subject = await resolveEnrollmentSubject(body, ctx);
    const challenge = await webauthn.issueChallenge("registration", subject.userId);
    const existing = await credentials.listCredentials(subject.userId);
    return sendJson(res, 200, {
      challenge,
      rp: { id: webauthn.relyingPartyId(), name: webauthn.relyingPartyName() },
      // The user handle is the account's real uuid, not the email: it is stored on the
      // authenticator forever, and an email can change.
      user: { id: Buffer.from(subject.userId).toString("base64url"), name: subject.email, displayName: subject.name },
      pubKeyCredParams: webauthn.SUPPORTED_ALGORITHMS.map((a) => ({ type: "public-key", alg: a.alg })),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      attestation: "none",
      authenticatorSelection: {
        // Discoverable, so sign-in needs no email field; verified, so it is a real Face ID /
        // fingerprint / PIN check rather than mere presence.
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      excludeCredentials: existing.map((c) => ({ type: "public-key", id: c.credential_id, transports: c.transports })),
    });
  });

  router.post("/api/auth/enroll/verify", async (req, res, _params, ctx) => {
    const body = await readJson(req);
    const subject = await resolveEnrollmentSubject(body, ctx);

    const consumed = await webauthn.consumeChallenge(body.challenge, "registration");
    if (!consumed || consumed.user_id !== subject.userId) {
      throw badRequest("That registration attempt expired. Start again.");
    }

    let registration;
    try {
      registration = webauthn.verifyRegistration({
        expectedChallenge: consumed.challenge,
        response: body.response,
      });
    } catch (err) {
      throw badRequest(`That passkey could not be registered: ${err.message}`);
    }

    const label = String(body.label || subject.label || "Passkey").slice(0, 80);
    // Consume the enrolment token BEFORE storing, so a token can never survive a duplicate
    // credential error and be reused.
    if (body.token) {
      const used = await credentials.consumeEnrollment(body.token, registration.credentialId);
      if (!used) throw unauthorized("That enrolment link has already been used.");
    }

    const stored = await credentials.storeCredential(subject.userId, registration, label);
    await recordAuthEvent({
      email: subject.email,
      userId: subject.userId,
      event: "passkey_registered",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // Enrolling from a link signs you straight in -- there is nothing else to prove.
    if (body.token) {
      await markSignedIn(subject.userId);
      const session = await createSession(subject.userId, {
        userAgent: ctx.userAgent,
        ip: ctx.ip,
        credentialId: registration.credentialId,
      });
      ctx.setSessionCookie(session.token, session.ttlSeconds);
      return sendJson(res, 201, {
        passkey: stored,
        user: { id: subject.userId, email: subject.email, name: subject.name },
        expiresAt: session.expiresAt,
      });
    }

    return sendJson(res, 201, { passkey: stored });
  });

  router.get("/api/passkeys", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { passkeys: await credentials.listCredentials(user.id) });
  });

  router.delete("/api/passkeys/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const removed = await credentials.revokeCredential(user.id, params.id);
    await recordAuthEvent({
      email: user.email,
      userId: user.id,
      event: "passkey_revoked",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return sendJson(res, 200, { ok: true, removed });
  });

  // A fresh assertion inside a live session. The vault's reveal is the caller the design names
  // ("passkey (WebAuthn) re-auth per reveal ... a stated security requirement, not polish") --
  // the vault UI itself is a later Feature, but the proof-of-freshness it needs lives here.
  router.post("/api/auth/reverify/options", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const owned = await credentials.listCredentials(user.id);
    return sendJson(res, 200, {
      challenge: await webauthn.issueChallenge("vault", user.id),
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
      allowCredentials: owned.map((c) => ({ type: "public-key", id: c.credential_id, transports: c.transports })),
    });
  });

  router.post("/api/auth/reverify", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const consumed = await webauthn.consumeChallenge(body.challenge, "vault");
    if (!consumed || consumed.user_id !== user.id) throw unauthorized("That check expired. Try again.");

    const credential = await credentials.findCredential(body.id);
    if (!credential || credential.user_id !== user.id) throw unauthorized("That passkey is not on this account.");

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      if (!config.isProduction) console.error("[webauthn] re-verify refused:", err.message);
      throw unauthorized("That passkey check did not pass.");
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    const verifiedAt = await markSessionVerified(ctx.sessionToken, credential.credential_id);
    return sendJson(res, 200, { ok: true, verifiedAt });
  });

  router.post("/api/auth/logout", async (_req, res, _params, ctx) => {
    if (ctx.sessionToken) {
      await revokeSession(ctx.sessionToken);
      if (ctx.session) {
        await recordAuthEvent({
          email: ctx.session.user.email,
          userId: ctx.session.user.id,
          event: "logout",
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    }
    ctx.clearSessionCookie();
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/auth/logout-everywhere", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const count = await revokeAllSessions(user.id);
    // Git #3276, README: "'Sign out everywhere' in Settings... ends the trust instantly." A
    // trusted browser is its own real bearer credential, independent of the session cookie
    // being cleared here -- without this it would keep filling logins one-click after a real
    // sign-out-everywhere, which defeats the whole point of that button.
    const devicesRevoked = await vault.revokeAllTrustedDevices(user.id);
    ctx.clearSessionCookie();
    return sendJson(res, 200, { ok: true, revoked: count, devicesRevoked });
  });

  router.get("/api/me", async (_req, res, _params, ctx) => {
    if (!ctx.session) return sendJson(res, 200, { user: null });
    const user = ctx.session.user;
    return sendJson(res, 200, {
      user,
      pendingCaptures: await captures.pendingCount(user.id),
      publicOrigin: config.publicOrigin,
      passkeyCount: await credentials.countCredentials(user.id),
      lastVerifiedAt: ctx.session.lastVerifiedAt,
      // The critter daily-roll seed (Git #3119) -- see serverDateKey() above.
      serverDate: serverDateKey(),
    });
  });

  // -- the capture box ----------------------------------------------------

  // Raw-body upload rather than multipart: the browser can POST a Blob straight from
  // MediaRecorder or a camera <input> with one fetch, and the server needs no parser.
  router.post("/api/media", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const bytes = await readBody(req, config.maxUploadBytes);
    const row = await media.storeMedia({
      userId: user.id,
      mimeType: req.headers["content-type"] || "",
      bytes,
      originalName: req.headers["x-file-name"] || null,
    });
    return sendJson(res, 201, row);
  });

  router.get("/api/media/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await media.readMedia(user.id, params.id);
    if (!row) throw notFound("Attachment not found");
    res.writeHead(200, {
      "content-type": row.mime_type,
      "content-length": row.byte_size,
      "cache-control": "private, max-age=3600",
    });
    return res.end(row.bytes);
  });

  router.post("/api/captures", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const kind = body.mediaId && !body.kind ? "photo" : body.kind || "text";

    // Git #3292: real-time deterministic pattern detection, BEFORE anything is filed to the
    // pending inbox -- same real principle BuildConsole's own Ctrl+K command center uses (Epic
    // #2017). Only ever runs against real typed text (a photo/voice capture has nothing to match
    // against yet -- those still need Claude regardless). A recognized, cleanly-resolved pattern
    // calls the matching real core function directly and returns a real, immediate confirmation
    // with no capture row ever created; anything that doesn't match -- or matches but can't
    // safely resolve -- falls through to the exact same pending-capture path as before. See
    // capture-grammar.mjs's own header for the full fail-safe contract.
    if (kind === "text" && body.text && String(body.text).trim()) {
      const grammar = await runCaptureGrammar({ userId: user.id, text: body.text });
      if (grammar.matched) {
        return sendJson(res, 200, { matched: true, rule: grammar.rule, message: grammar.message });
      }
    }

    // latitude/longitude (Git #3159): the browser's own native geolocation permission, attached
    // silently when it's already there -- never a new form field. See captures.mjs's own header.
    const row = await captures.createCapture({
      userId: user.id,
      kind,
      bodyText: body.text ?? null,
      mediaId: body.mediaId ?? null,
      source: "web",
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    });
    await audit.record({ userId: user.id, actor: "web", action: "capture.create", detail: { captureId: row.id, kind } });
    return sendJson(res, 201, { ...row, matched: false });
  });

  router.get("/api/captures", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      captures: await captures.listCaptures(user.id, {
        status: ctx.url.searchParams.get("status") || "pending",
        limit: ctx.url.searchParams.get("limit"),
      }),
    });
  });

  router.post("/api/captures/:id/dismiss", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await captures.dismissCapture(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "capture.dismiss", detail: { captureId: params.id } });
    return sendJson(res, 200, row);
  });

  // -- entities -----------------------------------------------------------

  router.get("/api/entities", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      entities: await entities.listEntities(user.id, {
        category: q.get("category"),
        status: q.get("status"),
        search: q.get("search"),
        includeArchived: q.get("includeArchived") === "true",
        limit: q.get("limit"),
      }),
    });
  });

  router.post("/api/entities", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const entity = await entities.createEntity({
      userId: user.id,
      category: body.category || "note",
      categoryMeta: body.categoryMeta || {},
      title: body.title,
      body: body.body ?? null,
      status: body.status || "open",
      occursAt: body.occursAt ?? null,
      remindAt: body.remindAt ?? null,
      data: body.data || {},
      items: body.items || [],
      captureId: body.captureId ?? null,
      source: "web",
      createdBy: "shane",
    });
    await audit.record({ userId: user.id, actor: "web", action: "entity.create", entityId: entity.id, detail: { category: entity.category } });
    return sendJson(res, 201, entity);
  });

  router.get("/api/entities/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const entity = await entities.getEntity(user.id, params.id);
    if (!entity) throw notFound("Entity not found");
    return sendJson(res, 200, entity);
  });

  router.patch("/api/entities/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const patch = await readJson(req);
    const entity = await entities.updateEntity(user.id, params.id, patch, { createdBy: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "entity.update", entityId: params.id, detail: { fields: Object.keys(patch) } });
    return sendJson(res, 200, entity);
  });

  router.post("/api/entities/:id/items", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const entity = await entities.addItems(user.id, params.id, body.items);
    return sendJson(res, 201, entity);
  });

  router.patch("/api/entities/:id/items/:itemId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await entities.getEntity(user.id, params.id);
    if (!owned) throw notFound("Entity not found");
    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");
    const item = await entities.setItemChecked(params.id, params.itemId, body.checked, "owner");
    return sendJson(res, 200, item);
  });

  router.delete("/api/entities/:id/items/:itemId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await entities.deleteItem(user.id, params.id, params.itemId);
    return sendJson(res, 200, { ok: true });
  });

  // -- shopping / lists (typed tables, Git #3116's decision -- #3088 is the first room built
  // on this shape) ----------------------------------------------------------

  // Flat / Category / Best-path ordering (Git #3108) -- ?order=flat|category|best on either
  // real list-reading endpoint below. Best path reads the real, accumulated store_aisles map for
  // whatever store the list is currently set to; with no store set (or nothing learned yet for
  // it) every item lands in `unknown`, which is real and honest, not a guess.
  async function attachOrder(user, detail, url) {
    const mode = url.searchParams.get("order") || "flat";
    if (mode !== "category" && mode !== "best") return { ...detail, order: "flat" };
    let storeMap = [];
    if (mode === "best" && detail.store) storeMap = await storeAisles.getStoreMap(user.id, detail.store);
    const { mode: appliedMode, ...ordered } = orderItems(detail.items, mode, (item) => storeAisles.matchAisle(item.text, storeMap));
    return { ...detail, order: appliedMode, ...ordered };
  }

  // The Shopping room reads/writes exactly one real list -- "one run" (design handoff's capture
  // grammar, `grocery words -> the run`) -- so the client never needs to know its id up front.
  router.get("/api/shopping", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const list = await lists.getOrCreateShoppingList(user.id);
    const detail = await lists.getListDetail(user.id, list.id);
    // Per-store price history (Git #3112): "last time $X at Store" on each row, one extra query
    // for the whole list rather than one per item.
    detail.items = await prices.attachLatestPrices(user.id, detail.items);
    // Weekly-ad cross-store verdicts, coupons, multi-buy (Git #3110): "Walmart $2.99", cheapest
    // store on the current ad, plus any matching coupon -- a different question from lastPrice
    // above ("what does the CURRENT weekly ad say"), so it's a separate field, not a merge.
    detail.items = await prices.attachWeeklyAdVerdicts(user.id, detail.items);
    return sendJson(res, 200, await attachOrder(user, detail, ctx.url));
  });

  // The Lists room (#3155): every real list except the Shopping singleton -- Watch, Books, and
  // anything Claude files on the fly via `push_list`'s generic `category` path (Section 3, "real
  // simple lists").
  router.get("/api/lists", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { lists: await lists.listListsForUser(user.id) });
  });

  // Shane naming a list directly from the Lists room ("New list") -- the same real
  // find-or-create `push_list` uses, just reached from the UI instead of MCP.
  router.post("/api/lists", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const list = await lists.getOrCreateListByName(user.id, { name: body.name, category: body.category });
    return sendJson(res, 201, await lists.getListDetail(user.id, list.id));
  });

  router.get("/api/lists/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const detail = await lists.getListDetail(user.id, params.id);
    if (!detail) throw notFound("List not found");
    return sendJson(res, 200, await attachOrder(user, detail, ctx.url));
  });

  // Which real store this run is being shopped at -- what Best-path ordering and aisle memory
  // both key off. `store: null` clears it (switching stores mid-week).
  router.patch("/api/lists/:id/store", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await lists.setListStore(user.id, params.id, body.store ?? null));
  });

  // Real per-store aisle memory (Git #3108): "say where you found it once; next trip the list
  // walks the store in order." Sets/corrects a real spot for one item at one store, growing the
  // real accumulated map store_aisles.getStoreMap reads for Best-path -- and, for immediate
  // display, writes the same "Aisle N · note" line onto the item's own `note` field, matching
  // the design's "shown as a second line under the item."
  router.post("/api/lists/:id/items/:itemId/aisle", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await lists.getOwnedList(user.id, params.id);
    if (!owned) throw notFound("List not found");
    const body = await readJson(req);
    const store = body.store || owned.store;
    if (!store) throw badRequest("store is required (set the list's store first, or pass one in the body)");
    const items = await lists.getListDetail(user.id, params.id);
    const item = items?.items?.find((i) => i.id === params.itemId);
    if (!item) throw notFound("Item not found");

    const spot = await storeAisles.recordAisle(user.id, store, item.text, body.aisle, body.note ?? null);
    await audit.record({ userId: user.id, actor: "web", action: "store_aisle.record", entityId: params.id, detail: { store: spot.store, item: spot.item_text, aisle: spot.aisle, hits: spot.hits } });
    const noteLine = `Aisle ${spot.aisle}${spot.note ? ` · ${spot.note}` : ""}`;
    // Persist the aisle onto the list item's own note too, so it shows up on this run's row
    // without a second lookup -- store_aisles.getStoreMap remains the real source of truth for
    // future runs (and other lists at the same store).
    const updatedItem = await lists.setListItemNote(params.id, params.itemId, noteLine);
    return sendJson(res, 200, { spot, item: updatedItem, note: noteLine });
  });

  // The real, accumulated map for one store (Git #3108) -- what Best-path reads, surfaced for
  // the owner directly too (e.g. a settings/debug view), not just consumed internally.
  router.get("/api/store-aisles", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const store = ctx.url.searchParams.get("store");
    if (store) return sendJson(res, 200, { store, items: await storeAisles.getStoreMap(user.id, store) });
    return sendJson(res, 200, { stores: await storeAisles.listStores(user.id) });
  });

  // Real hub/spoke item-location memory (Git #3156). Saying it again corrects the same row --
  // see things.recordThing -- so there is deliberately no confirmation step here, matching
  // contract Section 8's "trust stated facts immediately."
  router.post("/api/things", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await things.recordThing(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "thing.record", entityId: row.id, detail: { name: row.name, place: row.place, house: row.house } });
    return sendJson(res, 200, row);
  });

  // List/browse, optionally by house ("Lives at <house>"); ?q= for a real results list, distinct
  // from the single-best-match /search endpoint below the "where's the..." box uses.
  router.get("/api/things", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const house = ctx.url.searchParams.get("house");
    const q = ctx.url.searchParams.get("q");
    if (q) return sendJson(res, 200, { items: await things.searchThings(user.id, q) });
    const [items, houses, take] = await Promise.all([
      things.listThings(user.id, { house }),
      things.listHouses(user.id),
      things.listTakeChecklist(user.id),
    ]);
    return sendJson(res, 200, { items, houses, take });
  });

  // "Next [house] run · Take" checklist (Git #3300): queue a real thing on file for the next
  // real run to a house, distinct from the Tesla-triggered "Heading Out" list (#3158).
  router.post("/api/things/take", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await things.queueForTake(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "thing.take.queue", entityId: row.id, detail: { name: row.name, take_for_house: row.take_for_house, quantity: row.quantity } });
    return sendJson(res, 200, row);
  });

  // Check/uncheck one queued item for this run.
  router.patch("/api/things/:id/take", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (body.done === undefined) throw badRequest("done is required");
    const row = await things.setTakeDone(user.id, params.id, body.done);
    await audit.record({ userId: user.id, actor: "web", action: "thing.take.check", entityId: row.id, detail: { done: row.take_done } });
    return sendJson(res, 200, row);
  });

  // The run actually happened: every checked-off item for this house now really lives there,
  // and the queue clears -- same real-state-change Heading Out's own "All set" applies to that
  // separate list.
  router.post("/api/things/take/:house/clear", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const moved = await things.clearTakeRun(user.id, params.house);
    await audit.record({ userId: user.id, actor: "web", action: "thing.take.clear", detail: { house: params.house, moved } });
    return sendJson(res, 200, { ok: true, moved });
  });

  // "where's the drill?" -- the app's own real, deterministic search (no AI call, per contract
  // Section 10). Returns the single best real match, or `thing: null` when genuinely nothing is
  // on file, which is a real, honest answer, not an error.
  router.get("/api/things/search", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    if (!q) throw badRequest("q is required");
    return sendJson(res, 200, { thing: await things.findThing(user.id, q) });
  });

  // Real pantry inventory (Git #3308, rebuilt as its own dedicated room by Git #3316) -- what's
  // actually at home, and real quantities. Reads only: same "no forms, anywhere, ever" idiom the
  // Things room already uses (Git #3181) -- writes only ever happen via a real capture
  // (capture-grammar.mjs's pantry_have/pantry_bought/pantry_out rules), the Zone screen's -/+
  // buttons (a direct real-time write, not a form), or Claude over MCP (set_pantry_item).
  //
  // `house` is intentionally NOT passed by the Pantry room itself -- its own Home/Rental toggle,
  // "Do we have…" cross-place search, and per-house tile counts all need every real house's items
  // on hand at once, filtered client-side. Each item already carries its own real `zone`
  // (pantry.mjs's own zoneOf, derived from category) for the zone grid/search sub-line.
  router.get("/api/pantry", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const house = ctx.url.searchParams.get("house");
    const [items, houses] = await Promise.all([pantry.listPantryItems(user.id, { house }), pantry.listPantryHouses(user.id)]);
    return sendJson(res, 200, { items, houses });
  });

  // Real, direct +/- one unit -- the Pantry room's own Zone screen (#3316 scope item 3): 44px
  // -/+ hit areas next to each row's real quantity pill. Also not a form -- a direct real-time
  // write, the same "no forms, anywhere, ever" exception Cook-mode checkoff below already uses.
  router.post("/api/pantry/:id/adjust", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const direction = Number(body?.direction);
    if (direction !== 1 && direction !== -1) throw badRequest("direction must be 1 or -1");
    const row = await pantry.adjustPantryItemById(user.id, params.id, direction);
    await audit.record({ userId: user.id, actor: "web", action: "pantry_item.adjust", entityId: row.id, detail: { direction, quantity: row.quantity } });
    return sendJson(res, 200, row);
  });

  // Real Cook-mode ingredient-checkoff depletion (Git #3312) -- the one real write this room's
  // "no forms, anywhere, ever" comment above doesn't cover, because it isn't a form: Cook mode's
  // own checkbox tick fires this directly, same as capture-grammar and MCP already write pantry
  // rows without a form. Silent, no confirmation (Shane's own real decision on #3308); does
  // nothing (no fabricated row, no error) when the ingredient text doesn't unambiguously match a
  // real pantry row -- see pantry.depleteForCookCheckoff's own doc comment.
  router.post("/api/pantry/deplete-checkoff", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const text = String(body?.text || "").trim();
    if (!text) throw badRequest("text is required");
    const item = await pantry.depleteForCookCheckoff(user.id, text);
    return sendJson(res, 200, { item });
  });

  // "Who fixed what" -- real service-provider contact log (Git #3156). Each capture is a new
  // real history row, not a latest-state update -- see contacts.recordContact.
  router.post("/api/contacts", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await contacts.recordContact(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "contact.record", entityId: row.id, detail: { name: row.name, trade: row.trade, did: row.did } });
    return sendJson(res, 201, row);
  });

  router.get("/api/contacts", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    const trade = ctx.url.searchParams.get("trade");
    if (q) return sendJson(res, 200, { items: await contacts.searchContacts(user.id, q) });
    return sendJson(res, 200, { items: await contacts.listContacts(user.id, { trade }) });
  });

  // -- places (Git #3159) --------------------------------------------------
  //
  // A place is only ever created by push_place (src/mcp/tools.mjs), from a geo-tagged capture --
  // no add-place form here (Section 3, "no forms, anywhere, ever"). The web routes below are
  // read-only-plus-forget: list what's saved, forget one (a plain action, not a form -- same
  // tier as Settings' existing "Revoke"/"Sign out everywhere" buttons), and the one real
  // foreground check the Today view calls when it already has a real current position.

  router.get("/api/places", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { items: await places.listPlaces(user.id) });
  });

  router.delete("/api/places/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await places.deletePlace(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "place.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // Foreground-only, on demand: the client sends its OWN real current position (from
  // navigator.geolocation, with permission already granted) -- this route never guesses or
  // polls on its own. See docs/location-aware-content-surfacing-findings.md.
  router.get("/api/places/nearby", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const lat = ctx.url.searchParams.get("lat");
    const lng = ctx.url.searchParams.get("lng");
    if (lat === null || lng === null) throw badRequest("lat and lng are required");
    const items = await places.findNearby(user.id, { latitude: lat, longitude: lng });
    // Real presence side effect (Git #3216): the same live check that already answers "You're
    // at <place>" for Today is also the ONLY real signal /widget's stateless page ever gets for
    // "away from home" -- so every real call here also updates presence_state, not just the
    // response to this one request.
    await places.recordPresence(user.id, items[0] || null);
    return sendJson(res, 200, { items });
  });

  // ---------------------------------------------------------------------------
  // People & Patterns -- private reflection journal (Git #3157, design contract Section 7)
  // ---------------------------------------------------------------------------

  // ?q= runs the real search/ask interface (Section 7) across both people and their notes;
  // omit it for the plain sidebar list.
  router.get("/api/people", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    if (q) return sendJson(res, 200, await people.search(user.id, q));
    return sendJson(res, 200, { items: await people.listPeople(user.id) });
  });

  router.post("/api/people", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await people.createPerson(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "person.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.get("/api/people/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const person = await people.getPerson(user.id, params.id);
    if (!person) throw notFound("Person not found");
    const entries = await people.listPersonEntries(user.id, params.id);
    const patterns = people.computePatterns(entries, person.name);
    return sendJson(res, 200, { person, entries, patterns });
  });

  router.patch("/api/people/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await people.updatePerson(user.id, params.id, body));
  });

  // Plain, literal, chronological export -- real material for an actual therapist conversation
  // (Section 7), never an AI-generated summary (Section 10). The client turns `text` into a
  // downloadable file; nothing here needs a Content-Disposition header of its own.
  router.get("/api/people/:id/export", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { text: await people.exportPersonText(user.id, params.id) });
  });

  router.post("/api/people/:id/entries", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const { entry } = await people.addPersonEntry(user.id, { ...body, personId: params.id, source: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "person.entry.create", entityId: entry.id, detail: { personId: params.id } });
    return sendJson(res, 201, entry);
  });

  router.delete("/api/people/:id/entries/:entryId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await people.deletePersonEntry(user.id, params.entryId);
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/lists/:id/items", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const detail = await lists.addListItems(user.id, params.id, body.items, { addedBy: "owner" });
    // Real audit rows (Git #3186) -- what the Shared list page's live activity feed reads via
    // audit.recentForEntity. One row per item, same granularity as a check event, so the feed
    // can say "Shane just added Milk" rather than a single opaque "added some items" line.
    for (const raw of body.items || []) {
      const text = typeof raw === "string" ? raw : raw?.text;
      if (!text) continue;
      await audit.record({ userId: user.id, actor: "web", action: "list.item.add", entityId: params.id, detail: { text: String(text).trim().slice(0, 500) } });
    }
    return sendJson(res, 201, detail);
  });

  router.patch("/api/lists/:id/items/:itemId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = await lists.getOwnedList(user.id, params.id);
    if (!owned) throw notFound("List not found");
    const body = await readJson(req);
    if (body.checked === undefined) throw badRequest("checked is required");
    const item = await lists.setListItemChecked(params.id, params.itemId, body.checked, "owner");
    if (!item) throw notFound("Item not found");
    await audit.record({ userId: user.id, actor: "web", action: "list.item.check", entityId: params.id, detail: { itemId: item.id, checked: Boolean(body.checked), text: item.text } });

    // Pantry <-> Shopping (Git #3316 scope item 6, design's own real `pantryRestock`): checking a
    // real item off the SHOPPING run (never an arbitrary other list -- `category === 'shopping'`
    // is the one real singleton lists.getOrCreateShoppingList itself creates) restocks the
    // matching real Home pantry row; unchecking it reverses that same restock. Best-effort and
    // non-fatal, same "never block the real result" pattern the Tesla trunk-schedule call below
    // already uses -- a pantry item that isn't on file yet (or a genuinely ambiguous name) is not
    // an error, it's just nothing to restock.
    if (owned.category === "shopping") {
      try {
        await pantry.restockHomeFromRun(user.id, item.text, body.checked ? 1 : -1);
      } catch (err) {
        console.error(`[pantry] restock-from-run failed: ${err.message}`);
      }
    }

    // setListItemChecked returns the entity-shaped keys (checked_at/checked_by) the share layer
    // needs -- remapped here onto the same raw done/done_at shape every other owner-side list
    // endpoint (GET /api/shopping, POST items, clear-checked) already returns.
    return sendJson(res, 200, { id: item.id, position: item.position, text: item.text, note: item.note, done: Boolean(item.checked_at), done_at: item.checked_at, added_by: item.added_by, checked_by: item.checked_by });
  });

  router.delete("/api/lists/:id/items/:itemId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await lists.deleteListItem(user.id, params.id, params.itemId);
    return sendJson(res, 200, { ok: true });
  });

  // The in-scope half of the design's "Done shopping" (Shanes Life 04 - Shopping.dc.html, 1j):
  // clears what's checked. Folding that into aisle-order pattern memory is a separate Feature.
  router.post("/api/lists/:id/clear-checked", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await lists.clearCheckedItems(user.id, params.id);
    // Git #3218's real first Tesla-room automation: a real "Done shopping" moment is the one real
    // trigger for the real 5-minute-then-open-trunk countdown. A no-op for everyone who hasn't
    // armed it (see scheduleCheckoutTrunkOpen's own header) -- clearing a shopping list must never
    // fail because an unrelated automation isn't configured.
    let teslaTrunkScheduledFor = null;
    try {
      const scheduled = await teslaCore.scheduleCheckoutTrunkOpen(user.id);
      if (scheduled) teslaTrunkScheduledFor = scheduled.scheduled_for;
    } catch (err) {
      // Real, non-fatal: scheduling the trunk automation never blocks the real "list cleared" result.
      console.error(`[tesla] checkout-to-trunk schedule failed: ${err.message}`);
    }
    return sendJson(res, 200, { ...result, teslaTrunkScheduledFor });
  });

  // #3111: a real stated budget for this run. `budget` is dollars (a number, or null to clear)
  // -- informational only, per the issue's own scope: this never blocks addListItems above, it
  // just changes what getListDetail's real running total looks like against.
  router.patch("/api/lists/:id/budget", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (body.budget === undefined) throw badRequest("budget is required (a number, or null to clear)");
    const budgetCents = body.budget === null ? null : Math.round(Number(body.budget) * 100);
    if (budgetCents !== null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
      throw badRequest("budget must be a non-negative number or null");
    }
    return sendJson(res, 200, await lists.setListBudget(user.id, params.id, budgetCents));
  });

  // -- recipes (Git #3124, blocked_by #3088) -------------------------------
  //
  // "No separate recipe-authoring UI, no manual meal-planning calendar" (Section 5) -- the web
  // UI here only lists, matches, and lets Shane add missing ingredients or archive a recipe he
  // no longer wants; the real generation happens in a Claude conversation over MCP (push_recipes,
  // below in src/mcp/tools.mjs). createRecipe is still reachable directly (createdBy: 'shane')
  // for the rare case Shane wants to type one in himself.

  router.get("/api/recipes", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { recipes: await recipes.listRecipesWithMatch(user.id) });
  });

  router.post("/api/recipes", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await recipes.createRecipe(user.id, { ...body, createdBy: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "recipe.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.delete("/api/recipes/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await recipes.archiveRecipe(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "recipe.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // #3124's real scope item 3: the recipe's real currently-missing ingredients, pushed straight
  // onto the one real Shopping run -- same run push_list and the Shopping screen already write to.
  router.post("/api/recipes/:id/add-missing", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await recipes.addMissingIngredients(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "recipe.add_missing", entityId: params.id, detail: { added: result.added } });
    return sendJson(res, 200, result);
  });

  // Section 5's real health context -- stated once, read by Claude (get_health_context, MCP)
  // before it generates recipes. Surfaced here too so the web UI (Settings) can show/edit it
  // without going through Claude every time.
  router.get("/api/health-context", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { healthContext: await recipes.getHealthContext(user.id) });
  });

  router.patch("/api/health-context", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const healthContext = await recipes.setHealthContext(user.id, body.healthContext ?? null);
    await audit.record({ userId: user.id, actor: "web", action: "health_context.set" });
    return sendJson(res, 200, { healthContext });
  });

  // -- room order (Git #3215) -- the first Settings card's "House · Room order" ---------
  router.get("/api/room-order", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { order: await roomOrder.getRoomOrder(user.id) });
  });

  router.patch("/api/room-order", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const order = await roomOrder.setRoomOrder(user.id, body.order);
    await audit.record({ userId: user.id, actor: "web", action: "room_order.set", detail: { order } });
    return sendJson(res, 200, { order });
  });

  router.delete("/api/room-order", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const order = await roomOrder.resetRoomOrder(user.id);
    await audit.record({ userId: user.id, actor: "web", action: "room_order.reset" });
    return sendJson(res, 200, { order });
  });

  // -- medications (Git #3135) ----------------------------------------------
  //
  // The batch-grouped Meds tray: GET returns today's real state (batches + taken-today status,
  // refills split into needs-you/handled). Swiping a batch complete or undoing it, marking a
  // manual-watch refill ordered, and basic CRUD for the medication list itself are all here so
  // the web UI is fully self-serve -- Claude's own MCP path (src/mcp/tools.mjs) is the
  // capture-grammar entry point ("took my morning meds"), not the only way in.

  router.get("/api/medications", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await medications.getMedsToday(user.id));
  });

  router.post("/api/medications", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await medications.createMedication(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "medication.create", entityId: row.id, detail: { name: row.name, batch: row.batch } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/medications/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await medications.updateMedication(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "medication.update", entityId: params.id });
    return sendJson(res, 200, row);
  });

  router.delete("/api/medications/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await medications.archiveMedication(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "medication.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // "Ordered it" -- design screen 6's real manual-watch refill action.
  router.post("/api/medications/:id/ordered", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await medications.markMedicationOrdered(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "medication.ordered", entityId: params.id, detail: { nextRefillOn: row.next_refill_on } });
    return sendJson(res, 200, row);
  });

  // Single swipe per batch (README non-negotiable) -- :batch is the batch name (morning,
  // evening, ...), not a medication id.
  router.post("/api/medications/batches/:batch/take", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await medications.markBatchTaken(user.id, params.batch, { source: "web" });
    await audit.record({ userId: user.id, actor: "web", action: "medication.batch_taken", detail: { batch: row.batch } });
    return sendJson(res, 200, row);
  });

  // Undo (Section 8's real 5s Undo pattern) -- clears today's swipe for this batch.
  router.delete("/api/medications/batches/:batch/take", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await medications.unmarkBatchTaken(user.id, params.batch);
    await audit.record({ userId: user.id, actor: "web", action: "medication.batch_undo", detail: { batch: params.batch } });
    return sendJson(res, 200, { ok: true });
  });

  // -- meal plan (Git #3127, blocked_by #3124 and #3132) -------------------
  //
  // Section 5's real Sunday ritual: "no manual meal-planning calendar" holds here too -- this is
  // a real, read-only display of what Claude already pushed via push_meal_plan (MCP), plus the
  // one archive action to correct a bad push. There is no POST here on purpose; the app hosts
  // and displays the plan, it does not author it.

  router.get("/api/meal-plan", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      entries: await mealPlan.listMealPlan(user.id, {
        from: ctx.url.searchParams.get("from"),
        to: ctx.url.searchParams.get("to"),
      }),
    });
  });

  router.delete("/api/meal-plan/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await mealPlan.archiveMealPlanEntry(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "meal_plan.archive", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // -- per-store price history (Git #3112) ---------------------------------

  router.get("/api/stores", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { stores: await prices.listStores(user.id) });
  });

  router.post("/api/stores", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.name) throw badRequest("name is required");
    return sendJson(res, 201, await prices.getOrCreateStore(user.id, body.name));
  });

  // ?item= is the same normalised text saved with each price -- the Shopping room's own item
  // text, so "spaghetti sauce" pulls back every real observation ever logged for it.
  router.get("/api/prices", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    const item = url.searchParams.get("item");
    if (!item) throw badRequest("item query param is required");
    return sendJson(res, 200, { item, history: await prices.getPriceHistory(user.id, item) });
  });

  router.post("/api/prices", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await prices.recordPrice(user.id, {
      storeId: body.storeId ?? null,
      storeName: body.storeName ?? null,
      itemText: body.itemText,
      priceCents: body.priceCents,
      observedOn: body.observedOn ?? null,
      note: body.note ?? null,
      source: "shane",
    });
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "price.record",
      detail: { itemText: row.item_text, storeName: row.store_name, priceCents: row.price_cents },
    });
    return sendJson(res, 201, row);
  });

  // Barcode scan (Git #3109): resolve a real scanned barcode against this real list before
  // asking Shane for a price -- exact / near / unknown, per the design's own three-state
  // grammar. Read-only; never a silent failure -- "unknown" is a real, valid response, not an
  // error.
  router.post("/api/lists/:id/scan/lookup", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await scan.lookupBarcode(user.id, params.id, body.barcode));
  });

  // Saves the real typed price, links the barcode for next time, and checks the item off --
  // "Saving also checks the item off" per the design copy. Also feeds the real per-store price
  // history (Git #3122, fixing the #3109/#3112 gap this route's own prior note described) --
  // scan.saveScan() itself infers the store from the run's existing `lists.store` (#3108,
  // "Which store?" above the list) rather than asking again here, per the design's own "Shane
  // only types the price" copy for this screen.
  router.post("/api/lists/:id/scan/save", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await scan.saveScan(user.id, params.id, {
      barcode: body.barcode,
      itemId: body.itemId ?? null,
      text: body.text ?? null,
      priceCents: body.priceCents,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "list.item.scan",
      entityId: params.id,
      detail: { barcode: body.barcode, itemId: result.item.id, priceCents: result.item.price_cents },
    });
    return sendJson(res, 200, result);
  });

  // -- money (Git #3137) ---------------------------------------------------
  //
  // Every number here comes out of ShanesSurvival's own real tables in the SAME real Postgres
  // (#3107) and through the math ported from its own DashboardService.cs -- see
  // src/core/money.mjs. Reads only: the one endpoint that talks about moving money simulates it
  // and says so in its own response body, because Plaid is read-only and NFCU has no Transfer
  // product.

  router.get("/api/money/gate", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getGateStatus(user.id));
  });

  router.get("/api/money/budget-day", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { budgetDay: await money.getBudgetDay(user.id) });
  });

  // GET, not POST: a what-if changes nothing, and a shareable/refreshable URL is the right shape
  // for a question that is pure arithmetic over current balances.
  router.get("/api/money/what-if", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    return sendJson(res, 200, await money.whatIf(user.id, url.searchParams.get("amount")));
  });

  // POST despite never writing anything: the request carries three real fields and reads far
  // better as a body than a query string. `executed: false` in every response is structural --
  // there is no code path in this app that can move real money.
  router.post("/api/money/simulate-transfer", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await money.simulateTransfer(user.id, {
      amount: body.amount,
      from: body.from,
      to: body.to,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.transfer.simulated",
      detail: { amount: body.amount, from: body.from, to: body.to, resolvable: result.resolvable },
    });
    return sendJson(res, 200, result);
  });

  router.get("/api/money/habits", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { habits: await money.listHabits(user.id, { includeInactive: true }) });
  });

  // The only real write in this section, and it writes to Shane's Life's own table (026), never
  // to a ShanesSurvival one.
  router.patch("/api/money/habits", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await money.setHabit(user.id, body);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.habit.set",
      entityId: row.id,
      detail: { name: row.name, amountPerCycle: row.amount_per_cycle, isActive: row.is_active },
    });
    return sendJson(res, 200, row);
  });

  // -- Money -> Income Rules + transaction auto-scan (Git #3169) -----------------------
  //
  // Real port of Finance-Tracker's IncomeRule/scanTransactions -- see
  // src/core/income-rules.mjs's own header for the full real reasoning. Contract pack
  // Section 8 ("no forms, anywhere, ever") is why this app's own UI only ever reads rules and
  // fires single-click actions here (scan, delete, set primary) -- creating/editing a rule's
  // several typed fields is a real MCP tool (mcp/tools.mjs), the same architecture already used
  // for set_habit.

  router.get("/api/money/income-rules", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, {
      rules: await incomeRules.listRules({ includeInactive: true }),
      sources: await incomeRules.listIncomeSources(),
    });
  });

  router.post("/api/money/income-rules", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const rule = await incomeRules.createRule(body);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.income_rule.created",
      entityId: rule.id,
      detail: { name: rule.name, accountName: rule.accountName, sourceName: rule.sourceName },
    });
    return sendJson(res, 201, rule);
  });

  router.patch("/api/money/income-rules/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const rule = await incomeRules.updateRule(params.id, body);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.income_rule.updated",
      entityId: rule.id,
      detail: { name: rule.name, isActive: rule.isActive },
    });
    return sendJson(res, 200, rule);
  });

  router.delete("/api/money/income-rules/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await incomeRules.deleteRule(params.id);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.income_rule.deleted",
      entityId: params.id,
      detail: {},
    });
    return sendJson(res, 200, result);
  });

  // The one real write that also touches ShanesSurvival's own income_entries -- always through
  // scanTransactions()'s own claim-before-insert dedupe, never a direct insert here.
  router.post("/api/money/income-rules/scan", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await incomeRules.scanTransactions({ lookbackDays: body.lookbackDays });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.income_rules.scanned",
      detail: {
        scannedAccounts: result.scannedAccounts,
        transactionsScanned: result.transactionsScanned,
        created: result.created,
        linked: result.linked,
        alreadyLogged: result.alreadyLogged,
      },
    });
    return sendJson(res, 200, result);
  });

  router.post("/api/money/income-sources/:id/primary", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await incomeRules.setPrimarySource(params.id);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.income_source.primary_set",
      entityId: row.id,
      detail: { name: row.name },
    });
    return sendJson(res, 200, row);
  });

  // -- Money -> Banks: item health + reconnect (Git #3168) -------------------------------
  //
  // Deliberately NOT a second Plaid Link. ShanesSurvival's WPF app owns the initial link and the
  // real cursor-based /transactions/sync into these same tables; duplicating either here would
  // give one cursor two writers. What lives here is the half a desktop app structurally cannot
  // do: hold a webhook URL open, and be reachable from a phone when a bank connection breaks.
  //
  // Update mode is what makes that safe -- Plaid re-authenticates the EXISTING item, so the
  // access token and item id both survive and the desktop app's stored cursor keeps working.
  // Nothing here exchanges a public token, and nothing here writes to accounts or transactions.

  router.get("/api/money/banks", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, {
      configured: plaid.plaidConfigured(),
      plaidEnv: config.plaidEnv,
      webhookUrl: plaid.webhookUrl(),
      // False on a localhost origin. The screen says so rather than implying webhooks are live.
      webhookDeliverable: plaid.webhookUrlIsDeliverable(),
      items: await plaid.listItems(),
    });
  });

  /** The real webhook receipts, so "has Plaid ever actually called us?" has an answer on screen. */
  router.get("/api/money/banks/events", async (req, res, _params, ctx) => {
    requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 200);
    return sendJson(res, 200, { events: await plaid.listWebhookEvents({ limit }) });
  });

  /**
   * Ask Plaid what every item's state really is. This is the only path that works for the items
   * already in this database: the WPF app linked them without a webhook, so they would otherwise
   * sit at the default 'ok' forever no matter what is true at the bank.
   */
  router.post("/api/money/banks/refresh", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    if (!plaid.plaidConfigured()) throw badRequest("Plaid is not configured on this server.");
    const result = await plaid.refreshAllItemHealth();
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.banks.refreshed",
      detail: { refreshed: result.refreshed.length, failed: result.failed.length },
    });
    return sendJson(res, 200, { ...result, items: await plaid.listItems() });
  });

  /** Point already-linked items at this app's receiver -- they were created without one. */
  router.post("/api/money/banks/register-webhooks", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    if (!plaid.plaidConfigured()) throw badRequest("Plaid is not configured on this server.");
    const result = await plaid.registerWebhooks();
    if (result.skipped === "origin-not-public") {
      throw badRequest(
        `Plaid can only deliver to a public HTTPS URL, and this server's origin is ${plaid.webhookUrl()}. ` +
          "Register the webhook from the deployed app, not from local dev.",
      );
    }
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.banks.webhooks-registered",
      detail: { target: result.target, updated: result.updated.length, failed: result.failed.length },
    });
    return sendJson(res, 200, { ...result, items: await plaid.listItems() });
  });

  /** Real update-mode Link token for one item. Never creates a new item. */
  router.post("/api/money/banks/:id/reconnect-token", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    if (!plaid.plaidConfigured()) throw badRequest("Plaid is not configured on this server.");
    const row = await plaid.getItemRow(params.id);
    if (!row) throw notFound("No such connected bank.");
    let token;
    try {
      token = await plaid.createUpdateLinkToken(row.access_token, { clientUserId: user.id });
    } catch (err) {
      throw badRequest(`Plaid would not issue a reconnect token: ${err.message}`);
    }
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.banks.reconnect-started",
      entityId: row.id,
      detail: { institutionName: row.institution_name },
    });
    return sendJson(res, 200, {
      linkToken: token.linkToken,
      expiration: token.expiration,
      redirectUri: config.plaidRedirectUri,
      institutionName: row.institution_name,
    });
  });

  /**
   * Finish a reconnect. Link's onSuccess means "Shane finished the flow", which is NOT the same
   * claim as "the item is healthy again" -- so this asks Plaid directly with /item/get and only
   * clears the state if the real answer is clean. A reconnect that did not take stays broken on
   * screen rather than being quietly marked fixed.
   */
  router.post("/api/money/banks/:id/reconnect-complete", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    if (!plaid.plaidConfigured()) throw badRequest("Plaid is not configured on this server.");
    const row = await plaid.getItemRow(params.id);
    if (!row) throw notFound("No such connected bank.");

    const refreshed = await plaid.refreshItemHealth(row.id);
    const healthy = Boolean(refreshed && !refreshed.needsReconnect && refreshed.health === "ok");
    const item = healthy ? await plaid.markReconnected(row.id) : refreshed;

    // Best-effort: an item that just came back through Link is the natural moment to make sure
    // it points at this receiver. A failure here must not fail the reconnect itself.
    let webhook = null;
    if (healthy && plaid.webhookUrlIsDeliverable()) {
      try {
        webhook = await plaid.setItemWebhook(row.access_token);
      } catch {
        webhook = null;
      }
    }

    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.banks.reconnect-completed",
      entityId: row.id,
      detail: { institutionName: row.institution_name, healthy, health: item?.health ?? null },
    });
    return sendJson(res, 200, { healthy, item, webhook });
  });

  // -- Tesla (Git #3158): OAuth connect/disconnect, vehicle selection, on-demand climate read,
  // and the webhook tokens for the real external climate-preconditioning trigger. The webhook
  // itself (/hooks/tesla/:token) and the vehicle-pairing well-known route are NOT here -- both
  // are public, token/env-authenticated, and live in server.mjs + routes/tesla.mjs instead, the
  // same split Plaid's own webhook receiver uses.

  const TESLA_OAUTH_STATE_COOKIE = "sl_tesla_oauth_state";

  router.get("/api/tesla/status", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, await teslaCore.connectionStatus(ctx.session.user.id));
  });

  /** Real redirect to Tesla's own authorize page. `state` is a fresh random value, both sent to
   *  Tesla and stashed in a short-lived cookie -- the callback below refuses unless they match,
   *  the standard OAuth CSRF defense. */
  router.get("/auth/tesla/start", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    if (!teslaCore.teslaConfigured()) throw badRequest("Tesla is not configured on this server.");
    const state = mintToken(24);
    setCookie(res, TESLA_OAUTH_STATE_COOKIE, state, { maxAge: 600, secure: config.isProduction });
    return redirect(res, teslaCore.authorizeUrl(state));
  });

  /** Tesla's own redirect back, after Shane approves (or denies) the connection in its UI. */
  router.get("/auth/tesla/callback", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    const error = url.searchParams.get("error");
    if (error) throw badRequest(`Tesla declined the connection: ${error}`);

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const cookies = parseCookies(req);
    const expectedState = cookies[TESLA_OAUTH_STATE_COOKIE];
    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      throw badRequest("Tesla's callback did not carry a matching state -- start the connection again.");
    }
    setCookie(res, TESLA_OAUTH_STATE_COOKIE, "", { maxAge: 0, secure: config.isProduction });

    const tokens = await teslaCore.exchangeCode(code);
    await teslaCore.saveTokens(user.id, tokens);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.connected" });
    return redirect(res, "/#/settings");
  });

  router.post("/api/tesla/disconnect", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const disconnected = await teslaCore.disconnect(user.id);
    if (disconnected) await audit.record({ userId: user.id, actor: "owner", action: "tesla.disconnected" });
    return sendJson(res, 200, { disconnected });
  });

  router.get("/api/tesla/vehicles", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      return sendJson(res, 200, { vehicles: await teslaCore.listVehicles(user.id) });
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
  });

  router.post("/api/tesla/vehicles/select", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.vehicleId) throw badRequest("vehicleId is required");
    await teslaCore.selectVehicle(user.id, {
      vehicleId: body.vehicleId,
      vin: body.vin,
      displayName: body.displayName,
    });
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "tesla.vehicle-selected",
      detail: { vehicleId: body.vehicleId, displayName: body.displayName ?? null },
    });
    // Git #3270 gap #2: selecting a real Tesla vehicle here is the one moment this app knows
    // both a real Tesla connection AND a real vehicle exist -- auto-link (or create) the matching
    // Cars entity right now instead of leaving the two data models silently disconnected.
    const carsLink = await vehicles.autoLinkTeslaVehicle(user.id, { displayName: body.displayName, vin: body.vin });
    if (carsLink.linked) {
      await audit.record({
        userId: user.id,
        actor: "web",
        action: "vehicle.tesla-auto-link",
        entityId: carsLink.vehicleId,
        detail: { created: carsLink.created, vehicleName: carsLink.vehicleName },
      });
    }
    return sendJson(res, 200, { ...(await teslaCore.connectionStatus(user.id)), carsLink });
  });

  /**
   * Real, idempotent self-heal for an account that connected and selected a vehicle before the
   * auto-link above existed (Git #3270 -- Shane's own real, already-connected account is exactly
   * this case: `vehicles/select` already ran on the deployed server, so the auto-link above never
   * fired for him). The Tesla room calls this once on load; a no-op when already linked.
   */
  router.post("/api/tesla/link-to-cars", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const status = await teslaCore.connectionStatus(user.id);
    if (!status.connected || !status.vehicleId) throw badRequest("Connect Tesla and select a vehicle first.");
    const carsLink = await vehicles.autoLinkTeslaVehicle(user.id, { displayName: status.vehicleDisplayName, vin: status.vehicleVin });
    if (carsLink.linked) {
      await audit.record({
        userId: user.id,
        actor: "web",
        action: "vehicle.tesla-auto-link",
        entityId: carsLink.vehicleId,
        detail: { created: carsLink.created, vehicleName: carsLink.vehicleName },
      });
    }
    return sendJson(res, 200, carsLink);
  });

  /** On-demand real climate read (not an auto-poll -- see tesla.mjs's own header on why). */
  router.get("/api/tesla/climate", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      return sendJson(res, 200, await teslaCore.getVehicleClimateState(user.id));
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
  });

  /** On-demand real charge read (Git #3270's own Tesla room "Right now" card -- getChargeState
   *  already existed for the housekeeping sweep/commute check but had no direct route of its
   *  own). Same on-demand-only discipline as climate above. Real TeslaError (no vehicle, Tesla
   *  unreachable, a stale/missing vault key) is a real, honest 400 -- not an uncaught 500 -- same
   *  as this file's other new direct-command routes below. */
  router.get("/api/tesla/charge", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      return sendJson(res, 200, await teslaCore.getChargeState(user.id));
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
  });

  router.get("/api/tesla/hook-tokens", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { tokens: await teslaCore.listHookTokens(user.id) });
  });

  /** The real token value is returned exactly once, here -- same discipline as MCP/widget
   *  tokens: only its SHA-256 is ever stored, so this is the one moment it can be shown. */
  router.post("/api/tesla/hook-tokens", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const issued = await teslaCore.issueHookToken(user.id, body.label);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.hook-token-issued", detail: { label: issued.label } });
    return sendJson(res, 200, {
      ...issued,
      hookUrl: `${config.publicOrigin}/hooks/tesla/${issued.token}`,
    });
  });

  router.delete("/api/tesla/hook-tokens/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await teslaCore.revokeHookToken(user.id, params.id);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.hook-token-revoked", entityId: params.id });
    return sendJson(res, 200, { revoked: true });
  });

  // -- Tesla battery/charging-aware Money nudges (Git #3238) -- real, Shane-entered commute
  // settings + an on-demand real charge read. See core/tesla.mjs's own header and migration 056
  // for why the cost estimate is computed from Shane's own real settings rather than a value
  // Tesla's API doesn't actually publish.
  router.get("/api/tesla/commute-settings", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const settings = await teslaCore.getCommuteSettings(user.id);
    if (!settings) throw notFound("Connect Tesla before configuring commute nudges.");
    return sendJson(res, 200, settings);
  });

  router.patch("/api/tesla/commute-settings", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const settings = await teslaCore.updateCommuteSettings(user.id, body);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.commute-settings-updated" });
    return sendJson(res, 200, settings);
  });

  /** On-demand real "will tonight's charge cover tomorrow" check -- the same real logic the
   *  6-hour housekeeping sweep runs, exposed for a Settings "check now" action. */
  router.get("/api/tesla/commute-check", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      return sendJson(res, 200, await teslaCore.checkLowBatteryForCommute(user.id));
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
  });

  // -- Tesla room direct commands (Git #3270, design handoff "Do" card) -- a real, immediate tap
  // from the Tesla room itself: warm the car up (and stop), open the trunk right now. Distinct
  // from Heading Home (a composed navigation+climate send) and from the checkout-to-trunk
  // automation below (scheduled, not immediate).
  router.post("/api/tesla/climate/start", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      await teslaCore.startPreconditioning(user.id);
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.climate-start" });
    return sendJson(res, 200, { sent: true });
  });

  router.post("/api/tesla/climate/stop", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      await teslaCore.stopPreconditioning(user.id);
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.climate-stop" });
    return sendJson(res, 200, { sent: true });
  });

  /** The two-tap confirm lives client-side (design: "tap, then confirm within 4 seconds") -- by
   *  the time this route is called the real confirmation already happened. */
  router.post("/api/tesla/trunk/open", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    try {
      await teslaCore.openTrunkNow(user.id);
    } catch (err) {
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.trunk-open" });
    return sendJson(res, 200, { sent: true });
  });

  /** Real "Heading home · {house}" availability for the Tesla room's own Do card -- the same
   *  headingHomeAvailability() /api/today already computes, exposed on its own so the room can
   *  reload it independently (e.g. right after a Heading Home send). Null is a real, ordinary
   *  state (not connected, no vehicle, or no recommended/tagged house yet), not an error. */
  router.get("/api/tesla/heading-home/availability", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await headingHomeAvailability(user.id));
  });

  // -- Tesla vehicle commands (Git #3218) -- the checkout-to-trunk automation's real toggle and
  // visibility. Sending a command itself never has its own direct route: the one real trigger is
  // lists.mjs's clear-checked ("Done shopping"), which schedules it (tesla.mjs's own header on
  // why -- Tesla is this file's concern, not Lists').
  router.patch("/api/tesla/auto-trunk-on-checkout", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (typeof body.enabled !== "boolean") throw badRequest("enabled must be true or false");
    const result = await teslaCore.setAutoTrunkOnCheckout(user.id, body.enabled);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.auto-trunk-on-checkout", detail: result });
    return sendJson(res, 200, result);
  });

  router.get("/api/tesla/scheduled-commands", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { commands: await teslaCore.listScheduledCommands(user.id) });
  });

  router.delete("/api/tesla/scheduled-commands/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await teslaCore.cancelScheduledCommand(user.id, params.id);
    await audit.record({ userId: user.id, actor: "owner", action: "tesla.scheduled-command-canceled", entityId: params.id });
    return sendJson(res, 200, { canceled: true });
  });

  // -- Standalone timers (Git #3307) -----------------------------------------------------
  //
  // Server-side entity, real web push -- see src/core/timers.mjs's own header and
  // server.mjs's runTimerSweep for the "why not client-side state" reasoning. Capture grammar
  // (`timer_set` in capture-grammar.mjs) is the primary real entry point; these routes back the
  // Today tray's "see/cancel an active standalone timer" real scope item and let the UI set one
  // directly too, without needing to type through the capture box.

  router.get("/api/timers", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { timers: await timers.listActive(user.id) });
  });

  router.post("/api/timers", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await timers.createTimer(user.id, { label: body.label ?? null, durationSeconds: body.durationSeconds });
    // timers.id is bigserial, not the uuid activity_log.entity_id expects (Git #3161-class trap,
    // caught live -- see nudges' own `nudgeId`-in-detail convention for the same real reason).
    await audit.record({ userId: user.id, actor: "web", action: "timer.create", detail: { timerId: row.id, label: row.label, durationSeconds: row.duration_seconds } });
    return sendJson(res, 201, row);
  });

  router.delete("/api/timers/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await timers.cancelTimer(user.id, params.id);
    await audit.record({ userId: user.id, actor: "owner", action: "timer.canceled", detail: { timerId: params.id } });
    return sendJson(res, 200, { canceled: true });
  });

  // Git #3318: the Today-tray timer chip's own real "+1 min" action (prototype `d.timerPlus`).
  router.post("/api/timers/:id/extend", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await timers.extendTimer(user.id, params.id, body.seconds ?? 60);
    await audit.record({ userId: user.id, actor: "web", action: "timer.extended", detail: { timerId: row.id, seconds: body.seconds ?? 60 } });
    return sendJson(res, 200, row);
  });

  // -- Money -> Home-tab decision tools (Git #3171) -------------------------------------
  //
  // Period Review, Skip Suggestions, Distribute Paycheck, Transfer Instructions -- see
  // src/core/money.mjs's own header on this section for the real architecture translation from
  // Finance-Tracker's envelope model. Distribute Paycheck's "apply" is the one real write; it
  // writes only to this app's own paycheck_distributions table (migration 044), and structurally
  // cannot move a real dollar, same discipline as simulate-transfer above.

  router.get("/api/money/period-review", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getPeriodReview(user.id));
  });

  // Git #3205: the real, shared two-week cycle card at the top of Now and Bills --
  // ?cyclesBack=N pages back through real earlier cycles (N=0 is the current one).
  router.get("/api/money/cycle-card", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    const cyclesBack = Number(url.searchParams.get("cyclesBack") ?? 0);
    return sendJson(res, 200, await money.getCycleCard(user.id, { cyclesBack }));
  });

  router.get("/api/money/skip-suggestions", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getSkipSuggestions(user.id));
  });

  // GET, not POST: a preview changes nothing -- same reasoning as what-if above. `skip`/`give`
  // are the real conversational-adjustment path (Git #3208): repeatable `skip=Netflix` params and
  // a `give` JSON array of `{name, amount}`, the same shape the `preview_paycheck_distribution`
  // MCP tool exposes to Claude for "skip Netflix" / "give Rent 2000".
  router.get("/api/money/distribute-preview", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    let give = [];
    const giveRaw = url.searchParams.get("give");
    if (giveRaw) {
      try {
        give = JSON.parse(giveRaw);
      } catch {
        throw badRequest("give must be JSON: [{\"name\":\"Rent\",\"amount\":200}]");
      }
    }
    return sendJson(
      res,
      200,
      await money.previewDistribution(user.id, url.searchParams.get("amount"), {
        skip: url.searchParams.getAll("skip"),
        give,
      }),
    );
  });

  router.post("/api/money/distribute", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const result = await money.applyDistribution(user.id, {
      sourceAmount: body.sourceAmount,
      allocations: body.allocations,
    });
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.distribution.planned",
      detail: { sourceAmount: body.sourceAmount, accountCount: Array.isArray(body.allocations) ? body.allocations.length : 0 },
    });
    return sendJson(res, 200, result);
  });

  router.get("/api/money/transfer-instructions", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getTransferInstructions(user.id));
  });

  router.post("/api/money/transfer-instructions/:accountId/mark-transferred", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await money.markDistributionTransferred(user.id, params.accountId);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.distribution.transferred",
      entityId: params.accountId,
      detail: {},
    });
    return sendJson(res, 200, result);
  });

  // A real field Shane's Life itself owns on the shared accounts table (migration 044) -- see
  // money.mjs's own setBillCategory header for why this doesn't collide with ShanesSurvival's
  // own bill-account mutations.
  router.patch("/api/money/bills/:id/category", async (req, res, params, ctx) => {
    requireUser(ctx);
    const body = await readJson(req);
    return sendJson(res, 200, await money.setBillCategory(params.id, body.category));
  });

  // -- Money -> Bankruptcy/debt tracker (Git #3163) -------------------------------------
  //
  // A real overlay on ShanesSurvival's own `debts` table (migration 042) -- see
  // src/core/money.mjs's own header for the real investigation and decision. Full CRUD,
  // matching Finance-Tracker's `BankruptcyItem` shape (add/update/delete), because this is the
  // one real write surface in Money's own routes that writes to a ShanesSurvival table, not a
  // Shane's Life one -- the design's own "surface and organize existing real debt data" scope,
  // not read-only.

  router.get("/api/money/debts", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, { debts: await money.listDebts() });
  });

  router.post("/api/money/debts", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await money.createDebt(body);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.debt.create",
      entityId: row.id,
      detail: { creditor: row.creditor, balance: row.balance, includedInBankruptcy: row.includedInBankruptcy },
    });
    return sendJson(res, 201, row);
  });

  router.patch("/api/money/debts/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await money.updateDebt(params.id, body);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.debt.update",
      entityId: row.id,
      detail: { creditor: row.creditor, balance: row.balance, includedInBankruptcy: row.includedInBankruptcy },
    });
    return sendJson(res, 200, row);
  });

  router.delete("/api/money/debts/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const result = await money.deleteDebt(params.id);
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "money.debt.delete",
      entityId: result.id,
    });
    return sendJson(res, 200, result);
  });

  // Accounts' "Debts · critical first" overlay (Git #3210): real critical debts with a real
  // payoff-progress sparkline each, plus the real combined "paid down since" summary.
  router.get("/api/money/debts/critical-overlay", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, await money.getCriticalDebtOverlay());
  });

  // -- Money -> Accounts (Git #3170) ----------------------------------------------------
  //
  // Real sectioned account list (§1 of FINANCE_TRACKER_AUDIT.md's accounts.tsx audit, ported in
  // shape only) -- see src/core/money.mjs's own header comment above getAccountsOverview for the
  // real scope line drawn around Connected Banks disconnect/reconnect (that's #3168's job).

  router.get("/api/money/accounts", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getAccountsOverview(user.id));
  });

  // GET, same reasoning as /api/money/what-if: a live preview that changes nothing, never a
  // persisted target_amount write (that stays ShanesSurvival's own MCP tools' job).
  router.get("/api/money/accounts/:id/preview-target", async (req, res, params, ctx) => {
    requireUser(ctx);
    const url = new URL(req.url, "http://internal");
    return sendJson(
      res,
      200,
      await money.previewAccountTarget(params.id, url.searchParams.get("target")),
    );
  });

  // The real bill detail bottom sheet (Git #3212, design 1e): balance vs. target, the real
  // rolled-over/this-cycle envelope breakdown, the funding-history sparkline, and the real
  // Vault link when one exists. `userId` is only needed for the vault lookup.
  router.get("/api/money/bills/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await money.getBillDetail(user.id, params.id));
  });

  // -- Money -> Vault (Git #3150, widened to a full password vault by Git #3242) ---------
  //
  // The bill-payment reference vault. Design contract Section 9 flags this as "a real security
  // requirement, not optional polish", and the handoff README's own §7 line is the spec these
  // routes implement: "rows with site + masked reference + Reveal (passkey overlay -> full value
  // shown 20 s -> Copy)". src/core/vault.mjs owns the AES-256-GCM and the audit write; what
  // lives here is the part that cannot live there -- the real WebAuthn assertion.
  //
  // The reveal is deliberately TWO requests carrying one assertion, not a check against
  // `sessions.last_verified_at`. Gating on the session's last-verified stamp would make one
  // assertion good for every entry inside a window, which is precisely the "not just session
  // presence" the issue rules out. Instead the challenge is issued per entry
  // (purpose `vault:reveal:<id>`), so an assertion obtained for one row cannot reveal another,
  // and `consumeChallenge`'s atomic UPDATE ... WHERE consumed_at IS NULL means it cannot be
  // replayed to reveal the same row twice either.

  const VAULT_REVEAL_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

  /** VaultKeyUnavailable is a real deployment fact (no SL_VAULT_KEY), not a bad request -- 503
   *  says "this feature cannot work right now" rather than blaming the caller. */
  function vaultError(err) {
    if (err instanceof vault.VaultKeyUnavailable) return new HttpError(503, err.message);
    return err;
  }

  // `kind` and `q` are real server-side filters (Git #3242), not a convenience over a list the
  // client already has. A full password vault is the one room where "just send everything and
  // filter in JS" stops being harmless: the masked list is small, but the row COUNT and the set
  // of sites it holds are themselves worth keeping off the wire when they aren't being asked for.
  // Searching here also keeps the honest boundary visible -- see listEntries: a search can only
  // ever match label/site/username, because no plaintext password exists to match against.
  router.get("/api/vault", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const kind = ctx.url.searchParams.get("kind");
    if (kind && !vault.KINDS.includes(kind)) {
      throw badRequest(`kind must be one of: ${vault.KINDS.join(", ")}`);
    }
    return sendJson(res, 200, {
      // Masked rows only -- listEntries has no plaintext path at all, by design.
      entries: await vault.listEntries(user.id, { kind, q: ctx.url.searchParams.get("q") }),
      // Counted over the whole vault, so the filter row's numbers don't move as a search narrows.
      counts: await vault.countsByKind(user.id),
      kinds: vault.KINDS,
      // The room says so out loud rather than failing at the first Reveal tap.
      keyConfigured: vault.keyIsConfigured(),
      windowSeconds: vault.REVEAL_WINDOW_SECONDS,
      clipboardClearSeconds: vault.CLIPBOARD_CLEAR_SECONDS,
    });
  });

  router.post("/api/vault", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.label) throw badRequest("label is required");
    if (!body.secret) throw badRequest("secret is required");
    let entry;
    try {
      entry = await vault.createEntry(user.id, body);
    } catch (err) {
      throw vaultError(err);
    }
    // The detail column is a real audit trail, so it carries what the row IS, never what it
    // holds -- no secret, no notes, not even the masked hint's digits. The username is left out
    // too (Git #3242): it is half of a real credential, and the audit feed is a plainly readable
    // table that answers "what happened" without needing to know who the login belongs to.
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.created",
      entityId: entry.id,
      detail: { kind: entry.kind, label: entry.label, site: entry.site },
    });
    return sendJson(res, 201, entry);
  });

  router.patch("/api/vault/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    let entry;
    try {
      entry = await vault.updateEntry(user.id, params.id, body);
    } catch (err) {
      throw vaultError(err);
    }
    if (!entry) throw notFound("Vault entry not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.updated",
      entityId: entry.id,
      detail: {
        kind: entry.kind,
        label: entry.label,
        site: entry.site,
        secretChanged: Boolean(body.secret),
        // Same reasoning as the create above: that the notes changed is a real, auditable fact;
        // what they now say is not something an audit feed gets to hold.
        notesChanged: body.notes !== undefined,
      },
    });
    return sendJson(res, 200, entry);
  });

  router.delete("/api/vault/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const removed = await vault.deleteEntry(user.id, params.id);
    if (!removed) throw notFound("Vault entry not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.entry.deleted",
      entityId: params.id,
      detail: {},
    });
    return sendJson(res, 200, { ok: true });
  });

  // Step 1 of a reveal: a challenge bound to THIS entry. Issued only for an entry the caller
  // actually owns, so a probe cannot use this to learn which ids exist.
  router.post("/api/vault/:id/reveal/options", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = (await vault.listEntries(user.id)).some((e) => e.id === params.id);
    if (!owned) throw notFound("Vault entry not found");

    const credentialList = await credentials.listCredentials(user.id);
    if (credentialList.length === 0) {
      throw forbidden("No passkey is enrolled, and a reveal requires one every time.");
    }
    return sendJson(res, 200, {
      challenge: await webauthn.issueChallenge(`vault:reveal:${params.id}`, user.id),
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
      allowCredentials: credentialList.map((c) => ({
        type: "public-key",
        id: c.credential_id,
        transports: c.transports,
      })),
    });
  });

  // Step 2: the assertion itself. Nothing decrypts until this verifies.
  router.post("/api/vault/:id/reveal", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const gate = ratelimit.hit(`vault:reveal:${user.id}`, VAULT_REVEAL_LIMIT.limit, VAULT_REVEAL_LIMIT.windowMs);
    if (!gate.allowed) {
      throw tooMany("Too many reveals in a row. Wait a bit.", { retryAfterMs: gate.retryAfterMs });
    }

    const body = await readJson(req);
    const consumed = await webauthn.consumeChallenge(body.challenge, `vault:reveal:${params.id}`);
    if (!consumed || consumed.user_id !== user.id) throw unauthorized("That check expired. Try again.");

    const credential = await credentials.findCredential(body.id);
    if (!credential || credential.user_id !== user.id) throw unauthorized("That passkey is not on this account.");

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      if (!config.isProduction) console.error("[vault] reveal refused:", err.message);
      throw unauthorized("That passkey check did not pass.");
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    // A reveal is also a genuine proof of presence, so the session's own stamp moves with it --
    // but note the reveal did NOT read that stamp to decide whether to proceed.
    await markSessionVerified(ctx.sessionToken, credential.credential_id);

    let revealed;
    try {
      revealed = await vault.reveal(user.id, params.id, {
        credentialId: credential.credential_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      throw vaultError(err);
    }
    if (!revealed) throw notFound("Vault entry not found");

    // vault_reveals is the real audit row (written inside vault.reveal's own transaction); this
    // second line is the app-wide activity feed, and carries no plaintext either.
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.revealed",
      entityId: revealed.id,
      detail: {
        kind: revealed.kind,
        label: revealed.label,
        site: revealed.site,
        credentialId: credential.credential_id,
      },
    });

    // Git #3276, the design's own words: "minted only at the end of a real WebAuthn reveal
    // ceremony" -- this IS that ceremony, the exact same one every in-app Reveal already runs.
    // No second assertion, no separate mint route: the extension's own popup (extensionReveal in
    // app.js) asks for this by sending `trustDevice: true` on the SAME request that just proved
    // Face ID, alongside the label it guessed for this browser and the days preference from the
    // extension's options page. Refused, not silently ignored, if `days` isn't one of the real
    // choices the options page offers -- see vault.normaliseTrustDays.
    let trust = null;
    if (body.trustDevice) {
      try {
        trust = await vault.mintTrustedDevice(user.id, body.deviceLabel, body.trustDays);
      } catch (err) {
        throw badRequest(err.message);
      }
      await audit.record({
        userId: user.id,
        actor: "owner",
        action: "vault.device_trust.minted",
        entityId: trust.id,
        detail: { label: trust.label },
      });
    }

    return sendJson(res, 200, { ...revealed, trust });
  });

  router.get("/api/vault/:id/reveals", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { reveals: await vault.revealHistory(user.id, params.id) });
  });

  // A real LastPass CSV import (Git #3247). Same raw-body pattern as /api/media above -- the
  // browser can read the chosen file into a string with one `File.text()` call and POST it
  // whole, no multipart parser needed on either side. Deliberately NOT the capture box and NOT
  // an MCP tool (see vault.mjs's own header, and vaultAddCard's in app.js): the raw text is
  // parsed by vault.importLoginsFromCsv and discarded at the end of this handler -- it is never
  // written to `media`, never to `captures`, and never logged.
  router.post("/api/vault/import", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const bytes = await readBody(req, config.maxUploadBytes);
    let outcome;
    try {
      outcome = await vault.importLoginsFromCsv(user.id, bytes.toString("utf8"));
    } catch (err) {
      throw err instanceof vault.VaultKeyUnavailable ? vaultError(err) : badRequest(err.message);
    }
    // Counts only, same discipline as vault.entry.created's audit line above -- an import touches
    // dozens of rows at once, and none of their labels, sites or usernames belong in a feed that
    // is otherwise a plainly readable table of "what happened", not "what the vault holds".
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.imported",
      detail: outcome.summary,
    });
    return sendJson(res, 200, outcome);
  });

  // -- Vault room -> Browser add-on card (Git #3272, migration 062) -----------------------
  //
  // Real trusted-browser rows for the room's own "Browser add-on" card. Minting one happens
  // inside POST /api/vault/:id/reveal above (Git #3276); this room only ever lists what already
  // exists and Forgets it.

  router.get("/api/vault/device-trust", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { devices: await vault.listTrustedDevices(user.id) });
  });

  router.delete("/api/vault/device-trust/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const forgotten = await vault.forgetDevice(user.id, params.id);
    if (!forgotten) throw notFound("Trusted browser not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "vault.device_trust.forgotten",
      entityId: params.id,
      detail: {},
    });
    return sendJson(res, 200, { ok: true });
  });

  // -- Vault Autofill add-on -> the one-click fill (Git #3276) -----------------------------
  //
  // The extension's OWN bearer-token auth plane, not the session cookie -- a trusted-browser
  // fill is deliberately the one real cross-origin call in this whole app: it comes straight
  // from the extension's privileged background context (chrome-extension://<id>, host-permitted
  // but genuinely foreign), never routed through the app's own origin the way the reveal popup
  // is. checkOrigin (server.mjs) exempts exactly this path for exactly that reason -- a foreign
  // Origin header here is the extension working as designed, not a CSRF attempt. Authenticated
  // instead by the trust token itself (same real bearer-token discipline as widget_tokens/
  // mcp_tokens: presenting it correctly-hashed IS the proof), and rate-limited same as a normal
  // reveal so a stolen/leaked token still can't be hammered.
  //
  // Refuses an always-ask entry outright (vault.fillWithTrust's own check) -- README: "Refuses
  // always-ask entries (they take the existing reveal path)". The extension is expected to have
  // already routed those to SL_REQUEST_REVEAL instead of ever calling this, but the real
  // enforcement lives here, not in the extension's own (client-side, spoofable) judgment.
  router.post("/api/vault/:id/fill", async (req, res, params, ctx) => {
    const body = await readJson(req);
    const trust = await vault.resolveTrustedDevice(body.token);
    if (!trust) throw unauthorized("This browser isn't trusted any more. Face ID once to renew.");

    const gate = ratelimit.hit(`vault:fill:${trust.userId}`, VAULT_REVEAL_LIMIT.limit, VAULT_REVEAL_LIMIT.windowMs);
    if (!gate.allowed) {
      throw tooMany("Too many fills in a row. Wait a bit.", { retryAfterMs: gate.retryAfterMs });
    }

    let revealed;
    try {
      revealed = await vault.fillWithTrust(trust.userId, params.id, {
        deviceTrustId: trust.id,
        site: body.site || null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      if (err instanceof vault.VaultKeyUnavailable) throw vaultError(err);
      // "This login always asks" (fillWithTrust's own message) is a real refusal the extension
      // has to fall back from, not a server bug -- 409 says "try the other path", not 400/500.
      throw new HttpError(409, err.message);
    }
    if (!revealed) throw notFound("Vault entry not found");

    await audit.record({
      userId: trust.userId,
      actor: "owner",
      actorLabel: trust.label,
      action: "vault.revealed",
      entityId: revealed.id,
      detail: { kind: revealed.kind, label: revealed.label, site: revealed.site, via: "extension-trusted" },
    });
    return sendJson(res, 200, revealed);
  });

  // -- Money -> Important documents (Git #3244) ------------------------------------------
  //
  // Wills, life insurance, and the like -- real documents/policies, distinct in content type
  // from the vault's own bill-payment references, but the same real security tier: AES-256-GCM
  // under the same SL_VAULT_KEY, a fresh passkey assertion per reveal, a real per-reveal audit
  // row (src/core/documents.mjs owns all of that). What lives here is the same thing the vault
  // routes above carve out for the same reason -- the real WebAuthn assertion cannot live in the
  // core module, only in a route that can actually see the request.

  const DOCUMENT_REVEAL_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };

  function documentError(err) {
    if (err instanceof documents.VaultKeyUnavailable) return new HttpError(503, err.message);
    return err;
  }

  router.get("/api/documents", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      documents: await documents.listDocuments(user.id),
      keyConfigured: documents.keyIsConfigured(),
      windowSeconds: documents.REVEAL_WINDOW_SECONDS,
    });
  });

  // Real search (item 2 of the issue's scope): "where's my will", "who's my life insurance
  // beneficiary" -- answered directly from the real doc_type/name/location columns, no reveal
  // required to find the right document. Registered ahead of the plain GET routes below so a
  // literal path segment never shadows it.
  router.get("/api/documents/search", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams.get("q");
    return sendJson(res, 200, { documents: q ? await documents.searchDocuments(user.id, q) : [] });
  });

  router.post("/api/documents", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.docType) throw badRequest("docType is required");
    if (!body.name) throw badRequest("name is required");
    if (!body.details) throw badRequest("details is required");
    let doc;
    try {
      doc = await documents.createDocument(user.id, body);
    } catch (err) {
      throw documentError(err);
    }
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "document.created",
      entityId: doc.id,
      detail: { docType: doc.docType, name: doc.name },
    });
    return sendJson(res, 201, doc);
  });

  router.patch("/api/documents/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    let doc;
    try {
      doc = await documents.updateDocument(user.id, params.id, body);
    } catch (err) {
      throw documentError(err);
    }
    if (!doc) throw notFound("Document not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "document.updated",
      entityId: doc.id,
      detail: { docType: doc.docType, name: doc.name, detailsChanged: Boolean(body.details) },
    });
    return sendJson(res, 200, doc);
  });

  router.delete("/api/documents/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const removed = await documents.deleteDocument(user.id, params.id);
    if (!removed) throw notFound("Document not found");
    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "document.deleted",
      entityId: params.id,
      detail: {},
    });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/documents/:id/reveal/options", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const owned = (await documents.listDocuments(user.id)).some((d) => d.id === params.id);
    if (!owned) throw notFound("Document not found");

    const credentialList = await credentials.listCredentials(user.id);
    if (credentialList.length === 0) {
      throw forbidden("No passkey is enrolled, and a reveal requires one every time.");
    }
    return sendJson(res, 200, {
      challenge: await webauthn.issueChallenge(`documents:reveal:${params.id}`, user.id),
      rpId: webauthn.relyingPartyId(),
      timeout: webauthn.CHALLENGE_TTL_SECONDS * 1000,
      userVerification: "required",
      allowCredentials: credentialList.map((c) => ({
        type: "public-key",
        id: c.credential_id,
        transports: c.transports,
      })),
    });
  });

  router.post("/api/documents/:id/reveal", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const gate = ratelimit.hit(`documents:reveal:${user.id}`, DOCUMENT_REVEAL_LIMIT.limit, DOCUMENT_REVEAL_LIMIT.windowMs);
    if (!gate.allowed) {
      throw tooMany("Too many reveals in a row. Wait a bit.", { retryAfterMs: gate.retryAfterMs });
    }

    const body = await readJson(req);
    const consumed = await webauthn.consumeChallenge(body.challenge, `documents:reveal:${params.id}`);
    if (!consumed || consumed.user_id !== user.id) throw unauthorized("That check expired. Try again.");

    const credential = await credentials.findCredential(body.id);
    if (!credential || credential.user_id !== user.id) throw unauthorized("That passkey is not on this account.");

    let verified;
    try {
      verified = webauthn.verifyAssertion({
        expectedChallenge: consumed.challenge,
        response: body.response,
        credential,
      });
    } catch (err) {
      if (!config.isProduction) console.error("[documents] reveal refused:", err.message);
      throw unauthorized("That passkey check did not pass.");
    }

    await credentials.touchCredential(credential.credential_id, verified.signCount, verified.backedUp);
    await markSessionVerified(ctx.sessionToken, credential.credential_id);

    let revealed;
    try {
      revealed = await documents.reveal(user.id, params.id, {
        credentialId: credential.credential_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (err) {
      throw documentError(err);
    }
    if (!revealed) throw notFound("Document not found");

    await audit.record({
      userId: user.id,
      actor: "owner",
      action: "document.revealed",
      entityId: revealed.id,
      detail: { docType: revealed.docType, name: revealed.name, credentialId: credential.credential_id },
    });
    return sendJson(res, 200, revealed);
  });

  router.get("/api/documents/:id/reveals", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { reveals: await documents.revealHistory(user.id, params.id) });
  });

  // -- Money -> the smoking tracker (Git #3154) -------------------------------------------
  //
  // Real, deliberate exception to the no-guilt principle (Section 8), confirmed by Shane
  // directly: the financial-confrontation line in GET /api/money/gate's own `smoking`
  // field is the real mechanism (see money.getSmokeSummary), not a streak -- there is nothing
  // to reset here, only a real log to append to.

  router.post("/api/money/smoke", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await money.logSmoke(user.id, { packs: body.packs });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "money.smoke.logged",
      entityId: row.id,
      detail: { packs: row.packs, amount: row.amount },
    });
    return sendJson(res, 200, row);
  });

  router.get("/api/money/smoke", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const status = await money.getGateStatus(user.id);
    return sendJson(res, 200, status.smoking);
  });

  // -- Money -> Catches (Git #3153) -----------------------------------------------------
  //
  // Section 4's real expense-cutting mechanisms -- see src/core/catches.mjs for what each of
  // the five real detectors looks for. GET runs the detectors fresh every time (they are plain
  // upserts against real, already-synced data, cheap enough for a screen open) so the Catches
  // card is never stale just because the 6-hour server sweep (server.mjs) hasn't run yet.

  router.get("/api/money/catches", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    await catches.runDetectors(user.id);
    return sendJson(res, 200, { catches: await catches.listCatches(user.id) });
  });

  router.post("/api/money/catches/:id/dismiss", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await catches.dismissCatch(user.id, params.id);
    await audit.record({ userId: user.id, actor: "owner", action: "catch.dismiss", entityId: row.id, detail: { kind: row.kind } });
    return sendJson(res, 200, row);
  });

  // -- Money -> Cars (Git #3149) --------------------------------------------------------
  //
  // Real per-vehicle cards: identity + the linked real loan bill account (read through
  // src/core/vehicles.mjs, never duplicated) + insurance/registration/maintenance, aggregated
  // into a real all-in $/mo and $/yr. See vehicles.mjs's own header for exactly what each
  // component means and why. Reminders reuse Dates' own lead-time vocabulary rather than a
  // second copy of it.

  router.get("/api/cars", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { vehicles: await vehicles.listVehicles(user.id) });
  });

  router.post("/api/cars", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.createVehicle(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.get("/api/cars/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, await vehicles.getVehicle(user.id, params.id));
  });

  router.patch("/api/cars/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.updateVehicle(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/cars/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await vehicles.deleteVehicle(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/cars/:id/maintenance", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.logMaintenance(user.id, params.id, body);
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "vehicle.maintenance.log",
      entityId: params.id,
      detail: { description: body.description, amount: body.amount },
    });
    return sendJson(res, 201, row);
  });

  // Real Undo (Git #3213, design 1f) for the entry just logged above -- the five-second Undo
  // toast on the Cars card calls this, not a generic edit form.
  router.delete("/api/cars/:id/maintenance/:entryId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await vehicles.deleteMaintenanceEntry(user.id, params.id, params.entryId);
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.maintenance.undo", entityId: params.id, detail: { entryId: params.entryId } });
    return sendJson(res, 200, row);
  });

  // Real Tesla<->Cars link (Git #3217) -- marks which one real Money vehicle is the connected
  // Tesla, so the odometer/charging sync below knows where to write. See
  // vehicles.setTeslaSynced's own header for the at-most-one-vehicle invariant it enforces.
  router.patch("/api/cars/:id/tesla-sync", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await vehicles.setTeslaSynced(user.id, params.id, Boolean(body.enabled));
    await audit.record({ userId: user.id, actor: "web", action: "vehicle.tesla-sync", entityId: params.id, detail: { enabled: Boolean(body.enabled) } });
    return sendJson(res, 200, row);
  });

  // Real, on-demand "sync now" for both odometer and charging sessions (Git #3217) -- the
  // Settings -> Tesla "check now" pattern already established for climate/charge state, applied
  // to the two new real reads. Each half is tried and reported independently: a real charging-
  // history hiccup must never hide a real, successful odometer sync, and vice versa.
  router.post("/api/tesla/sync", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const [odometer, charging] = await Promise.all([
      vehicles.syncOdometerFromTesla(user.id),
      vehicles.syncChargingSessionsFromTesla(user.id),
    ]);
    await audit.record({ userId: user.id, actor: "web", action: "tesla.sync", detail: { odometer, charging } });
    return sendJson(res, 200, { odometer, charging });
  });

  // Real, synced charging sessions (Git #3217) -- energy/timestamp/location are real Tesla data;
  // costEstimate is always Shane's own rate x real kWh, see tesla.mjs's getChargingHistory and
  // migration 060's own header for why a real Tesla-sourced cost is never available here.
  router.get("/api/tesla/charging-sessions", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { sessions: await vehicles.listChargingSessions(user.id) });
  });

  // Git #3318: the Tesla room's own "Charging" card closing odometer row -- see
  // vehicles.getSyncedOdometer's own header for why this is independent of Cars' mileageStatus.
  router.get("/api/tesla/odometer", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { odometer: await vehicles.getSyncedOdometer(user.id) });
  });

  // -- Wins (Git #3151) -----------------------------------------------------
  //
  // Manual "I did it" capture straight from the Wins tab (source: 'shane') -- distinct from the
  // universal capture box's classify-later pipeline, because Wins is a fixed real category, not
  // one Claude needs to pick. Automatic wins (a real debt hitting $0, a critical debt resolved, a
  // deferred bill caught up) are detected server-side (see src/core/wins.mjs detectMoneyWins,
  // wired into server.mjs housekeeping) and read back through the same GET.

  router.get("/api/money/wins", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { wins: await wins.listWins(user.id) });
  });

  router.post("/api/money/wins", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await wins.createWin(user.id, { text: body.text, happenedOn: body.happenedOn ?? null, source: "shane" });
    await audit.record({ userId: user.id, actor: "web", action: "win.create", entityId: row.id, detail: { text: row.text } });
    return sendJson(res, 200, row);
  });

  // -- Dates (Git #3136) ----------------------------------------------------------------

  router.get("/api/dates", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      dates: await dates.listDates(user.id, {
        includeDone: q.get("includeDone") === "true",
        horizonDays: q.get("horizonDays") ? Number(q.get("horizonDays")) : undefined,
      }),
    });
  });

  router.post("/api/dates", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.createDate({
      userId: user.id,
      kind: body.kind,
      title: body.title,
      atDate: body.atDate,
      atTime: body.atTime ?? null,
      intervalDays: body.intervalDays ?? null,
      leadDays: body.leadDays ?? undefined,
      provider: body.provider ?? null,
      subjectType: body.subjectType || "self",
      subjectId: body.subjectId ?? null,
      category: body.category ?? null,
      categoryMeta: body.categoryMeta || {},
      source: "web",
      notes: body.notes ?? null,
    });
    await audit.record({ userId: user.id, actor: "web", action: "date.create", entityId: row.id, detail: { kind: row.kind } });
    return sendJson(res, 201, row);
  });

  router.get("/api/dates/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await dates.getDate(user.id, params.id);
    if (!row) throw notFound("Date not found");
    return sendJson(res, 200, row);
  });

  router.patch("/api/dates/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.updateDate(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "date.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/dates/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await dates.deleteDate(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "date.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  // "next time at dr fonji ask about ..."
  router.post("/api/dates/:id/asks", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addAsk(user.id, params.id, body.text);
    await audit.record({ userId: user.id, actor: "web", action: "date.ask.add", entityId: params.id });
    return sendJson(res, 201, row);
  });

  // Tapping "Asked" on the date-detail screen -- clears back to unasked with { asked: false }.
  router.patch("/api/dates/:id/asks/:askId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.setAskAsked(user.id, params.id, params.askId, body.asked !== false);
    return sendJson(res, 200, row);
  });

  // "Notes and photos, by visit."
  router.post("/api/dates/:id/visits", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addVisit(user.id, params.id, {
      visitedOn: body.visitedOn ?? null,
      notes: body.notes ?? null,
      photos: body.photos || [],
    });
    await audit.record({ userId: user.id, actor: "web", action: "date.visit.add", entityId: params.id });
    return sendJson(res, 201, row);
  });

  router.post("/api/dates/:id/visits/:visitId/photos", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await dates.addVisitPhoto(user.id, params.id, params.visitId, {
      mediaId: body.mediaId ?? null,
      url: body.url ?? null,
      label: body.label ?? null,
    });
    return sendJson(res, 201, row);
  });

  // -- pets (Git #3141) -------------------------------------------------------------------
  // Vet visits stay on /api/dates (subjectType: 'pet'); this is real per-pet identity, vaccine
  // tracking, feeding/meds care items (merged into /api/medications), and photo records.

  router.get("/api/pets", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { pets: await pets.listPets(user.id) });
  });

  router.post("/api/pets", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createPet(user.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.create", entityId: row.id, detail: { name: row.name } });
    return sendJson(res, 201, row);
  });

  router.get("/api/pets/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    const row = await pets.getPet(user.id, params.id);
    if (!row) throw notFound("Pet not found");
    return sendJson(res, 200, row);
  });

  router.patch("/api/pets/:id", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updatePet(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.update", entityId: params.id, detail: { fields: Object.keys(body) } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deletePet(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "pet.delete", entityId: params.id });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/vaccines", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createVaccine(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.create", entityId: row.id, detail: { petId: params.id, name: row.name } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/pets/:id/vaccines/:vaccineId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updateVaccine(user.id, params.id, params.vaccineId, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.update", entityId: params.vaccineId });
    return sendJson(res, 200, row);
  });

  router.post("/api/pets/:id/vaccines/:vaccineId/given", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req).catch(() => ({}));
    const row = await pets.markVaccineGiven(user.id, params.id, params.vaccineId, { givenOn: body.givenOn ?? undefined });
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.given", entityId: params.vaccineId, detail: { dueOn: row.due_on } });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id/vaccines/:vaccineId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteVaccine(user.id, params.id, params.vaccineId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.vaccine.delete", entityId: params.vaccineId });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/care", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.createCare(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.create", entityId: row.id, detail: { petId: params.id, batch: row.batch } });
    return sendJson(res, 201, row);
  });

  router.patch("/api/pets/:id/care/:careId", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.updateCare(user.id, params.id, params.careId, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.update", entityId: params.careId });
    return sendJson(res, 200, row);
  });

  router.delete("/api/pets/:id/care/:careId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteCare(user.id, params.id, params.careId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.care.delete", entityId: params.careId });
    return sendJson(res, 200, { ok: true });
  });

  router.post("/api/pets/:id/records", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const row = await pets.addRecord(user.id, params.id, body);
    await audit.record({ userId: user.id, actor: "web", action: "pet.record.add", entityId: row.id, detail: { petId: params.id } });
    return sendJson(res, 201, row);
  });

  router.delete("/api/pets/:id/records/:recordId", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await pets.deleteRecord(user.id, params.id, params.recordId);
    await audit.record({ userId: user.id, actor: "web", action: "pet.record.delete", entityId: params.recordId });
    return sendJson(res, 200, { ok: true });
  });

  // Read-only surface for the real, live-refreshed OPM federal holiday list.
  router.get("/api/federal-holidays", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    const q = ctx.url.searchParams;
    return sendJson(res, 200, {
      holidays: await federalHolidays.listFederalHolidays({ fromYear: q.get("fromYear") ? Number(q.get("fromYear")) : undefined }),
    });
  });

  // Manual trigger for the real OPM refresh -- the monthly housekeeping sweep in server.mjs
  // calls the same core function; this exists so a stale list never has to wait for a redeploy.
  router.post("/api/federal-holidays/refresh", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const result = await federalHolidays.refreshFederalHolidays();
    await audit.record({ userId: user.id, actor: "web", action: "federal_holidays.refresh", detail: result });
    return sendJson(res, 200, result);
  });

  // -- today / categories / activity --------------------------------------

  router.get("/api/today", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    // #3127's real moment-based meal nudges + "Tonight" teaser -- read off whatever Claude
    // pushed via push_meal_plan for today/tomorrow, never a calendar to browse.
    const { nudges: mealNudges, tonight } = await mealPlan.getTodayNudges(user.id);

    // Today tray Round 2 (Git #3144) -- the real "one card, chosen by rule" Next resolution and
    // the fox's contextual line both need to know: is there a real appointment/vet visit today,
    // and are there real open items on the running grocery list. Both are real, already-built
    // data (dates.mjs's own due_in_days, lists.mjs's own shopping list) -- no new tables.
    const allDates = await dates.listDates(user.id);
    const appointmentToday = allDates.find(
      (d) => (d.kind === "appointment" || d.kind === "vet") && d.due_in_days === 0,
    ) || null;
    const shoppingList = await lists.getOrCreateShoppingList(user.id);
    const shoppingDetail = await lists.getListDetail(user.id, shoppingList.id);
    const groceries = {
      listId: shoppingList.id,
      openCount: shoppingDetail.items.filter((i) => !i.done).length,
    };

    const pendingCaptures = await captures.pendingCount(user.id);
    const medsToday = await medications.getMedsToday(user.id);
    // Git #3216: same real precedence rule computeNextCard (widget.mjs) already applies -- a
    // real appointment today still wins, so this is only ever computed when it doesn't.
    const headingHome = appointmentToday ? null : await headingHomeAvailability(user.id);
    // Git #3273 ("Money nav restructure"): "while any bank needs a reconnect the attic vent's
    // amber arc goes solid" -- the same real `plaid_items.health_status` read Settings ->
    // Connected shows (renderBankSettings in public/app.js), reduced to a count so the house
    // grid can light a real signal without Today needing to know Plaid's own shape.
    const banksNeedReconnect = (await plaid.listItems()).filter((i) => i.needsReconnect).length;

    return sendJson(res, 200, {
      // "Today view shows only what's next" (contract pack Section 3) -- three, not a backlog.
      next: await entities.nextUp(user.id, 3),
      pendingCaptures,
      recent: await entities.listEntities(user.id, { limit: 8 }),
      mealNudges,
      tonight,
      appointmentToday: appointmentToday && {
        id: appointmentToday.id,
        kind: appointmentToday.kind,
        title: appointmentToday.title,
        provider: appointmentToday.provider,
        atTime: appointmentToday.at_time,
        categoryLabel: appointmentToday.category_label,
      },
      groceries,
      headingHome,
      meds: medsToday,
      // Standalone timers (Git #3307) -- Today tray's "see/cancel an active timer" real scope
      // item; server-side rows so this list is honest across a reload/redeploy, not client state.
      timers: await timers.listActive(user.id),
      rooms: await roomsForToday(user.id, { allDates, tonight, groceries, runItems: shoppingDetail.items, meds: medsToday, pendingCaptures }),
      roomOrder: await roomOrder.getRoomOrder(user.id),
      later: await computeLaterMoments(user.id, { allDates, tonight, pendingCaptures }),
      banksNeedReconnect,
    });
  });

  /**
   * Git #3320: the real command tray's own aggregate read -- everything its Quick grid needs to
   * render live-state-aware chip labels, in one call, rather than the tray reaching into
   * `/api/today`'s much larger payload (loaded once at app boot, not necessarily fresh) or
   * fetching Tesla/meds separately every time the capture box is focused. Deliberately narrow:
   * a real, cached (`teslaCore.connectionStatus`'s own `lastRead`) climate/outside-temp read, not
   * a live Fleet API call on every focus -- same "never wake the car just to paint a label"
   * discipline `getTodaysBatteryShortfall`'s own header comment already states.
   */
  router.get("/api/capture-tray", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const [headingTo, teslaStatus, medsToday] = await Promise.all([
      locationState.getHeadingTo(user.id, { staleAfterMs: 12 * 60 * 60 * 1000 }),
      teslaCore.connectionStatus(user.id),
      medications.getMedsToday(user.id),
    ]);

    // Same real "took my <batch> meds" phrasing meds_batch_taken (capture-grammar.mjs) already
    // matches unambiguously by naming the batch -- never the ambiguous bare "took my meds" this
    // rule only resolves when exactly one batch is untaken (see its own match() comment).
    const untaken = medsToday.batches.filter((b) => !b.takenToday);
    const meds =
      untaken.length === 0
        ? { label: "Meds all taken", phrase: "took my meds" }
        : {
            label: `${untaken[0].batch[0].toUpperCase()}${untaken[0].batch.slice(1)} meds`,
            phrase: `took my ${untaken[0].batch} meds`,
          };

    return sendJson(res, 200, {
      headingTo,
      tesla: {
        connected: teslaStatus.connected,
        vehicleDisplayName: teslaStatus.vehicleDisplayName || null,
        climateOn: teslaStatus.lastRead ? Boolean(teslaStatus.lastRead.isClimateOn) : false,
        outsideTempC: teslaStatus.lastRead ? teslaStatus.lastRead.outsideTempC : null,
      },
      meds,
    });
  });

  /** Git #3216: the main app's own real "Heading home?" tap action (the widget's version is the
   *  idempotent-GET pattern in routes/widget.mjs) -- session-gated POST, `house` optional
   *  override for the one-tap "not this one" alternative. */
  router.post("/api/tesla/heading-home", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    let result;
    try {
      result = await triggerHeadingHome(user.id, { house: body.house || null });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof TeslaError) throw badRequest(err.message);
      throw err;
    }
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "tesla.heading-home",
      detail: { house: result.targetHouse, navigation: result.navigation, climate: result.climate },
    });
    return sendJson(res, 200, result);
  });

  router.get("/api/categories", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    return sendJson(res, 200, { categories: await categories.listCategories() });
  });

  router.get("/api/activity", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { activity: await audit.recent(user.id, ctx.url.searchParams.get("limit")) });
  });

  // -- share links --------------------------------------------------------

  router.get("/api/shares", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      shares: await shares.listShareLinks(user.id, {
        entityId: ctx.url.searchParams.get("entityId"),
        listId: ctx.url.searchParams.get("listId"),
      }),
    });
  });

  router.post("/api/shares", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.entityId && !body.listId) throw badRequest("entityId or listId is required");
    const share = await shares.createShareLink({
      userId: user.id,
      entityId: body.entityId ?? null,
      listId: body.listId ?? null,
      label: body.label ?? null,
      canCheck: body.canCheck !== false,
      canAdd: Boolean(body.canAdd),
      expiresInDays: body.expiresInDays ?? null,
    });
    await audit.record({
      userId: user.id,
      actor: "web",
      action: "share.create",
      entityId: body.entityId ?? body.listId ?? null,
      detail: { shareId: share.id, kind: body.listId ? "list" : "entity" },
    });
    return sendJson(res, 201, share);
  });

  router.delete("/api/shares/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await shares.revokeShareLink(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "share.revoke", detail: { shareId: params.id } });
    return sendJson(res, 200, { ok: true });
  });

  // -- MCP tokens ---------------------------------------------------------

  router.get("/api/mcp-tokens", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      tokens: await mcpTokens.listMcpTokens(user.id),
      endpoint: `${config.publicOrigin}/mcp`,
    });
  });

  router.post("/api/mcp-tokens", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.label || !String(body.label).trim()) {
      throw badRequest("label is required -- name the connection so it can be revoked later.");
    }
    const issued = await mcpTokens.issueMcpToken(user.id, body.label);
    await audit.record({ userId: user.id, actor: "web", action: "mcp_token.issue", detail: { tokenId: issued.id, label: issued.label } });
    // The raw token appears here and nowhere else, ever.
    return sendJson(res, 201, {
      ...issued,
      endpoint: `${config.publicOrigin}/mcp`,
      urlForm: `${config.publicOrigin}/mcp/t/${issued.token}`,
    });
  });

  router.delete("/api/mcp-tokens/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await mcpTokens.revokeMcpToken(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "mcp_token.revoke", detail: { tokenId: params.id } });
    return sendJson(res, 200, { ok: true });
  });

  // -- widget tokens (Git #3188) -------------------------------------------

  router.get("/api/widget-tokens", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, { tokens: await widgetTokens.listWidgetTokens(user.id) });
  });

  router.post("/api/widget-tokens", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.label || !String(body.label).trim()) {
      throw badRequest("label is required -- name the widget so it can be revoked later.");
    }
    const issued = await widgetTokens.issueWidgetToken(user.id, body.label);
    await audit.record({ userId: user.id, actor: "web", action: "widget_token.issue", detail: { tokenId: issued.id, label: issued.label } });
    // The raw token appears here and nowhere else, ever.
    return sendJson(res, 201, {
      ...issued,
      urlForm: `${config.publicOrigin}/widget/t/${issued.token}`,
    });
  });

  router.delete("/api/widget-tokens/:id", async (_req, res, params, ctx) => {
    const user = requireUser(ctx);
    await widgetTokens.revokeWidgetToken(user.id, params.id);
    await audit.record({ userId: user.id, actor: "web", action: "widget_token.revoke", detail: { tokenId: params.id } });
    return sendJson(res, 200, { ok: true });
  });

  // "Preview the widget page ->" (Git #3214) -- the exact same real HTML /widget/t/:token
  // renders, but reached through the normal signed-in session instead of a widget token, so
  // Settings can offer a real "see what the widget shows right now" link without minting or
  // spending a token call on it.
  router.get("/api/widget-preview", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const data = await computeNextCard(user.id);
    return sendText(res, 200, renderWidgetPage({ data, justDone: false }), "text/html; charset=utf-8");
  });

  // -- push subscriptions + real act-on-notification (Git #3160) ---------

  router.get("/api/push/vapid-public-key", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    const publicKey = pushSubscriptions.isConfigured() ? webpush.vapidPublicKey() : null;
    return sendJson(res, 200, { publicKey });
  });

  router.post("/api/push/subscribe", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.endpoint) throw badRequest("endpoint is required");
    const row = await pushSubscriptions.saveSubscription(user.id, {
      endpoint: body.endpoint,
      keys: body.keys || {},
      userAgent: req.headers["user-agent"] || null,
    });
    await audit.record({ userId: user.id, actor: "web", action: "push.subscribe", detail: { subscriptionId: row.id } });
    return sendJson(res, 201, { ok: true, id: row.id });
  });

  router.post("/api/push/unsubscribe", async (req, res, _params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    if (!body.endpoint) throw badRequest("endpoint is required");
    await pushSubscriptions.removeSubscription(user.id, body.endpoint);
    await audit.record({ userId: user.id, actor: "web", action: "push.unsubscribe", detail: {} });
    return sendJson(res, 200, { ok: true });
  });

  router.get("/api/nudges", async (_req, res, _params, ctx) => {
    const user = requireUser(ctx);
    return sendJson(res, 200, {
      cap: await nudges.todayCapStatus(user.id),
      nudges: await nudges.listToday(user.id),
    });
  });

  /**
   * The real act-on-notification endpoint (Section 10's "mark done, snooze, dismiss").
   *
   * This is what BOTH paths call: a service worker's background fetch on a slide-down action
   * button (no app open -- the real zero-tap case) and the in-app fallback UI, if the tray ever
   * surfaces a nudge with its own action buttons. Same effect either way -- there is exactly one
   * real place a nudge action happens.
   */
  router.post("/api/nudges/:id/action", async (req, res, params, ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(req);
    const action = body.action;
    if (!["done", "snooze", "dismiss"].includes(action)) {
      throw badRequest('action must be one of "done", "snooze", "dismiss"');
    }
    const event = await nudges.getNudgeEvent(user.id, params.id);
    if (!event) throw notFound("Nudge not found");

    // "Done" performs the real underlying effect the nudge was actually about -- marking a
    // notification done with nothing behind it would be exactly the fabricated-completion-state
    // failure this app's own design rules out elsewhere.
    if (action === "done") {
      if (event.kind === "appointment" && event.payload?.dateId) {
        await dates.updateDate(user.id, event.payload.dateId, { done: true });
      } else if (event.kind === "vaccine" && event.payload?.petId && event.payload?.vaccineId) {
        await pets.markVaccineGiven(user.id, event.payload.petId, event.payload.vaccineId, {});
      }
    }

    const updated = await nudges.setNudgeAction(user.id, params.id, action);
    await audit.record({ userId: user.id, actor: "web", action: `nudge.${action}`, detail: { nudgeId: params.id, kind: event.kind } });
    return sendJson(res, 200, updated);
  });

  // Guard against a route ever being added that expects a signed-in user but forgets to say so.
  router.get("/api/_routes", async (_req, res, _params, ctx) => {
    requireUser(ctx);
    if (config.isProduction) throw forbidden("Not available in production");
    return sendJson(res, 200, { routes: router.routes.map((r) => `${r.method} ${r.pattern}`) });
  });

  return router;
}
