import React from 'react';

export interface QuizOptionTile {
  id: string;
  title: string;
  description: string;
  iconName: string;
  badge?: string;
  clusterId?: string; // Optional linking to cluster
  personaId?: string; // Optional linking to persona (used by ADAPTIVE_USE_CASES)
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
  manufacturing: [
    // Engineering
    { id: 'process_engineer', title: 'Process Engineer', description: 'Process flow documentation, CAD drafting & line optimization notes', iconName: 'Wrench', clusterId: 'engineering' },
    { id: 'automation_engineer', title: 'Automation Engineer', description: 'PLC programming logic, robotics specs & controls documentation', iconName: 'Cpu', clusterId: 'engineering' },

    // Quality & Safety
    { id: 'qa_inspector', title: 'QA Inspector', description: 'Defect logs, non-conformance reports & ISO audit prep', iconName: 'CheckSquare', clusterId: 'quality_safety' },
    { id: 'ehs_specialist', title: 'EHS Specialist', description: 'Safety incident reports, compliance checklists & hazard assessments', iconName: 'ShieldAlert', clusterId: 'quality_safety' },

    // Production
    { id: 'shift_supervisor', title: 'Shift Supervisor', description: 'Shift handover notes, throughput reports & scheduling docs', iconName: 'Users', clusterId: 'production' },
    { id: 'production_planner', title: 'Production Planner', description: 'Schedule optimization, capacity planning & work order drafting', iconName: 'Boxes', clusterId: 'production' },

    // Maintenance
    { id: 'maintenance_tech', title: 'Maintenance Technician', description: 'Work order documentation, preventive maintenance schedules', iconName: 'Settings', clusterId: 'maintenance' },
    { id: 'reliability_engineer', title: 'Reliability Engineer', description: 'Failure analysis reports & SCADA telemetry diagnostics', iconName: 'Activity', clusterId: 'maintenance' },
  ],
  education: [
    // Instruction
    { id: 'teacher', title: 'Teacher', description: 'Lesson plans, grading rubrics & parent/guardian communication', iconName: 'BookOpen', clusterId: 'instruction' },
    { id: 'instructional_coach', title: 'Instructional Coach', description: 'Professional development materials & classroom observation notes', iconName: 'GraduationCap', clusterId: 'instruction' },

    // Research
    { id: 'academic_researcher', title: 'Academic Researcher', description: 'Literature reviews, grant proposals & peer review synthesis', iconName: 'Microscope', clusterId: 'research' },
    { id: 'grad_assistant', title: 'Graduate Assistant', description: 'Data collection support, citation management & lit summaries', iconName: 'FileText', clusterId: 'research' },

    // Administration
    { id: 'registrar', title: 'Registrar', description: 'Enrollment records, transcript processing & scheduling docs', iconName: 'FileSpreadsheet', clusterId: 'administration' },
    { id: 'dean', title: 'Dean', description: 'Accreditation reports, faculty memos & institutional governance docs', iconName: 'Building', clusterId: 'administration' },

    // Curriculum
    { id: 'curriculum_designer', title: 'Curriculum Designer', description: 'Syllabus drafting & learning outcome mapping', iconName: 'Layers', clusterId: 'curriculum' },
    { id: 'instructional_designer', title: 'Instructional Designer', description: 'Course content development & assessment design', iconName: 'PenTool', clusterId: 'curriculum' },
  ],
  government: [
    // Policy & Analysis
    { id: 'policy_analyst', title: 'Policy Analyst', description: 'Legislative briefs, impact assessments & public comment synthesis', iconName: 'FileSpreadsheet', clusterId: 'policy_analysis' },
    { id: 'legislative_aide', title: 'Legislative Aide', description: 'Constituent correspondence & bill summary drafting', iconName: 'FileText', clusterId: 'policy_analysis' },

    // Operations
    { id: 'program_manager_gov', title: 'Program Manager', description: 'Interagency coordination notes & service delivery reports', iconName: 'FolderKanban', clusterId: 'operations' },
    { id: 'procurement_officer', title: 'Procurement Officer', description: 'RFP drafting, vendor contracts & sourcing documentation', iconName: 'FileCheck', clusterId: 'operations' },

    // Investigation
    { id: 'investigator', title: 'Investigator', description: 'Case file documentation, evidence logs & interview summaries', iconName: 'Search', clusterId: 'investigation' },
    { id: 'compliance_auditor_gov', title: 'Compliance Auditor', description: 'Regulatory audits & FOIA response drafting', iconName: 'ShieldCheck', clusterId: 'investigation' },

    // Communications
    { id: 'press_officer', title: 'Press Officer', description: 'Press releases, public statements & media briefing prep', iconName: 'Megaphone', clusterId: 'communications' },
    { id: 'public_affairs', title: 'Public Affairs Specialist', description: 'Citizen engagement materials & agency briefing documents', iconName: 'Users', clusterId: 'communications' },
  ],
  legal: [
    // Litigation
    { id: 'litigator', title: 'Litigator', description: 'Brief drafting, deposition prep & case strategy memos', iconName: 'Gavel', clusterId: 'litigation' },
    { id: 'litigation_paralegal', title: 'Litigation Paralegal', description: 'Discovery review, exhibit organization & filing prep', iconName: 'FileText', clusterId: 'litigation' },

    // Corporate & Transactional
    { id: 'transactional_attorney', title: 'Transactional Attorney', description: 'Contract drafting, deal memos & term sheet review', iconName: 'Briefcase', clusterId: 'corporate_transactional' },
    { id: 'corp_paralegal', title: 'Corporate Paralegal', description: 'Due diligence review & closing checklist management', iconName: 'CheckSquare', clusterId: 'corporate_transactional' },

    // Compliance & Regulatory
    { id: 'compliance_counsel', title: 'Compliance Counsel', description: 'Regulatory filings, policy drafting & risk memos', iconName: 'ShieldCheck', clusterId: 'legal_compliance' },
    { id: 'compliance_analyst_legal', title: 'Compliance Analyst', description: 'Audit response prep & regulatory risk assessments', iconName: 'FileCheck', clusterId: 'legal_compliance' },

    // Practice Management
    { id: 'practice_manager', title: 'Practice Manager', description: 'Billing narratives, client intake docs & matter administration', iconName: 'FileSpreadsheet', clusterId: 'practice_mgmt' },
    { id: 'legal_secretary', title: 'Legal Secretary', description: 'Correspondence drafting & calendar/matter coordination', iconName: 'Layers', clusterId: 'practice_mgmt' },
  ],
  retail: [
    // Merchandising
    { id: 'merchandiser', title: 'Merchandiser', description: 'Assortment plans, pricing analysis & planogram documentation', iconName: 'Tag', clusterId: 'merchandising' },
    { id: 'buyer', title: 'Buyer', description: 'Vendor negotiation memos & purchase order documentation', iconName: 'ShoppingBag', clusterId: 'merchandising' },

    // Store Operations
    { id: 'store_manager', title: 'Store Manager', description: 'Staff scheduling, inventory reports & daily ops summaries', iconName: 'Store', clusterId: 'store_ops' },
    { id: 'loss_prevention', title: 'Loss Prevention Specialist', description: 'Incident reports & shrinkage analysis documentation', iconName: 'ShieldAlert', clusterId: 'store_ops' },

    // E-Commerce
    { id: 'ecommerce_manager', title: 'E-Commerce Manager', description: 'Product listing copy & campaign brief drafting', iconName: 'ShoppingBag', clusterId: 'ecommerce' },
    { id: 'digital_marketer_retail', title: 'Digital Marketer', description: 'Ad copy drafting & campaign performance reports', iconName: 'Megaphone', clusterId: 'ecommerce' },

    // Customer Experience
    { id: 'cx_specialist', title: 'Customer Experience Specialist', description: 'Service scripts & complaint resolution documentation', iconName: 'Smile', clusterId: 'customer_experience' },
    { id: 'loyalty_manager', title: 'Loyalty Program Manager', description: 'Program communications & retention analysis reports', iconName: 'Heart', clusterId: 'customer_experience' },
  ],
  energy: [
    // Field Operations
    { id: 'field_technician_energy', title: 'Field Technician', description: 'Inspection reports & work order documentation', iconName: 'Zap', clusterId: 'field_ops' },
    { id: 'site_supervisor', title: 'Site Supervisor', description: 'Safety walkthrough docs & shift report drafting', iconName: 'Users', clusterId: 'field_ops' },

    // Engineering & Technical
    { id: 'reservoir_engineer', title: 'Reservoir Engineer', description: 'Reservoir modeling reports & technical specifications', iconName: 'Cpu', clusterId: 'engineering_technical' },
    { id: 'grid_engineer', title: 'Grid Engineer', description: 'Load analysis & capacity planning documentation', iconName: 'Activity', clusterId: 'engineering_technical' },

    // Regulatory & Environmental
    { id: 'environmental_specialist', title: 'Environmental Specialist', description: 'Emissions reports & permit application drafting', iconName: 'ShieldCheck', clusterId: 'regulatory_environmental' },
    { id: 'regulatory_affairs_energy', title: 'Regulatory Affairs Specialist', description: 'Compliance filings & audit preparation', iconName: 'FileCheck', clusterId: 'regulatory_environmental' },

    // Trading & Commercial
    { id: 'energy_trader', title: 'Energy Trader', description: 'Market analysis & contract structuring documentation', iconName: 'LineChart', clusterId: 'trading_commercial' },
    { id: 'commercial_analyst_energy', title: 'Commercial Analyst', description: 'Pricing models & hedging strategy documentation', iconName: 'TrendingUp', clusterId: 'trading_commercial' },
  ],
  transportation: [
    // Logistics & Dispatch
    { id: 'dispatcher', title: 'Dispatcher', description: 'Route plans, load schedules & carrier communications', iconName: 'Truck', clusterId: 'logistics_dispatch' },
    { id: 'logistics_coordinator', title: 'Logistics Coordinator', description: 'Carrier communications & shipment tracking updates', iconName: 'FolderKanban', clusterId: 'logistics_dispatch' },

    // Fleet Operations
    { id: 'fleet_manager', title: 'Fleet Manager', description: 'Maintenance logs & driver compliance documentation', iconName: 'Settings', clusterId: 'fleet_ops' },
    { id: 'fleet_analyst', title: 'Fleet Analyst', description: 'Telemetry reports & utilization analysis', iconName: 'BarChart2', clusterId: 'fleet_ops' },

    // Safety & Compliance
    { id: 'safety_officer_transport', title: 'Safety Officer', description: 'Incident reports & DOT audit preparation', iconName: 'ShieldAlert', clusterId: 'transport_safety' },
    { id: 'compliance_specialist_transport', title: 'Compliance Specialist', description: 'Hazmat documentation & inspection logs', iconName: 'FileCheck', clusterId: 'transport_safety' },

    // Customer & Freight Services
    { id: 'freight_coordinator', title: 'Freight Coordinator', description: 'Shipment tracking updates & billing documentation', iconName: 'FileText', clusterId: 'freight_services' },
    { id: 'claims_specialist', title: 'Claims Specialist', description: 'Claims resolution & customer correspondence', iconName: 'FileCheck', clusterId: 'freight_services' },
  ],
  agriculture: [
    // Field & Crop Operations
    { id: 'farm_manager', title: 'Farm Manager', description: 'Planting schedules & yield report documentation', iconName: 'Sprout', clusterId: 'field_crop_ops' },
    { id: 'field_technician_ag', title: 'Field Technician', description: 'Soil sample logs & irrigation record keeping', iconName: 'Activity', clusterId: 'field_crop_ops' },

    // Livestock & Herd Management
    { id: 'herd_manager', title: 'Herd Manager', description: 'Health records & breeding log documentation', iconName: 'Heart', clusterId: 'livestock_mgmt' },
    { id: 'livestock_technician', title: 'Livestock Technician', description: 'Feed planning docs & veterinary visit notes', iconName: 'Stethoscope', clusterId: 'livestock_mgmt' },

    // Agronomy & Research
    { id: 'agronomist', title: 'Agronomist', description: 'Field trial reports & pest/disease analysis', iconName: 'Microscope', clusterId: 'agronomy_research' },
    { id: 'research_technician_ag', title: 'Research Technician', description: 'Data collection support & lab notes', iconName: 'FileText', clusterId: 'agronomy_research' },

    // Supply Chain & Trading
    { id: 'commodity_trader', title: 'Commodity Trader', description: 'Contract structuring & market pricing analysis', iconName: 'TrendingUp', clusterId: 'ag_supply_chain' },
    { id: 'logistics_manager_ag', title: 'Logistics Manager', description: 'Storage planning & transport coordination docs', iconName: 'Boxes', clusterId: 'ag_supply_chain' },
  ],
  nonprofit: [
    // Programs & Services
    { id: 'program_manager_np', title: 'Program Manager', description: 'Case management notes & outcome report drafting', iconName: 'Heart', clusterId: 'programs_services' },
    { id: 'case_worker', title: 'Case Worker', description: 'Client intake documentation & service plan drafting', iconName: 'FileText', clusterId: 'programs_services' },

    // Development & Fundraising
    { id: 'development_director', title: 'Development Director', description: 'Donor proposals & cultivation strategy documentation', iconName: 'Users', clusterId: 'development_fundraising' },
    { id: 'grant_writer', title: 'Grant Writer', description: 'Grant applications & funder report drafting', iconName: 'PenTool', clusterId: 'development_fundraising' },

    // Finance & Compliance
    { id: 'finance_manager_np', title: 'Finance Manager', description: 'Budget reports & Form 990 preparation support', iconName: 'FileSpreadsheet', clusterId: 'nonprofit_finance' },
    { id: 'grants_accountant', title: 'Grants Accountant', description: 'Compliance tracking & expense report documentation', iconName: 'FileCheck', clusterId: 'nonprofit_finance' },

    // Communications & Outreach
    { id: 'comms_manager_np', title: 'Communications Manager', description: 'Newsletters & press release drafting', iconName: 'Megaphone', clusterId: 'comms_outreach' },
    { id: 'outreach_coordinator', title: 'Outreach Coordinator', description: 'Community engagement materials & social content', iconName: 'Users', clusterId: 'comms_outreach' },
  ],
  other: [
    // Leadership & Strategy
    { id: 'executive', title: 'Executive', description: 'Strategic plans, board memos & org-wide communications', iconName: 'Crown', clusterId: 'leadership_strategy' },
    { id: 'strategy_lead', title: 'Strategy Lead', description: 'Initiative roadmaps & strategic planning documentation', iconName: 'Target', clusterId: 'leadership_strategy' },

    // Operations & Delivery
    { id: 'project_manager_other', title: 'Project Manager', description: 'Status reports, project plans & vendor coordination', iconName: 'FolderKanban', clusterId: 'ops_delivery' },
    { id: 'ops_coordinator', title: 'Operations Coordinator', description: 'Process documentation & cross-team coordination', iconName: 'Boxes', clusterId: 'ops_delivery' },

    // Knowledge & Analysis
    { id: 'analyst_other', title: 'Analyst', description: 'Research synthesis & report drafting', iconName: 'BarChart', clusterId: 'knowledge_analysis' },
    { id: 'knowledge_manager', title: 'Knowledge Manager', description: 'Documentation management & knowledge base articles', iconName: 'BookOpen', clusterId: 'knowledge_analysis' },

    // Client & Stakeholder Relations
    { id: 'account_manager', title: 'Account Manager', description: 'Client communications & account plan documentation', iconName: 'Briefcase', clusterId: 'client_relations' },
    { id: 'relationship_manager', title: 'Relationship Manager', description: 'Stakeholder updates & service report drafting', iconName: 'Users', clusterId: 'client_relations' },
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
    { id: 'lit_synthesis_space', title: 'Literature Synthesis', description: 'Condensing dense astrophysics papers into digestible research briefs', iconName: 'Microscope', personaId: 'scientist' },
    { id: 'grant_drafting_space', title: 'Grant Proposal Drafting', description: 'Structuring funding narratives from raw research notes & prior awards', iconName: 'FileText', personaId: 'research_analyst' },
    { id: 'telemetry_pattern', title: 'Telemetry Pattern Detection', description: 'Surfacing anomalies across orbital sensor datasets in natural language', iconName: 'BarChart2', personaId: 'data_scientist' },
    { id: 'sample_reporting', title: 'Sample Analysis Reporting', description: 'Turning cleanroom test logs into structured material analysis reports', iconName: 'FileCheck', personaId: 'lab_specialist' },
    { id: 'mission_log_synth', title: 'Mission Log Synthesis', description: 'Extracting key anomalies & event sequences from raw flight telemetry', iconName: 'Radio', personaId: 'mission_spec' },
    { id: 'contingency_drafting', title: 'Contingency Protocol Drafting', description: 'Structuring command-center response plans from prior incident data', iconName: 'ShieldAlert', personaId: 'flight_dir' },
    { id: 'trajectory_notes', title: 'Trajectory Adjustment Notes', description: 'Documenting orbital correction rationale for handover & audit trail', iconName: 'Compass', personaId: 'ops_controller' },
    { id: 'biotelemetry_summary', title: 'Bio-Telemetry Summarization', description: 'Condensing crew physiological data into daily medical briefs', iconName: 'HeartPulse', personaId: 'flight_surgeon' },
    { id: 'integration_specs', title: 'Integration Spec Drafting', description: 'Turning hardware test data into instrument integration specifications', iconName: 'Cpu', personaId: 'payload_eng' },
    { id: 'sys_budget_docs', title: 'Systems Budget Documentation', description: 'Structuring thermal & power budget validation results for review', iconName: 'Layers', personaId: 'systems_eng' },
    { id: 'fault_tree_reports', title: 'Fault Tree Reporting', description: 'Converting hazard analysis worksheets into formal safety case reports', iconName: 'ShieldAlert', personaId: 'safety_eng' },
    { id: 'traceability_matrix', title: 'Traceability Matrix Drafting', description: 'Mapping system requirements to verification evidence automatically', iconName: 'CheckSquare', personaId: 'requirements_eng' },
    { id: 'agency_status_reports', title: 'Agency Status Reporting', description: 'Drafting inter-agency program status updates from milestone data', iconName: 'FileSpreadsheet', personaId: 'prog_mgr' },
    { id: 'mission_briefings', title: 'Mission Briefing Drafting', description: 'Turning technical mission data into public-facing briefing language', iconName: 'Megaphone', personaId: 'comms_spec' },
    { id: 'compliance_briefs_space', title: 'Compliance Brief Drafting', description: 'Synthesizing NASA/ESA policy updates into program-relevant briefs', iconName: 'FileText', personaId: 'policy_analyst' },
  ],
  healthcare: [
    { id: 'chart_summarization', title: 'Chart Summarization', description: 'Extracting key clinical history from long patient EHR records', iconName: 'Stethoscope', personaId: 'clinician' },
    { id: 'shift_handoff_notes', title: 'Shift Handoff Drafting', description: 'Structuring nurse-to-nurse handoff notes from care log entries', iconName: 'FileText', personaId: 'nurse' },
    { id: 'care_plan_drafting', title: 'Care Plan Drafting', description: 'Generating standardized discharge instructions & care pathways', iconName: 'HeartPulse', personaId: 'care_coord' },
    { id: 'clinical_trial_synth', title: 'Clinical Trial Synthesis', description: 'Aggregating trial papers & treatment efficacy data into briefs', iconName: 'Microscope', personaId: 'med_researcher' },
    { id: 'lab_result_reporting', title: 'Lab Result Reporting', description: 'Structuring assay results into standardized lab reports', iconName: 'FileCheck', personaId: 'lab_tech' },
    { id: 'hipaa_policy_updates', title: 'HIPAA Policy Updates', description: 'Updating hospital SOPs to match new health authority guidelines', iconName: 'ShieldCheck', personaId: 'compliance_officer' },
    { id: 'dictation_polish', title: 'Clinical Note Polishing', description: 'Refining physician dictations for accuracy & billing compliance', iconName: 'FileText', personaId: 'medical_writer' },
    { id: 'billing_scheduling_docs', title: 'Billing & Scheduling Documentation', description: 'Structuring facility scheduling & insurance intake paperwork', iconName: 'Building2', personaId: 'admin' },
  ],
  finance: [
    { id: 'market_digest', title: 'Market Digest Drafting', description: 'Daily macroeconomic digest & market feed synthesis', iconName: 'TrendingUp', personaId: 'analyst' },
    { id: 'trade_rationale_notes', title: 'Trade Rationale Documentation', description: 'Structuring trade thesis notes for compliance record-keeping', iconName: 'LineChart', personaId: 'trader' },
    { id: 'investor_letters', title: 'Investor Letter Drafting', description: 'Generating quarterly investor letters & portfolio performance notes', iconName: 'FileSpreadsheet', personaId: 'portfolio_mgr' },
    { id: 'risk_narrative_drafting', title: 'Risk Narrative Drafting', description: 'Formulating credit & liquidity risk narratives for investment comms', iconName: 'ShieldAlert', personaId: 'risk_officer' },
    { id: 'kyc_aml_docs', title: 'KYC/AML Documentation', description: 'Structuring trade monitoring & regulatory filing narratives', iconName: 'FileCheck', personaId: 'compliance' },
    { id: 'audit_workpapers', title: 'Audit Workpaper Drafting', description: 'Turning control test results into structured audit workpapers', iconName: 'CheckSquare', personaId: 'auditor' },
    { id: 'backtest_reporting', title: 'Backtest Reporting', description: 'Structuring algorithmic strategy backtest results into research notes', iconName: 'Cpu', personaId: 'quant_researcher' },
    { id: 'competitive_analysis_synth', title: 'Competitive Analysis Synthesis', description: 'Condensing industry trend data into competitive briefings', iconName: 'LineChart', personaId: 'market_researcher' },
    { id: 'settlement_recon_notes', title: 'Settlement Reconciliation Notes', description: 'Structuring trade settlement exceptions into resolution reports', iconName: 'Settings', personaId: 'ops_specialist' },
  ],
  technology: [
    { id: 'pr_doc_drafting', title: 'PR & Docs Drafting', description: 'Drafting PR descriptions & API documentation from code diffs', iconName: 'Code', personaId: 'dev' },
    { id: 'runbook_drafting', title: 'Runbook Drafting', description: 'Turning CI/CD pipeline configs into on-call runbook documentation', iconName: 'Cpu', personaId: 'devops' },
    { id: 'model_card_drafting', title: 'Model Card Drafting', description: 'Structuring ML model training results into model card documentation', iconName: 'BarChart2', personaId: 'data_scientist' },
    { id: 'prd_drafting', title: 'PRD Drafting', description: 'Turning user research & sprint notes into structured PRDs', iconName: 'Target', personaId: 'pm' },
    { id: 'design_spec_drafting', title: 'Design Spec Drafting', description: 'Structuring design system rationale into handoff-ready specs', iconName: 'Palette', personaId: 'designer' },
    { id: 'kb_article_drafting', title: 'KB Article Drafting', description: 'Turning resolved tickets into searchable knowledge base articles', iconName: 'LifeBuoy', personaId: 'support_eng' },
  ],
  manufacturing: [
    { id: 'process_flow_docs', title: 'Process Flow Documentation', description: 'Turning line optimization notes into structured process flow docs', iconName: 'Wrench', personaId: 'process_engineer' },
    { id: 'controls_doc_drafting', title: 'Controls Documentation', description: 'Structuring PLC programming logic into controls documentation', iconName: 'Cpu', personaId: 'automation_engineer' },
    { id: 'nonconformance_reports', title: 'Non-Conformance Reporting', description: 'Structuring defect logs into formal non-conformance reports', iconName: 'CheckSquare', personaId: 'qa_inspector' },
    { id: 'safety_incident_reports', title: 'Safety Incident Reporting', description: 'Turning hazard observations into structured OSHA-ready reports', iconName: 'ShieldAlert', personaId: 'ehs_specialist' },
    { id: 'shift_handover_briefs', title: 'Shift Handover Briefs', description: 'Structuring shift notes into consistent handover documentation', iconName: 'Users', personaId: 'shift_supervisor' },
    { id: 'capacity_planning_docs', title: 'Capacity Planning Documentation', description: 'Turning throughput data into schedule optimization proposals', iconName: 'Boxes', personaId: 'production_planner' },
    { id: 'work_order_drafting', title: 'Work Order Drafting', description: 'Structuring maintenance requests into standardized work orders', iconName: 'Settings', personaId: 'maintenance_tech' },
    { id: 'failure_analysis_reports', title: 'Failure Analysis Reporting', description: 'Turning SCADA diagnostics into structured failure analysis reports', iconName: 'Activity', personaId: 'reliability_engineer' },
  ],
  education: [
    { id: 'lesson_plan_drafting', title: 'Lesson Plan Drafting', description: 'Drafting modular course outlines & activity ideas', iconName: 'BookOpen', personaId: 'teacher' },
    { id: 'pd_material_drafting', title: 'PD Material Drafting', description: 'Turning observation notes into professional development materials', iconName: 'GraduationCap', personaId: 'instructional_coach' },
    { id: 'lit_review_drafting', title: 'Literature Review Drafting', description: 'Synthesizing academic sources into structured literature reviews', iconName: 'Microscope', personaId: 'academic_researcher' },
    { id: 'citation_management', title: 'Citation Management', description: 'Organizing & formatting citations across research drafts', iconName: 'FileText', personaId: 'grad_assistant' },
    { id: 'enrollment_reporting', title: 'Enrollment Reporting', description: 'Structuring enrollment & transcript data into administrative reports', iconName: 'FileSpreadsheet', personaId: 'registrar' },
    { id: 'accreditation_drafting', title: 'Accreditation Drafting', description: 'Turning program data into accreditation submission narratives', iconName: 'Building', personaId: 'dean' },
    { id: 'syllabus_drafting', title: 'Syllabus Drafting', description: 'Structuring learning objectives into complete course syllabi', iconName: 'Layers', personaId: 'curriculum_designer' },
    { id: 'assessment_design', title: 'Assessment Design', description: 'Drafting rubrics & assessments aligned to learning outcomes', iconName: 'PenTool', personaId: 'instructional_designer' },
  ],
  government: [
    { id: 'legislative_brief_drafting', title: 'Legislative Brief Drafting', description: 'Turning bill text & testimony into concise legislative briefs', iconName: 'FileSpreadsheet', personaId: 'policy_analyst' },
    { id: 'constituent_correspondence', title: 'Constituent Correspondence', description: 'Drafting responses to constituent inquiries at scale', iconName: 'FileText', personaId: 'legislative_aide' },
    { id: 'interagency_status_reports', title: 'Interagency Status Reporting', description: 'Structuring coordination notes into interagency status reports', iconName: 'FolderKanban', personaId: 'program_manager_gov' },
    { id: 'rfp_drafting', title: 'RFP Drafting', description: 'Turning sourcing requirements into structured RFP documents', iconName: 'FileCheck', personaId: 'procurement_officer' },
    { id: 'case_file_documentation', title: 'Case File Documentation', description: 'Structuring evidence & interview notes into case file summaries', iconName: 'Search', personaId: 'investigator' },
    { id: 'foia_response_drafting', title: 'FOIA Response Drafting', description: 'Structuring records review findings into FOIA response packets', iconName: 'ShieldCheck', personaId: 'compliance_auditor_gov' },
    { id: 'press_release_drafting', title: 'Press Release Drafting', description: 'Turning agency updates into public-ready press releases', iconName: 'Megaphone', personaId: 'press_officer' },
    { id: 'engagement_material_drafting', title: 'Engagement Material Drafting', description: 'Structuring citizen engagement materials & briefing decks', iconName: 'Users', personaId: 'public_affairs' },
  ],
  legal: [
    { id: 'brief_drafting', title: 'Brief Drafting', description: 'Structuring case law research into court-ready briefs', iconName: 'Gavel', personaId: 'litigator' },
    { id: 'discovery_review_summaries', title: 'Discovery Review Summaries', description: 'Summarizing discovery documents into exhibit-ready findings', iconName: 'FileText', personaId: 'litigation_paralegal' },
    { id: 'contract_drafting', title: 'Contract Drafting', description: 'Turning deal terms into structured contract drafts', iconName: 'Briefcase', personaId: 'transactional_attorney' },
    { id: 'due_diligence_summaries', title: 'Due Diligence Summaries', description: 'Structuring document review findings into diligence summaries', iconName: 'CheckSquare', personaId: 'corp_paralegal' },
    { id: 'regulatory_filing_drafting', title: 'Regulatory Filing Drafting', description: 'Turning policy changes into structured regulatory filings', iconName: 'ShieldCheck', personaId: 'compliance_counsel' },
    { id: 'audit_response_drafting_legal', title: 'Audit Response Drafting', description: 'Structuring compliance evidence into audit response packets', iconName: 'FileCheck', personaId: 'compliance_analyst_legal' },
    { id: 'billing_narrative_drafting', title: 'Billing Narrative Drafting', description: 'Turning time entries into client-ready billing narratives', iconName: 'FileSpreadsheet', personaId: 'practice_manager' },
    { id: 'correspondence_drafting_legal', title: 'Correspondence Drafting', description: 'Drafting routine client & court correspondence', iconName: 'Layers', personaId: 'legal_secretary' },
  ],
  retail: [
    { id: 'assortment_plan_drafting', title: 'Assortment Plan Drafting', description: 'Turning sales data into structured assortment & pricing plans', iconName: 'Tag', personaId: 'merchandiser' },
    { id: 'vendor_negotiation_memos', title: 'Vendor Negotiation Memos', description: 'Structuring vendor terms & negotiation points into memos', iconName: 'ShoppingBag', personaId: 'buyer' },
    { id: 'staffing_reports', title: 'Staffing & Inventory Reporting', description: 'Turning daily ops data into structured staffing reports', iconName: 'Store', personaId: 'store_manager' },
    { id: 'shrinkage_analysis_reports', title: 'Shrinkage Analysis Reporting', description: 'Structuring incident data into shrinkage analysis reports', iconName: 'ShieldAlert', personaId: 'loss_prevention' },
    { id: 'listing_copy_drafting', title: 'Product Listing Copy', description: 'Drafting SEO-ready product listing copy at scale', iconName: 'ShoppingBag', personaId: 'ecommerce_manager' },
    { id: 'ad_copy_drafting', title: 'Ad Copy Drafting', description: 'Generating campaign ad copy variants from product briefs', iconName: 'Megaphone', personaId: 'digital_marketer_retail' },
    { id: 'service_script_drafting', title: 'Service Script Drafting', description: 'Structuring resolution scripts from common complaint patterns', iconName: 'Smile', personaId: 'cx_specialist' },
    { id: 'retention_analysis_reports', title: 'Retention Analysis Reporting', description: 'Turning loyalty program data into retention analysis reports', iconName: 'Heart', personaId: 'loyalty_manager' },
  ],
  energy: [
    { id: 'inspection_reporting', title: 'Inspection Reporting', description: 'Structuring field inspection notes into formal reports', iconName: 'Zap', personaId: 'field_technician_energy' },
    { id: 'safety_walkthrough_docs', title: 'Safety Walkthrough Documentation', description: 'Turning walkthrough notes into structured safety documentation', iconName: 'ShieldAlert', personaId: 'site_supervisor' },
    { id: 'reservoir_modeling_reports', title: 'Reservoir Modeling Reports', description: 'Structuring modeling output into technical reservoir reports', iconName: 'Cpu', personaId: 'reservoir_engineer' },
    { id: 'load_analysis_docs', title: 'Load Analysis Documentation', description: 'Turning grid telemetry into structured load analysis reports', iconName: 'Activity', personaId: 'grid_engineer' },
    { id: 'emissions_reporting', title: 'Emissions Reporting', description: 'Structuring monitoring data into regulatory emissions reports', iconName: 'ShieldCheck', personaId: 'environmental_specialist' },
    { id: 'permit_application_drafting', title: 'Permit Application Drafting', description: 'Turning project specs into structured permit applications', iconName: 'FileCheck', personaId: 'regulatory_affairs_energy' },
    { id: 'market_analysis_drafting', title: 'Market Analysis Drafting', description: 'Structuring price movement data into trading desk analysis', iconName: 'LineChart', personaId: 'energy_trader' },
    { id: 'hedging_strategy_docs', title: 'Hedging Strategy Documentation', description: 'Turning pricing models into structured hedging strategy memos', iconName: 'TrendingUp', personaId: 'commercial_analyst_energy' },
  ],
  transportation: [
    { id: 'route_plan_drafting', title: 'Route Plan Drafting', description: 'Structuring load & route data into dispatch-ready plans', iconName: 'Truck', personaId: 'dispatcher' },
    { id: 'carrier_comm_drafting', title: 'Carrier Communication Drafting', description: 'Drafting shipment status updates for carriers & customers', iconName: 'FolderKanban', personaId: 'logistics_coordinator' },
    { id: 'maintenance_log_reporting', title: 'Maintenance Log Reporting', description: 'Structuring vehicle service records into fleet maintenance reports', iconName: 'Settings', personaId: 'fleet_manager' },
    { id: 'utilization_reporting', title: 'Utilization Reporting', description: 'Turning telemetry data into fleet utilization analysis', iconName: 'BarChart2', personaId: 'fleet_analyst' },
    { id: 'dot_audit_prep', title: 'DOT Audit Prep Documentation', description: 'Structuring incident & inspection records for DOT audit readiness', iconName: 'ShieldAlert', personaId: 'safety_officer_transport' },
    { id: 'hazmat_documentation', title: 'Hazmat Documentation', description: 'Structuring shipment records into compliant hazmat documentation', iconName: 'FileCheck', personaId: 'compliance_specialist_transport' },
    { id: 'shipment_tracking_updates', title: 'Shipment Tracking Updates', description: 'Drafting customer-facing shipment status communications', iconName: 'FileText', personaId: 'freight_coordinator' },
    { id: 'claims_resolution_drafting', title: 'Claims Resolution Drafting', description: 'Structuring claim evidence into resolution correspondence', iconName: 'FileCheck', personaId: 'claims_specialist' },
  ],
  agriculture: [
    { id: 'yield_reporting', title: 'Yield Reporting', description: 'Structuring harvest data into seasonal yield reports', iconName: 'Sprout', personaId: 'farm_manager' },
    { id: 'irrigation_log_reporting', title: 'Irrigation Log Reporting', description: 'Turning field sensor data into irrigation record summaries', iconName: 'Activity', personaId: 'field_technician_ag' },
    { id: 'herd_health_reporting', title: 'Herd Health Reporting', description: 'Structuring health & breeding records into herd status reports', iconName: 'Heart', personaId: 'herd_manager' },
    { id: 'vet_visit_summaries', title: 'Vet Visit Summaries', description: 'Turning veterinary notes into structured health record entries', iconName: 'Stethoscope', personaId: 'livestock_technician' },
    { id: 'field_trial_reporting', title: 'Field Trial Reporting', description: 'Structuring trial data into agronomic research reports', iconName: 'Microscope', personaId: 'agronomist' },
    { id: 'data_collection_logs', title: 'Data Collection Logs', description: 'Structuring raw field data into organized research lab notes', iconName: 'FileText', personaId: 'research_technician_ag' },
    { id: 'contract_structuring_docs', title: 'Contract Structuring Documentation', description: 'Turning market data into structured commodity contract terms', iconName: 'TrendingUp', personaId: 'commodity_trader' },
    { id: 'storage_transport_planning', title: 'Storage & Transport Planning', description: 'Structuring logistics data into storage & transport coordination plans', iconName: 'Boxes', personaId: 'logistics_manager_ag' },
  ],
  nonprofit: [
    { id: 'outcome_reporting', title: 'Outcome Reporting', description: 'Turning case data into program outcome reports for funders', iconName: 'Heart', personaId: 'program_manager_np' },
    { id: 'intake_documentation', title: 'Intake Documentation', description: 'Structuring client intake interviews into service plan documentation', iconName: 'FileText', personaId: 'case_worker' },
    { id: 'donor_proposal_drafting', title: 'Donor Proposal Drafting', description: 'Turning cultivation notes into tailored donor proposals', iconName: 'Users', personaId: 'development_director' },
    { id: 'grant_application_drafting', title: 'Grant Application Drafting', description: 'Structuring program data into competitive grant applications', iconName: 'PenTool', personaId: 'grant_writer' },
    { id: 'budget_reporting', title: 'Budget Reporting', description: 'Turning expense data into board-ready budget reports', iconName: 'FileSpreadsheet', personaId: 'finance_manager_np' },
    { id: 'compliance_tracking_docs', title: 'Grant Compliance Tracking', description: 'Structuring expense records into grant compliance documentation', iconName: 'FileCheck', personaId: 'grants_accountant' },
    { id: 'newsletter_drafting', title: 'Newsletter Drafting', description: 'Turning program updates into donor & community newsletters', iconName: 'Megaphone', personaId: 'comms_manager_np' },
    { id: 'engagement_content_drafting', title: 'Engagement Content Drafting', description: 'Drafting social & community outreach content from program stories', iconName: 'Users', personaId: 'outreach_coordinator' },
  ],
  other: [
    { id: 'board_memo_drafting', title: 'Board Memo Drafting', description: 'Structuring strategic updates into board-ready memos', iconName: 'Crown', personaId: 'executive' },
    { id: 'roadmap_drafting', title: 'Roadmap Drafting', description: 'Turning strategic priorities into structured initiative roadmaps', iconName: 'Target', personaId: 'strategy_lead' },
    { id: 'status_report_drafting', title: 'Status Report Drafting', description: 'Structuring project updates into consistent status reports', iconName: 'FolderKanban', personaId: 'project_manager_other' },
    { id: 'process_doc_drafting', title: 'Process Documentation', description: 'Turning workflow notes into structured process documentation', iconName: 'Boxes', personaId: 'ops_coordinator' },
    { id: 'research_synthesis_other', title: 'Research Synthesis', description: 'Condensing research findings into structured briefing reports', iconName: 'BarChart', personaId: 'analyst_other' },
    { id: 'kb_article_drafting_other', title: 'Knowledge Base Drafting', description: 'Turning tribal knowledge into searchable KB articles', iconName: 'BookOpen', personaId: 'knowledge_manager' },
    { id: 'account_plan_drafting', title: 'Account Plan Drafting', description: 'Structuring client history into strategic account plans', iconName: 'Briefcase', personaId: 'account_manager' },
    { id: 'stakeholder_update_drafting', title: 'Stakeholder Update Drafting', description: 'Turning project status into stakeholder-ready communications', iconName: 'Users', personaId: 'relationship_manager' },
  ],
  default: [
    { id: 'strategic_memo_drafting', title: 'Strategic Memo Drafting', description: 'Turning leadership priorities into org-wide strategic memos', iconName: 'Crown', personaId: 'exec_leader' },
    { id: 'doc_synthesis_default', title: 'Document Synthesis', description: 'Condensing cross-functional documents into shareable summaries', iconName: 'FileText', personaId: 'knowledge_worker' },
    { id: 'process_doc_default', title: 'Process Documentation', description: 'Turning operational notes into structured process documentation', iconName: 'Settings', personaId: 'ops_lead' },
    { id: 'ticket_response_drafting', title: 'Ticket Response Drafting', description: 'Drafting consistent, accurate responses to support requests', iconName: 'LifeBuoy', personaId: 'support_spec' },
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
