import React from 'react';

export interface QuizOptionTile {
  id: string;
  title: string;
  description: string;
  iconName: string;
  badge?: string;
  clusterId?: string; // Optional linking to cluster
}

export interface QuizStepDefinition {
  id: string;
  stepNumber: number;
  navLabel: string;
  title: string;
  description: string;
  hint: string;
  isMultiSelect?: boolean;
}

export const QUIZ_NAV_ITEMS = [
  { id: 'about-you', label: 'About You', stepNumber: 1, isMultiSelect: false },
  { id: 'industry', label: 'Industry', stepNumber: 2, isMultiSelect: false },
  { id: 'clusters', label: 'Persona Clusters', stepNumber: 3, isMultiSelect: true },
  { id: 'personas', label: 'Personas', stepNumber: 4, isMultiSelect: true },
  { id: 'use-cases', label: 'Use Cases', stepNumber: 5, isMultiSelect: true },
  { id: 'sensitivity', label: 'Data Sensitivity', stepNumber: 6, isMultiSelect: true },
  { id: 'collaboration', label: 'Collaboration Pattern', stepNumber: 7, isMultiSelect: true },
  { id: 'ai-comfort', label: 'AI Comfort', stepNumber: 8, isMultiSelect: false },
  { id: 'workflow', label: 'Workflow Structure', stepNumber: 9, isMultiSelect: false },
  { id: 'adoption-speed', label: 'Adoption Speed', stepNumber: 10, isMultiSelect: false },
  { id: 'outcomes', label: 'Outcome Priorities', stepNumber: 11, isMultiSelect: true },
  { id: 'change-mgmt', label: 'Change Management', stepNumber: 12, isMultiSelect: false },
  { id: 'review', label: 'Review', stepNumber: 13, isMultiSelect: false },
];

export const INDUSTRY_OPTIONS: QuizOptionTile[] = [
  { id: 'space', title: 'Space / Aerospace', description: 'Orbital systems, satellite telemetry, defense & space research', iconName: 'Rocket' },
  { id: 'healthcare', title: 'Healthcare', description: 'Clinical care, EHR systems, medical research & health ops', iconName: 'HeartPulse' },
  { id: 'finance', title: 'Finance', description: 'Investment banking, wealth management, SEC/SOX compliance', iconName: 'Landmark' },
  { id: 'manufacturing', title: 'Manufacturing', description: 'Plant operations, OT security, supply chain & quality control', iconName: 'Factory' },
  { id: 'education', title: 'Education', description: 'Academic research, K-12/higher ed administration, curriculum', iconName: 'GraduationCap' },
  { id: 'government', title: 'Government', description: 'Public sector, municipal operations, policy & defense', iconName: 'Building2' },
  { id: 'legal', title: 'Legal', description: 'Corporate counsel, law firms, contract redlining & litigation', iconName: 'Scale' },
  { id: 'retail', title: 'Retail', description: 'E-commerce, store ops, merchandising & customer experience', iconName: 'ShoppingBag' },
  { id: 'technology', title: 'Technology', description: 'Software engineering, SaaS products, DevOps & IT service', iconName: 'Code' },
  { id: 'energy', title: 'Energy', description: 'Renewables, utility grids, oil & gas exploration, field ops', iconName: 'Zap' },
  { id: 'transportation', title: 'Transportation', description: 'Logistics, fleet management, aviation & supply routes', iconName: 'Truck' },
  { id: 'agriculture', title: 'Agriculture', description: 'Agronomy, smart farming, yield telemetry & food supply', iconName: 'Sprout' },
  { id: 'nonprofit', title: 'Nonprofit', description: 'Donor relations, grant management, community outreach', iconName: 'Heart' },
  { id: 'other', title: 'Other (Custom Personas)', description: 'Custom enterprise profile, cross-industry matrix', iconName: 'Sparkles' },
];

