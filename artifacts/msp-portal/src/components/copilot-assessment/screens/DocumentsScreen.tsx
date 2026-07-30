import React, { useState } from 'react';
import { DocumentDeliverable } from '../types';
import { 
  FileCheck, 
  Download, 
  Clock, 
  CheckCircle2, 
  Sparkles,
  Layers,
  ArrowRight,
  FileText,
  Mail,
  Share2,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  Lock,
  Award,
  Zap,
  Briefcase,
  Users,
  ShieldCheck,
  TrendingUp,
  FileSpreadsheet,
  AlertCircle,
  ExternalLink
} from 'lucide-react';

interface ExtendedDocumentItem {
  id: string;
  title: string;
  category: string;
  type: string;
  status: 'Ready' | 'Updated' | 'New';
  pageCount: number;
  readTime: string;
  lastUpdated: string;
  fileSize: string;
  summary: string;
  sections: {
    heading: string;
    content: string;
    stats?: { label: string; value: string }[];
  }[];
}

interface DocumentsScreenProps {
  documents?: DocumentDeliverable[];
  onSelectDocument?: (doc: DocumentDeliverable) => void;
  onOpenArchitectureSpec?: () => void;
  onContinue?: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

const DEFAULT_DOCUMENTS: ExtendedDocumentItem[] = [
  {
    id: 'persona-stories',
    title: 'Persona Stories & Value Mapping',
    category: 'User Enablement',
    type: 'Persona Analysis',
    status: 'Ready',
    pageCount: 8,
    readTime: '8 min read',
    lastUpdated: 'July 30, 2026 • 12:45 UTC',
    fileSize: '2.4 MB',
    summary: 'Detailed evaluation of 4 core enterprise cohorts (Executive, Sales, Legal, PMO), mapping high-frequency workflows to Copilot capability clusters and time-recovery metrics.',
    sections: [
      {
        heading: '1. Executive Leadership & Strategy Cohort',
        content: 'Executive personas average 480 weekly email threads and 28 meeting hours. Copilot reduces meeting recap generation and board synthesis cycle time by 68%.',
        stats: [
          { label: 'Weekly Time Reclaimed', value: '6.5 hrs / seat' },
          { label: 'Annual Value', value: '$24,500 / seat' }
        ]
      },
      {
        heading: '2. Sales Operations & RFP Response Cohort',
        content: 'Sales directors leverage Copilot for automated proposal assembly and CRM telemetry integration, cutting RFP turnaround from 14 days down to 4 days.',
        stats: [
          { label: 'RFP Acceleration', value: '3.5x Faster' },
          { label: 'Annual Value', value: '$18,200 / seat' }
        ]
      },
      {
        heading: '3. Legal & Compliance Counsel Cohort',
        content: 'Legal counsel applies Copilot for contract redline analysis and regulatory audit synthesis, subject to Microsoft Purview strict DLP guardrails.',
        stats: [
          { label: 'Review Cycle Reduction', value: '45%' },
          { label: 'DLP Compliance', value: 'Strict' }
        ]
      }
    ]
  },
  {
    id: 'use-case-stories',
    title: 'Use Case Portfolio & Feasibility Matrix',
    category: 'Productivity Strategy',
    type: 'Workflow Portfolio',
    status: 'Ready',
    pageCount: 12,
    readTime: '12 min read',
    lastUpdated: 'July 30, 2026 • 12:50 UTC',
    fileSize: '3.1 MB',
    summary: 'Comprehensive taxonomy of 18 enterprise Copilot use cases across 5 departments, detailing technical feasibility scores, governance prerequisites, and expected ROI.',
    sections: [
      {
        heading: '1. Tier-1 High-Value Recommended Workflows',
        content: 'Executive briefings, RFP automated drafting, support knowledge base grounding, and custom declarative Copilot Studio agents demonstrate >90% technical feasibility.',
        stats: [
          { label: 'Validated Use Cases', value: '14 Active' },
          { label: 'Avg Feasibility', value: '92%' }
        ]
      },
      {
        heading: '2. Blocked Workflows & Governance Prerequisites',
        content: 'Contract redlines and cross-tenant financial consolidation remain conditionally blocked pending Purview sensitivity auto-labeling and Entra ID CA01 enforcement.',
        stats: [
          { label: 'Blocked Workflows', value: '4 Conditional' },
          { label: 'Required Fixes', value: '2 Policies' }
        ]
      }
    ]
  },
  {
    id: 'governance-report',
    title: 'Governance Simulation & Purview Audit Report',
    category: 'Security & Compliance',
    type: 'Governance Plan',
    status: 'Updated',
    pageCount: 15,
    readTime: '15 min read',
    lastUpdated: 'July 30, 2026 • 13:02 UTC',
    fileSize: '4.8 MB',
    summary: 'In-depth assessment of tenant data governance, Microsoft Purview sensitivity labeling coverage, oversharing exposure maps, and guest access DLP policies.',
    sections: [
      {
        heading: '1. Purview Sensitivity Labeling Baseline',
        content: 'Current audit reveals 35% of SharePoint Online sites lack active sensitivity labels. Deploying auto-labeling policies protects ground truth and unlocks safe Graph indexing.',
        stats: [
          { label: 'Label Coverage', value: '65% Current' },
          { label: 'Target Coverage', value: '100%' }
        ]
      },
      {
        heading: '2. Guest Access & External Sharing Guardrails',
        content: 'Recommends enforcing Restricted SharePoint Search and Microsoft Defender for Cloud Apps session monitoring on external collaborator tenant access.',
        stats: [
          { label: 'DLP Setting', value: 'Strict' },
          { label: 'Audit Logging', value: 'Purview Active' }
        ]
      }
    ]
  },
  {
    id: 'security-blast-radius',
    title: 'Security Blast Radius & Conditional Access Report',
    category: 'Identity & Access',
    type: 'Security Posture',
    status: 'Updated',
    pageCount: 10,
    readTime: '10 min read',
    lastUpdated: 'July 30, 2026 • 13:05 UTC',
    fileSize: '3.6 MB',
    summary: 'Evaluation of Entra ID Conditional Access CA01 enforcement, Privileged Identity Management (PIM) just-in-time elevation, and prompt-injection defense boundaries.',
    sections: [
      {
        heading: '1. Entra ID CA01 Conditional Access Analysis',
        content: 'Identified gap in CA01 device compliance enforcement for non-managed endpoints accessing M365 Copilot services. Remediation reduces blast radius by 82%.',
        stats: [
          { label: 'CA01 Posture', value: 'Needs Fix' },
          { label: 'Blast Radius Impact', value: '-82%' }
        ]
      },
      {
        heading: '2. Privileged Access & PIM Evaluation',
        content: 'Global Admin accounts enforce PIM 2-hour elevation windows with approval workflows. Zero static administrative access detected.',
        stats: [
          { label: 'PIM Enforcement', value: 'Active' },
          { label: 'Admin Elevation', value: '2 Hours' }
        ]
      }
    ]
  },
  {
    id: 'roi-report',
    title: 'Copilot Value Engine & Financial ROI Model',
    category: 'Financial Strategy',
    type: 'Financial Model',
    status: 'Ready',
    pageCount: 14,
    readTime: '12 min read',
    lastUpdated: 'July 30, 2026 • 12:55 UTC',
    fileSize: '4.2 MB',
    summary: 'Quantitative financial forecast detailing time recovery (1,240 hrs/mo), 7.2 FTE equivalence, $226k annual total value, and 85 unused license waste elimination.',
    sections: [
      {
        heading: '1. Financial Impact Summary',
        content: '500 M365 Copilot seats evaluated at 75% adoption rate generate $184,000 in operational productivity value and $42,000 in license optimization savings annually.',
        stats: [
          { label: 'Total Annual Value', value: '$226,000 / yr' },
          { label: 'Monthly Hours Saved', value: '1,240 hrs' },
          { label: 'FTE Equivalent', value: '7.2 FTEs' }
        ]
      },
      {
        heading: '2. License Optimization & Reallocation',
        content: 'Flagged 85 unassigned Copilot licenses for immediate reallocation to high-demand sales and PMO cohorts, reclaiming $30/user/mo in wasted spend.',
        stats: [
          { label: 'Unused Licenses', value: '85 Seats' },
          { label: 'Recovered Cost', value: '$42,000 / yr' }
        ]
      }
    ]
  },
  {
    id: 'full-assessment',
    title: 'Full Copilot Executive Assessment Document',
    category: 'Master Deliverable',
    type: 'Board Deliverable',
    status: 'New',
    pageCount: 38,
    readTime: '30 min read',
    lastUpdated: 'July 30, 2026 • 13:08 UTC',
    fileSize: '12.8 MB',
    summary: 'The master comprehensive assessment deliverable combining tenant telemetry, persona stories, governance roadmap, security blast radius remediation, and 3-year ROI statement.',
    sections: [
      {
        heading: '1. Executive Summary & Readiness Verdict',
        content: 'Tenant readiness index stands at 78/100 ("Needs Remediation Fixes"). Conditional approval for Wave 1 rollout upon execution of Entra ID CA01 and Purview sensitivity label fixes.',
        stats: [
          { label: 'Readiness Index', value: '78 / 100' },
          { label: 'Rollout Status', value: 'Wave 1 Conditional' },
          { label: '3-Year Net ROI', value: '342%' }
        ]
      },
      {
        heading: '2. Phased Deployment & Architecture Roadmap',
        content: 'Phase 1 (Remediation: Wks 1-4) → Phase 2 (Wave 1 Rollout: 250 Seats: Wks 5-8) → Phase 3 (Enterprise Scaling: 500 Seats: Wks 9-12).',
        stats: [
          { label: 'Phase 1 Duration', value: '4 Weeks' },
          { label: 'Wave 1 Seats', value: '250 Seats' }
        ]
      },
      {
        heading: '3. Next Steps & Statement of Work (SOW)',
        content: 'Defines engagement scope, implementation deliverables, Microsoft partner governance oversight, and formal Statement of Work authorization.',
        stats: [
          { label: 'Remediation Timeline', value: '30 Days' },
          { label: 'Partner Support', value: 'Dedicated Architect' }
        ]
      }
    ]
  }
];

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  onOpenArchitectureSpec,
  onContinue,
  onExitClick,
  onNavigate
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>('full-assessment');
  const [activePreviewPage, setActivePreviewPage] = useState<number>(1);
  const [emailAddress, setEmailAddress] = useState<string>('shanemccaw.inbox2@gmail.com');
  const [emailRole, setEmailRole] = useState<string>('Executive Sponsor');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState<boolean>(false);

