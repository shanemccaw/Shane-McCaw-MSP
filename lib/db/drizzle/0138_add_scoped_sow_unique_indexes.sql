CREATE UNIQUE INDEX "igd_scoped_sow_with_project_uidx" ON "insights_generated_documents" ("customer_id","project_id","doc_type") WHERE doc_type = 'scoped_sow' AND project_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "igd_scoped_sow_no_project_uidx" ON "insights_generated_documents" ("customer_id","doc_type") WHERE doc_type = 'scoped_sow' AND project_id IS NULL;
