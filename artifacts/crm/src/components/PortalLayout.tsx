import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalTour, { useTour } from "@/components/PortalTour";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import ScriptProgressWidget from "@/components/ScriptProgressWidget";
import NotificationBell from "@/components/NotificationBell";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: number;
  dataTour?: string;
}

interface PortalLayoutProps {
  children: React.ReactNode;
  unreadNotifications?: number;
  unreadMessages?: number;
}

interface HealthWidgetData {
  overallLatest: number;
  overallFirst: number;
  overallDelta: number;
}

function healthScoreColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function useHealthWidgetData() {
  const { fetchWithAuth } = useAuth();
  const [health, setHealth] = useState<HealthWidgetData | null>(null);
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchWithAuth("/api/portal/health/summary")
      .then(r => r.ok ? (r.json() as Promise<unknown>) : Promise.resolve({ hasData: false }))
      .then((d: unknown) => {
        const data = d as { hasData?: boolean; overallLatest?: number; overallFirst?: number; overallDelta?: number };
        if (data.hasData && data.overallLatest !== undefined) {
          setHealth({ overallLatest: data.overallLatest, overallFirst: data.overallFirst ?? data.overallLatest, overallDelta: data.overallDelta ?? 0 });
        }
      })
      .catch(() => {});
  }, [fetchWithAuth]);
  return health;
}

function healthStatusLabel(s: number) { return s >= 70 ? "Healthy" : s >= 40 ? "Attention" : "Critical"; }
function healthBarColor(s: number) { return s >= 70 ? "bg-green-500" : s >= 40 ? "bg-amber-400" : "bg-red-500"; }
function healthGlowColor(s: number) { return s >= 70 ? "shadow-green-500/20" : s >= 40 ? "shadow-amber-400/20" : "shadow-red-500/20"; }

