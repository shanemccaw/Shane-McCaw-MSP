-- Add FK constraint on campaigns.offer_id → offers.id
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL;