// ADAPTIVE PERSONA CLUSTERS CATALOG
export const ADAPTIVE_CLUSTERS: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'science_research', title: 'Science & Research', description: 'Astrophysical study, orbital mechanics & propulsion research', iconName: 'Atom' },
    { id: 'mission_ops', title: 'Mission Operations', description: 'Flight command, mission control & satellite telemetry ops', iconName: 'Compass' },
    { id: 'engineering', title: 'Engineering', description: 'Payload, hardware systems, CAD modeling & safety testing', iconName: 'Cpu' },
    { id: 'prog_admin', title: 'Program & Administration', description: 'Agency compliance, inter-governmental liaison & program management', iconName: 'Briefcase' },
  ],
  healthcare: [
    { id: 'clinical_care', title: 'Clinical Care', description: 'Direct patient interaction, diagnosis, therapy & EHR charting', iconName: 'Stethoscope' },
    { id: 'research_lab', title: 'Research & Lab', description: 'Genomics, clinical trial analysis & pharmaceutical research', iconName: 'Microscope' },
    { id: 'compliance_policy', title: 'Compliance & Policy', description: 'HIPAA auditing, medical writing & regulatory governance', iconName: 'ShieldCheck' },
    { id: 'administration', title: 'Administration', description: 'Hospital operations, billing, insurance & facility scheduling', iconName: 'Building2' },
  ],
  finance: [
    { id: 'front_office', title: 'Front Office', description: 'Investment banking, trading desks & portfolio management', iconName: 'TrendingUp' },
    { id: 'risk_compliance', title: 'Risk & Compliance', description: 'SOX auditing, risk modeling & trade monitoring', iconName: 'ShieldAlert' },
    { id: 'research_analysis', title: 'Research & Analysis', description: 'Quantitative modeling, market research & equity analysis', iconName: 'BarChart' },
    { id: 'operations', title: 'Operations', description: 'Settlement, treasury operations & client services', iconName: 'Briefcase' },
  ],
  manufacturing: [
    { id: 'engineering', title: 'Engineering', description: 'CAD designs, plant automation & robotics maintenance', iconName: 'Wrench' },
    { id: 'quality_safety', title: 'Quality & Safety', description: 'EHS compliance, ISO audits & defect root cause analysis', iconName: 'Shield' },
    { id: 'production', title: 'Production', description: 'Shop floor management, shift scheduling & throughput', iconName: 'Boxes' },
    { id: 'maintenance', title: 'Maintenance', description: 'SCADA telemetry diagnostics & preventive overhaul logs', iconName: 'Settings' },
  ],
  education: [
    { id: 'instruction', title: 'Instruction', description: 'K-12 & higher-ed teaching, grading & student engagement', iconName: 'BookOpen' },
    { id: 'research', title: 'Research', description: 'Academic publishing, grant application & peer review', iconName: 'GraduationCap' },
    { id: 'administration', title: 'Administration', description: 'Institutional governance, accreditation & student admissions', iconName: 'Building' },
    { id: 'curriculum', title: 'Curriculum', description: 'Syllabus design, learning outcome mapping & pedagogical standards', iconName: 'Layers' },
  ],
  government: [
    { id: 'policy_analysis', title: 'Policy & Analysis', description: 'Legislative analysis, policy drafting & public comments', iconName: 'FileSpreadsheet' },
    { id: 'operations', title: 'Operations', description: 'Agency administration, inter-department coordination & service delivery', iconName: 'FolderKanban' },
    { id: 'investigation', title: 'Investigation', description: 'Regulatory audits, case file analysis & FOIA processing', iconName: 'Search' },
    { id: 'communications', title: 'Communications', description: 'Public press releases, citizen engagement & agency briefings', iconName: 'Megaphone' },
  ],
  technology: [
    { id: 'engineering', title: 'Engineering', description: 'Software development, DevOps, cloud infra & data engineering', iconName: 'Code' },
    { id: 'product', title: 'Product', description: 'Product management, roadmap planning & feature spec drafting', iconName: 'Target' },
    { id: 'design', title: 'Design', description: 'UX research, UI prototyping & design system management', iconName: 'Palette' },
    { id: 'support', title: 'Support', description: 'Technical customer support, KB documentation & incident retros', iconName: 'LifeBuoy' },
  ],
  legal: [
    { id: 'litigation', title: 'Litigation', description: 'Courtroom prep, discovery review & brief drafting', iconName: 'Gavel' },
    { id: 'corporate_transactional', title: 'Corporate & Transactional', description: 'Contract drafting, M&A due diligence & deal structuring', iconName: 'Briefcase' },
    { id: 'legal_compliance', title: 'Compliance & Regulatory', description: 'Regulatory filings, policy review & audit response', iconName: 'ShieldCheck' },
    { id: 'practice_mgmt', title: 'Practice Management', description: 'Billing, client intake & matter administration', iconName: 'FileSpreadsheet' },
  ],
  retail: [
    { id: 'merchandising', title: 'Merchandising', description: 'Assortment planning, pricing strategy & vendor negotiations', iconName: 'Tag' },
    { id: 'store_ops', title: 'Store Operations', description: 'Staffing, inventory counts & loss prevention', iconName: 'Store' },
    { id: 'ecommerce', title: 'E-Commerce', description: 'Product listings, digital marketing & fulfillment ops', iconName: 'ShoppingBag' },
    { id: 'customer_experience', title: 'Customer Experience', description: 'Service scripts, loyalty programs & returns handling', iconName: 'Smile' },
  ],
  energy: [
    { id: 'field_ops', title: 'Field Operations', description: 'Well/rig site inspections, pipeline monitoring & safety walkthroughs', iconName: 'Zap' },
    { id: 'engineering_technical', title: 'Engineering & Technical', description: 'Reservoir modeling, grid load analysis & turbine specs', iconName: 'Cpu' },
    { id: 'regulatory_environmental', title: 'Regulatory & Environmental', description: 'Permitting, emissions reporting & compliance audits', iconName: 'ShieldCheck' },
    { id: 'trading_commercial', title: 'Trading & Commercial', description: 'Contract structuring, market analysis & hedging strategy', iconName: 'LineChart' },
  ],
  transportation: [
    { id: 'logistics_dispatch', title: 'Logistics & Dispatch', description: 'Route planning, load scheduling & carrier coordination', iconName: 'Truck' },
    { id: 'fleet_ops', title: 'Fleet Operations', description: 'Maintenance logs, driver compliance & vehicle telemetry', iconName: 'Activity' },
    { id: 'transport_safety', title: 'Safety & Compliance', description: 'DOT audits, incident reports & hazmat documentation', iconName: 'ShieldAlert' },
    { id: 'freight_services', title: 'Customer & Freight Services', description: 'Shipment tracking, billing & claims resolution', iconName: 'FileText' },
  ],
  agriculture: [
    { id: 'field_crop_ops', title: 'Field & Crop Operations', description: 'Planting schedules, yield tracking & soil analysis', iconName: 'Sprout' },
    { id: 'livestock_mgmt', title: 'Livestock & Herd Management', description: 'Health records, breeding logs & feed planning', iconName: 'Heart' },
    { id: 'agronomy_research', title: 'Agronomy & Research', description: 'Field trials, pest/disease analysis & seed research', iconName: 'Microscope' },
    { id: 'ag_supply_chain', title: 'Supply Chain & Trading', description: 'Commodity contracts, storage logistics & market pricing', iconName: 'TrendingUp' },
  ],
  nonprofit: [
    { id: 'programs_services', title: 'Programs & Services', description: 'Beneficiary case management, program reporting & outcome tracking', iconName: 'Heart' },
    { id: 'development_fundraising', title: 'Development & Fundraising', description: 'Donor cultivation, grant writing & campaign planning', iconName: 'Users' },
    { id: 'nonprofit_finance', title: 'Finance & Compliance', description: '990 filings, grant compliance & budget reporting', iconName: 'FileCheck' },
    { id: 'comms_outreach', title: 'Communications & Outreach', description: 'Newsletters, social campaigns & community engagement', iconName: 'Megaphone' },
  ],
  other: [
    { id: 'leadership_strategy', title: 'Leadership & Strategy', description: 'Org planning, board reporting & strategic initiatives', iconName: 'Crown' },
    { id: 'ops_delivery', title: 'Operations & Delivery', description: 'Project execution, process management & vendor coordination', iconName: 'Boxes' },
    { id: 'knowledge_analysis', title: 'Knowledge & Analysis', description: 'Research synthesis, reporting & documentation', iconName: 'FileText' },
    { id: 'client_relations', title: 'Client & Stakeholder Relations', description: 'Account management, communications & service delivery', iconName: 'Users' },
  ],
  default: [
    { id: 'exec_strategy', title: 'Executive & Strategy', description: 'Organizational leadership, strategic planning & board reporting', iconName: 'Crown' },
    { id: 'tech_ops', title: 'Technical Operations', description: 'System administration, security engineering & IT support', iconName: 'Cpu' },
    { id: 'gen_knowledge', title: 'General Knowledge', description: 'Cross-functional document creation, synthesis & daily collaboration', iconName: 'Briefcase' },
    { id: 'support_services', title: 'Support & Services', description: 'Customer service, vendor management & internal helpdesk', iconName: 'Users' },
  ]
};

