import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

export default function PortalPage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col">
      {/* Header */}
      <header className="bg-[#0A2540] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </div>
          <span className="text-white font-bold text-sm">Shane McCaw Consulting</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/60 text-sm">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-white/70 text-sm hover:text-white transition-colors border border-white/20 rounded-lg px-3 py-1.5 hover:bg-white/10"
          >
            Log out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#0078D4]/10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-[#0078D4]" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-[#0A2540] mb-3">Your Project Portal</h1>
          <p className="text-muted-foreground leading-relaxed mb-2">
            Welcome, {user?.email}.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Your projects will appear here once they're set up. Shane will reach out to configure your portal access shortly.
          </p>
          <div className="mt-8 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-xl p-6">
            <p className="text-[#0A2540] text-sm font-medium">Questions? Contact Shane directly:</p>
            <a href="mailto:info@shanemccaw.com" className="text-[#0078D4] text-sm font-semibold hover:underline mt-1 block">
              info@shanemccaw.com
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