function MiniScoreRing({ score }: { score: number }) {
  const size = 44;
  const r = 17;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={healthScoreColor(score)} strokeWidth="5"
          strokeLinecap="round" strokeDasharray={`${(score / 100) * circ} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-black text-white">{score}%</span>
      </div>
    </div>
  );
}

function OverallHealthWidget({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const health = useHealthWidgetData();
  if (!health) return null;
  const score = health.overallLatest;
  const delta = health.overallDelta;
  const hasHistory = health.overallFirst !== health.overallLatest;

  if (variant === "light") {
    return (
      <Link href="/portal/health">
        <div className="mx-3 mb-1 rounded-xl overflow-hidden border border-[#0078D4]/20 cursor-pointer hover:border-[#0078D4]/40 transition-all group">
          <div className={`h-0.5 w-full ${healthBarColor(score)}`} />
          <div className="bg-[#0078D4]/6 hover:bg-[#0078D4]/10 transition-colors px-3 py-2.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-black tracking-[0.2em] uppercase text-[#0A2540]/50">Env. Health</span>
              <span className="text-[9px] font-bold text-[#0A2540]/40">{healthStatusLabel(score)}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <MiniScoreRing score={score} />
              <div className="flex-1 min-w-0">
                <div className="text-lg font-black text-[#0A2540] leading-none">{score}%</div>
                {hasHistory && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[9px] text-[#0A2540]/40">{health.overallFirst}%</span>
                    <svg className="w-2.5 h-2.5 text-[#0A2540]/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    <span className="text-[9px] font-black text-[#0A2540]">{score}%</span>
                    {delta !== 0 && (
                      <span className={`text-[8px] font-black px-1 rounded ${delta > 0 ? "text-green-600" : "text-red-600"}`}>{delta > 0 ? "+" : ""}{delta}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link href="/portal/health">
      <div className={`mx-3 mb-1 rounded-xl overflow-hidden cursor-pointer transition-all group shadow-lg ${healthGlowColor(score)} hover:shadow-xl`}>
        {/* Status bar */}
        <div className={`h-0.5 w-full ${healthBarColor(score)}`} />
        <div className="bg-white/5 hover:bg-white/8 border border-white/8 hover:border-white/15 transition-all rounded-b-xl px-3 py-3">
          {/* Header row */}
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthBarColor(score)}`} />
              <span className="text-[9px] font-black tracking-[0.2em] uppercase text-white/40">Env. Health</span>
            </div>
            <span className={`text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded ${
              score >= 70 ? "text-green-400 bg-green-500/15" :
              score >= 40 ? "text-amber-300 bg-amber-400/15" :
              "text-red-400 bg-red-500/15"
            }`}>{healthStatusLabel(score)}</span>
          </div>

          {/* Score + ring */}
          <div className="flex items-center gap-3">
            <MiniScoreRing score={score} />
            <div className="flex-1 min-w-0">
              <div className="text-2xl font-black text-white leading-none" style={{ color: healthScoreColor(score) }}>{score}%</div>
              {hasHistory ? (
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-[9px] text-white/30">{health.overallFirst}%</span>
                  <svg className="w-2.5 h-2.5 text-white/20 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  <span className="text-[9px] font-black text-white">{score}%</span>
                  {delta !== 0 && (
                    <span className={`text-[8px] font-black px-1 py-0.5 rounded ${delta > 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      {delta > 0 ? "+" : ""}{delta}pts
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-[9px] text-white/25 mt-1">Baseline established</p>
              )}
            </div>
            <svg className="w-3 h-3 text-white/20 group-hover:text-white/40 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-white font-bold text-sm leading-tight truncate">Shane McCaw</p>
        <p className="text-white/40 text-xs truncate">Consulting</p>
      </div>
    </div>
  );
}

function NavLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link href={item.path}>
      <div
        data-tour={item.dataTour}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl mx-2 cursor-pointer transition-all duration-150 group relative ${
          isActive
            ? "bg-[#0078D4] text-white shadow-lg shadow-[#0078D4]/25"
            : "text-white/60 hover:text-white hover:bg-white/8"
        }`}
      >
        <span className={`flex-shrink-0 ${isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}`}>
          {item.icon}
        </span>
        <span className="text-sm font-medium truncate flex-1">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {item.badge > 9 ? "9+" : item.badge}
          </span>
        )}
      </div>
    </Link>
  );
}

const CLIENT_NAV_ITEMS = (unreadMessages: number, hasArchivedProjects = false, appRegPending = false): NavItem[] => [
  {
    label: "Dashboard",
    path: "/portal",
    dataTour: "dashboard",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  },
  {
    label: "Projects",
    path: "/portal/projects",
    dataTour: "projects",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  },
  {
    label: "Services",
    path: "/portal/services",
    dataTour: "services",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
  },
  {
    label: "Billing",
    path: "/portal/billing",
    dataTour: "billing",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  },
  {
    label: "Messages",
    path: "/portal/messages",
    badge: unreadMessages,
    dataTour: "messages",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  },
  ...(hasArchivedProjects ? [{
    label: "Project Archive",
    path: "/portal/archive",
    icon: (<svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>),
  }] : []),
  {
    label: "M365 Profile",
    path: "/portal/m365-profile",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  },
  {
    label: "Automation Setup",
    path: "/portal/automation-setup",
    badge: appRegPending ? 1 : 0,
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  },
  {
    label: "Profile",
    path: "/portal/profile",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
  },
  {
    label: "Security",
    path: "/portal/security",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  },
  {
    label: "Webhooks",
    path: "/portal/webhooks",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
  },
  {
    label: "Insights",
    path: "/portal/insights",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  },
  {
    label: "Journey Map",
    path: "/portal/journey",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  },
  {
    label: "Privacy & Data",
    path: "/portal/privacy",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>,
  },
  {
    label: "Notifications",
    path: "/portal/notifications",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
  },
];

export function ClientSidebar({ unreadNotifications = 0, unreadMessages = 0, hasArchivedProjects = false, appRegPending = false }: { unreadNotifications?: number; unreadMessages?: number; hasArchivedProjects?: boolean; appRegPending?: boolean }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { startTour } = useTour();
  const navItems = CLIENT_NAV_ITEMS(unreadMessages, hasArchivedProjects, appRegPending);

  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 bg-[#0A2540] flex-col h-screen sticky top-0">
      {/* Logo + notification bell row */}
      <div className="flex items-center border-b border-white/10">
        <div className="flex-1 min-w-0"><Logo /></div>
        <div className="pr-3 flex-shrink-0">
          <NotificationBell />
        </div>
      </div>
      <div className="pt-3">
        <OverallHealthWidget />
        <ScriptProgressWidget />
      </div>
      <nav className="flex-1 py-2 overflow-y-auto space-y-0.5">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            item={item}
            isActive={item.path === "/portal" ? location === "/portal" : location.startsWith(item.path)}
          />
        ))}
      </nav>
      <div className="p-3 border-t border-white/10 space-y-2">
        <button
          onClick={startTour}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors text-xs font-medium text-left group"
          title="Replay the portal walkthrough"
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0 group-hover:text-[#0078D4] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Take the tour
        </button>
        <div className="bg-white/5 rounded-xl p-3">
          <p className="text-white/50 text-xs truncate mb-0.5">{user?.email}</p>
          <p className="text-white/70 text-xs font-medium mb-2">Client Portal</p>
          <button
            onClick={() => logout()}
            className="w-full text-white/50 text-xs hover:text-white/80 transition-colors text-left"
          >
            Sign out →
          </button>
        </div>
      </div>
    </aside>
  );
}

