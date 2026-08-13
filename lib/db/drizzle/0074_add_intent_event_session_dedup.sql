-- Remove duplicate cta_click / form_submit / site_visit rows created before
-- dedup was enforced, keeping the earliest occurrence per (lead, type, session, page).
DELETE FROM lead_intent_events
WHERE id NOT IN (
  SELECT DISTINCT ON (lead_id, event_type, metadata->>'sessionId', metadata->>'page') id
  FROM lead_intent_events
  WHERE event_type IN ('cta_click', 'form_submit', 'site_visit')
    AND metadata->>'sessionId' IS NOT NULL
    AND metadata->>'page'      IS NOT NULL
  ORDER BY lead_id, event_type, metadata->>'sessionId', metadata->>'page', occurred_at
)
AND event_type IN ('cta_click', 'form_submit', 'site_visit')
AND metadata->>'sessionId' IS NOT NULL
AND metadata->>'page'      IS NOT NULL;

-- Unique partial index: one intent event per (lead_id, event_type, sessionId, page)
-- for session-scoped event types. Concurrent inserts will conflict and be discarded.
CREATE UNIQUE INDEX IF NOT EXISTS lead_intent_events_session_dedup_idx
  ON lead_intent_events (
    lead_id,
    event_type,
    (metadata->>'sessionId'),
    (metadata->>'page')
  )
  WHERE event_type IN ('cta_click', 'form_submit', 'site_visit');
