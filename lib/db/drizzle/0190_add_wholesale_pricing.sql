ALTER TABLE "services" ADD COLUMN "internal_cost_cents" integer;
ALTER TABLE "services" ADD COLUMN "price_cents" integer;
ALTER TABLE "sales_offers" ADD COLUMN "internal_cost_cents" integer;
ALTER TABLE "sales_offers" ADD COLUMN "price_cents" integer;