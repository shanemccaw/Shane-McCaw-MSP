export type PersonaId = 'user' | 'shane' | 'jane' | 'marcus' | 'priya' | 'kirk' | 'beth';

export type PersonaRole =
  | 'The Customer'
  | 'Lead Consultant'
  | 'Mission Specialist'
  | 'Engineering Lead'
  | 'Operations Lead'
  | 'Security Expert'
  | 'Legal & Risk Advisor';

export interface Persona {
  id: PersonaId;
  name: string;
  role: PersonaRole;
  title?: string;
  department?: string;
  avatarUrl: string;
  accentColor: string; // Tailwind border/glow color class
  glowHex: string; // e.g. '#3b82f6'
  secondaryHex: string;
  position: 'head' | 'left-top' | 'left-center' | 'left-bottom' | 'right-top' | 'right-center' | 'right-bottom' | 'bottom-center';
  isConditional?: boolean;
  activeInBeats: number[]; // Story beat numbers (1..4) where persona is present
  idlePulseDuration: number;
  bio?: string;
  priorities?: string[];
  keyQuote?: string;
}

export type ContextAnchorType = 'oversharing' | 'dlp' | 'sprawl' | 'value' | 'doc';

export interface ContextAnchor {
  id: string;
  type: ContextAnchorType;
  label: string;
  iconName: string;
  targetId?: string;
  description: string;
}

export interface ChatMessage {
  id: string;
  speakerId: PersonaId;
  speakerName: string;
  text: string;
  timestamp: string;
  beatIndex: number;
  anchors?: ContextAnchor[];
  docId?: string;
  isUserMessage?: boolean;
}

export interface SuggestedPrompt {
  id: string;
  label: string;
  messageText: string;
}

export interface HandOffCardData {
  id: string;
  title: string;
  subtitle?: string;
  type?: string;
  question?: string;
  scenarioContext?: string;
  issuedBy: PersonaId;
  status: 'pending' | 'discussing' | 'resolved';
  suggestedPrompts?: SuggestedPrompt[];
  impact?: {
    readinessDelta: number;
    riskDelta?: string;
    nodeResolved?: string;
    description: string;
  };
}

export interface WhiteboardNode {
  id: string;
  label: string;
  category: 'security' | 'governance' | 'adoption' | 'copilot' | 'identity';
  status: 'danger' | 'warning' | 'safe' | 'active';
  x: number; // percentage 0-100 on whiteboard surface
  y: number; // percentage 0-100 on whiteboard surface
  value: string;
  metricLabel: string;
  details: string;
  plainSummary?: string;
  businessImpact?: string;
  recommendedActions?: string[];
  suggestedQuestion?: string;
}

export interface WhiteboardLink {
  fromId: string;
  toId: string;
  status: 'risk' | 'remediated' | 'active';
  label?: string;
}

export interface StoryBeat {
  id: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  atmosphereTheme: 'calm' | 'twist' | 'remediation' | 'resolution';
  ambientGlowColor: string; // CSS radial gradient string
  activePersonaIds: PersonaId[];
  speakerHighlightId?: PersonaId;
  messages: ChatMessage[];
  handOffCards?: HandOffCardData[];
  readinessScore: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  dlpCoverage: number;
  oversharingSites: number;
  copilotLicensesReady: number;
  summary: string;
}

export interface DocumentPreviewData {
  id: string;
  title: string;
  type: 'security_audit' | 'data_exposure' | 'copilot_spec' | 'action_plan';
  classification: 'CONFIDENTIAL' | 'RESTRICTED' | 'INTERNAL' | 'PUBLIC';
  author: string;
  date: string;
  summary: string;
  findings: Array<{
    severity: 'High' | 'Medium' | 'Low';
    topic: string;
    detail: string;
    status: string;
  }>;
  stats: Record<string, string | number>;
}
