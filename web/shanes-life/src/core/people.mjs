// People & Patterns -- a private per-person reflection journal (Git #3157, design contract
// Section 7, migration 034).
//
// Real, explicit boundary the contract states directly and this module exists to honour: NOT a
// companion or chatbot persona. A private journal capturing Shane's own words about people in
// his life, threaded under the right person through the same one-box capture used everywhere
// else. The "threaded automatically based on who's mentioned" behavior is a Claude-conversation
// classification step (Section 10 -- the hosted app does no inference of its own): Claude reads a
// pending capture, recognises who it's about, and calls the log_person_note MCP tool with that
// person's name. This module just needs a stable, forgiving way to resolve a name to the same
// real person every time -- see resolvePerson's upsert-by-lower(name), same pattern
// things.recordThing and contacts already use for their own name-keyed rows.
//
// computePatterns() below is the "patterns panel" the design draws (Shanes Life 11 - People.dc.html):
// deliberately dumb word counts and timing over Shane's own words, quoted back verbatim. Plain,
// deterministic code -- no model call, no invented interpretation, no opinion about the person.

import { many, one, query, transaction } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

const KINDS = new Set(["text", "voice", "photo"]);
const SOURCES = new Set(["shane", "claude"]);

function normaliseName(name) {
  const n = String(name || "").trim().slice(0, 200);
  if (!n) throw badRequest("name is required");
  return n;
}

function normaliseRelationship(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().slice(0, 200);
  return v || null;
}

function normaliseBodyText(text) {
  const t = String(text ?? "").trim();
  if (!t) throw badRequest("bodyText is required");
  if (t.length > 5000) throw badRequest("Note is too long (5000 char limit)");
  return t;
}

function normaliseKind(kind) {
  const k = kind || "text";
  if (!KINDS.has(k)) throw badRequest(`kind must be one of: ${[...KINDS].join(", ")}`);
  return k;
}

