-- Load the EXISTING hardcoded quiz catalog into the new tables — #271 step 5,
-- sub-issue of #258, parent epic #183.
--
-- Companion to 2026-07-31-quiz-catalog-tables-271.sql, which must be run FIRST.
--
-- This is a data MIGRATION, not a content seed: every row below is the existing
-- ADAPTIVE_CLUSTERS / ADAPTIVE_PERSONAS / ADAPTIVE_USE_CASES /
-- ADAPTIVE_OUTCOME_PRIORITIES content from msp-portal's quizCatalog.ts, moved
-- verbatim. Its purpose is that no industry regresses to an empty quiz while
-- Shane backfills real depth — NOT to be the real content. Shane's own
-- Copilot-deep-research rows replace these level by level.
--
-- Generated mechanically from quizCatalog.ts rather than transcribed by hand, so
-- the migrated rows cannot drift from what the wizard actually renders today.
-- Totals: 60 clusters, 122 personas, 122 use cases, 13 outcomes, across the 14
-- real INDUSTRY_OPTIONS ids plus the literal "default" fallback key.
--
-- Two honest notes about what this content is:
--
-- 1. OUTCOMES ARE MIGRATED AS persona_key = '*' (industry-wide). #271 makes
--    outcomes persona-scoped, but the existing outcome content genuinely has no
--    persona linkage — that absence is the gap the issue was filed for. Writing
--    '*' records that truthfully. Duplicating each outcome under every persona
--    would have produced rows that LOOK persona-specific while carrying none of
--    the specificity, which is worse than an honest sentinel. The read route
--    maps '*' to "no linkage", so these render under any persona selection —
--    byte-identical behaviour to before this change.
--
-- 2. ONLY space, healthcare, finance AND default HAVE OUTCOMES AT ALL. That is
--    not an omission here: ADAPTIVE_OUTCOME_PRIORITIES only ever defined those
--    four keys, and the other ten industries fell through to 'default' at
--    runtime. The read route performs the same fallback, so behaviour is
--    preserved exactly; ten industries having no outcomes of their own is real,
--    pre-existing content debt this migration makes visible rather than hides.
--
-- Every statement is ON CONFLICT DO NOTHING: re-running is safe, and once Shane
-- has replaced a key with real content, re-running this file will NOT overwrite
-- it. To deliberately re-import a level, delete those rows first.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).