// ADAPTIVE CLUSTERED PERSONAS CATALOG
export const ADAPTIVE_PERSONAS: Record<string, QuizOptionTile[]> = {
  space: [
    // Science & Research
    { id: 'scientist', title: 'Scientist', description: 'Deep domain research, astrophysical calculations & paper synthesis', iconName: 'Atom', clusterId: 'science_research' },
    { id: 'research_analyst', title: 'Research Analyst', description: 'Literature reviews, grant proposals & data collection', iconName: 'FileText', clusterId: 'science_research' },
    { id: 'data_scientist', title: 'Data Scientist', description: 'Telemetry analysis, neural net modeling & sensor analytics', iconName: 'BarChart2', clusterId: 'science_research' },
    { id: 'lab_specialist', title: 'Lab Specialist', description: 'Cleanroom instrument testing & material sample analysis', iconName: 'Microscope', clusterId: 'science_research' },

    // Mission Operations
    { id: 'mission_spec', title: 'Mission Specialist', description: 'Real-time telemetry analysis, flight procedures & payload prep', iconName: 'Compass', clusterId: 'mission_ops' },
    { id: 'flight_dir', title: 'Flight Director', description: 'Command center oversight, contingency protocol execution', iconName: 'Radio', clusterId: 'mission_ops' },
    { id: 'ops_controller', title: 'Operations Controller', description: 'Orbital trajectory adjustments & comms link monitoring', iconName: 'Activity', clusterId: 'mission_ops' },
    { id: 'flight_surgeon', title: 'Flight Surgeon', description: 'Crew physiological monitoring & bio-telemetry review', iconName: 'HeartPulse', clusterId: 'mission_ops' },

    // Engineering
    { id: 'payload_eng', title: 'Payload Engineer', description: 'Instrument calibration, hardware integration & CAD specs', iconName: 'Cpu', clusterId: 'engineering' },
    { id: 'systems_eng', title: 'Systems Engineer', description: 'Subsystem integration, thermal & power budget validation', iconName: 'Layers', clusterId: 'engineering' },
    { id: 'safety_eng', title: 'Safety Engineer', description: 'Fault tree analysis, hazard identification & fail-safe testing', iconName: 'ShieldAlert', clusterId: 'engineering' },
    { id: 'requirements_eng', title: 'Requirements Engineer', description: 'NASA/ESA specification verification & traceability matrices', iconName: 'CheckSquare', clusterId: 'engineering' },

    // Program & Administration
    { id: 'prog_mgr', title: 'Program Manager', description: 'Schedule alignment, agency compliance & multi-contractor budgets', iconName: 'Briefcase', clusterId: 'prog_admin' },
    { id: 'comms_spec', title: 'Communications Specialist', description: 'Public mission briefings & inter-departmental newsletters', iconName: 'Megaphone', clusterId: 'prog_admin' },
    { id: 'policy_analyst', title: 'Policy Analyst', description: 'Space law, ITAR regulatory compliance & export control governance', iconName: 'Scale', clusterId: 'prog_admin' },
  ],
  healthcare: [
    // Clinical Care
    { id: 'clinician', title: 'Clinician', description: 'Direct patient care, EHR clinical notes & diagnosis review', iconName: 'Stethoscope', clusterId: 'clinical_care' },
    { id: 'nurse', title: 'Nurse', description: 'Patient intake, shift handover summaries & care protocols', iconName: 'Heart', clusterId: 'clinical_care' },
    { id: 'care_coord', title: 'Care Coordinator', description: 'Discharge planning, specialist referrals & patient follow-ups', iconName: 'Users', clusterId: 'clinical_care' },

    // Research & Lab
    { id: 'med_researcher', title: 'Medical Researcher', description: 'Clinical trials, journal literature synthesis & lab telemetry', iconName: 'Microscope', clusterId: 'research_lab' },
    { id: 'lab_tech', title: 'Lab Technician', description: 'Pathology diagnostic logging, assay testing & sample processing', iconName: 'Atom', clusterId: 'research_lab' },

    // Compliance & Policy
    { id: 'compliance_officer', title: 'Compliance Officer', description: 'HIPAA auditing, patient privacy guardrails & policy review', iconName: 'ShieldCheck', clusterId: 'compliance_policy' },
    { id: 'medical_writer', title: 'Medical Writer', description: 'Regulatory submission dossiers, IRB protocols & consent forms', iconName: 'FileText', clusterId: 'compliance_policy' },

    // Administration
    { id: 'admin', title: 'Administrator', description: 'Facility operations, insurance billing & staff scheduling', iconName: 'Building2', clusterId: 'administration' },
  ],
  finance: [
    // Front Office
    { id: 'analyst', title: 'Analyst', description: 'Financial modeling, earnings call summaries & valuation', iconName: 'BarChart', clusterId: 'front_office' },
    { id: 'trader', title: 'Trader', description: 'Market news synthesis, execution reports & order flow', iconName: 'TrendingUp', clusterId: 'front_office' },
    { id: 'portfolio_mgr', title: 'Portfolio Manager', description: 'Asset allocation strategy, investor updates & risk reviews', iconName: 'Briefcase', clusterId: 'front_office' },

    // Risk & Compliance
    { id: 'risk_officer', title: 'Risk Officer', description: 'Stress testing, SOX/SEC compliance & exposure modeling', iconName: 'ShieldAlert', clusterId: 'risk_compliance' },
    { id: 'compliance', title: 'Compliance Officer', description: 'Trade monitoring, regulatory filings & KYC/AML audits', iconName: 'FileCheck', clusterId: 'risk_compliance' },
    { id: 'auditor', title: 'Internal Auditor', description: 'Financial statement auditing, control testing & ledger reviews', iconName: 'CheckSquare', clusterId: 'risk_compliance' },

    // Research & Analysis
    { id: 'quant_researcher', title: 'Quantitative Researcher', description: 'Algorithmic strategy formulation, backtesting & market data math', iconName: 'Cpu', clusterId: 'research_analysis' },
    { id: 'market_researcher', title: 'Market Researcher', description: 'Industry trend synthesis, competitive analysis & macroeconomic notes', iconName: 'LineChart', clusterId: 'research_analysis' },

    // Operations
    { id: 'ops_specialist', title: 'Operations Specialist', description: 'Trade settlement reconciliation, client onboarding & wire processing', iconName: 'Settings', clusterId: 'operations' },
  ],
  technology: [
    // Engineering
    { id: 'dev', title: 'Developer', description: 'Code drafting, PR reviews, documentation & API integration', iconName: 'Code', clusterId: 'engineering' },
    { id: 'devops', title: 'DevOps Engineer', description: 'CI/CD pipeline scripts, Terraform configs & cluster telemetry', iconName: 'Cpu', clusterId: 'engineering' },
    { id: 'data_scientist', title: 'Data Scientist', description: 'ML model training, data pipeline engineering & analytics', iconName: 'BarChart2', clusterId: 'engineering' },

    // Product
    { id: 'pm', title: 'Product Manager', description: 'PRD writing, user story synthesis & sprint prioritization', iconName: 'Target', clusterId: 'product' },

    // Design
    { id: 'designer', title: 'Designer', description: 'UX research synthesis, design system guidelines & specs', iconName: 'Palette', clusterId: 'design' },

    // Support
    { id: 'support_eng', title: 'Support Engineer', description: 'Ticket triage, KB article generation & incident retros', iconName: 'LifeBuoy', clusterId: 'support' },
  ],
  default: [
    { id: 'exec_leader', title: 'Executive Leader', description: 'Strategic planning, board presentations & org-wide memos', iconName: 'Crown', clusterId: 'exec_strategy' },
    { id: 'knowledge_worker', title: 'Knowledge Worker', description: 'Daily M365 document synthesis, email & meeting catchup', iconName: 'Briefcase', clusterId: 'gen_knowledge' },
    { id: 'ops_lead', title: 'Operations Lead', description: 'Process optimization, team coordination & SOP maintenance', iconName: 'Settings', clusterId: 'tech_ops' },
    { id: 'support_spec', title: 'Support Specialist', description: 'Internal ticket resolution & knowledge base authoring', iconName: 'LifeBuoy', clusterId: 'support_services' },
  ]
};