function MobileBottomNav({ unreadMessages = 0, hasArchivedProjects = false, appRegPending = false }: { unreadMessages?: number; hasArchivedProjects?: boolean; appRegPending?: boolean }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [showMore, setShowMore] = useState(false);

  const { startTour } = useTour();

  const primaryTabs: NavItem[] = [
    {
      label: "Home",
      path: "/portal",
      dataTour: "dashboard",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
    },
    {
      label: "Projects",
      path: "/portal/projects",
      dataTour: "projects",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
    },
    {
      label: "Services",
      path: "/portal/services",
      dataTour: "services",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
    },
    {
      label: "Billing",
      path: "/portal/billing",
      dataTour: "billing",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
    },
    {
      label: "Messages",
      path: "/portal/messages",
      badge: unreadMessages,
      dataTour: "messages",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
    },
  ];

  const secondaryNavItems = [
    ...(hasArchivedProjects ? [{
      label: "Project Archive",
      path: "/portal/archive",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>,
    }] : []),
    {
      label: "M365 Profile",
      path: "/portal/m365-profile",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
    },
    {
      label: "Automation Setup",
      path: "/portal/automation-setup",
      badge: appRegPending ? 1 : 0,
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    },
    {
      label: "Profile",
      path: "/portal/profile",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
    },
    {
      label: "Security",
      path: "/portal/security",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    },
    {
      label: "Webhooks",
      path: "/portal/webhooks",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
    },
    {
      label: "Insights",
      path: "/portal/insights",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    },
    {
      label: "Journey Map",
      path: "/portal/journey",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
    },
  ];

  const isMoreActive = secondaryNavItems.some(item =>
    item.path === location || location.startsWith(item.path + "/")
  );

  return (
    <>
      <Sheet open={showMore} onOpenChange={setShowMore}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto pb-safe">
          <SheetHeader className="mb-3">
            <SheetTitle className="text-[#0A2540]">More</SheetTitle>
          </SheetHeader>

          <div className="mb-4 -mx-1">
            <OverallHealthWidget variant="light" />
          </div>

          <nav className="space-y-1 mb-6">
            {secondaryNavItems.map(item => {
              const isActive = location === item.path || location.startsWith(item.path + "/");
              return (
                <Link key={item.path} href={item.path} onClick={() => setShowMore(false)}>
                  <div className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                    isActive
                      ? "bg-[#0078D4]/10 text-[#0078D4]"
                      : "text-[#0A2540] hover:bg-gray-50"
                  }`}>
                    <span className={`flex-shrink-0 ${isActive ? "text-[#0078D4]" : "text-[#0A2540]/60"}`}>
                      {item.icon}
                    </span>
                    <span className="text-sm font-semibold flex-1">{item.label}</span>
                    {"badge" in item && item.badge !== undefined && item.badge > 0 && (
                      <span className="w-5 h-5 rounded-full bg-[#0078D4] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {item.badge > 9 ? "9+" : item.badge}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border pt-4 space-y-1">
            <p className="text-xs text-muted-foreground px-3 mb-2 truncate">Signed in as {user?.email}</p>
            <button
              onClick={() => { setShowMore(false); startTour(); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[#0A2540] hover:bg-gray-50 transition-colors text-sm font-semibold text-left"
            >
              <svg className="w-5 h-5 flex-shrink-0 text-[#0A2540]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Take the tour
            </button>
            <button
              onClick={() => { setShowMore(false); logout(); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-600 hover:bg-red-50 transition-colors text-sm font-semibold text-left"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <nav className="fixed bottom-0 inset-x-0 bg-[#0A2540] border-t border-white/10 flex md:hidden z-40 safe-area-bottom">
        {primaryTabs.map(item => {
          const isActive = item.path === "/portal" ? location === "/portal" : location.startsWith(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              className="flex-1"
              onClick={() => setShowMore(false)}
            >
              <div
                data-tour={item.dataTour}
                className={`flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors ${isActive ? "text-[#0078D4]" : "text-white/45 hover:text-white/70"}`}
              >
                <span className="relative">
                  {item.icon}
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  )}
                </span>
                <span className="text-[9px] font-semibold leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
        <button
          onClick={() => setShowMore(!showMore)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative ${showMore || isMoreActive ? "text-[#0078D4]" : "text-white/45 hover:text-white/70"}`}
        >
          <span className="relative">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
            {appRegPending && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">!</span>
            )}
          </span>
          <span className="text-[9px] font-semibold leading-none">More</span>
        </button>
      </nav>
    </>
  );
}

export function AdminSidebar({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
  const adminTabs = [
    { key: "leads", label: "Leads", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
    { key: "clients", label: "Clients", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
    { key: "projects", label: "Projects", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> },
    { key: "services", label: "Services", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg> },
    { key: "reports", label: "Reports", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
    { key: "invoices", label: "Invoices", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg> },
    { key: "messages", label: "Messages", icon: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg> },
  ];

  return (
    <div className="overflow-x-auto mb-6 -mx-1 px-1">
      <nav className="flex gap-1.5 flex-nowrap min-w-max">
        {adminTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all flex-shrink-0 ${
              activeTab === tab.key
                ? "bg-[#0078D4] text-white shadow-md"
                : "bg-white text-[#0A2540] border border-border hover:border-[#0078D4]/40 hover:text-[#0078D4]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function ImpersonationBanner({ email }: { email: string }) {
  const handleExit = () => {
    if (window.opener) {
      window.close();
    } else {
      window.location.href = "/admin-panel/crm/clients";
    }
  };

  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-amber-500 text-white flex items-center justify-between px-4 py-2 shadow-lg">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        Admin Preview Mode — Viewing as <span className="underline underline-offset-2">{email}</span>
        <span className="text-amber-200 font-normal">(read-only · session expires in 30 min)</span>
      </div>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Exit Preview
      </button>
    </div>
  );
}

function renderMessageContent(content: string) {
  return content.split(/(\*\*.*?\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, loading, sendMessage, reset } = useAssistantChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage(input);
    setInput("");
  };

  const QUICK = ["Project status?", "Unpaid invoices?", "What can you help with?"];

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 bg-[#0078D4] text-white px-4 py-3 rounded-2xl shadow-xl hover:bg-[#0078D4]/90 transition-all hover:scale-105 active:scale-95"
        title="Ask the Assistant"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        <span className="text-sm font-semibold hidden sm:block">Ask the Assistant</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full sm:w-[380px] h-[520px] max-h-[90vh] bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col border border-border overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-[#0A2540] px-4 py-3.5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-bold leading-tight">Portal Assistant</p>
                  <p className="text-white/50 text-[10px]">Rule-based · Shane McCaw Consulting</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={reset} title="Start new chat" className="text-white/50 hover:text-white/80 transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white/80 transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#0078D4] text-white rounded-br-sm"
                      : "bg-gray-100 text-[#0A2540] rounded-bl-sm"
                  }`}>
                    {msg.content.split("\n").map((line, i) => (
                      <p key={i} className={i > 0 ? "mt-1" : ""}>{renderMessageContent(line)}</p>
                    ))}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Quick questions */}
            {messages.length <= 1 && (
              <div className="px-4 pb-2 flex gap-2 flex-wrap flex-shrink-0">
                {QUICK.map(q => (
                  <button
                    key={q}
                    onClick={() => { void sendMessage(q); }}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-[#0078D4]/8 text-[#0078D4] hover:bg-[#0078D4]/15 transition-colors border border-[#0078D4]/20"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex-shrink-0 border-t border-border px-3 py-3 flex items-center gap-2 bg-white">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about projects, billing, M365…"
                className="flex-1 text-sm px-3 py-2 rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-xl bg-[#0078D4] text-white flex items-center justify-center hover:bg-[#0078D4]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default function PortalLayout({ children, unreadNotifications = 0, unreadMessages = 0 }: PortalLayoutProps) {
  const { user, fetchWithAuth } = useAuth();
  const [hasArchivedProjects, setHasArchivedProjects] = useState(false);
  const [appRegPending, setAppRegPending] = useState(false);
  const isImpersonating = Boolean(user?.impersonatedBy);

  useEffect(() => {
    fetchWithAuth("/api/portal/projects")
      .then(r => r.ok ? r.json() : [])
      .then((projects: { status: string }[]) => {
        setHasArchivedProjects(Array.isArray(projects) && projects.some(p => p.status === "completed"));
      })
      .catch(() => null);

    fetchWithAuth("/api/portal/app-registration")
      .then(r => r.ok ? r.json() : null)
      .then((d: { status?: string } | null) => {
        setAppRegPending(!d || (d.status !== "submitted" && d.status !== "verified"));
      })
      .catch(() => null);
  }, [fetchWithAuth]);

  return (
    <div className="flex flex-col min-h-screen bg-[#F7F9FC]">
      {isImpersonating && <ImpersonationBanner email={user!.email} />}
      <div className={`flex flex-1 w-full ${isImpersonating ? "pt-[42px]" : ""}`}>
        <ClientSidebar unreadNotifications={unreadNotifications} unreadMessages={unreadMessages} hasArchivedProjects={hasArchivedProjects} appRegPending={appRegPending} />
        <main className="flex-1 overflow-auto min-w-0 pb-16 md:pb-0">
          {children}
        </main>
        <MobileBottomNav unreadMessages={unreadMessages} hasArchivedProjects={hasArchivedProjects} appRegPending={appRegPending} />
      </div>
      <PortalTour />
      <AiAssistant />
    </div>
  );
}
