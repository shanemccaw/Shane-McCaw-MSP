ALTER TABLE "insights_generated_documents" DROP CONSTRAINT IF EXISTS "insights_generated_documents_status_check";
ALTER TABLE "insights_generated_documents" ADD CONSTRAINT "insights_generated_documents_status_check" CHECK ("status" IN ('draft', 'approved', 'delivered', 'archived', 'generating'));
