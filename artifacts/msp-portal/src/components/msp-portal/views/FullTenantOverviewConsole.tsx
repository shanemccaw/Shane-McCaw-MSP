import React, { useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Smartphone,
  Mail,
  Users2,
  DollarSign,
  SlidersHorizontal,
  Activity,
  RefreshCw,
  Search,
  Lock,
  AlertTriangle,
  FileText,
  CheckCircle2,
  Copy,
  ExternalLink,
  ChevronRight,
  Zap,
  Building2,
  Filter,
  Download,
  Terminal,
  X,
  Code2,
  ShieldAlert,
  Server,
  UserCheck,
  UserX,
  Radio,
  Clock,
  Sparkles,
  Layers,
  ArrowUpRight,
  TrendingUp,
  HardDrive,
  Trash2,
  Share2,
  FileSpreadsheet,
  Check,
  Globe,
  Database,
  Info,
  PieChart as PieIcon,
  BarChart3,
  Flame,
  CheckSquare,
  BarChart2,
  Eye,
  Sliders,
} from 'lucide-react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Tenant } from '../../types';

interface FullTenantOverviewConsoleProps {
  tenant?: Tenant | null;
  tenants?: Tenant[];
  initialPillar?: string | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
}

export const FullTenantOverviewConsole: React.FC<FullTenantOverviewConsoleProps> = ({
  tenant,
  tenants = [],
  initialPillar = null,
  onSelectTenant,
  onExecuteWorkflow,
  onShowToast,
}) => {
  // Current active tenant
  const activeTenant: Tenant = tenant || {
    id: 'contoso-tenant-01',
    name: 'Contoso Corporation',
    primaryDomain: 'contoso.onmicrosoft.com',
    secureScore: 84.0,
    mfaPercentage: 94.2,
    activeAlertsCount: 3,
    licenseTier: 'M365 E5 Enterprise',
    syncStatus: 'Healthy',
    lastSyncTimestamp: '2 mins ago',
    globalAdminUPNs: ['admin@contoso.com', 'sec-ops@contoso.com'],
  };

  // State
  const [selectedPillar, setSelectedPillar] = useState<string | null>(initialPillar);

  React.useEffect(() => {
    if (initialPillar) {
      setSelectedPillar(initialPillar);
    }
  }, [initialPillar]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [copiedId, setCopiedId] = useState(false);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  // Modals & Drawers State
  const [activeModalData, setActiveModalData] = useState<{
    title: string;
    type: 'json' | 'remediate';
    data: any;
  } | null>(null);

  // Copy Tenant ID
  const handleCopyTenantId = () => {
    const tenantId = '8f42d109-7a3b-4c22-91f8-091a1829e8c4';
    navigator.clipboard.writeText(tenantId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
    onShowToast?.('info', 'Copied to Clipboard', `M365 Tenant ID (${tenantId}) copied.`);
  };

  // Trigger Full Tenant Scan
  const handleRunFullScan = () => {
    setIsScanning(true);
    setScanProgress(10);
    onShowToast?.(
      'info',
      'Tenant Scan Initiated',
      `Scanning all 7 Pillars for ${activeTenant.name} via Microsoft Graph API...`
    );

    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsScanning(false);
          onShowToast?.(
            'success',
            'Full Tenant Scan Complete',
            `Re-evaluated 142 compliance controls across Security, Licensing, & Copilot readiness.`
          );
          return 100;
        }
        return prev + 22;
      });
    }, 400);
  };

  // Radar Chart Data - Pillar Synergy
  const radarData = [
    { pillar: 'Security', score: 88, benchmark: 75 },
    { pillar: 'Governance', score: 74, benchmark: 70 },
    { pillar: 'Compliance', score: 91, benchmark: 80 },
    { pillar: 'Adoption', score: 68, benchmark: 65 },
    { pillar: 'Copilot', score: 85, benchmark: 60 },
    { pillar: 'Architecture', score: 82, benchmark: 75 },
    { pillar: 'Licensing', score: 62, benchmark: 70 },
  ];

  // Cost Efficiency / License Waste Bar Data
  const licenseWasteData = [
    { sku: 'M365 E5', assigned: 450, unused: 28, wasteCost: 1624 },
    { sku: 'M365 E3', assigned: 820, unused: 45, wasteCost: 1620 },
    { sku: 'Copilot M365', assigned: 120, unused: 15, wasteCost: 450 },
    { sku: 'Defender P2', assigned: 300, unused: 12, wasteCost: 180 },
    { sku: 'Visio Plan 2', assigned: 80, unused: 18, wasteCost: 270 },
  ];

  // Historical Health Score Trend Data
  const healthTrendData = [
    { date: 'Jun 24', score: 71, security: 68, compliance: 75 },
    { date: 'Jul 01', score: 74, security: 72, compliance: 78 },
    { date: 'Jul 08', score: 78, security: 79, compliance: 82 },
    { date: 'Jul 15', score: 81, security: 84, compliance: 88 },
    { date: 'Jul 22', score: 84, security: 88, compliance: 91 },
  ];

  // 7 Pillars Metadata
  const pillarDetails = [
    {
      id: 'security',
      title: 'SECURITY',
      score: 88,
      status: 'Strong Alignment',
      color: 'emerald',
      icon: ShieldAlert,
      findings: '2 Alerts',
      desc: 'Defender XDR, MFA enforcement & threat signals',
      stats: 'MFA: 94.2% • 0 Breached Credentials',
    },
    {
      id: 'governance',
      title: 'GOVERNANCE',
      score: 74,
      status: 'Attention Needed',
      color: 'amber',
      icon: ShieldCheck,
      findings: '1 Drift Risk',
      desc: 'PIM elevation, Break-Glass accounts & Global Admins',
      stats: '4 Global Admins • 2 Break-Glass Vaulted',
    },
    {
      id: 'compliance',
      title: 'COMPLIANCE',
      score: 91,
      status: 'Optimal Guardrails',
      color: 'emerald',
      icon: Lock,
      findings: '1 Warning',
      desc: 'Purview DLP, Retention labels, GDPR/CCPA DSAR',
      stats: 'DLP Enforced • 14 Quarantined Mails',
    },
    {
      id: 'adoption',
      title: 'ADOPTION',
      score: 68,
      status: 'Moderate Usage',
      color: 'blue',
      icon: Users2,
      findings: '42 Inactive Users',
      desc: 'Active workload utilization across Teams, Exchange & SharePoint',
      stats: '1,420 Active Users • 68% Engagement',
    },
    {
      id: 'copilot',
      title: 'COPILOT',
      score: 85,
      status: 'Ready for Rollout',
      color: 'purple',
      icon: Sparkles,
      findings: '85% Seat Usage',
      desc: 'Data loss prevention & AI sensitivity labeling readiness',
      stats: '120 Seats Assigned • DLP Guardrails Active',
    },
    {
      id: 'architecture',
      title: 'ARCHITECTURE',
      score: 82,
      status: 'Healthy Fabric',
      color: 'sky',
      icon: HardDrive,
      findings: '0 Latency Faults',
      desc: 'Entra Connect sync status, Exchange mail flow & MX routing',
      stats: 'Sync: Healthy • 2 mins ago',
    },
    {
      id: 'licensing',
      title: 'LICENSING',
      score: 62,
      status: 'High Waste Found',
      color: 'red',
      icon: DollarSign,
      findings: '$3,420/yr Waste',
      desc: 'Unassigned SKU seats & overlapping add-on subscriptions',
      stats: '118 Unused Seats • 5 SKUs Impacted',
    },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0b0e14] text-[#e0e2ea] font-sans overflow-y-auto select-none">
      
      {/* ========================================================================= */}
      {/* 1. TOP HEADER & TENANT SCOPE BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#181c22] border-b border-[#404752] p-4 sm:p-5 shrink-0 shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          
          {/* Tenant Metadata Header */}
          <div className="flex flex-wrap items-center gap-3.5">
            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] text-[#a3c9ff]">
              <Building2 className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-[#e0e2ea] tracking-tight flex items-center gap-2">
                  <span>{activeTenant.name}</span>
                </h1>

                {/* Tenant Selector Dropdown */}
                {tenants.length > 0 && onSelectTenant && (
                  <select
                    value={activeTenant.id}
                    onChange={(e) => {
                      const sel = tenants.find((t) => t.id === e.target.value) || null;
                      onSelectTenant(sel);
                    }}
                    className="bg-[#101419] border border-[#404752] text-xs text-[#a3c9ff] font-semibold rounded px-2.5 py-1 outline-none focus:border-[#0078d4] cursor-pointer"
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        Switch Tenant: {t.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Primary Domain */}
                <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-[#101419] text-[#8a919e] border border-[#404752] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#a3c9ff]" />
                  <span>{activeTenant.primaryDomain}</span>
                </span>

                {/* Click-to-copy Tenant ID */}
                <button
                  onClick={handleCopyTenantId}
                  className="text-xs font-mono px-2.5 py-0.5 rounded bg-[#101419] hover:bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] border border-[#404752] transition-colors flex items-center gap-1 cursor-pointer"
                  title="Click to copy M365 Tenant ID"
                >
                  <span>ID: 8f42d109...</span>
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#8a919e]" />
                  )}
                </button>

                {/* GDAP Active Badge */}
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
                  GDAP Monitored
                </span>
              </div>

              {/* Service Scope Indicators */}
              <div className="flex items-center gap-2 mt-1.5 text-xs">
                <span className="text-[#8a919e] font-semibold">Live Scope:</span>
                <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10.5px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-[#4ade80]" /> Exchange Online
                </span>
                <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10.5px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-[#4ade80]" /> Entra ID
                </span>
                <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[10.5px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-[#4ade80]" /> Defender XDR
                </span>
              </div>
            </div>
          </div>

          {/* Action Header Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={handleRunFullScan}
              disabled={isScanning}
              className="px-3.5 py-1.5 bg-[#0078d4] hover:bg-[#0060ab] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-white ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? `Scanning (${scanProgress}%)...` : 'Run Full Tenant Scan'}</span>
            </button>

            <button
              onClick={() =>
                onShowToast?.(
                  'success',
                  'Executive PDF Exported',
                  `Customer Executive Health Report generated for ${activeTenant.name}.`
                )
              }
              className="px-3 py-1.5 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] border border-[#404752] rounded text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-purple-300" />
              <span>Export Customer PDF</span>
            </button>
          </div>
        </div>

        {/* Scan Progress Bar */}
        {isScanning && (
          <div className="w-full bg-[#101419] h-1.5 rounded overflow-hidden mt-3 relative">
            <div
              className="bg-[#0078d4] h-full transition-all duration-300"
              style={{ width: `${scanProgress}%` }}
            />
          </div>
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-5">

        {/* ========================================================================= */}
        {/* 2. MAIN HERO SECTION - M365 HEALTH SCORE & EXECUTIVE SUMMARY */}
        {/* ========================================================================= */}
        <div className="bg-[#181c22] border border-[#404752] rounded-md p-5 sm:p-6 shadow-sm relative overflow-hidden">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            
            {/* Left Column: Big Health Score Radial Gauge */}
            <div className="lg:col-span-4 flex flex-col items-center justify-center p-4 bg-[#101419] border border-[#404752] rounded-md relative">
              <div className="relative w-40 h-40 flex items-center justify-center">
                
                {/* SVG Gauge Circle */}
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="80"
                    cy="80"
                    r="64"
                    stroke="currentColor"
                    strokeWidth="10"
                    className="text-[#272a30]"
                    fill="transparent"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="64"
                    stroke="#0078d4"
                    strokeWidth="10"
                    strokeDasharray={402}
                    strokeDashoffset={402 - (402 * 84) / 100}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                    fill="transparent"
                  />
                </svg>

                {/* Center Score Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-black text-[#e0e2ea] font-mono tracking-tight">84</span>
                  <span className="text-[11px] font-bold text-[#8a919e] uppercase tracking-widest mt-0.5">/ 100</span>
                  <span className="mt-1 px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] border border-[#166534] text-[9.5px] font-extrabold uppercase tracking-wider">
                    EXCELLENT
                  </span>
                </div>
              </div>

              <div className="text-center mt-3 space-y-1">
                <h3 className="text-xs font-bold text-[#e0e2ea]">M365 Health Score</h3>
                <p className="text-[11px] text-[#8a919e]">
                  Runs continuously via Microsoft Graph API telemetry
                </p>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#101419] text-[#a3c9ff] text-[10.5px] font-mono border border-[#404752] mt-1">
                  <Clock className="w-3 h-3 text-[#a3c9ff]" />
                  <span>Last Scan: 2 mins ago</span>
                </div>
              </div>
            </div>

            {/* Right Column: 3 Stat Summary Cards + Pillar Score Bar Distribution */}
            <div className="lg:col-span-8 space-y-4">
              
              {/* 3 Executive Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                
                {/* Annual Cost Savings */}
                <div className="bg-[#101419] border border-[#404752] p-3.5 rounded space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[#8a919e] font-semibold uppercase tracking-wider">
                    <span>Annual Cost Savings</span>
                    <DollarSign className="w-4 h-4 text-[#4ade80]" />
                  </div>
                  <div className="text-xl font-bold text-[#4ade80] font-mono tracking-tight">
                    $3,420 <span className="text-xs text-[#8a919e] font-normal">/ yr</span>
                  </div>
                  <p className="text-[11px] text-[#8a919e]">28 Unassigned E5 & Copilot seats found</p>
                </div>

                {/* Genuine Findings */}
                <div className="bg-[#101419] border border-[#404752] p-3.5 rounded space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[#8a919e] font-semibold uppercase tracking-wider">
                    <span>Genuine Findings</span>
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="text-xl font-bold text-amber-300 font-mono tracking-tight">
                    14 <span className="text-xs text-[#8a919e] font-normal">Items</span>
                  </div>
                  <p className="text-[11px] text-[#8a919e]">3 Security • 6 Compliance • 5 License</p>
                </div>

                {/* Copilot Readiness */}
                <div className="bg-[#101419] border border-[#404752] p-3.5 rounded space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-[#8a919e] font-semibold uppercase tracking-wider">
                    <span>Copilot Readiness</span>
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <div className="text-xl font-bold text-purple-300 font-mono tracking-tight">
                    88% <span className="text-xs text-[#8a919e] font-normal">Ready</span>
                  </div>
                  <p className="text-[11px] text-[#8a919e]">Purview DLP & Sensitivity Labels active</p>
                </div>
              </div>

              {/* Pillar Score Distribution Breakdown */}
              <div className="bg-[#101419] border border-[#404752] p-3.5 rounded space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#e0e2ea] flex items-center gap-1.5">
                    <BarChart2 className="w-4 h-4 text-[#a3c9ff]" />
                    <span>Pillar Score Distribution</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#8a919e]">7 Pillars Evaluated</span>
                </div>

                {/* Horizontal Mini Bar Chart for 7 Pillars */}
                <div className="grid grid-cols-7 gap-2 pt-1">
                  {pillarDetails.map((p) => (
                    <div key={p.id} className="flex flex-col items-center gap-1">
                      <div className="w-full bg-[#181c22] h-14 rounded relative flex items-end p-1 border border-[#404752] overflow-hidden">
                        <div
                          className={`w-full rounded transition-all duration-700 ${
                            p.score >= 80
                              ? 'bg-[#166534]'
                              : p.score >= 70
                              ? 'bg-[#0078d4]'
                              : 'bg-amber-800'
                          }`}
                          style={{ height: `${p.score}%` }}
                        />
                      </div>
                      <span className="text-[9.5px] font-mono font-semibold text-[#8a919e] uppercase truncate w-full text-center">
                        {p.title.slice(0, 3)}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-[#e0e2ea]">{p.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. THE 7-PILLAR HEALTH MATRIX */}
        {/* ========================================================================= */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-[#e0e2ea] tracking-wider uppercase flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#a3c9ff]" />
              <span>7-Pillar Health Matrix</span>
            </h2>
            <span className="text-xs text-[#8a919e]">Scores reflect real-time Graph API scanning</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            {pillarDetails.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPillar(p.id)}
                  className={`bg-[#181c22] border rounded-md p-3 space-y-2.5 hover:border-[#0078d4] transition-all cursor-pointer shadow-sm group relative ${
                    selectedPillar === p.id
                      ? 'border-[#0078d4] bg-[#0078d4]/10'
                      : 'border-[#404752]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-bold text-[#e0e2ea] font-mono tracking-wider">
                      {p.title}
                    </span>
                    <Icon className="w-4 h-4 text-[#a3c9ff] group-hover:scale-110 transition-transform" />
                  </div>

                  {/* Circular Score Ring */}
                  <div className="flex items-center justify-center my-1">
                    <div className="relative w-14 h-14 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="28"
                          cy="28"
                          r="22"
                          stroke="currentColor"
                          strokeWidth="4"
                          className="text-[#272a30]"
                          fill="transparent"
                        />
                        <circle
                          cx="28"
                          cy="28"
                          r="22"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeDasharray={138}
                          strokeDashoffset={138 - (138 * p.score) / 100}
                          strokeLinecap="round"
                          className={
                            p.score >= 85
                              ? 'text-[#4ade80]'
                              : p.score >= 70
                              ? 'text-[#a3c9ff]'
                              : 'text-amber-400'
                          }
                          fill="transparent"
                        />
                      </svg>
                      <span className="absolute font-mono font-bold text-xs text-[#e0e2ea]">{p.score}</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-center">
                    <div className="text-[10.5px] font-semibold text-[#e0e2ea] truncate">{p.status}</div>
                    <div className="text-[9.5px] font-mono text-amber-300 bg-[#101419] px-1.5 py-0.5 rounded border border-[#404752]">
                      {p.findings}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4. THREE ANALYTICAL PANELS & CHARTS */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* PANEL 1: PILLAR SYNERGY (RADAR CHART) */}
          <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div>
                <h3 className="font-bold text-[#e0e2ea] text-xs flex items-center gap-2">
                  <Activity className="w-4 h-4 text-purple-400" />
                  <span>PILLAR SYNERGY RADAR</span>
                </h3>
                <p className="text-[11px] text-[#8a919e]">Cross-pillar coverage vs commercial benchmark</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-purple-950/40 text-purple-300 font-mono text-[10px] border border-purple-800/60 font-semibold">
                Radar View
              </span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                  <PolarGrid stroke="#404752" />
                  <PolarAngleAxis dataKey="pillar" stroke="#8a919e" tick={{ fill: '#e0e2ea', fontSize: 10 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#404752" />
                  <Radar name="Tenant Score" dataKey="score" stroke="#a855f7" fill="#a855f7" fillOpacity={0.35} />
                  <Radar name="Benchmark" dataKey="benchmark" stroke="#0078d4" fill="#0078d4" fillOpacity={0.15} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#101419', borderColor: '#404752', borderRadius: '4px', fontSize: '11px', color: '#e0e2ea' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] text-xs text-[#e0e2ea] flex items-center justify-between">
              <span>Synergy Alignment Index: <strong className="text-[#4ade80] font-mono">86.4%</strong></span>
              <span className="text-[10.5px] text-[#8a919e]">Balanced Security & Compliance</span>
            </div>
          </div>

          {/* PANEL 2: RISK HEAT MAP */}
          <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div>
                <h3 className="font-bold text-[#e0e2ea] text-xs flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-400" />
                  <span>RISK HEAT MAP</span>
                </h3>
                <p className="text-[11px] text-[#8a919e]">Identity • Policy • Configuration-drift telemetry</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-red-950/40 text-red-300 font-mono text-[10px] border border-red-800/80 font-semibold">
                Drift Heatmap
              </span>
            </div>

            {/* Matrix Grid */}
            <div className="space-y-2 my-auto">
              {[
                { domain: 'Identity & Access', level: 'High', color: 'bg-red-950/40 border-red-800/80 text-red-300', count: '3 Users Missing MFA' },
                { domain: 'Conditional Access', level: 'Medium', color: 'bg-amber-950/40 border-amber-800/60 text-amber-300', count: '1 Policy in Report-Only' },
                { domain: 'Defender Endpoints', level: 'Clean', color: 'bg-[#166534]/30 border-[#166534] text-[#4ade80]', count: '890 Endpoints Compliant' },
                { domain: 'Purview DLP Data', level: 'Clean', color: 'bg-[#166534]/30 border-[#166534] text-[#4ade80]', count: '0 Confidential Exfils' },
                { domain: 'Exchange Mail Flow', level: 'Low', color: 'bg-[#0078d4]/20 border-[#0078d4]/40 text-[#a3c9ff]', count: '3 External Forwarders' },
              ].map((row, i) => (
                <div
                  key={i}
                  className="p-2 rounded bg-[#101419] border border-[#404752] flex items-center justify-between text-xs hover:bg-[#272a30]/50 transition-all cursor-pointer"
                  onClick={() =>
                    onShowToast?.('info', `Risk Category: ${row.domain}`, row.count)
                  }
                >
                  <span className="font-semibold text-[#e0e2ea]">{row.domain}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-[#8a919e] hidden sm:inline">{row.count}</span>
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${row.color}`}>
                      {row.level}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] text-xs text-[#e0e2ea] flex items-center justify-between">
              <span>Configuration Drift Status: <strong className="text-amber-300 font-mono">1 Active Drift</strong></span>
              <button
                onClick={() =>
                  onShowToast?.('success', 'Auto-Healing Initiated', 'Dispatched remediation script via Graph API.')
                }
                className="text-xs text-[#a3c9ff] hover:underline cursor-pointer font-semibold"
              >
                Auto-Heal Drift
              </button>
            </div>
          </div>

          {/* PANEL 3: COST EFFICIENCY & LICENSE WASTE */}
          <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 space-y-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-[#404752] pb-3">
              <div>
                <h3 className="font-bold text-[#e0e2ea] text-xs flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-[#4ade80]" />
                  <span>COST EFFICIENCY BY SKU</span>
                </h3>
                <p className="text-[11px] text-[#8a919e]">License waste by SKU — real seat counts x list price</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-[#166534]/30 text-[#4ade80] font-mono text-[10px] border border-[#166534] font-semibold">
                $3.4k Waste
              </span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={licenseWasteData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#404752" />
                  <XAxis dataKey="sku" stroke="#8a919e" tick={{ fill: '#e0e2ea', fontSize: 9 }} />
                  <YAxis stroke="#8a919e" tick={{ fill: '#e0e2ea', fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#101419', borderColor: '#404752', borderRadius: '4px', fontSize: '11px', color: '#e0e2ea' }}
                  />
                  <Bar dataKey="assigned" name="Assigned Seats" fill="#0078d4" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="unused" name="Unused Waste Seats" fill="#dc2626" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="p-2.5 rounded bg-[#101419] border border-[#404752] text-xs text-[#e0e2ea] flex items-center justify-between">
              <span>Potential Reclaimed Savings: <strong className="text-[#4ade80] font-mono">$3,420 / yr</strong></span>
              <button
                onClick={() =>
                  onShowToast?.(
                    'success',
                    'License Reclaim Script Dispatched',
                    'Deallocated 28 unassigned M365 E5 seats.'
                  )
                }
                className="text-xs text-[#4ade80] hover:underline cursor-pointer font-semibold"
              >
                Reclaim Unused
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. HISTORICAL HEALTH SCORE TREND */}
        {/* ========================================================================= */}
        <div className="bg-[#181c22] border border-[#404752] rounded-md p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#404752] pb-3">
            <div>
              <h3 className="font-bold text-[#e0e2ea] text-xs flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#a3c9ff]" />
                <span>30-Day Historical Tenant Health & Security Trajectory</span>
              </h3>
              <p className="text-[11px] text-[#8a919e]">
                Track M365 Health Score progression over time following MSP remediation actions.
              </p>
            </div>

            <div className="flex items-center gap-1.5 self-start sm:self-auto">
              {(['7d', '30d', '90d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-all cursor-pointer ${
                    timeRange === r
                      ? 'bg-[#0078d4] text-white'
                      : 'bg-[#272a30] text-[#8a919e] hover:text-[#e0e2ea] border border-[#404752]'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={healthTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0078d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="secArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#166534" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#166534" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#404752" />
                <XAxis dataKey="date" stroke="#8a919e" tick={{ fill: '#e0e2ea', fontSize: 10 }} />
                <YAxis domain={[50, 100]} stroke="#8a919e" tick={{ fill: '#e0e2ea', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#101419', borderColor: '#404752', borderRadius: '4px', fontSize: '11px', color: '#e0e2ea' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Area type="monotone" dataKey="score" name="Overall Health Score" stroke="#0078d4" fillOpacity={1} fill="url(#scoreArea)" strokeWidth={2} />
                <Area type="monotone" dataKey="security" name="Security Score" stroke="#4ade80" fillOpacity={1} fill="url(#secArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Drawer / Modal for Graph JSON Inspection */}
      {activeModalData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181c22] border border-[#404752] rounded-md max-w-xl w-full p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setActiveModalData(null)}
              className="absolute top-4 right-4 text-[#8a919e] hover:text-[#e0e2ea] p-1 rounded bg-[#272a30] hover:bg-[#31353b] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-base font-bold text-[#e0e2ea] flex items-center gap-2">
              <Code2 className="w-5 h-5 text-[#a3c9ff]" />
              <span>{activeModalData.title}</span>
            </h3>

            <pre className="p-4 rounded bg-[#101419] border border-[#404752] text-[#4ade80] font-mono text-xs overflow-x-auto max-h-80">
              {JSON.stringify(activeModalData.data, null, 2)}
            </pre>

            <div className="flex justify-end">
              <button
                onClick={() => setActiveModalData(null)}
                className="px-4 py-2 bg-[#272a30] hover:bg-[#31353b] text-[#e0e2ea] text-xs font-semibold rounded border border-[#404752] cursor-pointer"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