// ADAPTIVE USE-CASES CATALOG
export const ADAPTIVE_USE_CASES: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'res_sum', title: 'Research Summarization', description: 'Synthesizing multi-disciplinary aerospace papers & mission reports', iconName: 'FileText' },
    { id: 'tech_write', title: 'Technical Writing', description: 'Drafting flight manual procedures & hardware specification sheets', iconName: 'PenTool' },
    { id: 'mission_log', title: 'Mission Log Synthesis', description: 'Extracting key anomalies & event sequences from flight telemetry', iconName: 'Radio' },
    { id: 'eng_doc', title: 'Engineering Documentation', description: 'Standardizing CAD/system change logs & safety reviews', iconName: 'Cpu' },
    { id: 'data_analysis', title: 'Data Analysis', description: 'Analyzing orbital sensor datasets & mission performance metrics', iconName: 'LineChart' },
    { id: 'safety_reporting', title: 'Safety Reporting', description: 'Generating fault tree incident reviews & anomaly mitigation plans', iconName: 'ShieldAlert' },
    { id: 'req_drafting', title: 'Requirements Drafting', description: 'Formulating NASA/ESA system verification criteria & verification matrices', iconName: 'CheckSquare' },
  ],
  healthcare: [
    { id: 'chart_sum', title: 'Chart Summarization', description: 'Extracting key clinical history from long patient EHR records', iconName: 'Stethoscope' },
    { id: 'care_plan', title: 'Care Plan Drafting', description: 'Generating standardized discharge instructions & care pathways', iconName: 'HeartPulse' },
    { id: 'med_res_synth', title: 'Research Synthesis', description: 'Aggregating clinical trial papers & treatment efficacy data', iconName: 'Microscope' },
    { id: 'policy_doc', title: 'Policy Documentation', description: 'Updating hospital SOPs to match new health authority guidelines', iconName: 'FileCheck' },
    { id: 'clinical_notes', title: 'Clinical Note Improvement', description: 'Polishing physician dictations for accuracy & billing compliance', iconName: 'FileText' },
  ],
  finance: [
    { id: 'market_sum', title: 'Market Summarization', description: 'Daily macroeconomic digest & Bloomberg feed synthesis', iconName: 'TrendingUp' },
    { id: 'report_draft', title: 'Report Drafting', description: 'Generating quarterly investor letters & portfolio performance notes', iconName: 'FileSpreadsheet' },
    { id: 'risk_model', title: 'Risk Modeling', description: 'Formulating credit & liquidity risk narratives for investment comms', iconName: 'ShieldAlert' },
    { id: 'fin_policy', title: 'Policy Writing', description: 'Drafting SEC disclosure responses & compliance checklists', iconName: 'Scale' },
    { id: 'compliance_doc', title: 'Compliance Documentation', description: 'Auditing trading logs, KYC disclosures & AML verification records', iconName: 'FileCheck' },
  ],
  manufacturing: [
    { id: 'safety_doc', title: 'Safety Documentation', description: 'Automating EHS incident summaries & OSHA reporting logs', iconName: 'Shield' },
    { id: 'qual_rep', title: 'Quality Reporting', description: 'Synthesizing non-conformance reports & supplier audit notes', iconName: 'CheckSquare' },
    { id: 'eng_notes', title: 'Engineering Notes', description: 'Transcribing maintenance audio notes into structured work orders', iconName: 'Wrench' },
    { id: 'proc_opt', title: 'Process Optimization', description: 'Analyzing assembly line bottleneck data & shift handover briefs', iconName: 'Boxes' },
    { id: 'maint_logs', title: 'Maintenance Logs', description: 'Aggregating SCADA machine error logs into diagnostic summaries', iconName: 'Settings' },
  ],
  education: [
    { id: 'lesson_plan', title: 'Lesson Planning', description: 'Drafting modular course outlines & interactive activity ideas', iconName: 'BookOpen' },
    { id: 'edu_res_sum', title: 'Research Summarization', description: 'Synthesizing academic literature for grant proposals', iconName: 'GraduationCap' },
    { id: 'student_feedback', title: 'Student Feedback', description: 'Drafting constructive essay rubrics & personalized notes', iconName: 'MessageSquare' },
    { id: 'curric_draft', title: 'Curriculum Drafting', description: 'Mapping learning objectives across department degree tracks', iconName: 'Layers' },
    { id: 'acad_reporting', title: 'Academic Reporting', description: 'Drafting university accreditation submissions & department evaluations', iconName: 'Building' },
  ],
  government: [
    { id: 'gov_policy', title: 'Policy Drafting', description: 'Writing policy whitepapers & public consultation memos', iconName: 'Building2' },
    { id: 'invest_sum', title: 'Investigation Summaries', description: 'Synthesizing witness transcripts & regulatory evidence files', iconName: 'Search' },
    { id: 'gov_compl', title: 'Compliance Documentation', description: 'Auditing FISMA/FedRAMP controls & agency mandates', iconName: 'ShieldCheck' },
    { id: 'public_comm', title: 'Public Communication', description: 'Drafting accessible press releases & citizen service FAQs', iconName: 'Megaphone' },
    { id: 'briefing_creation', title: 'Briefing Creation', description: 'Summarizing inter-agency memos into concise executive briefs', iconName: 'FileSpreadsheet' },
  ],
  technology: [
    { id: 'coding_assist', title: 'Coding Assistance', description: 'Generating unit tests, refactoring code & debugging errors', iconName: 'Code' },
    { id: 'doc_draft', title: 'Documentation Drafting', description: 'Writing API reference guides, SDK docs & architecture specs', iconName: 'FileCode' },
    { id: 'ticket_sum', title: 'Ticket Summarization', description: 'Compressing long Jira/GitHub issue threads into action items', iconName: 'ListTodo' },
    { id: 'tech_data', title: 'Data Analysis', description: 'Parsing telemetry logs, user analytics & system latency metrics', iconName: 'BarChart2' },
    { id: 'release_notes', title: 'Release Notes', description: 'Automating customer-facing product updates from commit logs', iconName: 'Tag' },
  ],
  default: [
    { id: 'exec_brief', title: 'Executive Briefings', description: 'Condensing lengthy email threads & meeting recaps into briefs', iconName: 'Crown' },
    { id: 'doc_synthesis', title: 'Document Synthesis', description: 'Cross-referencing multiple PDFs, Word docs & PowerPoint decks', iconName: 'Layers' },
    { id: 'proposal_draft', title: 'Proposal Drafting', description: 'Accelerating RFP responses with prior institutional knowledge', iconName: 'FileText' },
    { id: 'workflow_auto', title: 'Workflow Automation', description: 'Automating routine status reports & team communications', iconName: 'Zap' },
  ]
};

