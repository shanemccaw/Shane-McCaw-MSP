import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { startCopilotAssessmentCheckout } from '../checkoutClient';
import {
  Briefcase, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Download, 
  Mail, 
  ShieldCheck, 
  Sparkles, 
  FileText, 
  Plus, 
  Trash2, 
  Check, 
  ShoppingBag, 
  CreditCard, 
  ArrowRight, 
  Building2, 
  ShieldAlert, 
  UserCheck, 
  Layers, 
  HelpCircle, 
  X,
  Award,
  AlertCircle,
  FileSpreadsheet,
  Send,
  Lock,
  ChevronRight,
  TrendingUp,
  Zap,
  CheckCircle,
  XCircle,
  Activity
} from 'lucide-react';

export interface SowScopeModule {
  id: string;
  title: string;
  subtitle: string;
  price: number;
  isRecurring?: boolean;
  durationWeeks: number;
  badge: 'Recommended' | 'High Value' | 'Optional';
  badgeColor: string;
  description: string;
  deliverables: string[];
  defaultSelected: boolean;
  impactReadiness: number;
  impactGovernance: number;
  impactSecurity: number;
  impactRoi: number;
  impactDeployment: number;
  detailNote: string;
}

export const SCOPE_MODULES: SowScopeModule[] = [
  {
    id: 'core-deploy',
    title: '1. Copilot Deployment (Core)',
    subtitle: 'M365 tenant prep, admin center setup & licensing',
    price: 15000,
    durationWeeks: 3,
    badge: 'Recommended',
    badgeColor: 'bg-status-green/20 text-status-green border-status-green/40',
    description: 'Baseline M365 Copilot environment deployment, admin center service principal provisioning, app assignment, and IT team technical briefing.',
    deliverables: [
      'Tenant Technical Assessment & Prerequisites Validation',
      'M365 Admin Center Copilot Licensing & App Deployment',
      'Telemetry Analytics & Adoption Portal Activation'
    ],
    defaultSelected: true,
    impactReadiness: 15,
    impactGovernance: 5,
    impactSecurity: 5,
    impactRoi: 10,
    impactDeployment: 25,
    detailNote: 'Essential baseline for all Copilot services'
  },
  {
    id: 'governance-remediation',
    title: '2. Governance Remediation',
    subtitle: 'Purview auto-labeling & oversharing containment',
    price: 18500,
    durationWeeks: 3,
    badge: 'High Value',
    badgeColor: 'bg-status-amber/20 text-status-amber border-status-amber/40',
    description: 'Remediate critical data exposure risks by deploying Microsoft Purview sensitivity labels across unlabeled SharePoint sites and setting external DLP rules.',
    deliverables: [
      'Microsoft Purview Auto-Labeling Deployment',
      'SharePoint Oversharing Audit & Remediation Plan',
      'External Sharing & Guest Access DLP Guardrails'
    ],
    defaultSelected: true,
    impactReadiness: 25,
    impactGovernance: 31,
    impactSecurity: 15,
    impactRoi: 5,
    impactDeployment: 5,
    detailNote: 'CA01, labels, DLP & external exposure containment'
  },
  {
    id: 'security-hardening',
    title: '3. Security Hardening',
    subtitle: 'Entra ID CA01 & PIM elevation enforcement',
    price: 22000,
    durationWeeks: 3,
    badge: 'High Value',
    badgeColor: 'bg-destructive/20 text-destructive border-destructive/40',
    description: 'Enforce Entra ID Conditional Access CA01 policies for compliant endpoint isolation and configure Privileged Identity Management (PIM) for Copilot admins.',
    deliverables: [
      'Entra ID CA01 Conditional Access Policy Enforcement',
      'Privileged Identity Management (PIM) Elevation Rules',
      'Defender for Cloud Apps Real-Time Session Monitoring'
    ],
    defaultSelected: true,
    impactReadiness: 22,
    impactGovernance: 10,
    impactSecurity: 28,
    impactRoi: 5,
    impactDeployment: 5,
    detailNote: 'Blast radius reduction & tenant hardening'
  },
  {
    id: 'workflow-automation',
    title: '4. Workflow Automation',
    subtitle: 'Custom Copilot Studio agents & Graph connectors',
    price: 28000,
    durationWeeks: 4,
    badge: 'High Value',
    badgeColor: 'bg-accent/20 text-accent border-accent/40',
    description: 'Accelerate productivity with 2 custom declarative Copilot Studio agents for RFP generation and contract review, plus Power Automate flows.',
    deliverables: [
      '2 Declarative Copilot Studio Enterprise Agents',
      'Power Automate Trigger & ERP Integration Workflows',
      'Custom Microsoft Graph Indexing Setup'
    ],
    defaultSelected: false,
    impactReadiness: 18,
    impactGovernance: 5,
    impactSecurity: 5,
    impactRoi: 24,
    impactDeployment: 10,
    detailNote: 'Time saved & automated repetitive flows'
  },
  {
    id: 'persona-training',
    title: '5. Persona Enablement Training',
    subtitle: 'Cohort prompt engineering & department playbooks',
    price: 9500,
    durationWeeks: 2,
    badge: 'Recommended',
    badgeColor: 'bg-status-green/20 text-status-green border-status-green/40',
    description: 'Role-specific prompt engineering workshops for Sales, HR, Legal, and Finance teams, complete with custom department prompt cheat-sheets.',
    deliverables: [
      '4 Department-Specific Enablement Masterclasses',
      'Custom Role Prompt Libraries & Cheat-Sheets',
      'End-User Adoption & Champion Network Playbook'
    ],
    defaultSelected: true,
    impactReadiness: 8,
    impactGovernance: 0,
    impactSecurity: 0,
    impactRoi: 12,
    impactDeployment: 20,
    detailNote: 'Drives daily user habit & prompt mastery'
  },
  {
    id: 'ongoing-monitoring',
    title: '6. Ongoing Copilot Monitoring (Recurring)',
    subtitle: 'Monthly seat optimization & continuous health checks',
    price: 4500,
    isRecurring: true,
    durationWeeks: 4,
    badge: 'Optional',
    badgeColor: 'bg-primary/20 text-primary border-primary/40',
    description: 'Continuous monthly license utilization audits, prompt telemetry analysis, quarterly security posture checks, and recurring MSP optimization.',
    deliverables: [
      'Monthly Unused License Reallocation & Waste Audit',
      'Quarterly Purview Security & DLP Alignment Review',
      'Continuous Prompt Tuning & Model Version Advisory'
    ],
    defaultSelected: false,
    impactReadiness: 10,
    impactGovernance: 12,
    impactSecurity: 10,
    impactRoi: 10,
    impactDeployment: 5,
    detailNote: 'Sustained MSP oversight & continuous tuning'
  },
  {
    id: 'license-optimization',
    title: '7. License Optimization & Waste Reduction',
    subtitle: 'Reallocate inactive seats & optimize M365 SKUs',
    price: 8000,
    durationWeeks: 1,
    badge: 'High Value',
    badgeColor: 'bg-status-green/20 text-status-green border-status-green/40',
    description: 'Identify inactive or low-usage Copilot licenses within 30 days and establish automated seat recycling rules to eliminate seat waste.',
    deliverables: [
      'Copilot License Utilization Telemetry Audit Report',
      'Automated Seat Recycling & Reallocation Pipeline',
      'M365 E3/E5 Step-Up Licensing Cost Optimization'
    ],
    defaultSelected: false,
    impactReadiness: 12,
    impactGovernance: 8,
    impactSecurity: 0,
    impactRoi: 18,
    impactDeployment: 0,
    detailNote: 'Immediate hard dollars cost reduction'
  },
  {
    id: 'custom-workflow',
    title: '8. Custom Departmental Workflow Buildout',
    subtitle: 'Tailored LOB integrations for Finance & Operations',
    price: 16500,
    durationWeeks: 3,
    badge: 'Optional',
    badgeColor: 'bg-accent/20 text-accent border-accent/40',
    description: 'Deep line-of-business custom integration extending Copilot to SAP/Salesforce data sources via custom Graph Connectors.',
    deliverables: [
      'Custom Graph Connector for SAP & Salesforce Data',
      'Line-of-Business Financial Reporting Copilot Bot',
      'Data Protection & Field-Level Access Control Matrix'
    ],
    defaultSelected: false,
    impactReadiness: 14,
    impactGovernance: 5,
    impactSecurity: 5,
    impactRoi: 20,
    impactDeployment: 5,
    detailNote: 'Deep LOB ERP/CRM data connection'
  }
];