function normaliseHappenedAt(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest("happenedAt must be a real date/time");
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** Find-or-create by (user, lower(name)) -- a later note about "Dana" threads onto the same
 *  real person, it never silently creates a second "Dana" next to her. An explicitly-passed
 *  relationship only ever fills a currently-empty one; it never overwrites what's already there,
 *  since most calls into this (every MCP-threaded note) don't carry one at all. */
export async function resolvePerson(userId, { personId = null, personName = null, relationship = null } = {}) {
  if (personId) {
    const existing = await one(
      "SELECT * FROM people WHERE id = $1 AND user_id = $2 AND archived_at IS NULL",
      [personId, userId],
    );
    if (!existing) throw notFound("Person not found");
    return existing;
  }
  const name = normaliseName(personName);
  const rel = normaliseRelationship(relationship);
  return one(
    `INSERT INTO people (user_id, name, relationship)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, lower(name))
     DO UPDATE SET relationship = COALESCE(people.relationship, EXCLUDED.relationship), updated_at = now()
     RETURNING *`,
    [userId, name, rel],
  );
}

/** Explicit "+ Person" add from the room, or Claude naming someone for the first time. */
export async function createPerson(userId, { name, relationship } = {}) {
  return resolvePerson(userId, { personName: name, relationship });
}

export async function updatePerson(userId, personId, { relationship } = {}) {
  const row = await one(
    `UPDATE people SET relationship = $3, updated_at = now()
      WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
      RETURNING *`,
    [personId, userId, normaliseRelationship(relationship)],
  );
  if (!row) throw notFound("Person not found");
  return row;
}

/** Sidebar list -- most recently written-about first, matching the design's own ordering. */
export async function listPeople(userId) {
  return many(
    `SELECT p.id, p.name, p.relationship, p.created_at,
            (SELECT count(*)::int FROM person_entries e WHERE e.person_id = p.id) AS note_count,
            (SELECT max(happened_at) FROM person_entries e WHERE e.person_id = p.id) AS last_entry_at
       FROM people p
      WHERE p.user_id = $1 AND p.archived_at IS NULL
      ORDER BY last_entry_at DESC NULLS LAST, p.created_at DESC`,
    [userId],
  );
}

export async function getPerson(userId, personId) {
  return one(
    `SELECT p.*,
            (SELECT count(*)::int FROM person_entries e WHERE e.person_id = p.id) AS note_count,
            (SELECT min(happened_at) FROM person_entries e WHERE e.person_id = p.id) AS first_entry_at,
            (SELECT max(happened_at) FROM person_entries e WHERE e.person_id = p.id) AS last_entry_at
       FROM people p
      WHERE p.id = $1 AND p.user_id = $2 AND p.archived_at IS NULL`,
    [personId, userId],
  );
}

export async function findPersonByName(userId, name) {
  const n = String(name || "").trim();
  if (!n) throw badRequest("name is required");
  return one(
    "SELECT * FROM people WHERE user_id = $1 AND lower(name) = lower($2) AND archived_at IS NULL",
    [userId, n],
  );
}

// ---------------------------------------------------------------------------
// Entries -- one real note in Shane's own words
// ---------------------------------------------------------------------------

/**
 * Record one real note. Resolves (or creates) the person first, so this is the single entry
 * point for both the room's own capture bar ("Note about Dana") and the MCP-threaded path from
 * a classified one-box capture. `captureId`, when passed, marks that capture classified without
 * pointing captures.entity_id at this row -- that column's real FK targets entities(id), and a
 * person entry is deliberately its own typed table, not an entity (per #3116's own recorded
 * decision that rooms use their own typed tables).
 */
export async function addPersonEntry(
  userId,
  { personId = null, personName = null, relationship = null, bodyText, kind = "text", happenedAt = null, captureId = null, source = "shane" } = {},
) {
  const text = normaliseBodyText(bodyText);
  const kind_ = normaliseKind(kind);
  const happenedAt_ = normaliseHappenedAt(happenedAt);
  if (!SOURCES.has(source)) throw badRequest(`source must be one of: ${[...SOURCES].join(", ")}`);
  if (!personId && !personName) throw badRequest("personId or personName is required");

  const person = await resolvePerson(userId, { personId, personName, relationship });

  if (captureId) {
    const cap = await one("SELECT id FROM captures WHERE id = $1 AND user_id = $2", [captureId, userId]);
    if (!cap) throw notFound("Capture not found");
  }

  const entry = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO person_entries (user_id, person_id, body_text, kind, source, capture_id, happened_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
       RETURNING id, person_id, body_text, kind, source, capture_id, happened_at, created_at`,
      [userId, person.id, text, kind_, source, captureId, happenedAt_],
    );
    if (captureId) {
      await client.query(
        `UPDATE captures SET status = 'classified', classified_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
        [captureId, userId],
      );
    }
    return rows[0];
  });

  return { person, entry };
}

export async function listPersonEntries(userId, personId, { limit = 200 } = {}) {
  const owned = await one("SELECT id FROM people WHERE id = $1 AND user_id = $2", [personId, userId]);
  if (!owned) throw notFound("Person not found");
  return many(
    `SELECT id, person_id, body_text, kind, source, capture_id, happened_at, created_at
       FROM person_entries
      WHERE person_id = $1
      ORDER BY happened_at DESC, created_at DESC
      LIMIT $2`,
    [personId, Math.min(Number(limit) || 200, 500)],
  );
}

/** A note filed by mistake, or against the wrong person -- real hygiene, same as any other
 *  room's delete. Nothing else here ever mutates a note's own text: it is a journal entry, not
 *  an editable field. */
export async function deletePersonEntry(userId, entryId) {
  const { rowCount } = await query("DELETE FROM person_entries WHERE id = $1 AND user_id = $2", [
    entryId,
    userId,
  ]);
  if (rowCount === 0) throw notFound("Note not found");
}

// ---------------------------------------------------------------------------
// Search -- the real "search/ask interface for pattern recall" (Section 7)
// ---------------------------------------------------------------------------

