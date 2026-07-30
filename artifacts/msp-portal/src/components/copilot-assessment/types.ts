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

export interface QuizQuestion {
  id: number;
  question: string;
  category: string;
  options: {
    id: string;
    label: string;
    description: string;
    personaImpact: string;
    useCaseFit: string;
  }[];
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