export const ADAPTIVE_DATA_SENSITIVITY: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'classified', title: 'Classified / ITAR', description: 'Strict government export controls, defense classification & airgap requirements', iconName: 'Lock', badge: 'Strict' },
    { id: 'mission_crit', title: 'Mission-Critical', description: 'Telemetry, flight code & real-time operational safety data', iconName: 'ShieldAlert' },
    { id: 'res_sens', title: 'Research-Sensitive', description: 'Proprietary propulsion & material science patent research', iconName: 'EyeOff' },
    { id: 'low_sens', title: 'Low Sensitivity', description: 'Public mission releases, educational outreach & open telemetry', iconName: 'Globe' },
  ],
  healthcare: [
    { id: 'phi', title: 'Protected Health Info (PHI)', description: 'Direct patient clinical records, diagnostic imaging & genomic data', iconName: 'HeartPulse', badge: 'HIPAA' },
    { id: 'hipaa_reg', title: 'HIPAA-Regulated', description: 'Medical billing, clinical trial participant codes & pharmacy records', iconName: 'ShieldCheck' },
    { id: 'mixed_sens', title: 'Mixed Sensitivity', description: 'Hospital administrative policies, scheduling & internal staff comms', iconName: 'FileText' },
  ],
  finance: [
    { id: 'sec_reg', title: 'SEC-Regulated / MNPI', description: 'Material non-public information, insider financial results & deal terms', iconName: 'Landmark', badge: 'SOX/SEC' },
    { id: 'sox', title: 'SOX Compliant Data', description: 'Audited general ledgers, corporate tax filings & treasury records', iconName: 'FileSpreadsheet' },
    { id: 'high_sens', title: 'High Sensitivity PII', description: 'Customer bank account numbers, SSNs, credit scores & transaction logs', iconName: 'Lock' },
  ],
  default: [
    { id: 'cui_restricted', title: 'CUI / Highly Restricted', description: 'Strict compliance requirements, confidential IP, customer PII & trade secrets', iconName: 'Lock', badge: 'Restricted' },
    { id: 'confidential', title: 'Confidential Internal', description: 'Proprietary business strategies, unreleased products & internal financials', iconName: 'Shield' },
    { id: 'internal', title: 'Internal Only', description: 'Standard day-to-day employee collaboration, department wikis & SOPs', iconName: 'Building' },
    { id: 'low_public', title: 'Low / Public', description: 'Public press releases, published documentation & open web content', iconName: 'Globe' },
  ]
};

