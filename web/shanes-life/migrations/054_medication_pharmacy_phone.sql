-- Real "Call pharmacy" button (Git #3191, Meds Round 2 visual rebuild). The real design
-- (Shanes Life 07 - Meds.dc.html) puts a real "Call pharmacy" button next to "Ordered it" on
-- every manual-watch refill card -- there was nowhere to put a real phone number for it to call.
--
-- pharmacy_phone is free text, not validated as a phone format, so it can hold whatever Shane
-- actually says in a capture ("555-1234" or "(555) 123-4567 ext 2"), rendered as a real tel:
-- link when set. Nullable on purpose: the button only ever appears once a real number exists --
-- never a fake or placeholder destination.

ALTER TABLE medications ADD COLUMN IF NOT EXISTS pharmacy_phone text;
