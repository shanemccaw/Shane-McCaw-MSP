import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: number;
}

interface PortalLayoutProps {
  children: React.ReactNode;
  unreadNotifications?: number;
  unreadMessages?: number;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/10">
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
      <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl mx-2 cursor-pointer transition-all duration-150 group relative ${
        isActive
          ? "bg-[#0078D4] text-white shadow-lg shadow-[#0078D4]/25"
          : "text-white/60 hover:text-white hover:bg-white/8"
      }`}>
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

const CLIENT_NAV_ITEMS = (unreadMessages: number): NavItem[] => [
  {
    label: "Dashboard",
    path: "/portal",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  },
  {
    label: "Projects",
    path: "/portal/projects",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  },
  {
    label: "Services",
    path: "/portal/services",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
  },
  {
    label: "Billing",
    path: "/portal/billing",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  },
  {
    label: "Reports",
    path: "/portal/reports",
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
  {
    label: "Messages",
    path: "/portal/messages",
    badge: unreadMessages,
    icon: <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  },
];

export function ClientSidebar({ unreadNotifications = 0, unreadMessages = 0 }: { unreadNotifications?: number; unreadMessages?: number }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const navItems = CLIENT_NAV_ITEMS(unreadMessages);

  return (
    <aside className="hidden md:flex w-60 flex-shrink-0 bg-[#0A2540] flex-col h-screen sticky top-0">
      <Logo />
      <nav className="flex-1 py-3 overflow-y-auto space-y-0.5">
        {navItems.map(item => (
          <NavLink
            key={item.path}
            item={item}
            isActive={item.path === "/portal" ? location === "/portal" : location.startsWith(item.path)}
          />
        ))}
      </nav>
      <div className="p-3 border-t border-white/10">
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

function MobileBottomNav({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [showAccount, setShowAccount] = useState(false);

  const primaryTabs: NavItem[] = [
    {
      label: "Home",
      path: "/portal",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
    },
    {
      label: "Projects",
      path: "/portal/projects",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
    },
    {
      label: "Services",
      path: "/portal/services",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
    },
    {
      label: "Billing",
      path: "/portal/billing",
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
    },
    {
      label: "Messages",
      path: "/portal/messages",
      badge: unreadMessages,
      icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
    },
  ];

  return (
    <>
      {showAccount && (
        <div className="fixed inset-0 z-50" onClick={() => setShowAccount(false)}>
          <div className="absolute bottom-[64px] inset-x-4" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-xl shadow-2xl border border-border p-4">
              <p className="text-xs text-muted-foreground mb-0.5">Signed in as</p>
              <p className="text-sm font-semibold text-[#0A2540] truncate mb-3">{user?.email}</p>
              <button
                onClick={() => { setShowAccount(false); logout(); }}
                className="w-full text-left text-sm font-semibold text-red-600 hover:text-red-700 py-1.5 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 inset-x-0 bg-[#0A2540] border-t border-white/10 flex md:hidden z-40 safe-area-bottom">
        {primaryTabs.map(item => {
          const isActive = item.path === "/portal" ? location === "/portal" : location.startsWith(item.path);
          return (
            <Link
              key={item.path}
              href={item.path}
              className="flex-1"
              onClick={() => setShowAccount(false)}
            >
              <div className={`flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors ${isActive ? "text-[#0078D4]" : "text-white/45 hover:text-white/70"}`}>
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
          onClick={() => setShowAccount(!showAccount)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${showAccount ? "text-[#0078D4]" : "text-white/45 hover:text-white/70"}`}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          <span className="text-[9px] font-semibold leading-none">Account</span>
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

export default function PortalLayout({ children, unreadNotifications = 0, unreadMessages = 0 }: PortalLayoutProps) {
  return (
    <div className="flex min-h-screen bg-[#F7F9FC]">
      <ClientSidebar unreadNotifications={unreadNotifications} unreadMessages={unreadMessages} />
      <main className="flex-1 overflow-auto min-w-0 pb-16 md:pb-0">
        {children}
      </main>
      <MobileBottomNav unreadMessages={unreadMessages} />
    </div>
  );
}
