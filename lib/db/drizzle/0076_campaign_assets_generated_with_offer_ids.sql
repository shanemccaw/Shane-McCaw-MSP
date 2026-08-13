ALTER TABLE campaign_assets
  ADD COLUMN IF NOT EXISTS generated_with_offer_ids jsonb;