  const selectedDoc = DEFAULT_DOCUMENTS.find(d => d.id === selectedDocId) || DEFAULT_DOCUMENTS[5];

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleDownload = (format: string) => {
    triggerToast(`Exporting "${selectedDoc.title}" as ${format}... File ready!`);
  };

  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailAddress) return;
    setIsSendingEmail(true);
    setTimeout(() => {
      setIsSendingEmail(false);
      triggerToast(`Successfully sent "${selectedDoc.title}" to ${emailAddress} (${emailRole})!`);
    }, 1200);
  };

  const getStatusBadgeStyle = (status: 'Ready' | 'Updated' | 'New') => {
    switch (status) {
      case 'New':
        return 'bg-accent/20 text-accent border-accent/40';
      case 'Updated':
        return 'bg-status-amber/20 text-status-amber border-status-amber/40';
      case 'Ready':
      default:
        return 'bg-status-green/20 text-status-green border-status-green/40';
    }
  };

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">
      
      {/* Toast Notification Bar */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-status-green border border-status-green/80 text-status-green font-mono text-xs px-5 py-2.5 rounded-2xl shadow-2xl flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-status-green" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TOP NAVBAR                                                           */}
      {/* ==================================================================== */}
      <header className="h-14 bg-background/95 border-b border-border px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-status-green border border-status-green/50 flex items-center justify-center text-status-green shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <FileCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-foreground">
                Copilot Document Delivery Center
              </span>
              <span className="text-[10px] font-mono bg-status-green/20 text-status-green border border-status-green/40 px-2 py-0.5 rounded font-extrabold">
                EXECUTIVE DOWNLOAD HUB
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              6 Assessment Deliverables Generated • PDF, DOCX, JSON & Stakeholder Distribution
            </p>
          </div>
        </div>

        {/* Status Pill */}
        <div className="hidden lg:flex items-center space-x-3 bg-muted/60 px-4 py-1.5 rounded-xl border border-border">
          <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold">
            Asset Readiness:
          </span>
          <div className="flex items-center space-x-2">
            <span className="text-sm font-mono font-black text-status-green">
              6 / 6 Documents Ready
            </span>
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-status-green text-status-green border-status-green/30">
              C-Suite Verified
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3">
          {onOpenArchitectureSpec && (
            <button
              onClick={onOpenArchitectureSpec}
              className="hidden md:flex items-center space-x-1.5 text-[10px] font-mono text-primary bg-primary/10 border border-primary/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer hover:bg-primary/80"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>UI Spec Reader</span>
            </button>
          )}

          <button
            onClick={onContinue}
            className="flex items-center space-x-2 bg-gradient-to-r from-status-green via-status-teal to-accent hover:from-status-green hover:to-accent text-primary-foreground font-extrabold px-4 py-1.5 rounded-lg text-xs transition-all shadow-lg shadow-status-green/50 cursor-pointer border border-border uppercase tracking-wider"
          >
            <span>Proceed to SOW</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          {onExitClick && (
            <button
              onClick={onExitClick}
              className="p-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* ==================================================================== */}
      {/* THREE-PANEL BODY LAYOUT                                              */}
      {/* ==================================================================== */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ================================================================== */}
        {/* LEFT PANEL — DOCUMENT LIST                                         */}
        {/* ================================================================== */}
        <aside className="w-80 bg-sidebar/95 border-r border-border p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-status-green" />
              <span>Generated Documents</span>
            </span>
            <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded">
              6 Assets
            </span>
          </div>

          <div className="space-y-2">
            {DEFAULT_DOCUMENTS.map((doc) => {
              const isSelected = doc.id === selectedDocId;
              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    setSelectedDocId(doc.id);
                    setActivePreviewPage(1);
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-background border-status-green ring-1 ring-status-green/50 shadow-[0_0_15px_rgba(16,185,129,0.25)]'
                      : 'bg-background border-border hover:border-border'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                      {doc.category}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${getStatusBadgeStyle(doc.status)}`}>
                      {doc.status}
                    </span>
                  </div>

                  <h3 className={`text-xs font-bold leading-tight mb-1.5 ${isSelected ? 'text-status-green' : 'text-foreground'}`}>
                    {doc.title}
                  </h3>

                  <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/80">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3 text-status-green" />
                      {doc.pageCount} Pages
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {doc.readTime}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — DOCUMENT PREVIEW                                    */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-background p-6 flex flex-col relative scrollbar-thin space-y-5">

          {/* Document Header Bar */}
          <div className="bg-background border border-border rounded-2xl p-5 shadow-xl space-y-3 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono uppercase bg-status-green text-status-green border border-status-green/30 px-2.5 py-0.5 rounded font-bold">
                  {selectedDoc.type}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {selectedDoc.lastUpdated}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded">
                  Confidential — C-Suite Briefing
                </span>
                <span className={`text-[9px] font-mono font-bold px-2.5 py-0.5 rounded border ${getStatusBadgeStyle(selectedDoc.status)}`}>
                  {selectedDoc.status}
                </span>
              </div>
            </div>

            <div>
              <h1 className="text-xl font-extrabold text-foreground tracking-tight">
                {selectedDoc.title}
              </h1>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {selectedDoc.summary}
              </p>
            </div>

            {/* Page Count & Quick Navigation Bar */}
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs font-mono text-muted-foreground">
              <div className="flex items-center space-x-3">
                <span className="text-status-green font-bold">{selectedDoc.pageCount} Total Pages</span>
                <span>•</span>
                <span>File Size: {selectedDoc.fileSize}</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  disabled={activePreviewPage === 1}
                  onClick={() => setActivePreviewPage(prev => Math.max(1, prev - 1))}
                  className="p-1 rounded bg-secondary border border-border text-muted-foreground disabled:opacity-40 hover:bg-secondary cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-muted-foreground">
                  Page <strong className="text-foreground">{activePreviewPage}</strong> of {selectedDoc.pageCount}
                </span>
                <button
                  disabled={activePreviewPage === selectedDoc.pageCount}
                  onClick={() => setActivePreviewPage(prev => Math.min(selectedDoc.pageCount, prev + 1))}
                  className="p-1 rounded bg-secondary border border-border text-muted-foreground disabled:opacity-40 hover:bg-secondary cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* SIMULATED PAPER DOCUMENT PREVIEW CANVAS */}
          <div className="bg-background border border-border rounded-2xl p-8 shadow-2xl relative space-y-6 text-foreground min-h-[500px]">
            {/* Watermark header */}
            <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground border-b border-border pb-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 text-status-green" />
                MICROSOFT 365 COPILOT ENTERPRISE ASSESSMENT
              </span>
              <span>PAGE {activePreviewPage} OF {selectedDoc.pageCount}</span>
            </div>

            {/* Document Content Sections */}
            <div className="space-y-6">
              {selectedDoc.sections.map((sec, idx) => (
                <div key={idx} className="space-y-3 bg-secondary/60 p-4 rounded-xl border border-border/50">
                  <h3 className="text-sm font-bold text-status-green font-mono flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-status-green" />
                    <span>{sec.heading}</span>
                  </h3>
                  
                  <p className="text-xs text-muted-foreground leading-relaxed font-sans">
                    {sec.content}
                  </p>

                  {/* Embedded Stats if available */}
                  {sec.stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                      {sec.stats.map((st, sIdx) => (
                        <div key={sIdx} className="bg-secondary/90 p-2 rounded-lg border border-border">
                          <span className="text-[10px] text-muted-foreground block font-mono">{st.label}:</span>
                          <span className="text-xs font-mono font-bold text-status-green">{st.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Document Footer */}
            <div className="pt-6 border-t border-border flex justify-between items-center text-[9.5px] font-mono text-muted-foreground">
              <span>Confidential • Prepared for Board & C-Suite Review</span>
              <span>Generated via Copilot Value Engine</span>
            </div>
          </div>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — DELIVERY OPTIONS & EXPORT CENTER                     */}
        {/* ================================================================== */}
        <aside className="w-84 bg-sidebar/95 border-l border-border p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Download className="w-4 h-4 text-status-green" />
              <span>Delivery & Export Center</span>
            </span>
            <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded">
              Ready
            </span>
          </div>

          <div className="space-y-4">

            {/* Selected Asset Info Card */}
            <div className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-1.5">
              <span className="text-[10px] font-mono uppercase text-status-green font-bold block">
                Target Selected Document
              </span>
              <p className="text-xs font-bold text-foreground leading-tight">
                {selectedDoc.title}
              </p>
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1 border-t border-border">
                <span>Size: {selectedDoc.fileSize}</span>
                <span>{selectedDoc.pageCount} Pages</span>
              </div>
            </div>

            {/* Download Buttons Section */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase text-muted-foreground font-bold block">
                Direct Document Downloads
              </span>

              {/* PDF Button */}
              <button
                onClick={() => handleDownload('PDF')}
                className="w-full py-2.5 px-3 bg-status-green/15 hover:bg-status-green text-status-green border border-status-green/80 rounded-xl text-xs font-mono font-bold flex items-center justify-between transition-all cursor-pointer shadow-lg"
              >
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-status-green" />
                  <span>Download Executive PDF</span>
                </div>
                <Download className="w-3.5 h-3.5 text-status-green" />
              </button>

              {/* DOCX Button */}
              <button
                onClick={() => handleDownload('DOCX (Word)')}
                className="w-full py-2.5 px-3 bg-secondary hover:bg-secondary text-primary border border-border rounded-xl text-xs font-mono font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span>Download Editable DOCX</span>
                </div>
                <Download className="w-3.5 h-3.5 text-primary" />
              </button>

              {/* JSON Button */}
              <button
                onClick={() => handleDownload('JSON Schema')}
                className="w-full py-2.5 px-3 bg-secondary hover:bg-secondary text-accent border border-border rounded-xl text-xs font-mono font-bold flex items-center justify-between transition-all cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  <FileSpreadsheet className="w-4 h-4 text-accent" />
                  <span>Download Raw Telemetry JSON</span>
                </div>
                <Download className="w-3.5 h-3.5 text-accent" />
              </button>
            </div>

            {/* Email to Stakeholders Form */}
            <form onSubmit={handleSendEmail} className="p-3.5 rounded-xl bg-secondary/90 border border-border space-y-2.5">
              <span className="text-[10px] font-mono uppercase text-primary font-bold block flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-primary" />
                Email to Enterprise Stakeholders
              </span>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground block">Stakeholder Email:</label>
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  placeholder="executive@company.com"
                  className="w-full bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-muted-foreground block">Stakeholder Role:</label>
                <select
                  value={emailRole}
                  onChange={(e) => setEmailRole(e.target.value)}
                  className="w-full bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary cursor-pointer"
                >
                  <option>Executive Sponsor (VP/C-Suite)</option>
                  <option>CISO & Security Officer</option>
                  <option>VP of IT & Operations</option>
                  <option>Business Unit Leader</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isSendingEmail}
                className="w-full py-2 px-3 bg-primary hover:bg-primary text-primary-foreground font-mono font-bold rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>{isSendingEmail ? 'Dispatching Email...' : 'Send Document to Stakeholder'}</span>
              </button>
            </form>

            {/* Bulk Download ZIP Callout */}
            <div className="p-3 rounded-xl bg-accent/40 border border-accent/40 space-y-2">
              <span className="text-[10px] font-mono uppercase text-accent font-bold block">
                Complete Deliverable Bundle (.ZIP)
              </span>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Includes all 6 executive documents, raw telemetry logs, and financial projections in a single encrypted ZIP archive.
              </p>
              <button
                onClick={() => handleDownload('ZIP Bundle (6 Files)')}
                className="w-full py-2 px-3 bg-accent hover:bg-accent text-primary-foreground font-mono font-bold rounded-lg text-xs flex items-center justify-center space-x-2 transition-colors cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Download All 6 Files (.ZIP)</span>
              </button>
            </div>

            {/* Bottom SOW Progression Button */}
            <div className="pt-2">
              <button
                onClick={onContinue}
                className="w-full py-3 px-4 bg-gradient-to-r from-status-green via-status-teal to-accent hover:from-status-green hover:to-accent text-primary-foreground font-black rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shadow-xl shadow-status-green/60 cursor-pointer border border-border uppercase tracking-wider"
              >
                <span>Proceed to Statement of Work (SOW)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

          </div>
        </aside>

      </div>
    </div>
  );
};
