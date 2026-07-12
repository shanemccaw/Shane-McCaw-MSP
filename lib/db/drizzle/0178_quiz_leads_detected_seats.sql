-- Add detected_seats to quiz_leads: stores the seat count extracted by AI
-- from the m365-health quiz conversation, used to deep-link the results page
-- CTA to the specific monitoring tier matching the user's tenant size.
-- Safe to re-apply: ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE quiz_leads ADD COLUMN IF NOT EXISTS detected_seats integer;