INSERT INTO "quiz_persona_clusters" ("industry", "cluster_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'science_research', 'Science & Research', 'Astrophysical study, orbital mechanics & propulsion research', 'Atom', 0),
  ('space', 'mission_ops', 'Mission Operations', 'Flight command, mission control & satellite telemetry ops', 'Compass', 10),
  ('space', 'engineering', 'Engineering', 'Payload, hardware systems, CAD modeling & safety testing', 'Cpu', 20),
  ('space', 'prog_admin', 'Program & Administration', 'Agency compliance, inter-governmental liaison & program management', 'Briefcase', 30),
  ('healthcare', 'clinical_care', 'Clinical Care', 'Direct patient interaction, diagnosis, therapy & EHR charting', 'Stethoscope', 0),
  ('healthcare', 'research_lab', 'Research & Lab', 'Genomics, clinical trial analysis & pharmaceutical research', 'Microscope', 10),
  ('healthcare', 'compliance_policy', 'Compliance & Policy', 'HIPAA auditing, medical writing & regulatory governance', 'ShieldCheck', 20),
  ('healthcare', 'administration', 'Administration', 'Hospital operations, billing, insurance & facility scheduling', 'Building2', 30),
  ('finance', 'front_office', 'Front Office', 'Investment banking, trading desks & portfolio management', 'TrendingUp', 0),
  ('finance', 'risk_compliance', 'Risk & Compliance', 'SOX auditing, risk modeling & trade monitoring', 'ShieldAlert', 10),
  ('finance', 'research_analysis', 'Research & Analysis', 'Quantitative modeling, market research & equity analysis', 'BarChart', 20),
  ('finance', 'operations', 'Operations', 'Settlement, treasury operations & client services', 'Briefcase', 30),
  ('manufacturing', 'engineering', 'Engineering', 'CAD designs, plant automation & robotics maintenance', 'Wrench', 0),
  ('manufacturing', 'quality_safety', 'Quality & Safety', 'EHS compliance, ISO audits & defect root cause analysis', 'Shield', 10),
  ('manufacturing', 'production', 'Production', 'Shop floor management, shift scheduling & throughput', 'Boxes', 20),
  ('manufacturing', 'maintenance', 'Maintenance', 'SCADA telemetry diagnostics & preventive overhaul logs', 'Settings', 30),
  ('education', 'instruction', 'Instruction', 'K-12 & higher-ed teaching, grading & student engagement', 'BookOpen', 0),
  ('education', 'research', 'Research', 'Academic publishing, grant application & peer review', 'GraduationCap', 10),
  ('education', 'administration', 'Administration', 'Institutional governance, accreditation & student admissions', 'Building', 20),
  ('education', 'curriculum', 'Curriculum', 'Syllabus design, learning outcome mapping & pedagogical standards', 'Layers', 30),
  ('government', 'policy_analysis', 'Policy & Analysis', 'Legislative analysis, policy drafting & public comments', 'FileSpreadsheet', 0),
  ('government', 'operations', 'Operations', 'Agency administration, inter-department coordination & service delivery', 'FolderKanban', 10),
  ('government', 'investigation', 'Investigation', 'Regulatory audits, case file analysis & FOIA processing', 'Search', 20),
  ('government', 'communications', 'Communications', 'Public press releases, citizen engagement & agency briefings', 'Megaphone', 30),
  ('technology', 'engineering', 'Engineering', 'Software development, DevOps, cloud infra & data engineering', 'Code', 0),
  ('technology', 'product', 'Product', 'Product management, roadmap planning & feature spec drafting', 'Target', 10),
  ('technology', 'design', 'Design', 'UX research, UI prototyping & design system management', 'Palette', 20),
  ('technology', 'support', 'Support', 'Technical customer support, KB documentation & incident retros', 'LifeBuoy', 30),
  ('legal', 'litigation', 'Litigation', 'Courtroom prep, discovery review & brief drafting', 'Gavel', 0),
  ('legal', 'corporate_transactional', 'Corporate & Transactional', 'Contract drafting, M&A due diligence & deal structuring', 'Briefcase', 10),
  ('legal', 'legal_compliance', 'Compliance & Regulatory', 'Regulatory filings, policy review & audit response', 'ShieldCheck', 20),
  ('legal', 'practice_mgmt', 'Practice Management', 'Billing, client intake & matter administration', 'FileSpreadsheet', 30),
  ('retail', 'merchandising', 'Merchandising', 'Assortment planning, pricing strategy & vendor negotiations', 'Tag', 0),
  ('retail', 'store_ops', 'Store Operations', 'Staffing, inventory counts & loss prevention', 'Store', 10),
  ('retail', 'ecommerce', 'E-Commerce', 'Product listings, digital marketing & fulfillment ops', 'ShoppingBag', 20),
  ('retail', 'customer_experience', 'Customer Experience', 'Service scripts, loyalty programs & returns handling', 'Smile', 30),
  ('energy', 'field_ops', 'Field Operations', 'Well/rig site inspections, pipeline monitoring & safety walkthroughs', 'Zap', 0),
  ('energy', 'engineering_technical', 'Engineering & Technical', 'Reservoir modeling, grid load analysis & turbine specs', 'Cpu', 10),
  ('energy', 'regulatory_environmental', 'Regulatory & Environmental', 'Permitting, emissions reporting & compliance audits', 'ShieldCheck', 20),
  ('energy', 'trading_commercial', 'Trading & Commercial', 'Contract structuring, market analysis & hedging strategy', 'LineChart', 30),
  ('transportation', 'logistics_dispatch', 'Logistics & Dispatch', 'Route planning, load scheduling & carrier coordination', 'Truck', 0),
  ('transportation', 'fleet_ops', 'Fleet Operations', 'Maintenance logs, driver compliance & vehicle telemetry', 'Activity', 10),
  ('transportation', 'transport_safety', 'Safety & Compliance', 'DOT audits, incident reports & hazmat documentation', 'ShieldAlert', 20),
  ('transportation', 'freight_services', 'Customer & Freight Services', 'Shipment tracking, billing & claims resolution', 'FileText', 30),
  ('agriculture', 'field_crop_ops', 'Field & Crop Operations', 'Planting schedules, yield tracking & soil analysis', 'Sprout', 0),
  ('agriculture', 'livestock_mgmt', 'Livestock & Herd Management', 'Health records, breeding logs & feed planning', 'Heart', 10),
  ('agriculture', 'agronomy_research', 'Agronomy & Research', 'Field trials, pest/disease analysis & seed research', 'Microscope', 20),
  ('agriculture', 'ag_supply_chain', 'Supply Chain & Trading', 'Commodity contracts, storage logistics & market pricing', 'TrendingUp', 30),
  ('nonprofit', 'programs_services', 'Programs & Services', 'Beneficiary case management, program reporting & outcome tracking', 'Heart', 0),
  ('nonprofit', 'development_fundraising', 'Development & Fundraising', 'Donor cultivation, grant writing & campaign planning', 'Users', 10),
  ('nonprofit', 'nonprofit_finance', 'Finance & Compliance', '990 filings, grant compliance & budget reporting', 'FileCheck', 20),
  ('nonprofit', 'comms_outreach', 'Communications & Outreach', 'Newsletters, social campaigns & community engagement', 'Megaphone', 30),
  ('other', 'leadership_strategy', 'Leadership & Strategy', 'Org planning, board reporting & strategic initiatives', 'Crown', 0),
  ('other', 'ops_delivery', 'Operations & Delivery', 'Project execution, process management & vendor coordination', 'Boxes', 10),
  ('other', 'knowledge_analysis', 'Knowledge & Analysis', 'Research synthesis, reporting & documentation', 'FileText', 20),
  ('other', 'client_relations', 'Client & Stakeholder Relations', 'Account management, communications & service delivery', 'Users', 30),
  ('default', 'exec_strategy', 'Executive & Strategy', 'Organizational leadership, strategic planning & board reporting', 'Crown', 0),
  ('default', 'tech_ops', 'Technical Operations', 'System administration, security engineering & IT support', 'Cpu', 10),
  ('default', 'gen_knowledge', 'General Knowledge', 'Cross-functional document creation, synthesis & daily collaboration', 'Briefcase', 20),
  ('default', 'support_services', 'Support & Services', 'Customer service, vendor management & internal helpdesk', 'Users', 30)
ON CONFLICT ("industry", "cluster_key") DO NOTHING;

INSERT INTO "quiz_personas" ("industry", "cluster_key", "persona_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'science_research', 'scientist', 'Scientist', 'Deep domain research, astrophysical calculations & paper synthesis', 'Atom', 0),
  ('space', 'science_research', 'research_analyst', 'Research Analyst', 'Literature reviews, grant proposals & data collection', 'FileText', 10),
  ('space', 'science_research', 'data_scientist', 'Data Scientist', 'Telemetry analysis, neural net modeling & sensor analytics', 'BarChart2', 20),
  ('space', 'science_research', 'lab_specialist', 'Lab Specialist', 'Cleanroom instrument testing & material sample analysis', 'Microscope', 30),
  ('space', 'mission_ops', 'mission_spec', 'Mission Specialist', 'Real-time telemetry analysis, flight procedures & payload prep', 'Compass', 40),
  ('space', 'mission_ops', 'flight_dir', 'Flight Director', 'Command center oversight, contingency protocol execution', 'Radio', 50),
  ('space', 'mission_ops', 'ops_controller', 'Operations Controller', 'Orbital trajectory adjustments & comms link monitoring', 'Activity', 60),
  ('space', 'mission_ops', 'flight_surgeon', 'Flight Surgeon', 'Crew physiological monitoring & bio-telemetry review', 'HeartPulse', 70),
  ('space', 'engineering', 'payload_eng', 'Payload Engineer', 'Instrument calibration, hardware integration & CAD specs', 'Cpu', 80),
  ('space', 'engineering', 'systems_eng', 'Systems Engineer', 'Subsystem integration, thermal & power budget validation', 'Layers', 90),
  ('space', 'engineering', 'safety_eng', 'Safety Engineer', 'Fault tree analysis, hazard identification & fail-safe testing', 'ShieldAlert', 100),
  ('space', 'engineering', 'requirements_eng', 'Requirements Engineer', 'NASA/ESA specification verification & traceability matrices', 'CheckSquare', 110),
  ('space', 'prog_admin', 'prog_mgr', 'Program Manager', 'Schedule alignment, agency compliance & multi-contractor budgets', 'Briefcase', 120),
  ('space', 'prog_admin', 'comms_spec', 'Communications Specialist', 'Public mission briefings & inter-departmental newsletters', 'Megaphone', 130),
  ('space', 'prog_admin', 'policy_analyst', 'Policy Analyst', 'Space law, ITAR regulatory compliance & export control governance', 'Scale', 140),
  ('healthcare', 'clinical_care', 'clinician', 'Clinician', 'Direct patient care, EHR clinical notes & diagnosis review', 'Stethoscope', 0),
  ('healthcare', 'clinical_care', 'nurse', 'Nurse', 'Patient intake, shift handover summaries & care protocols', 'Heart', 10),
  ('healthcare', 'clinical_care', 'care_coord', 'Care Coordinator', 'Discharge planning, specialist referrals & patient follow-ups', 'Users', 20),
  ('healthcare', 'research_lab', 'med_researcher', 'Medical Researcher', 'Clinical trials, journal literature synthesis & lab telemetry', 'Microscope', 30),
  ('healthcare', 'research_lab', 'lab_tech', 'Lab Technician', 'Pathology diagnostic logging, assay testing & sample processing', 'Atom', 40),
  ('healthcare', 'compliance_policy', 'compliance_officer', 'Compliance Officer', 'HIPAA auditing, patient privacy guardrails & policy review', 'ShieldCheck', 50),
  ('healthcare', 'compliance_policy', 'medical_writer', 'Medical Writer', 'Regulatory submission dossiers, IRB protocols & consent forms', 'FileText', 60),
  ('healthcare', 'administration', 'admin', 'Administrator', 'Facility operations, insurance billing & staff scheduling', 'Building2', 70),
  ('finance', 'front_office', 'analyst', 'Analyst', 'Financial modeling, earnings call summaries & valuation', 'BarChart', 0),
  ('finance', 'front_office', 'trader', 'Trader', 'Market news synthesis, execution reports & order flow', 'TrendingUp', 10),
  ('finance', 'front_office', 'portfolio_mgr', 'Portfolio Manager', 'Asset allocation strategy, investor updates & risk reviews', 'Briefcase', 20),
  ('finance', 'risk_compliance', 'risk_officer', 'Risk Officer', 'Stress testing, SOX/SEC compliance & exposure modeling', 'ShieldAlert', 30),
  ('finance', 'risk_compliance', 'compliance', 'Compliance Officer', 'Trade monitoring, regulatory filings & KYC/AML audits', 'FileCheck', 40),
  ('finance', 'risk_compliance', 'auditor', 'Internal Auditor', 'Financial statement auditing, control testing & ledger reviews', 'CheckSquare', 50),
  ('finance', 'research_analysis', 'quant_researcher', 'Quantitative Researcher', 'Algorithmic strategy formulation, backtesting & market data math', 'Cpu', 60),
  ('finance', 'research_analysis', 'market_researcher', 'Market Researcher', 'Industry trend synthesis, competitive analysis & macroeconomic notes', 'LineChart', 70),
  ('finance', 'operations', 'ops_specialist', 'Operations Specialist', 'Trade settlement reconciliation, client onboarding & wire processing', 'Settings', 80),
  ('technology', 'engineering', 'dev', 'Developer', 'Code drafting, PR reviews, documentation & API integration', 'Code', 0),
  ('technology', 'engineering', 'devops', 'DevOps Engineer', 'CI/CD pipeline scripts, Terraform configs & cluster telemetry', 'Cpu', 10),
  ('technology', 'engineering', 'data_scientist', 'Data Scientist', 'ML model training, data pipeline engineering & analytics', 'BarChart2', 20),
  ('technology', 'product', 'pm', 'Product Manager', 'PRD writing, user story synthesis & sprint prioritization', 'Target', 30),
  ('technology', 'design', 'designer', 'Designer', 'UX research synthesis, design system guidelines & specs', 'Palette', 40),
  ('technology', 'support', 'support_eng', 'Support Engineer', 'Ticket triage, KB article generation & incident retros', 'LifeBuoy', 50),
  ('manufacturing', 'engineering', 'process_engineer', 'Process Engineer', 'Process flow documentation, CAD drafting & line optimization notes', 'Wrench', 0),
  ('manufacturing', 'engineering', 'automation_engineer', 'Automation Engineer', 'PLC programming logic, robotics specs & controls documentation', 'Cpu', 10),
  ('manufacturing', 'quality_safety', 'qa_inspector', 'QA Inspector', 'Defect logs, non-conformance reports & ISO audit prep', 'CheckSquare', 20),
  ('manufacturing', 'quality_safety', 'ehs_specialist', 'EHS Specialist', 'Safety incident reports, compliance checklists & hazard assessments', 'ShieldAlert', 30),
  ('manufacturing', 'production', 'shift_supervisor', 'Shift Supervisor', 'Shift handover notes, throughput reports & scheduling docs', 'Users', 40),
  ('manufacturing', 'production', 'production_planner', 'Production Planner', 'Schedule optimization, capacity planning & work order drafting', 'Boxes', 50),
  ('manufacturing', 'maintenance', 'maintenance_tech', 'Maintenance Technician', 'Work order documentation, preventive maintenance schedules', 'Settings', 60),
  ('manufacturing', 'maintenance', 'reliability_engineer', 'Reliability Engineer', 'Failure analysis reports & SCADA telemetry diagnostics', 'Activity', 70),
  ('education', 'instruction', 'teacher', 'Teacher', 'Lesson plans, grading rubrics & parent/guardian communication', 'BookOpen', 0),
  ('education', 'instruction', 'instructional_coach', 'Instructional Coach', 'Professional development materials & classroom observation notes', 'GraduationCap', 10),
  ('education', 'research', 'academic_researcher', 'Academic Researcher', 'Literature reviews, grant proposals & peer review synthesis', 'Microscope', 20),
  ('education', 'research', 'grad_assistant', 'Graduate Assistant', 'Data collection support, citation management & lit summaries', 'FileText', 30),
  ('education', 'administration', 'registrar', 'Registrar', 'Enrollment records, transcript processing & scheduling docs', 'FileSpreadsheet', 40),
  ('education', 'administration', 'dean', 'Dean', 'Accreditation reports, faculty memos & institutional governance docs', 'Building', 50),
  ('education', 'curriculum', 'curriculum_designer', 'Curriculum Designer', 'Syllabus drafting & learning outcome mapping', 'Layers', 60),
  ('education', 'curriculum', 'instructional_designer', 'Instructional Designer', 'Course content development & assessment design', 'PenTool', 70),
  ('government', 'policy_analysis', 'policy_analyst', 'Policy Analyst', 'Legislative briefs, impact assessments & public comment synthesis', 'FileSpreadsheet', 0),
  ('government', 'policy_analysis', 'legislative_aide', 'Legislative Aide', 'Constituent correspondence & bill summary drafting', 'FileText', 10),
  ('government', 'operations', 'program_manager_gov', 'Program Manager', 'Interagency coordination notes & service delivery reports', 'FolderKanban', 20),
  ('government', 'operations', 'procurement_officer', 'Procurement Officer', 'RFP drafting, vendor contracts & sourcing documentation', 'FileCheck', 30),
  ('government', 'investigation', 'investigator', 'Investigator', 'Case file documentation, evidence logs & interview summaries', 'Search', 40),
  ('government', 'investigation', 'compliance_auditor_gov', 'Compliance Auditor', 'Regulatory audits & FOIA response drafting', 'ShieldCheck', 50),
  ('government', 'communications', 'press_officer', 'Press Officer', 'Press releases, public statements & media briefing prep', 'Megaphone', 60),
  ('government', 'communications', 'public_affairs', 'Public Affairs Specialist', 'Citizen engagement materials & agency briefing documents', 'Users', 70),
  ('legal', 'litigation', 'litigator', 'Litigator', 'Brief drafting, deposition prep & case strategy memos', 'Gavel', 0),
  ('legal', 'litigation', 'litigation_paralegal', 'Litigation Paralegal', 'Discovery review, exhibit organization & filing prep', 'FileText', 10),
  ('legal', 'corporate_transactional', 'transactional_attorney', 'Transactional Attorney', 'Contract drafting, deal memos & term sheet review', 'Briefcase', 20),
  ('legal', 'corporate_transactional', 'corp_paralegal', 'Corporate Paralegal', 'Due diligence review & closing checklist management', 'CheckSquare', 30),
  ('legal', 'legal_compliance', 'compliance_counsel', 'Compliance Counsel', 'Regulatory filings, policy drafting & risk memos', 'ShieldCheck', 40),
  ('legal', 'legal_compliance', 'compliance_analyst_legal', 'Compliance Analyst', 'Audit response prep & regulatory risk assessments', 'FileCheck', 50),
  ('legal', 'practice_mgmt', 'practice_manager', 'Practice Manager', 'Billing narratives, client intake docs & matter administration', 'FileSpreadsheet', 60),
  ('legal', 'practice_mgmt', 'legal_secretary', 'Legal Secretary', 'Correspondence drafting & calendar/matter coordination', 'Layers', 70),
  ('retail', 'merchandising', 'merchandiser', 'Merchandiser', 'Assortment plans, pricing analysis & planogram documentation', 'Tag', 0),
  ('retail', 'merchandising', 'buyer', 'Buyer', 'Vendor negotiation memos & purchase order documentation', 'ShoppingBag', 10),
  ('retail', 'store_ops', 'store_manager', 'Store Manager', 'Staff scheduling, inventory reports & daily ops summaries', 'Store', 20),
  ('retail', 'store_ops', 'loss_prevention', 'Loss Prevention Specialist', 'Incident reports & shrinkage analysis documentation', 'ShieldAlert', 30),
  ('retail', 'ecommerce', 'ecommerce_manager', 'E-Commerce Manager', 'Product listing copy & campaign brief drafting', 'ShoppingBag', 40),
  ('retail', 'ecommerce', 'digital_marketer_retail', 'Digital Marketer', 'Ad copy drafting & campaign performance reports', 'Megaphone', 50),
  ('retail', 'customer_experience', 'cx_specialist', 'Customer Experience Specialist', 'Service scripts & complaint resolution documentation', 'Smile', 60),
  ('retail', 'customer_experience', 'loyalty_manager', 'Loyalty Program Manager', 'Program communications & retention analysis reports', 'Heart', 70),
  ('energy', 'field_ops', 'field_technician_energy', 'Field Technician', 'Inspection reports & work order documentation', 'Zap', 0),
  ('energy', 'field_ops', 'site_supervisor', 'Site Supervisor', 'Safety walkthrough docs & shift report drafting', 'Users', 10),
  ('energy', 'engineering_technical', 'reservoir_engineer', 'Reservoir Engineer', 'Reservoir modeling reports & technical specifications', 'Cpu', 20),
  ('energy', 'engineering_technical', 'grid_engineer', 'Grid Engineer', 'Load analysis & capacity planning documentation', 'Activity', 30),
  ('energy', 'regulatory_environmental', 'environmental_specialist', 'Environmental Specialist', 'Emissions reports & permit application drafting', 'ShieldCheck', 40),
  ('energy', 'regulatory_environmental', 'regulatory_affairs_energy', 'Regulatory Affairs Specialist', 'Compliance filings & audit preparation', 'FileCheck', 50),
  ('energy', 'trading_commercial', 'energy_trader', 'Energy Trader', 'Market analysis & contract structuring documentation', 'LineChart', 60),
  ('energy', 'trading_commercial', 'commercial_analyst_energy', 'Commercial Analyst', 'Pricing models & hedging strategy documentation', 'TrendingUp', 70),
  ('transportation', 'logistics_dispatch', 'dispatcher', 'Dispatcher', 'Route plans, load schedules & carrier communications', 'Truck', 0),
  ('transportation', 'logistics_dispatch', 'logistics_coordinator', 'Logistics Coordinator', 'Carrier communications & shipment tracking updates', 'FolderKanban', 10),
  ('transportation', 'fleet_ops', 'fleet_manager', 'Fleet Manager', 'Maintenance logs & driver compliance documentation', 'Settings', 20),
  ('transportation', 'fleet_ops', 'fleet_analyst', 'Fleet Analyst', 'Telemetry reports & utilization analysis', 'BarChart2', 30),
  ('transportation', 'transport_safety', 'safety_officer_transport', 'Safety Officer', 'Incident reports & DOT audit preparation', 'ShieldAlert', 40),
  ('transportation', 'transport_safety', 'compliance_specialist_transport', 'Compliance Specialist', 'Hazmat documentation & inspection logs', 'FileCheck', 50),
  ('transportation', 'freight_services', 'freight_coordinator', 'Freight Coordinator', 'Shipment tracking updates & billing documentation', 'FileText', 60),
  ('transportation', 'freight_services', 'claims_specialist', 'Claims Specialist', 'Claims resolution & customer correspondence', 'FileCheck', 70),
  ('agriculture', 'field_crop_ops', 'farm_manager', 'Farm Manager', 'Planting schedules & yield report documentation', 'Sprout', 0),
  ('agriculture', 'field_crop_ops', 'field_technician_ag', 'Field Technician', 'Soil sample logs & irrigation record keeping', 'Activity', 10),
  ('agriculture', 'livestock_mgmt', 'herd_manager', 'Herd Manager', 'Health records & breeding log documentation', 'Heart', 20),
  ('agriculture', 'livestock_mgmt', 'livestock_technician', 'Livestock Technician', 'Feed planning docs & veterinary visit notes', 'Stethoscope', 30),
  ('agriculture', 'agronomy_research', 'agronomist', 'Agronomist', 'Field trial reports & pest/disease analysis', 'Microscope', 40),
  ('agriculture', 'agronomy_research', 'research_technician_ag', 'Research Technician', 'Data collection support & lab notes', 'FileText', 50),
  ('agriculture', 'ag_supply_chain', 'commodity_trader', 'Commodity Trader', 'Contract structuring & market pricing analysis', 'TrendingUp', 60),
  ('agriculture', 'ag_supply_chain', 'logistics_manager_ag', 'Logistics Manager', 'Storage planning & transport coordination docs', 'Boxes', 70),
  ('nonprofit', 'programs_services', 'program_manager_np', 'Program Manager', 'Case management notes & outcome report drafting', 'Heart', 0),
  ('nonprofit', 'programs_services', 'case_worker', 'Case Worker', 'Client intake documentation & service plan drafting', 'FileText', 10),
  ('nonprofit', 'development_fundraising', 'development_director', 'Development Director', 'Donor proposals & cultivation strategy documentation', 'Users', 20),
  ('nonprofit', 'development_fundraising', 'grant_writer', 'Grant Writer', 'Grant applications & funder report drafting', 'PenTool', 30),
  ('nonprofit', 'nonprofit_finance', 'finance_manager_np', 'Finance Manager', 'Budget reports & Form 990 preparation support', 'FileSpreadsheet', 40),
  ('nonprofit', 'nonprofit_finance', 'grants_accountant', 'Grants Accountant', 'Compliance tracking & expense report documentation', 'FileCheck', 50),
  ('nonprofit', 'comms_outreach', 'comms_manager_np', 'Communications Manager', 'Newsletters & press release drafting', 'Megaphone', 60),
  ('nonprofit', 'comms_outreach', 'outreach_coordinator', 'Outreach Coordinator', 'Community engagement materials & social content', 'Users', 70),
  ('other', 'leadership_strategy', 'executive', 'Executive', 'Strategic plans, board memos & org-wide communications', 'Crown', 0),
  ('other', 'leadership_strategy', 'strategy_lead', 'Strategy Lead', 'Initiative roadmaps & strategic planning documentation', 'Target', 10),
  ('other', 'ops_delivery', 'project_manager_other', 'Project Manager', 'Status reports, project plans & vendor coordination', 'FolderKanban', 20),
  ('other', 'ops_delivery', 'ops_coordinator', 'Operations Coordinator', 'Process documentation & cross-team coordination', 'Boxes', 30),
  ('other', 'knowledge_analysis', 'analyst_other', 'Analyst', 'Research synthesis & report drafting', 'BarChart', 40),
  ('other', 'knowledge_analysis', 'knowledge_manager', 'Knowledge Manager', 'Documentation management & knowledge base articles', 'BookOpen', 50),
  ('other', 'client_relations', 'account_manager', 'Account Manager', 'Client communications & account plan documentation', 'Briefcase', 60),
  ('other', 'client_relations', 'relationship_manager', 'Relationship Manager', 'Stakeholder updates & service report drafting', 'Users', 70),
  ('default', 'exec_strategy', 'exec_leader', 'Executive Leader', 'Strategic planning, board presentations & org-wide memos', 'Crown', 0),
  ('default', 'gen_knowledge', 'knowledge_worker', 'Knowledge Worker', 'Daily M365 document synthesis, email & meeting catchup', 'Briefcase', 10),
  ('default', 'tech_ops', 'ops_lead', 'Operations Lead', 'Process optimization, team coordination & SOP maintenance', 'Settings', 20),
  ('default', 'support_services', 'support_spec', 'Support Specialist', 'Internal ticket resolution & knowledge base authoring', 'LifeBuoy', 30)
ON CONFLICT ("industry", "persona_key") DO NOTHING;

INSERT INTO "quiz_use_cases" ("industry", "persona_key", "use_case_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', 'scientist', 'lit_synthesis_space', 'Literature Synthesis', 'Condensing dense astrophysics papers into digestible research briefs', 'Microscope', 0),
  ('space', 'research_analyst', 'grant_drafting_space', 'Grant Proposal Drafting', 'Structuring funding narratives from raw research notes & prior awards', 'FileText', 10),
  ('space', 'data_scientist', 'telemetry_pattern', 'Telemetry Pattern Detection', 'Surfacing anomalies across orbital sensor datasets in natural language', 'BarChart2', 20),
  ('space', 'lab_specialist', 'sample_reporting', 'Sample Analysis Reporting', 'Turning cleanroom test logs into structured material analysis reports', 'FileCheck', 30),
  ('space', 'mission_spec', 'mission_log_synth', 'Mission Log Synthesis', 'Extracting key anomalies & event sequences from raw flight telemetry', 'Radio', 40),
  ('space', 'flight_dir', 'contingency_drafting', 'Contingency Protocol Drafting', 'Structuring command-center response plans from prior incident data', 'ShieldAlert', 50),
  ('space', 'ops_controller', 'trajectory_notes', 'Trajectory Adjustment Notes', 'Documenting orbital correction rationale for handover & audit trail', 'Compass', 60),
  ('space', 'flight_surgeon', 'biotelemetry_summary', 'Bio-Telemetry Summarization', 'Condensing crew physiological data into daily medical briefs', 'HeartPulse', 70),
  ('space', 'payload_eng', 'integration_specs', 'Integration Spec Drafting', 'Turning hardware test data into instrument integration specifications', 'Cpu', 80),
  ('space', 'systems_eng', 'sys_budget_docs', 'Systems Budget Documentation', 'Structuring thermal & power budget validation results for review', 'Layers', 90),
  ('space', 'safety_eng', 'fault_tree_reports', 'Fault Tree Reporting', 'Converting hazard analysis worksheets into formal safety case reports', 'ShieldAlert', 100),
  ('space', 'requirements_eng', 'traceability_matrix', 'Traceability Matrix Drafting', 'Mapping system requirements to verification evidence automatically', 'CheckSquare', 110),
  ('space', 'prog_mgr', 'agency_status_reports', 'Agency Status Reporting', 'Drafting inter-agency program status updates from milestone data', 'FileSpreadsheet', 120),
  ('space', 'comms_spec', 'mission_briefings', 'Mission Briefing Drafting', 'Turning technical mission data into public-facing briefing language', 'Megaphone', 130),
  ('space', 'policy_analyst', 'compliance_briefs_space', 'Compliance Brief Drafting', 'Synthesizing NASA/ESA policy updates into program-relevant briefs', 'FileText', 140),
  ('healthcare', 'clinician', 'chart_summarization', 'Chart Summarization', 'Extracting key clinical history from long patient EHR records', 'Stethoscope', 0),
  ('healthcare', 'nurse', 'shift_handoff_notes', 'Shift Handoff Drafting', 'Structuring nurse-to-nurse handoff notes from care log entries', 'FileText', 10),
  ('healthcare', 'care_coord', 'care_plan_drafting', 'Care Plan Drafting', 'Generating standardized discharge instructions & care pathways', 'HeartPulse', 20),
  ('healthcare', 'med_researcher', 'clinical_trial_synth', 'Clinical Trial Synthesis', 'Aggregating trial papers & treatment efficacy data into briefs', 'Microscope', 30),
  ('healthcare', 'lab_tech', 'lab_result_reporting', 'Lab Result Reporting', 'Structuring assay results into standardized lab reports', 'FileCheck', 40),
  ('healthcare', 'compliance_officer', 'hipaa_policy_updates', 'HIPAA Policy Updates', 'Updating hospital SOPs to match new health authority guidelines', 'ShieldCheck', 50),
  ('healthcare', 'medical_writer', 'dictation_polish', 'Clinical Note Polishing', 'Refining physician dictations for accuracy & billing compliance', 'FileText', 60),
  ('healthcare', 'admin', 'billing_scheduling_docs', 'Billing & Scheduling Documentation', 'Structuring facility scheduling & insurance intake paperwork', 'Building2', 70),
  ('finance', 'analyst', 'market_digest', 'Market Digest Drafting', 'Daily macroeconomic digest & market feed synthesis', 'TrendingUp', 0),
  ('finance', 'trader', 'trade_rationale_notes', 'Trade Rationale Documentation', 'Structuring trade thesis notes for compliance record-keeping', 'LineChart', 10),
  ('finance', 'portfolio_mgr', 'investor_letters', 'Investor Letter Drafting', 'Generating quarterly investor letters & portfolio performance notes', 'FileSpreadsheet', 20),
  ('finance', 'risk_officer', 'risk_narrative_drafting', 'Risk Narrative Drafting', 'Formulating credit & liquidity risk narratives for investment comms', 'ShieldAlert', 30),
  ('finance', 'compliance', 'kyc_aml_docs', 'KYC/AML Documentation', 'Structuring trade monitoring & regulatory filing narratives', 'FileCheck', 40),
  ('finance', 'auditor', 'audit_workpapers', 'Audit Workpaper Drafting', 'Turning control test results into structured audit workpapers', 'CheckSquare', 50),
  ('finance', 'quant_researcher', 'backtest_reporting', 'Backtest Reporting', 'Structuring algorithmic strategy backtest results into research notes', 'Cpu', 60),
  ('finance', 'market_researcher', 'competitive_analysis_synth', 'Competitive Analysis Synthesis', 'Condensing industry trend data into competitive briefings', 'LineChart', 70),
  ('finance', 'ops_specialist', 'settlement_recon_notes', 'Settlement Reconciliation Notes', 'Structuring trade settlement exceptions into resolution reports', 'Settings', 80),
  ('technology', 'dev', 'pr_doc_drafting', 'PR & Docs Drafting', 'Drafting PR descriptions & API documentation from code diffs', 'Code', 0),
  ('technology', 'devops', 'runbook_drafting', 'Runbook Drafting', 'Turning CI/CD pipeline configs into on-call runbook documentation', 'Cpu', 10),
  ('technology', 'data_scientist', 'model_card_drafting', 'Model Card Drafting', 'Structuring ML model training results into model card documentation', 'BarChart2', 20),
  ('technology', 'pm', 'prd_drafting', 'PRD Drafting', 'Turning user research & sprint notes into structured PRDs', 'Target', 30),
  ('technology', 'designer', 'design_spec_drafting', 'Design Spec Drafting', 'Structuring design system rationale into handoff-ready specs', 'Palette', 40),
  ('technology', 'support_eng', 'kb_article_drafting', 'KB Article Drafting', 'Turning resolved tickets into searchable knowledge base articles', 'LifeBuoy', 50),
  ('manufacturing', 'process_engineer', 'process_flow_docs', 'Process Flow Documentation', 'Turning line optimization notes into structured process flow docs', 'Wrench', 0),
  ('manufacturing', 'automation_engineer', 'controls_doc_drafting', 'Controls Documentation', 'Structuring PLC programming logic into controls documentation', 'Cpu', 10),
  ('manufacturing', 'qa_inspector', 'nonconformance_reports', 'Non-Conformance Reporting', 'Structuring defect logs into formal non-conformance reports', 'CheckSquare', 20),
  ('manufacturing', 'ehs_specialist', 'safety_incident_reports', 'Safety Incident Reporting', 'Turning hazard observations into structured OSHA-ready reports', 'ShieldAlert', 30),
  ('manufacturing', 'shift_supervisor', 'shift_handover_briefs', 'Shift Handover Briefs', 'Structuring shift notes into consistent handover documentation', 'Users', 40),
  ('manufacturing', 'production_planner', 'capacity_planning_docs', 'Capacity Planning Documentation', 'Turning throughput data into schedule optimization proposals', 'Boxes', 50),
  ('manufacturing', 'maintenance_tech', 'work_order_drafting', 'Work Order Drafting', 'Structuring maintenance requests into standardized work orders', 'Settings', 60),
  ('manufacturing', 'reliability_engineer', 'failure_analysis_reports', 'Failure Analysis Reporting', 'Turning SCADA diagnostics into structured failure analysis reports', 'Activity', 70),
  ('education', 'teacher', 'lesson_plan_drafting', 'Lesson Plan Drafting', 'Drafting modular course outlines & activity ideas', 'BookOpen', 0),
  ('education', 'instructional_coach', 'pd_material_drafting', 'PD Material Drafting', 'Turning observation notes into professional development materials', 'GraduationCap', 10),
  ('education', 'academic_researcher', 'lit_review_drafting', 'Literature Review Drafting', 'Synthesizing academic sources into structured literature reviews', 'Microscope', 20),
  ('education', 'grad_assistant', 'citation_management', 'Citation Management', 'Organizing & formatting citations across research drafts', 'FileText', 30),
  ('education', 'registrar', 'enrollment_reporting', 'Enrollment Reporting', 'Structuring enrollment & transcript data into administrative reports', 'FileSpreadsheet', 40),
  ('education', 'dean', 'accreditation_drafting', 'Accreditation Drafting', 'Turning program data into accreditation submission narratives', 'Building', 50),
  ('education', 'curriculum_designer', 'syllabus_drafting', 'Syllabus Drafting', 'Structuring learning objectives into complete course syllabi', 'Layers', 60),
  ('education', 'instructional_designer', 'assessment_design', 'Assessment Design', 'Drafting rubrics & assessments aligned to learning outcomes', 'PenTool', 70),
  ('government', 'policy_analyst', 'legislative_brief_drafting', 'Legislative Brief Drafting', 'Turning bill text & testimony into concise legislative briefs', 'FileSpreadsheet', 0),
  ('government', 'legislative_aide', 'constituent_correspondence', 'Constituent Correspondence', 'Drafting responses to constituent inquiries at scale', 'FileText', 10),
  ('government', 'program_manager_gov', 'interagency_status_reports', 'Interagency Status Reporting', 'Structuring coordination notes into interagency status reports', 'FolderKanban', 20),
  ('government', 'procurement_officer', 'rfp_drafting', 'RFP Drafting', 'Turning sourcing requirements into structured RFP documents', 'FileCheck', 30),
  ('government', 'investigator', 'case_file_documentation', 'Case File Documentation', 'Structuring evidence & interview notes into case file summaries', 'Search', 40),
  ('government', 'compliance_auditor_gov', 'foia_response_drafting', 'FOIA Response Drafting', 'Structuring records review findings into FOIA response packets', 'ShieldCheck', 50),
  ('government', 'press_officer', 'press_release_drafting', 'Press Release Drafting', 'Turning agency updates into public-ready press releases', 'Megaphone', 60),
  ('government', 'public_affairs', 'engagement_material_drafting', 'Engagement Material Drafting', 'Structuring citizen engagement materials & briefing decks', 'Users', 70),
  ('legal', 'litigator', 'brief_drafting', 'Brief Drafting', 'Structuring case law research into court-ready briefs', 'Gavel', 0),
  ('legal', 'litigation_paralegal', 'discovery_review_summaries', 'Discovery Review Summaries', 'Summarizing discovery documents into exhibit-ready findings', 'FileText', 10),
  ('legal', 'transactional_attorney', 'contract_drafting', 'Contract Drafting', 'Turning deal terms into structured contract drafts', 'Briefcase', 20),
  ('legal', 'corp_paralegal', 'due_diligence_summaries', 'Due Diligence Summaries', 'Structuring document review findings into diligence summaries', 'CheckSquare', 30),
  ('legal', 'compliance_counsel', 'regulatory_filing_drafting', 'Regulatory Filing Drafting', 'Turning policy changes into structured regulatory filings', 'ShieldCheck', 40),
  ('legal', 'compliance_analyst_legal', 'audit_response_drafting_legal', 'Audit Response Drafting', 'Structuring compliance evidence into audit response packets', 'FileCheck', 50),
  ('legal', 'practice_manager', 'billing_narrative_drafting', 'Billing Narrative Drafting', 'Turning time entries into client-ready billing narratives', 'FileSpreadsheet', 60),
  ('legal', 'legal_secretary', 'correspondence_drafting_legal', 'Correspondence Drafting', 'Drafting routine client & court correspondence', 'Layers', 70),
  ('retail', 'merchandiser', 'assortment_plan_drafting', 'Assortment Plan Drafting', 'Turning sales data into structured assortment & pricing plans', 'Tag', 0),
  ('retail', 'buyer', 'vendor_negotiation_memos', 'Vendor Negotiation Memos', 'Structuring vendor terms & negotiation points into memos', 'ShoppingBag', 10),
  ('retail', 'store_manager', 'staffing_reports', 'Staffing & Inventory Reporting', 'Turning daily ops data into structured staffing reports', 'Store', 20),
  ('retail', 'loss_prevention', 'shrinkage_analysis_reports', 'Shrinkage Analysis Reporting', 'Structuring incident data into shrinkage analysis reports', 'ShieldAlert', 30),
  ('retail', 'ecommerce_manager', 'listing_copy_drafting', 'Product Listing Copy', 'Drafting SEO-ready product listing copy at scale', 'ShoppingBag', 40),
  ('retail', 'digital_marketer_retail', 'ad_copy_drafting', 'Ad Copy Drafting', 'Generating campaign ad copy variants from product briefs', 'Megaphone', 50),
  ('retail', 'cx_specialist', 'service_script_drafting', 'Service Script Drafting', 'Structuring resolution scripts from common complaint patterns', 'Smile', 60),
  ('retail', 'loyalty_manager', 'retention_analysis_reports', 'Retention Analysis Reporting', 'Turning loyalty program data into retention analysis reports', 'Heart', 70),
  ('energy', 'field_technician_energy', 'inspection_reporting', 'Inspection Reporting', 'Structuring field inspection notes into formal reports', 'Zap', 0),
  ('energy', 'site_supervisor', 'safety_walkthrough_docs', 'Safety Walkthrough Documentation', 'Turning walkthrough notes into structured safety documentation', 'ShieldAlert', 10),
  ('energy', 'reservoir_engineer', 'reservoir_modeling_reports', 'Reservoir Modeling Reports', 'Structuring modeling output into technical reservoir reports', 'Cpu', 20),
  ('energy', 'grid_engineer', 'load_analysis_docs', 'Load Analysis Documentation', 'Turning grid telemetry into structured load analysis reports', 'Activity', 30),
  ('energy', 'environmental_specialist', 'emissions_reporting', 'Emissions Reporting', 'Structuring monitoring data into regulatory emissions reports', 'ShieldCheck', 40),
  ('energy', 'regulatory_affairs_energy', 'permit_application_drafting', 'Permit Application Drafting', 'Turning project specs into structured permit applications', 'FileCheck', 50),
  ('energy', 'energy_trader', 'market_analysis_drafting', 'Market Analysis Drafting', 'Structuring price movement data into trading desk analysis', 'LineChart', 60),
  ('energy', 'commercial_analyst_energy', 'hedging_strategy_docs', 'Hedging Strategy Documentation', 'Turning pricing models into structured hedging strategy memos', 'TrendingUp', 70),
  ('transportation', 'dispatcher', 'route_plan_drafting', 'Route Plan Drafting', 'Structuring load & route data into dispatch-ready plans', 'Truck', 0),
  ('transportation', 'logistics_coordinator', 'carrier_comm_drafting', 'Carrier Communication Drafting', 'Drafting shipment status updates for carriers & customers', 'FolderKanban', 10),
  ('transportation', 'fleet_manager', 'maintenance_log_reporting', 'Maintenance Log Reporting', 'Structuring vehicle service records into fleet maintenance reports', 'Settings', 20),
  ('transportation', 'fleet_analyst', 'utilization_reporting', 'Utilization Reporting', 'Turning telemetry data into fleet utilization analysis', 'BarChart2', 30),
  ('transportation', 'safety_officer_transport', 'dot_audit_prep', 'DOT Audit Prep Documentation', 'Structuring incident & inspection records for DOT audit readiness', 'ShieldAlert', 40),
  ('transportation', 'compliance_specialist_transport', 'hazmat_documentation', 'Hazmat Documentation', 'Structuring shipment records into compliant hazmat documentation', 'FileCheck', 50),
  ('transportation', 'freight_coordinator', 'shipment_tracking_updates', 'Shipment Tracking Updates', 'Drafting customer-facing shipment status communications', 'FileText', 60),
  ('transportation', 'claims_specialist', 'claims_resolution_drafting', 'Claims Resolution Drafting', 'Structuring claim evidence into resolution correspondence', 'FileCheck', 70),
  ('agriculture', 'farm_manager', 'yield_reporting', 'Yield Reporting', 'Structuring harvest data into seasonal yield reports', 'Sprout', 0),
  ('agriculture', 'field_technician_ag', 'irrigation_log_reporting', 'Irrigation Log Reporting', 'Turning field sensor data into irrigation record summaries', 'Activity', 10),
  ('agriculture', 'herd_manager', 'herd_health_reporting', 'Herd Health Reporting', 'Structuring health & breeding records into herd status reports', 'Heart', 20),
  ('agriculture', 'livestock_technician', 'vet_visit_summaries', 'Vet Visit Summaries', 'Turning veterinary notes into structured health record entries', 'Stethoscope', 30),
  ('agriculture', 'agronomist', 'field_trial_reporting', 'Field Trial Reporting', 'Structuring trial data into agronomic research reports', 'Microscope', 40),
  ('agriculture', 'research_technician_ag', 'data_collection_logs', 'Data Collection Logs', 'Structuring raw field data into organized research lab notes', 'FileText', 50),
  ('agriculture', 'commodity_trader', 'contract_structuring_docs', 'Contract Structuring Documentation', 'Turning market data into structured commodity contract terms', 'TrendingUp', 60),
  ('agriculture', 'logistics_manager_ag', 'storage_transport_planning', 'Storage & Transport Planning', 'Structuring logistics data into storage & transport coordination plans', 'Boxes', 70),
  ('nonprofit', 'program_manager_np', 'outcome_reporting', 'Outcome Reporting', 'Turning case data into program outcome reports for funders', 'Heart', 0),
  ('nonprofit', 'case_worker', 'intake_documentation', 'Intake Documentation', 'Structuring client intake interviews into service plan documentation', 'FileText', 10),
  ('nonprofit', 'development_director', 'donor_proposal_drafting', 'Donor Proposal Drafting', 'Turning cultivation notes into tailored donor proposals', 'Users', 20),
  ('nonprofit', 'grant_writer', 'grant_application_drafting', 'Grant Application Drafting', 'Structuring program data into competitive grant applications', 'PenTool', 30),
  ('nonprofit', 'finance_manager_np', 'budget_reporting', 'Budget Reporting', 'Turning expense data into board-ready budget reports', 'FileSpreadsheet', 40),
  ('nonprofit', 'grants_accountant', 'compliance_tracking_docs', 'Grant Compliance Tracking', 'Structuring expense records into grant compliance documentation', 'FileCheck', 50),
  ('nonprofit', 'comms_manager_np', 'newsletter_drafting', 'Newsletter Drafting', 'Turning program updates into donor & community newsletters', 'Megaphone', 60),
  ('nonprofit', 'outreach_coordinator', 'engagement_content_drafting', 'Engagement Content Drafting', 'Drafting social & community outreach content from program stories', 'Users', 70),
  ('other', 'executive', 'board_memo_drafting', 'Board Memo Drafting', 'Structuring strategic updates into board-ready memos', 'Crown', 0),
  ('other', 'strategy_lead', 'roadmap_drafting', 'Roadmap Drafting', 'Turning strategic priorities into structured initiative roadmaps', 'Target', 10),
  ('other', 'project_manager_other', 'status_report_drafting', 'Status Report Drafting', 'Structuring project updates into consistent status reports', 'FolderKanban', 20),
  ('other', 'ops_coordinator', 'process_doc_drafting', 'Process Documentation', 'Turning workflow notes into structured process documentation', 'Boxes', 30),
  ('other', 'analyst_other', 'research_synthesis_other', 'Research Synthesis', 'Condensing research findings into structured briefing reports', 'BarChart', 40),
  ('other', 'knowledge_manager', 'kb_article_drafting_other', 'Knowledge Base Drafting', 'Turning tribal knowledge into searchable KB articles', 'BookOpen', 50),
  ('other', 'account_manager', 'account_plan_drafting', 'Account Plan Drafting', 'Structuring client history into strategic account plans', 'Briefcase', 60),
  ('other', 'relationship_manager', 'stakeholder_update_drafting', 'Stakeholder Update Drafting', 'Turning project status into stakeholder-ready communications', 'Users', 70),
  ('default', 'exec_leader', 'strategic_memo_drafting', 'Strategic Memo Drafting', 'Turning leadership priorities into org-wide strategic memos', 'Crown', 0),
  ('default', 'knowledge_worker', 'doc_synthesis_default', 'Document Synthesis', 'Condensing cross-functional documents into shareable summaries', 'FileText', 10),
  ('default', 'ops_lead', 'process_doc_default', 'Process Documentation', 'Turning operational notes into structured process documentation', 'Settings', 20),
  ('default', 'support_spec', 'ticket_response_drafting', 'Ticket Response Drafting', 'Drafting consistent, accurate responses to support requests', 'LifeBuoy', 30)
ON CONFLICT ("industry", "persona_key", "use_case_key") DO NOTHING;

INSERT INTO "quiz_outcomes" ("industry", "persona_key", "outcome_key", "title", "description", "icon_name", "sort_order") VALUES
  ('space', '*', 'res_accel', 'Research Acceleration', 'Compressing literature reviews & mission feasibility calculations from months to days', 'Rocket', 0),
  ('space', '*', 'mission_safety', 'Mission Safety', 'Eliminating human error in complex checklists & flight procedure documentation', 'ShieldCheck', 10),
  ('space', '*', 'doc_quality', 'Documentation Quality', 'Standardizing engineering specs & anomaly reporting across global sites', 'FileText', 20),
  ('space', '*', 'eng_accuracy', 'Engineering Accuracy', 'Verifying mathematical precision & systems telemetry alignment', 'Target', 30),
  ('healthcare', '*', 'care_quality', 'Care Quality & Patient Time', 'Reducing EHR clerical burden so clinicians spend more face-to-face time with patients', 'Heart', 0),
  ('healthcare', '*', 'compliance', 'Strict HIPAA Compliance', 'Ensuring zero patient data leaks while automating care notes & insurance forms', 'ShieldCheck', 10),
  ('healthcare', '*', 'efficiency', 'Operational Efficiency', 'Accelerating shift handovers, lab summaries & discharge processing', 'Zap', 20),
  ('finance', '*', 'risk_reduction', 'Risk & Error Reduction', 'Minimizing manual copy-paste errors in compliance reports & valuation models', 'ShieldAlert', 0),
  ('finance', '*', 'accuracy', 'Analytical Accuracy', 'Standardizing financial disclosures, earnings notes & audit trails', 'Target', 10),
  ('finance', '*', 'speed', 'Market Speed & Alpha', 'Synthesizing market movements instantly to act ahead of competitors', 'TrendingUp', 20),
  ('default', '*', 'dev_velocity', 'Productivity & Time Saved', 'Recovering 4–6 hours per week per employee from administrative tasks', 'Clock', 0),
  ('default', '*', 'error_red', 'Quality & Error Reduction', 'Improving output consistency, grammar, formatting & technical accuracy', 'CheckCircle2', 10),
  ('default', '*', 'time_to_mkt', 'Speed-to-Market', 'Accelerating RFP turnarounds, software releases & customer response times', 'Zap', 20)
ON CONFLICT ("industry", "persona_key", "outcome_key") DO NOTHING;


-- ── Verification — run after applying ────────────────────────────────────────
--
-- 1. Expect exactly: clusters 60, personas 122, use_cases 122, outcomes 13.
-- SELECT 'clusters' AS level, count(*) FROM "quiz_persona_clusters"
-- UNION ALL SELECT 'personas',  count(*) FROM "quiz_personas"
-- UNION ALL SELECT 'use_cases', count(*) FROM "quiz_use_cases"
-- UNION ALL SELECT 'outcomes',  count(*) FROM "quiz_outcomes";
--
-- 2. Expect 15 industry keys at the first three levels (14 real industries plus
--    'default'), and 4 at outcomes (space/healthcare/finance/default):
-- SELECT count(DISTINCT industry) FROM "quiz_persona_clusters";
-- SELECT count(DISTINCT industry) FROM "quiz_outcomes";
--
-- 3. Re-run the orphan checks from the table-creation file. Expect 0 rows from
--    each — this migration was generated with those joins already satisfied.
--
-- 4. Spot-check one industry end to end against the live wizard (the issue asks
--    for healthcare specifically):
-- SELECT c.title AS cluster, p.title AS persona, u.title AS use_case
--   FROM "quiz_persona_clusters" c
--   JOIN "quiz_personas" p  ON p.industry = c.industry AND p.cluster_key = c.cluster_key
--   LEFT JOIN "quiz_use_cases" u ON u.industry = p.industry AND u.persona_key = p.persona_key
--  WHERE c.industry = 'healthcare'
--  ORDER BY c.sort_order, p.sort_order, u.sort_order;


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-quiz-catalog-migrate-existing-271.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
