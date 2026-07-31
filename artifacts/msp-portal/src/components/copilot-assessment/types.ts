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

export interface PersonaStory {
  id: string;
  name: string;
  role: string;
  department: string;
  avatar: string;
  riskScore: number;
  opportunityScore: number;
  recommendedRollout: string;
  detailedStory: string;
  telemetryEvidence: string[];
  roiPreview: {
    hoursSavedPerWeek: number;
    annualValue: string;
    primaryBenefit: string;
  };
}

export interface UseCaseTile {
  id: string;
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
  selectedPersona: PersonaStory | null;
  selectedDocument: DocumentDeliverable | null;
  governance: GovernanceState;
  roi: RoiState;
}