// ADAPTIVE COLLABORATION
export const ADAPTIVE_COLLABORATION: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'cross_mission', title: 'Cross-Mission Teams', description: 'Integrated flight controllers, payload engineers & launch teams', iconName: 'Rocket' },
    { id: 'cross_agency', title: 'Cross-Agency / Prime Contractors', description: 'Collaborating with NASA, ESA, SpaceX, Boeing & defense primes', iconName: 'Globe' },
    { id: 'internal_only', title: 'Internal Only / Airgapped', description: 'Restricted to isolated secure lab environments & internal staff', iconName: 'Shield' },
  ],
  healthcare: [
    { id: 'care_team', title: 'Care Team Level', description: 'Physicians, nurses, pharmacists & specialists sharing patient care notes', iconName: 'Stethoscope' },
    { id: 'department', title: 'Departmental Unit', description: 'Radiology, Cardiology, or Surgery department internal operations', iconName: 'Building' },
    { id: 'multi_facility', title: 'Multi-Facility Network', description: 'Health system-wide collaboration across hospitals & outpatient clinics', iconName: 'Network' },
  ],
  finance: [
    { id: 'desk_level', title: 'Desk / Team Level', description: 'Isolated trading desk or deal team with strict information barriers (Chinese walls)', iconName: 'Lock' },
    { id: 'firm_wide', title: 'Firm-Wide Enterprise', description: 'Cross-departmental collaboration across research, risk & client service', iconName: 'Building2' },
    { id: 'client_facing', title: 'Client-Facing / External', description: 'Sharing financial reports & advisory decks directly with external investors', iconName: 'Users' },
  ],
  default: [
    { id: 'cross_functional', title: 'Cross-Functional Teams', description: 'Project-based collaboration across product, sales, legal & engineering', iconName: 'Users' },
    { id: 'enterprise_wide', title: 'Enterprise-Wide Broad', description: 'Open organization-wide channels, company town halls & shared hubs', iconName: 'Globe' },
    { id: 'external_partners', title: 'External Partners & Vendors', description: 'Frequent guest access, shared B2B extranets & customer portals', iconName: 'Share2' },
  ]
};

