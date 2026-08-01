import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { WhiteboardNode } from '../types';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ChevronUp,
  ChevronDown,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  FileText,
  X,
} from 'lucide-react';
import { audioSynth } from '../utils/audioSynth';

export interface SOWFinding {
  id: string;
  phaseId: number;
  title: string;
  detail: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Safe';
  status: 'discovered' | 'remediated' | 'pending';
  nodeId?: string;
}

export interface SOWPhase {
  id: number;
  title: string;
  shortTitle: string;
  description: string;
  findings: SOWFinding[];
}

interface SOWPhasesDockProps {
  nodes: WhiteboardNode[];
  activeBeatId: number;
  readinessScore: number;
  dlpCoverage: number;
  oversharingSites: number;
  onSelectNode?: (node: WhiteboardNode) => void;
  onDiscussFinding?: (promptText: string) => void;
}

export const SOWPhasesDock: React.FC<SOWPhasesDockProps> = ({
  nodes,
  activeBeatId,
  readinessScore,
  dlpCoverage,
  oversharingSites,
  onSelectNode,
  onDiscussFinding,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activePhaseTab, setActivePhaseTab] = useState<number>(1);
  const [newlyAddedFindingId, setNewlyAddedFindingId] = useState<string | null>(null);
  const [flyingBadge, setFlyingBadge] = useState<{ id: string; title: string } | null>(null);

  // Derive findings dynamically based on beat & nodes status
  const isPurviewRemediated = dlpCoverage > 70 || readinessScore > 75;

  const phases: SOWPhase[] = [
    {
      id: 1,
      title: 'Phase 1: Discovery & Copilot Readiness Assessment',
      shortTitle: 'Phase 1: Discovery',
      description: 'Audit M365 tenant index, EEEU oversharing, and license readiness.',
      findings: [
        {
          id: 'f-1',
          phaseId: 1,
          title: `${oversharingSites} Oversharing Sites exposed via Semantic Index`,
          detail: '312 SharePoint/Teams sites open to Everyone Except External Users without labeling.',
          severity: oversharingSites > 500 ? 'High' : 'Safe',
          status: oversharingSites > 500 ? 'discovered' : 'remediated',
          nodeId: 'node-sprawl',
        },
        {
          id: 'f-2',
          phaseId: 1,
          title: 'Semantic Search EEEU Open Access Gap',
          detail: 'Executive compensation & M&A files indexable by standard employee prompts.',
          severity: isPurviewRemediated ? 'Safe' : 'Critical',
          status: isPurviewRemediated ? 'remediated' : 'discovered',
          nodeId: 'node-oversharing',
        },
        {
          id: 'f-3',
          phaseId: 1,
          title: `Technical License Readiness (${readinessScore}%)`,
          detail: 'Copilot license assignment & tenant enterprise agreement alignment.',
          severity: readinessScore > 70 ? 'Safe' : 'Medium',
          status: readinessScore > 70 ? 'remediated' : 'pending',
          nodeId: 'node-readiness',
        },
      ],
    },
    {
      id: 2,
      title: 'Phase 2: Purview DLP & Governance Remediation',
      shortTitle: 'Phase 2: Governance',
      description: 'Enforce Microsoft Purview DLP policies, sensitivity labels, and credit card/SSN safeguards.',
      findings: [
        {
          id: 'f-4',
          phaseId: 2,
          title: 'Unlabeled Executive SSNs & Salary Files in Open Chats',
          detail: 'HR spreadsheets stored in Teams chats accessible to Copilot queries.',
          severity: isPurviewRemediated ? 'Safe' : 'Critical',
          status: isPurviewRemediated ? 'remediated' : activeBeatId >= 2 ? 'discovered' : 'pending',
          nodeId: 'node-dlp',
        },
        {
          id: 'f-5',
          phaseId: 2,
          title: `Purview DLP Policy Coverage (${dlpCoverage}%)`,
          detail: 'Automated data loss prevention rules preventing support reps emailing PII.',
          severity: dlpCoverage > 75 ? 'Safe' : 'High',
          status: dlpCoverage > 75 ? 'remediated' : activeBeatId >= 2 ? 'discovered' : 'pending',
          nodeId: 'node-dlp',
        },
        {
          id: 'f-6',
          phaseId: 2,
          title: 'Retail Credit Card & Customer PII Exposure Safeguards',
          detail: 'DLP blocking rules for PCI compliance across support desk mailboxes.',
          severity: dlpCoverage > 75 ? 'Safe' : 'High',
          status: dlpCoverage > 75 ? 'remediated' : 'discovered',
        },
      ],
    },
    {
      id: 3,
      title: 'Phase 3: Conditional Access & Identity Endpoint Hardening',
      shortTitle: 'Phase 3: Identity',
      description: 'Restrict unmanaged BYOD endpoints, external guest access, and privilege sprawl.',
      findings: [
        {
          id: 'f-7',
          phaseId: 3,
          title: 'Unmanaged BYOD Devices Accessing Copilot Without MFA',
          detail: 'Conditional Access policy required to enforce Intune device compliance.',
          severity: 'Medium',
          status: activeBeatId >= 3 ? 'discovered' : 'pending',
          nodeId: 'node-conditional-access',
        },
        {
          id: 'f-8',
          phaseId: 3,
          title: 'External Guest Sharing & Session Control Gaps',
          detail: 'Guest accounts in Teams with unmonitored Copilot prompt interaction permissions.',
          severity: 'Medium',
          status: activeBeatId >= 3 ? 'discovered' : 'pending',
        },
      ],
    },
    {
      id: 4,
      title: 'Phase 4: Copilot Adoption & Value Realization',
      shortTitle: 'Phase 4: Adoption',
      description: 'Empower 1,500 target seats with prompt engineering, ROI tracking, and executive sign-off.',
      findings: [
        {
          id: 'f-9',
          phaseId: 4,
          title: 'Copilot Champion Prompt Engineering Guidance',
          detail: 'Structured prompt libraries saving 5.2 hrs/week per pilot employee.',
          severity: activeBeatId === 4 ? 'Safe' : 'Medium',
          status: activeBeatId === 4 ? 'remediated' : 'pending',
          nodeId: 'node-business-impact',
        },
        {
          id: 'f-10',
          phaseId: 4,
          title: 'Executive Boardroom Assurance & ROI Sign-off',
          detail: 'CISO & Legal sign-off for full enterprise Copilot expansion.',
          severity: activeBeatId === 4 ? 'Safe' : 'Medium',
          status: activeBeatId === 4 ? 'remediated' : 'pending',
        },
      ],
    },
  ];

  // Animate new finding entrance when activeBeatId shifts
  useEffect(() => {
    if (activeBeatId > 1) {
      const newFindingTitle =
        activeBeatId === 2
          ? 'Purview Executive SSN & Salary Exposure'
          : activeBeatId === 3
          ? 'Unmanaged BYOD MFA Conditional Access Gap'
          : 'Executive Boardroom ROI Assurance Sign-off';

      setFlyingBadge({ id: `fly-${activeBeatId}`, title: newFindingTitle });
      audioSynth.playCardSwoosh();

      const timer = setTimeout(() => {
        setFlyingBadge(null);
        setNewlyAddedFindingId(`beat-${activeBeatId}`);
      }, 1400);

      return () => clearTimeout(timer);
    }
  }, [activeBeatId]);

  const totalFindings = phases.flatMap((p) => p.findings).length;
  const remediatedCount = phases.flatMap((p) => p.findings).filter((f) => f.status === 'remediated').length;
  const criticalCount = phases.flatMap((p) => p.findings).filter((f) => f.severity === 'Critical').length;

  return (
    <div className="absolute bottom-3 left-3 sm:bottom-5 sm:left-5 z-40 pointer-events-auto">
      {/* Flying Holographic Finding Particle Animation into Dock */}
      <AnimatePresence>
        {flyingBadge && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, x: 120, y: -120 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.3 }}
            transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-24 left-10 z-50 px-4 py-2 rounded-2xl bg-gradient-to-r from-rose-500/90 via-purple-600/90 to-cyan-500/90 text-white font-mono font-bold text-xs shadow-[0_0_20px_rgba(244,63,94,0.4)] border border-white/30 flex items-center gap-2 pointer-events-none transform-gpu will-change-transform"
          >
            <Sparkles className="w-4 h-4 text-cyan-200" />
            <span>NEW FINDING IN SOW DOCK: {flyingBadge.title}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed Bubble Trigger Button */}
      {!isExpanded ? (
        <motion.button
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            audioSynth.playHoverTick();
            setIsExpanded(true);
          }}
          className={`px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-3xl bg-slate-950/95 border-2 ${
            criticalCount > 0
              ? 'border-rose-500/80 shadow-[0_0_30px_rgba(244,63,94,0.4)]'
              : 'border-cyan-400/80 shadow-[0_0_30px_rgba(6,182,212,0.3)]'
          } backdrop-blur-2xl text-slate-100 font-mono text-xs flex items-center gap-2.5 shadow-2xl cursor-pointer transition-all group`}
        >
          {/* Pulsing Dock Icon Badge */}
          <div
            className={`p-1.5 rounded-full ${
              criticalCount > 0 ? 'bg-rose-950 text-rose-400' : 'bg-cyan-950 text-cyan-400'
            }`}
          >
            <Layers className="w-4 h-4 animate-pulse" />
          </div>

          <div className="flex flex-col items-start text-left">
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-wider text-cyan-200 text-xs">SOW PHASES & FINDINGS</span>
              {criticalCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-slate-950 font-extrabold text-[9px] animate-pulse">
                  {criticalCount} CRITICAL
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400">
              {remediatedCount}/{totalFindings} Findings Remediated • SOW Scope
            </span>
          </div>

          <div className="ml-1 p-1 rounded-full bg-slate-900 group-hover:bg-cyan-950 text-slate-300 group-hover:text-cyan-300 transition-colors">
            <ChevronUp className="w-4 h-4" />
          </div>
        </motion.button>
      ) : (
        /* Expanded SOW Drawer Card */
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 30 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="w-[340px] sm:w-[420px] max-h-[520px] rounded-3xl bg-slate-950/95 border border-cyan-500/50 backdrop-blur-2xl shadow-[0_0_50px_rgba(6,182,212,0.3)] p-4 flex flex-col justify-between overflow-hidden"
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-cyan-950 border border-cyan-500/40 text-cyan-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono flex items-center gap-2">
                  <span>STATEMENT OF WORK (SOW) DOCK</span>
                </h4>
                <p className="text-[10px] text-slate-400">Microsoft 365 Copilot Remediation Scope</p>
              </div>
            </div>

            <button
              onClick={() => {
                audioSynth.playHoverTick();
                setIsExpanded(false);
              }}
              className="p-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Phase Selector Tabs */}
          <div className="flex items-center gap-1 my-2 overflow-x-auto custom-scrollbar pb-1">
            {phases.map((p) => {
              const phaseDiscovered = p.findings.filter((f) => f.status === 'discovered').length;
              const phaseRemediated = p.findings.filter((f) => f.status === 'remediated').length;

              return (
                <button
                  key={p.id}
                  onClick={() => {
                    audioSynth.playHoverTick();
                    setActivePhaseTab(p.id);
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-[10px] font-mono font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                    activePhaseTab === p.id
                      ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
                      : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span>P{p.id}</span>
                  {phaseRemediated > 0 && <CheckCircle2 className="w-3 h-3 text-emerald-900" />}
                  {phaseDiscovered > 0 && <ShieldAlert className="w-3 h-3 text-rose-900" />}
                </button>
              );
            })}
          </div>

          {/* Active Phase Details */}
          {phases
            .filter((p) => p.id === activePhaseTab)
            .map((p) => (
              <div key={p.id} className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2 my-1">
                <div className="p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800">
                  <h5 className="text-xs font-bold text-cyan-300 font-mono mb-0.5">{p.title}</h5>
                  <p className="text-[11px] text-slate-400">{p.description}</p>
                </div>

                {/* Nested Findings List */}
                <div className="space-y-2">
                  <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider block">
                    Nested Audit Findings ({p.findings.length}):
                  </span>

                  {p.findings.map((f) => (
                    <motion.div
                      key={f.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-3 rounded-2xl border transition-all flex flex-col gap-1.5 ${
                        f.severity === 'Critical'
                          ? 'bg-rose-950/40 border-rose-500/50 text-rose-100 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
                          : f.severity === 'High'
                          ? 'bg-amber-950/40 border-amber-500/50 text-amber-100'
                          : f.status === 'remediated'
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-100'
                          : 'bg-slate-900/80 border-slate-800 text-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          {f.status === 'remediated' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : f.severity === 'Critical' ? (
                            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 animate-bounce" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          )}
                          <span>{f.title}</span>
                        </div>

                        <span
                          className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-extrabold uppercase border flex-shrink-0 ${
                            f.status === 'remediated'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                              : f.severity === 'Critical'
                              ? 'bg-rose-950 text-rose-300 border-rose-500/60'
                              : 'bg-amber-950 text-amber-300 border-amber-500/60'
                          }`}
                        >
                          {f.status === 'remediated' ? 'REMEDIATED' : f.severity}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-300 leading-snug">{f.detail}</p>

                      {/* Action buttons */}
                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/5">
                        {f.nodeId && onSelectNode && (
                          <button
                            onClick={() => {
                              const targetNode = nodes.find((n) => n.id === f.nodeId);
                              if (targetNode) onSelectNode(targetNode);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono font-bold transition-colors cursor-pointer"
                          >
                            INSPECT NODE
                          </button>
                        )}
                        {onDiscussFinding && (
                          <button
                            onClick={() => {
                              onDiscussFinding(`Let's walk through our remediation steps for SOW finding: ${f.title}`);
                              setIsExpanded(false);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono font-bold transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <span>DISCUSS IN BRIEFING</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}

          {/* SOW Bottom Progress Bar */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] font-mono text-slate-300">
                Remediation Readiness: <span className="font-bold text-emerald-400">{readinessScore}%</span>
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-[10px] font-mono text-cyan-400 hover:underline cursor-pointer"
            >
              CLOSE DOCK
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};
