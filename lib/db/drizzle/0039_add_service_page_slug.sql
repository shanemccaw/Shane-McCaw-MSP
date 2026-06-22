ALTER TABLE "services" ADD COLUMN "page_slug" text;

UPDATE "services" SET "page_slug" = 'tenant-health-audit'            WHERE "slug" = 'm365-tenant-health-audit';
UPDATE "services" SET "page_slug" = 'migration-readiness-assessment'  WHERE "slug" = 'migration-readiness-assessment';
UPDATE "services" SET "page_slug" = 'power-platform-quick-start'      WHERE "slug" = 'power-platform-quickstart';
UPDATE "services" SET "page_slug" = 'copilot-readiness-assessment'    WHERE "slug" = 'copilot-for-m365-readiness-assessment';
UPDATE "services" SET "page_slug" = 'governance-foundations'          WHERE "slug" = 'governance-foundations-package';
UPDATE "services" SET "page_slug" = 'm365-training-enablement'        WHERE "slug" = 'microsoft-365-training--enablement';