// UNIVERSAL QUESTIONS
export const UNIVERSAL_AI_COMFORT: QuizOptionTile[] = [
  { id: 'very_comfortable', title: 'Very Comfortable', description: 'Active power users of LLMs, enthusiastic about prompt engineering & agentic AI', iconName: 'Zap' },
  { id: 'somewhat_comfortable', title: 'Somewhat Comfortable', description: 'Familiar with AI tools (ChatGPT, M365 Copilot), comfortable with drafted output', iconName: 'Smile' },
  { id: 'neutral', title: 'Neutral', description: 'Open to AI assistance, but relies on standard review workflows before sending', iconName: 'Meh' },
  { id: 'cautious', title: 'Cautious', description: 'Prefers strict human-in-the-loop validation, concerned about accuracy & hallucination', iconName: 'ShieldAlert' },
  { id: 'not_comfortable', title: 'Not Comfortable', description: 'Skeptical or resistant to AI, requires extensive policy guardrails & proof', iconName: 'AlertTriangle' },
];

export const UNIVERSAL_WORKFLOW_STRUCTURE: QuizOptionTile[] = [
  { id: 'highly_structured', title: 'Highly Structured', description: 'Strict SOPs, rigid checklists, standardized forms & predictable daily cadences', iconName: 'CheckSquare' },
  { id: 'moderately_structured', title: 'Moderately Structured', description: 'Mix of repeatable processes & ad-hoc creative or problem-solving tasks', iconName: 'Layers' },
  { id: 'unstructured', title: 'Unstructured / Dynamic', description: 'Highly dynamic, unpredictable day-to-day work, rapid context switching', iconName: 'Activity' },
];

