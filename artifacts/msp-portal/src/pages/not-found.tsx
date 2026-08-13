import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, LayoutDashboard, LifeBuoy, Settings, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { reportNotFoundEvent } from "@/lib/report-404-event";

interface NotFoundCard {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  label: string;
}

export default function NotFound() {
  const { user, accessToken } = useAuth();

  useEffect(() => {
    // window.location.pathname (not wouter's useLocation) so the reported path
    // is the real browser URL, not one already stripped of its slug/base prefix.
    reportNotFoundEvent(accessToken, window.location.pathname, document.referrer || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCustomerUser = user?.mspRole === "CustomerUser";

  const cards: NotFoundCard[] = [
    {
      icon: <LayoutDashboard className="w-6 h-6 text-primary" />,
      title: isCustomerUser ? "Customer Home" : "Dashboard",
      desc: isCustomerUser
        ? "Back to your projects, documents, and everything else that actually exists."
        : "Back to the numbers that actually mean something.",
      href: isCustomerUser ? "/customer-home" : "/dashboard",
      label: isCustomerUser ? "Go to Customer Home →" : "Go to Dashboard →",
    },
    {
      icon: <LifeBuoy className="w-6 h-6 text-primary" />,
      title: "Support",
      desc: "If something's actually broken, this is where to say so.",
      href: "/support",
      label: "Get help →",
    },
    {
      icon: <Settings className="w-6 h-6 text-primary" />,
      title: "Settings",
      desc: "Profile, team, billing, and everything else you came here to configure.",
      href: "/settings",
      label: "Open Settings →",
    },
  ];

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Hero */}
      <section className="bg-sidebar pt-24 pb-16 text-center">
        <div className="max-w-[860px] mx-auto px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-8">
            <ShieldCheck className="w-3.5 h-3.5 text-sidebar-foreground/70" />
            <span className="text-sidebar-foreground/70 text-xs font-bold uppercase tracking-widest">
              Error 404
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-sidebar-foreground leading-tight mb-6">
            This page ran off to go check a compliance score.
          </h1>
          <p className="text-sidebar-foreground/60 text-lg leading-relaxed max-w-xl mx-auto mb-10">
            Good news: your tenant's fine.
            <br className="hidden sm:block" />
            Bad news: this page isn't.
          </p>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground font-semibold border border-white/20 hover:border-white/40 px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to where things made sense
          </button>
        </div>
      </section>

      {/* Action cards */}
      <section className="bg-muted/30 py-16">
        <div className="max-w-[1000px] mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {cards.map((card) => (
              <Link key={card.href} href={card.href} className="group">
                <div className="bg-card border border-border rounded-2xl p-6 h-full flex flex-col gap-4 hover:border-primary/40 hover:shadow-md transition-all duration-200">
                  <div className="w-11 h-11 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                    {card.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-extrabold text-foreground mb-2 group-hover:text-primary transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{card.desc}</p>
                  </div>
                  <span className="text-primary text-sm font-semibold">{card.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Cheeky footer note */}
      <section className="bg-background py-10 border-t border-border">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <p className="text-muted-foreground text-sm leading-relaxed">
            Think this should exist?{" "}
            <Link href="/support" className="text-primary hover:underline font-medium">
              Let Shane know.
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