/**
 * Real, deterministic search (no AI call, per contract Section 10) -- typing a person's name
 * jumps straight to their thread ("how have things with Dana been"); typing a word or phrase
 * surfaces every real note that used it, across every person. Both real answers, never a
 * generated summary.
 */
export async function search(userId, q) {
  const query_ = String(q || "").trim();
  if (!query_) return { people: [], entries: [] };
  const people_ = await many(
    `SELECT id, name, relationship
       FROM people
      WHERE user_id = $1 AND archived_at IS NULL AND lower(name) LIKE '%' || lower($2) || '%'
      ORDER BY name`,
    [userId, query_],
  );
  const entries_ = await many(
    `SELECT pe.id, pe.person_id, p.name AS person_name, pe.body_text, pe.kind, pe.happened_at
       FROM person_entries pe
       JOIN people p ON p.id = pe.person_id
      WHERE pe.user_id = $1 AND pe.body_text ILIKE '%' || $2 || '%'
      ORDER BY pe.happened_at DESC
      LIMIT 50`,
    [userId, query_],
  );
  return { people: people_, entries: entries_ };
}

// ---------------------------------------------------------------------------
// Patterns -- deliberately dumb: word counts and timing, quoted back verbatim (Section 7/8)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "about", "after", "again", "also", "always", "because", "been", "before", "being", "could",
  "didn't", "does", "doesn't", "down", "even", "every", "from", "have", "hasn't", "haven't",
  "he's", "her", "here", "hers", "him", "his", "into", "isn't", "it's", "just", "know", "like",
  "more", "most", "much", "never", "not", "our", "over", "really", "said", "says", "she's",
  "should", "since", "some", "still", "than", "that", "that's", "their", "them", "then", "there",
  "these", "they", "they're", "this", "those", "time", "very", "wasn't", "were", "weren't",
  "what", "when", "where", "which", "while", "who", "whom", "will", "with", "won't", "would",
  "wouldn't", "your", "you're", "you've",
]);

