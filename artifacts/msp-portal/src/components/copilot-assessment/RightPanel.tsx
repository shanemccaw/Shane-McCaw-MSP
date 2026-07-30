import React from 'react';
import { AssessmentStep, GovernanceState, RoiState } from './types';
import { 
  Info, 
  Lightbulb, 
  ShieldCheck, 
  TrendingUp, 
  PanelRightClose, 
  PanelRight, 
  AlertTriangle, 
  CheckCircle2,
  Zap,
  Target,
  Sparkles
} from 'lucide-react';

interface RightPanelProps {
  currentStep: AssessmentStep;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  quizAnswers: Record<number, string>;
  governance: GovernanceState;
  roi: RoiState;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  currentStep,
  isCollapsed,
  onToggleCollapse,
  quizAnswers,
  governance,
  roi
}) => {
  const answeredCount = Object.keys(quizAnswers).length;

  return (
    <aside
      className={`bg-[#111111] border-l border-[#2D2D2D] flex flex-col transition-all duration-300 z-20 shrink-0 select-none ${
        isCollapsed ? 'w-12' : 'w-72 md:w-80'
      }`}
    >
      {/* Top Header / Toggle */}
      <div className="h-12 border-b border-[#2D2D2D] flex items-center justify-between px-4 shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors cursor-pointer"
          title={isCollapsed ? "Expand Right Context Panel" : "Collapse Right Context Panel"}
        >
          {isCollapsed ? <PanelRight className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
        </button>
        {!isCollapsed && (
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#0078D4] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse"></span>
            Context Insights
          </h2>
        )}
      </div>

      {/* Content Area */}
      {!isCollapsed && (
        <div className="flex-1 p-6 space-y-6 overflow-y-auto scrollbar-thin text-xs">
          {/* SCREEN 1: HOME */}
          {currentStep === 'home' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Why This Assessment?</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] leading-relaxed italic text-[#CCCCCC]">
                  "Most organizations face barriers in adoption not because of technology, but because of alignment. This framework solves for alignment by correlating real tenant data with human behaviors."
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Tenant Connectivity</div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#888888]">Graph API</span>
                    <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 font-bold">CONNECTED</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#888888]">Log Analytics</span>
                    <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 font-bold">CONNECTED</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#888888]">Entra Health</span>
                    <span className="text-[10px] bg-yellow-900/40 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30 font-bold">PENDING</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Quick Fact</div>
                <div className="flex gap-3 items-start">
                  <div className="w-1.5 h-1.5 bg-[#0078D4] rounded-full mt-1.5 shrink-0"></div>
                  <p className="text-[11px] text-[#A1A1A1] leading-relaxed">84% of Copilot implementations fail to scale without a predefined ROI Persona Model.</p>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 2: QUIZ */}
          {currentStep === 'quiz' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Persona Likelihood Hints</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] space-y-3 text-[11px]">
                  <div>
                    <div className="flex justify-between text-[#E1E1E1] mb-1">
                      <span>Executive Leadership</span>
                      <span className="font-mono text-green-400 font-bold">88%</span>
                    </div>
                    <div className="w-full bg-[#2D2D2D] h-1.5 rounded-full overflow-hidden">
                      <div className="bg-green-500 h-full w-[88%]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[#E1E1E1] mb-1">
                      <span>Sales & Revenue Ops</span>
                      <span className="font-mono text-[#0078D4] font-bold">76%</span>
                    </div>
                    <div className="w-full bg-[#2D2D2D] h-1.5 rounded-full overflow-hidden">
                      <div className="bg-[#0078D4] h-full w-[76%]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[#E1E1E1] mb-1">
                      <span>Legal & Compliance</span>
                      <span className="font-mono text-yellow-400 font-bold">62%</span>
                    </div>
                    <div className="w-full bg-[#2D2D2D] h-1.5 rounded-full overflow-hidden">
                      <div className="bg-yellow-500 h-full w-[62%]" />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Quiz Progress</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[#A1A1A1] text-[11px] leading-relaxed">
                  Questions answered: <strong className="text-white font-mono">{answeredCount}/10</strong>. Answers automatically populate telemetry evaluation models.
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 3: TELEMETRY */}
          {currentStep === 'telemetry' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Why This Matters</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] leading-relaxed italic text-[#CCCCCC]">
                  Copilot operates strictly on Microsoft Graph permission boundaries. Direct tenant correlation verifies query health, index latency, and permission boundaries before license assignment.
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Signal Checks</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] space-y-2 text-[#A1A1A1] text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-[#0078D4]">■</span> Graph API Request Density
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#0078D4]">■</span> SharePoint Inheritance Drift
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#0078D4]">■</span> Exchange & Teams Webhook Health
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 4: PERSONAS */}
          {currentStep === 'personas' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Cohort Rules</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] leading-relaxed text-[#CCCCCC]">
                  Prioritize cohorts with <strong className="text-white font-mono">Opportunity &gt; 85</strong> and <strong className="text-white font-mono">Risk &lt; 35</strong> for Wave 1 deployment to achieve rapid ROI wins.
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Top Recommendation</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#0078D4]/40 text-[11px] text-[#E1E1E1]">
                  <strong>Executive Leadership</strong> & <strong>Sales Ops</strong> demonstrate the highest velocity return (+6.5 hrs/wk).
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 5: USE CASES */}
          {currentStep === 'use-cases' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Recommended Use Cases</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] text-[#CCCCCC]">
                  Executive Briefings, Proposal Drafting, and Custom Declarative Agents are unlocked for rollout.
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Blocked Workflows</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-rose-900/50 text-[11px] text-[#E1E1E1]">
                  Contract Redline Synthesis requires sensitivity label enforcement. Enable guardrails in Screen 06.
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 6: SECURITY */}
          {currentStep === 'security' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Current Posture</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#888888]">CA01 MFA:</span>
                    <span className={governance.ca01 ? "text-green-400 font-mono font-bold" : "text-rose-400 font-mono font-bold"}>
                      {governance.ca01 ? "ENFORCED" : "OFF"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#888888]">PIM Active:</span>
                    <span className={governance.pim ? "text-green-400 font-mono font-bold" : "text-rose-400 font-mono font-bold"}>
                      {governance.pim ? "ACTIVE" : "OFF"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#888888]">Sensitivity Labels:</span>
                    <span className={governance.sensitivityLabels ? "text-green-400 font-mono font-bold" : "text-rose-400 font-mono font-bold"}>
                      {governance.sensitivityLabels ? "ACTIVE" : "OFF"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#888888]">DLP Enforcement:</span>
                    <span className="text-[#0078D4] uppercase font-mono font-bold">{governance.dlp}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 7: ROI */}
          {currentStep === 'roi' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">High-Value Drivers</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] text-[#CCCCCC]">
                  Executive Leadership and Sales AE teams yield <strong>$24.5k</strong> and <strong>$18.2k</strong> in individual return per seat annually.
                </div>
              </div>
            </div>
          )}

          {/* SCREEN 8: DOCUMENTS */}
          {currentStep === 'documents' && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-bold text-[#A1A1A1] uppercase mb-3">Deliverables Overview</div>
                <div className="p-4 bg-[#1F1F1F] rounded-md border border-[#2D2D2D] text-[11px] text-[#CCCCCC] leading-relaxed">
                  All 4 board deliverables support interactive viewing, embedded metric charts, and PDF exports.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bot Footer */}
      {!isCollapsed && (
        <div className="mt-auto p-6 bg-[#161616] border-t border-[#2D2D2D]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0078D4] to-[#00F0FF] flex items-center justify-center text-[10px] font-bold text-white shrink-0">
              AI
            </div>
            <div>
              <div className="text-xs font-bold text-white leading-none">Assessment Bot</div>
              <div className="text-[10px] text-[#0078D4] mt-1">Listening to context...</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