// CAPTCHA gate (Cloudflare Turnstile; dev-bypass when unconfigured) — mirrors
// AssessmentPaymentPlan.tsx's CaptchaGate so this real Stripe checkout sends a
// real token when VITE_TURNSTILE_SITE_KEY is set, and a bypass token in dev
// where the server's verifyCaptchaToken also bypasses.
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}
function CaptchaGate({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) {
      onVerify('DEV_BYPASS_TOKEN');
      return;
    }
    if (!window.turnstile) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    let widgetId: string | undefined;
    const renderWidget = () => {
      if (window.turnstile && containerRef.current) {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
        });
      } else {
        setTimeout(renderWidget, 100);
      }
    };
    renderWidget();
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

interface SowScreenProps {
  onContinue?: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const SowScreen: React.FC<SowScreenProps> = ({
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>(
    SCOPE_MODULES.filter(m => m.defaultSelected).map(m => m.id)
  );

  const [companyName, setCompanyName] = useState<string>('Contoso Pharmaceuticals Enterprise');
  const [poNumber, setPoNumber] = useState<string>('PO-2026-M365-8841');
  const [signerName, setSignerName] = useState<string>('Sarah Jenkins, Chief Information Officer');
  const [procurementEmail, setProcurementEmail] = useState<string>('procurement@contoso.com');
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastImpactDelta, setLastImpactDelta] = useState<{ type: 'added' | 'removed'; title: string; delta: number } | null>(null);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [isProcurementSent, setIsProcurementSent] = useState<boolean>(false);

  const { fetchWithAuth } = useAuth();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const handleCaptchaVerify = useCallback((token: string) => setCaptchaToken(token), []);

  // Trigger Toast Notification
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Toggle Module Selection with Live Delta Notification
  const toggleModule = (id: string) => {
    const mod = SCOPE_MODULES.find(m => m.id === id);
    if (!mod) return;

    setSelectedModuleIds(prev => {
      const isCurrentlySelected = prev.includes(id);
      if (isCurrentlySelected) {
        if (prev.length === 1) {
          triggerToast('At least one scope module must remain selected in the SOW.');
          return prev;
        }
        setLastImpactDelta({
          type: 'removed',
          title: mod.title,
          delta: -mod.impactReadiness
        });
        return prev.filter(mId => mId !== id);
      } else {
        setLastImpactDelta({
          type: 'added',
          title: mod.title,
          delta: mod.impactReadiness
        });
        return [...prev, id];
      }
    });
  };

  // Clear last delta banner after 3.5s
  useEffect(() => {
    if (lastImpactDelta) {
      const timer = setTimeout(() => {
        setLastImpactDelta(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [lastImpactDelta]);

  // Selected Modules & Calculations
  const selectedModules = SCOPE_MODULES.filter(m => selectedModuleIds.includes(m.id));
  const subtotal = selectedModules.reduce((acc, m) => acc + m.price, 0);
  const msCredit = 15000; // Microsoft Assessment Funding Credit
  const totalInvestment = Math.max(0, subtotal - msCredit);
  const totalWeeks = Math.max(...selectedModules.map(m => m.durationWeeks), 0);

  // Dynamic Live Scores Calculation
  const baseReadiness = 12;
  const baseGovernance = 15;
  const baseSecurity = 20;
  const baseRoi = 10;

  const rawReadiness = baseReadiness + selectedModules.reduce((acc, m) => acc + m.impactReadiness, 0);
  const readinessScore = Math.min(100, rawReadiness);

  const rawGovernance = baseGovernance + selectedModules.reduce((acc, m) => acc + m.impactGovernance, 0);
  const governanceScore = Math.min(100, rawGovernance);

  const rawSecurity = baseSecurity + selectedModules.reduce((acc, m) => acc + m.impactSecurity, 0);
  const securityScore = Math.min(100, rawSecurity);

  const rawRoi = baseRoi + selectedModules.reduce((acc, m) => acc + m.impactRoi, 0);
  const roiScore = Math.min(100, rawRoi);

  const isCopilotReady = readinessScore >= 80;

  // Aggregated Deliverables
  const aggregatedDeliverables = selectedModules.flatMap(m => m.deliverables);

  const handleSendProcurement = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcurementSent(true);
    triggerToast(`Statement of Work dispatched to procurement (${procurementEmail}) with PO #${poNumber}!`);
  };

  const handleConfirmPurchase = async () => {
    if (!captchaToken || isCheckingOut) return;
    setCheckoutError(null);
    setIsCheckingOut(true);
    try {
      const url = await startCopilotAssessmentCheckout(fetchWithAuth, {
        captchaToken,
        companyName,
        poNumber,
        signerName,
        readinessScore,
        selectedModules,
        creditCents: Math.round(msCredit * 100),
      });
      window.location.href = url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed. Please try again.');
      setIsCheckingOut(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none relative">

      {/* Top Floating Toast Notification */}
      {toastMessage && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-status-green/90 border border-status-green/80 text-status-green font-mono text-xs px-5 py-2.5 rounded-2xl shadow-2xl flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-status-green shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* CONFIRMATION PURCHASE MODAL                                          */}
      {/* ==================================================================== */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-muted/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-background border border-status-green/50 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 relative">
            <button
              onClick={() => setIsPurchaseModalOpen(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-3 border-b border-border">
              <div className="w-10 h-10 rounded-xl bg-status-green/10 border border-status-green/50 flex items-center justify-center text-status-green">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-foreground">Authorize Statement of Work</h3>
                <p className="text-xs text-muted-foreground font-mono">Microsoft 365 Copilot Enterprise Engagement</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground font-mono bg-secondary/80 p-3.5 rounded-xl border border-border">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client Entity:</span>
                <span className="text-foreground font-bold">{companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Authorized Signer:</span>
                <span className="text-foreground">{signerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Purchase Order #:</span>
                <span className="text-status-green font-bold">{poNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Readiness Score Achieved:</span>
                <span className={`font-bold ${isCopilotReady ? 'text-status-green' : 'text-status-amber'}`}>
                  {readinessScore}/100 ({isCopilotReady ? 'Copilot Ready' : 'Remediation Required'})
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border text-sm">
                <span className="text-foreground font-bold">Total Net Investment:</span>
                <span className="text-status-green font-black">${totalInvestment.toLocaleString()} USD</span>
              </div>
            </div>

            <div className="p-3 bg-status-green/40 border border-status-green/30/60 rounded-xl text-[11px] text-status-green flex items-start gap-2">
              <Lock className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Includes 30-day guaranteed price lock and $15,000 Microsoft Partner Assessment Funding Credit. Net 30 payment terms apply upon kickoff.</span>
            </div>

            <CaptchaGate onVerify={handleCaptchaVerify} />

            {checkoutError && (
              <div className="p-2.5 bg-destructive/15 border border-destructive/40 rounded-xl text-[11px] text-destructive flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setIsPurchaseModalOpen(false)}
                disabled={isCheckingOut}
                className="flex-1 py-2.5 bg-secondary hover:bg-secondary text-muted-foreground font-mono rounded-xl text-xs border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPurchase}
                disabled={!captchaToken || isCheckingOut}
                className="flex-1 py-2.5 bg-gradient-to-r from-status-green via-status-teal to-accent hover:from-status-green hover:to-accent text-primary-foreground font-black rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-status-green/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingOut ? 'Redirecting to Stripe…' : 'Confirm & Sign SOW'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* NAVBAR                                                               */}
      {/* ==================================================================== */}
      <header className="h-14 bg-background/95 border-b border-border px-5 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/50 flex items-center justify-center text-accent shadow-[0_0_15px_rgba(99,102,241,0.3)]">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-black uppercase tracking-wider text-foreground">
                Statement of Work & Scope Selection
              </span>
              <span className="text-[10px] font-mono bg-accent/20 text-accent border border-accent/40 px-2 py-0.5 rounded font-extrabold">
                LIVE SCORE CALCULATOR
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Microsoft Consulting Services SOW-2026-M365-092 • Interactive Real-Time SOW Configurator
            </p>
          </div>
        </div>

        {/* Live Top Status Bar */}
        <div className="hidden lg:flex items-center space-x-4 bg-muted/60 px-4 py-1.5 rounded-xl border border-border font-mono">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase text-muted-foreground font-bold">Readiness Score:</span>
            <span className={`text-sm font-black ${isCopilotReady ? 'text-status-green' : 'text-status-amber'}`}>
              {readinessScore}/100
            </span>
          </div>
          <div className="w-px h-4 bg-foreground/10" />
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase text-muted-foreground font-bold">Total Investment:</span>
            <span className="text-sm font-black text-status-green">
              ${totalInvestment.toLocaleString()} USD
            </span>
          </div>
        </div>

        {/* Navigation Actions */}
        <div className="flex items-center space-x-3">
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
        {/* LEFT PANEL — SCOPE OPTIONS (SELECTABLE MODULES)                    */}
        {/* ================================================================== */}
        <aside className="w-84 bg-sidebar/95 border-r border-border p-3.5 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-3 z-20">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5 font-mono">
              <Layers className="w-4 h-4 text-accent" />
              <span>Scope Modules (8 Available)</span>
            </span>
            <span className="text-[9px] font-mono text-accent bg-accent/10 border border-accent px-2 py-0.5 rounded font-bold">
              {selectedModuleIds.length}/8 Active
            </span>
          </div>

          {/* Module List */}
          <div className="space-y-2.5">
            {SCOPE_MODULES.map((mod) => {
              const isSelected = selectedModuleIds.includes(mod.id);
              return (
                <div
                  key={mod.id}
                  onClick={() => toggleModule(mod.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${
                    isSelected
                      ? 'bg-background border-primary ring-1 ring-primary/50 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                      : 'bg-background border-border hover:border-border opacity-70 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-secondary'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${mod.badgeColor}`}>
                        {mod.badge}
                      </span>
                    </div>

                    <span className="text-xs font-mono font-black text-status-green">
                      ${mod.price.toLocaleString()} {mod.isRecurring ? '/mo' : ''}
                    </span>
                  </div>

                  <h3 className={`text-xs font-bold leading-tight mb-1 ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {mod.title}
                  </h3>

                  <p className="text-[10.5px] text-muted-foreground leading-snug mb-2">
                    {mod.subtitle}
                  </p>

                  <div className="pt-1.5 border-t border-border/80 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-primary" />
                      {mod.durationWeeks} Wks
                    </span>
                    <span className="flex items-center gap-1 text-status-green font-bold">
                      <Zap className="w-3 h-3 text-status-amber" />
                      +{mod.impactReadiness} Score
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ================================================================== */}
        {/* CENTER PANEL — DYNAMIC SOW BUILDER                                 */}
        {/* ================================================================== */}
        <main className="flex-1 overflow-y-auto bg-background p-6 flex flex-col relative scrollbar-thin space-y-6">

          {/* Dynamic Impact Delta Notification Banner */}
          {lastImpactDelta && (
            <div className={`p-3 rounded-xl border font-mono text-xs flex items-center justify-between shadow-lg transition-all animate-fadeIn ${
              lastImpactDelta.type === 'added'
                ? 'bg-status-green/15 border-status-green/80 text-status-green'
                : 'bg-destructive/15 border-destructive/80 text-destructive'
            }`}>
              <div className="flex items-center space-x-2">
                {lastImpactDelta.type === 'added' ? (
                  <Sparkles className="w-4 h-4 text-status-green shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                )}
                <span>
                  <strong>{lastImpactDelta.type === 'added' ? 'Scope Added:' : 'Scope Removed:'}</strong> {lastImpactDelta.title}
                </span>
              </div>
              <span className={`font-black px-2.5 py-0.5 rounded text-xs ${
                lastImpactDelta.type === 'added' ? 'bg-status-green/10 text-status-green' : 'bg-destructive/10 text-destructive'
              }`}>
                {lastImpactDelta.type === 'added' ? '+' : ''}{lastImpactDelta.delta} Readiness
              </span>
            </div>
          )}

          {/* SOW Document Main Container */}
          <div className="bg-background border border-border rounded-2xl p-6 shadow-2xl space-y-6 relative">
            
            {/* Header Document Metadata */}
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase bg-accent/10 text-accent border border-accent px-2.5 py-0.5 rounded font-bold">
                  MICROSOFT CONSULTING SERVICES STATEMENT OF WORK
                </span>
                <h1 className="text-xl font-extrabold text-foreground mt-1">
                  M365 COPILOT ENTERPRISE SCOPE & DEPLOYMENT AGREEMENT
                </h1>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  Ref: SOW-2026-M365-092 • Organization: {companyName}
                </p>
              </div>

              <div className="text-right font-mono">
                <span className="text-[10px] text-muted-foreground block">NET INVESTMENT</span>
                <span className="text-2xl font-black text-status-green">${totalInvestment.toLocaleString()} USD</span>
              </div>
            </div>

            {/* Engagement Overview & Executive Context */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-primary font-mono uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <span>Executive Engagement Context</span>
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed font-sans bg-secondary/60 p-4 rounded-xl border border-border/50">
                This Statement of Work (SOW) details the technical deliverables, governance guardrails, security hardening, and persona enablement services required for <strong>{companyName}</strong> to achieve operational readiness for 500 Microsoft 365 Copilot seats. Services are delivered in accordance with Microsoft enterprise architectural standards and Microsoft Solution Assessment best practices.
              </p>
            </div>

            {/* Selected Scope Modules List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-status-green" />
                  <span>Configured Scope Modules ({selectedModules.length} Active)</span>
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground">Click Trash Icon to Remove Module</span>
              </div>

              <div className="space-y-2">
                {selectedModules.map((mod) => (
                  <div key={mod.id} className="bg-secondary/80 p-3.5 rounded-xl border border-border flex items-start justify-between">
                    <div className="space-y-1 pr-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-foreground font-mono">{mod.title}</span>
                        <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${mod.badgeColor}`}>
                          {mod.badge}
                        </span>
                        <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded">
                          +{mod.impactReadiness} Readiness
                        </span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground">{mod.description}</p>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0">
                      <div className="text-right font-mono">
                        <span className="text-xs font-bold text-status-green block">${mod.price.toLocaleString()}</span>
                        <span className="text-[10px] text-muted-foreground">{mod.durationWeeks} Wks</span>
                      </div>
                      <button
                        onClick={() => toggleModule(mod.id)}
                        className="p-1 hover:bg-destructive/15 text-muted-foreground hover:text-destructive rounded-lg transition-colors cursor-pointer border border-transparent hover:border-destructive/30"
                        title="Remove module"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Dynamic Deliverables List */}
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-2">
                  <Award className="w-4 h-4 text-accent" />
                  <span>Aggregated Deliverables ({aggregatedDeliverables.length} Items)</span>
                </h3>
                <span className="text-[10px] font-mono text-accent bg-accent/10 border border-accent px-2 py-0.5 rounded">
                  Auto-Expanding SOW List
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {aggregatedDeliverables.map((del, dIdx) => (
                  <div key={dIdx} className="bg-secondary/60 p-2.5 rounded-lg border border-border/80 text-[11px] font-mono text-foreground flex items-center space-x-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-status-green shrink-0" />
                    <span>{del}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Project Timeline & Phases Schedule */}
            <div className="space-y-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <span>Execution Schedule & Timeline ({totalWeeks} Weeks Total)</span>
                </h3>
                <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded">
                  Parallel Phased Execution
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-secondary/80 p-3 rounded-xl border border-status-amber/40 space-y-1">
                  <span className="text-[10px] text-status-amber font-bold block">WEEKS 1–2</span>
                  <span className="text-foreground font-bold block">Remediation & Hardening</span>
                  <p className="text-[10px] text-muted-foreground">Purview auto-labeling & Entra ID CA01 policy setup</p>
                </div>

                <div className="bg-secondary/80 p-3 rounded-xl border border-primary/40 space-y-1">
                  <span className="text-[10px] text-primary font-bold block">WEEKS 3–4</span>
                  <span className="text-foreground font-bold block">Deployment & Onboarding</span>
                  <p className="text-[10px] text-muted-foreground">Tenant config & cohort prompt engineering workshops</p>
                </div>

                <div className="bg-secondary/80 p-3 rounded-xl border border-accent/40 space-y-1">
                  <span className="text-[10px] text-accent font-bold block">WEEKS 5–6</span>
                  <span className="text-foreground font-bold block">Workflow Agents</span>
                  <p className="text-[10px] text-muted-foreground">Copilot Studio agent creation & Power Automate integration</p>
                </div>

                <div className="bg-secondary/80 p-3 rounded-xl border border-status-green/40 space-y-1">
                  <span className="text-[10px] text-status-green font-bold block">WEEKS 7–8</span>
                  <span className="text-foreground font-bold block">Hand-off & Optimization</span>
                  <p className="text-[10px] text-muted-foreground">Final telemetry review & ongoing MSP seat optimization</p>
                </div>
              </div>
            </div>

            {/* Financial Breakdown */}
            <div className="space-y-3 pt-3 border-t border-border">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider font-mono flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-status-green" />
                <span>Financial Summary & Microsoft Credit Application</span>
              </h3>

              <div className="bg-secondary/90 rounded-xl border border-border p-4 font-mono text-xs space-y-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>Selected Modules Subtotal ({selectedModules.length} Modules):</span>
                  <span className="font-bold text-foreground">${subtotal.toLocaleString()} USD</span>
                </div>

                <div className="flex justify-between text-status-green">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    Microsoft Assessment Partner Funding Credit:
                  </span>
                  <span className="font-bold">-${msCredit.toLocaleString()} USD</span>
                </div>

                <div className="flex justify-between pt-2 border-t border-border text-sm font-black">
                  <span className="text-foreground">Net Investment Authorization Amount:</span>
                  <span className="text-status-green">${totalInvestment.toLocaleString()} USD</span>
                </div>
              </div>
            </div>

          </div>

        </main>

        {/* ================================================================== */}
        {/* RIGHT PANEL — REAL-TIME SCORE + PURCHASE SUMMARY                   */}
        {/* ================================================================== */}
        <aside className="w-88 bg-sidebar/95 border-l border-border p-4 flex flex-col shrink-0 overflow-y-auto scrollbar-thin space-y-4 z-20 font-mono">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <span className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-status-green" />
              <span>Real-Time Scoring Engine</span>
            </span>
            <span className="text-[9px] font-mono text-status-green bg-status-green/15 border border-status-green/30 px-2 py-0.5 rounded font-bold">
              LIVE CALCULATOR
            </span>
          </div>

          {/* 1. COPILOT READINESS OVERALL SCORE */}
          <div className={`p-4 rounded-2xl border transition-all space-y-3 relative overflow-hidden ${
            isCopilotReady 
              ? 'bg-gradient-to-br from-secondary via-status-green/40 to-background border-status-green/60 shadow-[0_0_20px_rgba(16,185,129,0.2)]'
              : 'bg-gradient-to-br from-secondary via-status-amber/40 to-background border-status-amber/60 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-muted-foreground tracking-wider font-bold">
                Copilot Readiness Score
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                isCopilotReady 
                  ? 'bg-status-green/10 text-status-green border-status-green' 
                  : 'bg-status-amber/10 text-status-amber border-status-amber'
              }`}>
                {isCopilotReady ? 'Copilot Ready' : 'Remediation Required'}
              </span>
            </div>

            <div className="flex items-baseline space-x-2">
              <span className={`text-3xl font-black ${isCopilotReady ? 'text-status-green' : 'text-status-amber'}`}>
                {readinessScore}
              </span>
              <span className="text-sm text-muted-foreground font-bold">/ 100</span>
            </div>

            {/* Animated Progress Bar */}
            <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden border border-border p-0.5">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  isCopilotReady ? 'bg-gradient-to-r from-status-green to-status-teal' : 'bg-gradient-to-r from-status-amber to-destructive'
                }`}
                style={{ width: `${readinessScore}%` }}
              />
            </div>

            <p className="text-[10px] text-muted-foreground leading-snug">
              {isCopilotReady 
                ? 'High readiness threshold achieved! All key governance, security, and enablement requirements met.'
                : 'Threshold < 80: Select Governance or Security modules to remediate risk before deployment.'}
            </p>
          </div>

          {/* SUB-CATEGORICAL SCORES */}
          <div className="space-y-2.5">
            <span className="text-[10px] uppercase text-muted-foreground font-bold block border-b border-border pb-1">
              Category Score Breakdown
            </span>

            {/* 2. Governance Score */}
            <div className="bg-secondary/90 p-3 rounded-xl border border-border space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                  Governance Score
                </span>
                <span className="font-extrabold text-primary">{governanceScore}/100</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div className="bg-primary h-full transition-all duration-500" style={{ width: `${governanceScore}%` }} />
              </div>
              <p className="text-[9.5px] text-muted-foreground">
                Purview labels, DLP policies, oversharing containment
              </p>
            </div>

            {/* 3. Security Score */}
            <div className="bg-secondary/90 p-3 rounded-xl border border-border space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-destructive" />
                  Security Score
                </span>
                <span className="font-extrabold text-destructive">{securityScore}/100</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div className="bg-destructive h-full transition-all duration-500" style={{ width: `${securityScore}%` }} />
              </div>
              <p className="text-[9.5px] text-muted-foreground">
                Entra ID CA01, PIM elevation & blast radius reduction
              </p>
            </div>

            {/* 4. ROI Score */}
            <div className="bg-secondary/90 p-3 rounded-xl border border-border space-y-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground font-bold flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-status-green" />
                  ROI & Automation Score
                </span>
                <span className="font-extrabold text-status-green">{roiScore}/100</span>
              </div>
              <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                <div className="bg-status-green h-full transition-all duration-500" style={{ width: `${roiScore}%` }} />
              </div>
              <p className="text-[9.5px] text-muted-foreground">
                Workflow automation, agent buildout & waste reduction
              </p>
            </div>
          </div>

          {/* Terms & Authorization Summary */}
          <div className="p-3 rounded-xl bg-secondary/90 border border-border space-y-2 text-[10.5px]">
            <span className="text-[10px] uppercase text-accent font-bold block flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-accent" />
              SOW Authorization Details
            </span>

            <div className="space-y-1.5 text-muted-foreground">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Entity:</span>
                <span className="text-foreground font-bold">{companyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PO Number:</span>
                <span className="text-status-green font-bold">{poNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Terms:</span>
                <span className="text-foreground">Net 30 • 30-Day Lock</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-1 mt-auto">

            {/* 1. Main Purchase Button */}
            <button
              onClick={() => {
                setCaptchaToken(null);
                setCheckoutError(null);
                setIsPurchaseModalOpen(true);
              }}
              className="w-full py-3 px-4 bg-gradient-to-r from-status-green via-status-teal to-accent hover:from-status-green hover:to-accent text-primary-foreground font-black rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shadow-xl shadow-status-green/60 cursor-pointer border border-border uppercase tracking-wider"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Purchase & Authorize SOW</span>
            </button>

            {/* 2. Send SOW to Procurement Form */}
            <form onSubmit={handleSendProcurement} className="space-y-1.5">
              <div className="flex space-x-1.5">
                <input
                  type="email"
                  value={procurementEmail}
                  onChange={(e) => setProcurementEmail(e.target.value)}
                  placeholder="procurement@company.com"
                  className="flex-1 bg-secondary border border-border rounded-lg px-2.5 py-1 text-[10.5px] text-foreground focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  className="py-1 px-3 bg-primary hover:bg-primary text-primary-foreground font-bold rounded-lg text-[10.5px] shrink-0 cursor-pointer"
                >
                  Procurement
                </button>
              </div>
            </form>

            {/* 3. Download SOW PDF Button */}
            <button
              onClick={() => triggerToast(`Downloading "Statement_of_Work_SOW-2026-M365-092.pdf"... File ready!`)}
              className="w-full py-2.5 px-3 bg-secondary hover:bg-secondary text-muted-foreground rounded-xl text-xs flex items-center justify-center space-x-2 border border-border transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-primary" />
              <span>Download SOW PDF</span>
            </button>

          </div>

        </aside>

      </div>
    </div>
  );
};