function tokenizeWords(text) {
  return (String(text || "").toLowerCase().match(/[a-z']+/g) || []).filter(
    (w) => w.length >= 4 && !STOPWORDS.has(w),
  );
}

/** Runs of Capitalized Words, skipping the start of every sentence (the very first word, and
 *  any word right after a `. ! ?`) -- reduces the false positives ordinary sentence-initial
 *  capitalization would otherwise all count as "topics", and stops two adjacent sentence-initial
 *  capitals (e.g. "Rental. She ...") from being merged into one bogus phrase. Catches real
 *  recurring proper nouns like "The Rental" or "Dr. Fonji". */
function extractCapitalizedPhrases(text) {
  const words = String(text || "").split(/\s+/);
  const phrases = [];
  let current = [];
  let sentenceStart = true;
  for (const raw of words) {
    const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    const isCap = /^[A-Z][a-z]*$/.test(w);
    const isSentenceStart = sentenceStart;
    sentenceStart = /[.!?]$/.test(raw);
    if (isCap && !isSentenceStart) {
      current.push(w);
    } else {
      if (current.length) phrases.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) phrases.push(current.join(" "));
  return phrases.filter((p) => p.length >= 3);
}

const RECENT_WINDOW = 5;
const BUCKET_LABEL = {
  overnight: "late at night",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
};

function hourBucket(hour) {
  if (hour < 5) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function wordPattern(recentEntries) {
  const counts = new Map();
  for (const e of recentEntries) {
    for (const w of new Set(tokenizeWords(e.body_text))) counts.set(w, (counts.get(w) || 0) + 1);
  }
  let best = null;
  for (const [word, count] of counts) {
    if (count < 3) continue; // a real, majority-of-the-window signal only -- not two coincidences
    if (!best || count > best.count || (count === best.count && word < best.word)) best = { word, count };
  }
  return best;
}

function topicPattern(allEntries, personName) {
  // A note about Dana always mentioning "Dana" is a given, not a real topic pattern -- exclude
  // her own name (and its first word, for "Dana Smith") so the panel surfaces something new.
  const nameParts = new Set(String(personName || "").toLowerCase().split(/\s+/).filter(Boolean));
  const counts = new Map(); // lower phrase -> { display, count }
  for (const e of allEntries) {
    const seen = new Set();
    for (const phrase of extractCapitalizedPhrases(e.body_text)) {
      const key = phrase.toLowerCase();
      if (nameParts.has(key)) continue;
      if (!seen.has(key)) {
        seen.add(key);
        if (!counts.has(key)) counts.set(key, { display: phrase, count: 0 });
        counts.get(key).count++;
      }
    }
  }
  let best = null;
  for (const v of counts.values()) {
    if (v.count < 2) continue;
    if (!best || v.count > best.count) best = v;
  }
  return best;
}

function timingPattern(allEntries) {
  const counts = new Map();
  for (const e of allEntries) {
    const bucket = hourBucket(new Date(e.happened_at).getHours());
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  let best = null;
  for (const [bucket, count] of counts) {
    if (!best || count > best.count) best = { bucket, count };
  }
  if (!best) return null;
  if (best.count < 3 || best.count / allEntries.length < 0.6) return null; // a real majority, not a coin flip
  return best;
}

/**
 * The patterns panel's real content. `entries` is newest-first (listPersonEntries's own order).
 * Fewer than 3 notes means genuinely not enough to say anything -- an empty array is the honest
 * answer, not a padded one. Every returned pattern is plain arithmetic over `entries`, nothing
 * inferred, nothing summarized, no AI call (Section 10).
 */
export function computePatterns(entries, personName) {
  if (!Array.isArray(entries) || entries.length < 3) return [];
  const recent = entries.slice(0, Math.min(RECENT_WINDOW, entries.length));
  const patterns = [];

  const w = wordPattern(recent);
  if (w) {
    patterns.push({
      type: "word",
      word: w.word,
      inCount: w.count,
      ofCount: recent.length,
      text: `You've written "${w.word}" in ${w.count} of your last ${recent.length} notes about ${personName}.`,
    });
  }

  const tm = timingPattern(entries);
  if (tm) {
    patterns.push({
      type: "timing",
      bucket: tm.bucket,
      inCount: tm.count,
      ofCount: entries.length,
      text: `Most of your notes about ${personName} are written ${BUCKET_LABEL[tm.bucket]} (${tm.count} of ${entries.length}).`,
    });
  }

  const t = topicPattern(entries, personName);
  if (t) {
    patterns.push({
      type: "topic",
      phrase: t.display,
      inCount: t.count,
      ofCount: entries.length,
      text: `"${t.display}" comes up in ${t.count} of ${entries.length} notes about ${personName}.`,
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Export -- real material for an actual therapist conversation (Section 7)
// ---------------------------------------------------------------------------

/**
 * A plain, literal, chronological (oldest-first) export of everything on file for one person --
 * "support, not replace, real therapy." Deliberately NOT an AI-generated summary: the contract's
 * own "no advice framed as certainty" boundary rules that out, and Section 10 rules out this app
 * ever calling a model to produce one. What's here is exactly what Shane wrote, in order, dated --
 * real material to bring to a real conversation, not a substitute for one.
 */
export async function exportPersonText(userId, personId) {
  const person = await getPerson(userId, personId);
  if (!person) throw notFound("Person not found");
  const entries = await listPersonEntries(userId, personId, { limit: 1000 });
  const ordered = [...entries].reverse();

  const lines = [
    `${person.name}${person.relationship ? ` (${person.relationship})` : ""} — private notes`,
    `Exported ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · ${ordered.length} note${ordered.length === 1 ? "" : "s"}`,
    "",
  ];
  for (const e of ordered) {
    const when = new Date(e.happened_at).toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    lines.push(`${when}${e.kind !== "text" ? ` · ${e.kind}` : ""}`);
    lines.push(e.body_text);
    lines.push("");
  }
  return lines.join("\n");
}
