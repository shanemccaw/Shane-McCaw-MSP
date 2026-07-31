export type AssessmentStep = 
  | 'home'
  | 'quiz'
  | 'telemetry'
  | 'personas'
  | 'use-cases'
  | 'security'
  | 'security2'
  | 'governance'
  | 'roi'
  | 'report'
  | 'documents'
  | 'sow';

export type CollaborationPattern = 'internal' | 'cross-team' | 'external';
export type WorkflowStyle = 'structured' | 'unstructured';
export type AiComfortLevel = 'low' | 'medium' | 'high';

// Real structured attribute collection produced by the Quiz (Phase 1 of the
// Copilot Assessment epic, #184). This JSON becomes the prompt-context input
// for the Persona/Use-Case/Report AI generation phases (#183 Phases 3/4/8) —
// the shape is the contract those phases are built against, so it is frozen
// here rather than reshaped per-consumer.
export interface QuizProfile {
  role: string;
  department: string;
  // Real Zoho Lead fields (see zoho-lead-sync.ts's mapStagingToZohoLead) that
  // nothing else in the funnel collects -- name comes from the authenticated
  // account, industry is its own quiz step. Optional: not every quiz-taker
  // has a company/phone to give, and this shouldn't block completing the quiz.
  company?: string;
  phone?: string;
  industry: string;
  collaboration: CollaborationPattern[];
  sensitivity: string[];
  workflowStyle: WorkflowStyle;
  outcomePriorities: string[];
  draftingLoad: number; // 0-1
  researchLoad: number; // 0-1
  communicationLoad: number; // 0-1
  repetitiveLoad: number; // 0-1
  toolUsage: string[];
  aiComfort: AiComfortLevel;
}

export interface EngineStatus {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'complete';
  progress: number;
  details: string[];
}

export type PersonaSeverity = 'High' | 'Medium' | 'Low';
export type PersonaBgAnimationType = 'engineer' | 'security' | 'pm' | 'writer' | 'researcher';

// Real consumed shape (Copilot Assessment epic #183, Phase 3 / #186) — audited
// directly against PersonasScreen.tsx's actual field reads rather than assumed
// from the interface that used to live here. That prior narrower shape (id/
// name/role/department/avatar/riskScore/opportunityScore/recommendedRollout/
// detailedStory/telemetryEvidence/roiPreview) was never what the screen
// rendered; PersonasScreen locally defined and consumed a much richer
// ExtendedPersonaData shape instead, matching UseCasesScreen's identical
// shadow-interface gap flagged in #186's issue body. This interface now IS
// that real shape, generated fresh per quiz-taker by persona-generation-engine.ts
// (single-input model — ~5 archetypal personas from one QuizProfile, not real
// multi-employee clustering).
export interface PersonaStory {
  id: string;
  name: string;
  role: string;
  department: string;
  avatar: string;
  bgAnimationType: PersonaBgAnimationType;
  collaborationPattern: string[];
  sensitivitySet: string[];
  useCaseCluster: string;
  outcomePriorities: string[];
  riskScore: number;
  feasibilityScore: number;
  adoptionFriction: number;
  sensitivityExposure: { label: string; severity: PersonaSeverity }[];
  collaborationFriction: { label: string; severity: PersonaSeverity }[];
  valuePotential: {
    hoursSavedPerWeek: number;
    annualValuePerSeat: string;
    roiMultiplier: string;
    primaryBenefit: string;
  };
  shortStory: {
    summary: string;
    telemetryCheck: string;
    copilotUnlock: string;
  };
  expandedNarrative: {
    identityContext: string;
    collaborationSensitivity: string;
    telemetryRealityCheck: string;
    workflowFriction: string;
    feasibilityReadiness: string;
    copilotValueStory: string;
    roiBreakdown: string;
  };
  insightRibbonText: string;
}

export interface UseCaseTile {
  id: string;
  // Real gap fixed by #187: use cases are generated per-persona (Phase 4 of
  // the Copilot Assessment epic, #183), so every tile must link back to the
  // PersonaStory.id it was generated for.
  personaId: string;
  name: string;
  category: string;
  feasibilityScore: number;
  blockers: string[];
  expectedRoi: string;
  recommended: boolean;
  blocked: boolean;
  summary: string;
}

export interface GovernanceState {
  ca01: boolean;
  pim: boolean;
  sensitivityLabels: boolean;
  dlp: 'off' | 'moderate' | 'strict';
}

export interface RoiState {
  adoptionRate: number; // 0 - 100
  personaCoverage: number; // 0 - 100
  useCaseIntensity: number; // 0 - 100
}

export interface DocumentDeliverable {
  id: string;
  title: string;
  type: string;
  description: string;
  readTime: string;
  sections: {
    heading: string;
    content: string;
    stats?: { label: string; value: string }[];
  }[];
}

export type PersonaGenerationStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AssessmentState {
  currentStep: AssessmentStep;
  currentQuestionIndex: number;
  quizAnswers: Record<string, string>;
  quizProfile: QuizProfile | null;
  isLeftPanelCollapsed: boolean;
  isRightPanelCollapsed: boolean;
  engines: EngineStatus[];
  isTelemetryRunning: boolean;
  telemetryProgress: number;
  personas: PersonaStory[];
  personasStatus: PersonaGenerationStatus;
  selectedPersona: PersonaStory | null;
  selectedDocument: DocumentDeliverable | null;
  governance: GovernanceState;
  roi: RoiState;
}
