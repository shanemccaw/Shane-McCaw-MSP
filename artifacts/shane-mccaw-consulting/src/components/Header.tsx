import { Link } from "wouter";
import { ShieldCheck, LogIn } from "lucide-react";

export function Header() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 bg-charcoal-0/85 backdrop-blur-xl border-b border-white/[0.08]"
      data-track="nav"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-18">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 group" data-track="nav">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-violet))" }}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <span className="font-display font-bold text-base text-text-primary tracking-tight leading-none">
              Shane McCaw
            </span>
          </Link>

          {/* Login */}
          <Link
            href="/login"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-text-primary border border-white/[0.14] bg-white/[0.04] hover:bg-white/[0.08] hover:border-accent-blue/50 transition-colors"
            data-track="cta"
          >
            <LogIn className="w-4 h-4 text-accent-blue" />
            <span>Log In</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

export default Header;