export const UNIVERSAL_ADOPTION_SPEED: QuizOptionTile[] = [
  { id: 'early_adopter', title: 'Early Adopter', description: 'Proactively seeks out new tech, tests beta builds, champions innovations', iconName: 'Sparkles' },
  { id: 'fast_follower', title: 'Fast Follower', description: 'Quickly adopts tools once colleagues demonstrate clear time savings', iconName: 'TrendingUp' },
  { id: 'average_adopter', title: 'Average Adopter', description: 'Follows official company rollout timelines and mandatory IT migration paths', iconName: 'Clock' },
  { id: 'slow_adopter', title: 'Slow Adopter', description: 'Hesitant to change established habits; requires formal training and coaching', iconName: 'Shield' },
];

export const ADAPTIVE_OUTCOME_PRIORITIES: Record<string, QuizOptionTile[]> = {
  space: [
    { id: 'res_accel', title: 'Research Acceleration', description: 'Compressing literature reviews & mission feasibility calculations from months to days', iconName: 'Rocket' },
    { id: 'mission_safety', title: 'Mission Safety', description: 'Eliminating human error in complex checklists & flight procedure documentation', iconName: 'ShieldCheck' },
    { id: 'doc_quality', title: 'Documentation Quality', description: 'Standardizing engineering specs & anomaly reporting across global sites', iconName: 'FileText' },
    { id: 'eng_accuracy', title: 'Engineering Accuracy', description: 'Verifying mathematical precision & systems telemetry alignment', iconName: 'Target' },
  ],
  healthcare: [
    { id: 'care_quality', title: 'Care Quality & Patient Time', description: 'Reducing EHR clerical burden so clinicians spend more face-to-face time with patients', iconName: 'Heart' },
    { id: 'compliance', title: 'Strict HIPAA Compliance', description: 'Ensuring zero patient data leaks while automating care notes & insurance forms', iconName: 'ShieldCheck' },
    { id: 'efficiency', title: 'Operational Efficiency', description: 'Accelerating shift handovers, lab summaries & discharge processing', iconName: 'Zap' },
  ],
  finance: [
    { id: 'risk_reduction', title: 'Risk & Error Reduction', description: 'Minimizing manual copy-paste errors in compliance reports & valuation models', iconName: 'ShieldAlert' },
    { id: 'accuracy', title: 'Analytical Accuracy', description: 'Standardizing financial disclosures, earnings notes & audit trails', iconName: 'Target' },
    { id: 'speed', title: 'Market Speed & Alpha', description: 'Synthesizing market movements instantly to act ahead of competitors', iconName: 'TrendingUp' },
  ],
  default: [
    { id: 'dev_velocity', title: 'Productivity & Time Saved', description: 'Recovering 4–6 hours per week per employee from administrative tasks', iconName: 'Clock' },
    { id: 'error_red', title: 'Quality & Error Reduction', description: 'Improving output consistency, grammar, formatting & technical accuracy', iconName: 'CheckCircle2' },
    { id: 'time_to_mkt', title: 'Speed-to-Market', description: 'Accelerating RFP turnarounds, software releases & customer response times', iconName: 'Zap' },
  ]
};

export const UNIVERSAL_CHANGE_MGMT: QuizOptionTile[] = [
  { id: 'minimal', title: 'Minimal Support Needed', description: 'Self-serve documentation, async video tutorials, and ad-hoc user discovery', iconName: 'Compass' },
  { id: 'moderate', title: 'Moderate Support Needed', description: 'Department champion network, weekly lunch-and-learns, and prompt libraries', iconName: 'Users' },
  { id: 'significant', title: 'Significant Support Needed', description: 'Dedicated change management team, mandatory hands-on workshops & 1-on-1 coaching', iconName: 'ShieldCheck' },
];

// Backward-compatible flat exports for telemetryCatalog.ts, which expects
// SENSITIVITY_OPTIONS/COLLABORATION_OPTIONS as flat { id, title } lookups
// rather than the industry-adaptive Record<string, QuizOptionTile[]> shape
// above. Union of every industry's options, deduped by id, so any id that
// could appear in a real quiz answer resolves to a real title.
function dedupeById(catalog: Record<string, QuizOptionTile[]>): QuizOptionTile[] {
  const seen = new Map<string, QuizOptionTile>();
  Object.values(catalog).flat().forEach(opt => {
    if (!seen.has(opt.id)) seen.set(opt.id, opt);
  });
  return Array.from(seen.values());
}

export const SENSITIVITY_OPTIONS: QuizOptionTile[] = dedupeById(ADAPTIVE_DATA_SENSITIVITY);
export const COLLABORATION_OPTIONS: QuizOptionTile[] = dedupeById(ADAPTIVE_COLLABORATION);
