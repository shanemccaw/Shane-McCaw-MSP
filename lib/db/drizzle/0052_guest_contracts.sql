-- Make contracts.user_id nullable to support guest purchases
-- (account is created after Stripe payment, not at contract-signing time)
ALTER TABLE "contracts" ALTER COLUMN "user_id" DROP NOT NULL;

-- Store the guest's email on the contract record so we can link
-- it to a newly-created user account after payment is confirmed
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "guest_email" text;
