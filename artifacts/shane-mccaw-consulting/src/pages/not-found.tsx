import { Bot, Brain, Layers, BookOpen, CalendarDays, Mail, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

const ACTION_CARDS = [
  {
    icon: <Bot className="w-6 h-6 text-accent-blue" />,
    title: "Take the Copilot Readiness Quiz",
    desc: "Find out if your M365 tenant is actually ready for Copilot — before you buy the licenses.",
    href: "/copilot-quiz",
    label: "Start the quiz →",
  },
  {
    icon: <Brain className="w-6 h-6 text-accent-blue" />,
    title: "Take the Retainer Selector Quiz",
    desc: "Not sure which retainer tier fits? Answer five questions and get a straight recommendation.",
    href: "/retainer-quiz",
    label: "Find my tier →",
  },
  {
    icon: <Layers className="w-6 h-6 text-accent-blue" />,
    title: "Explore Quick-Start Packs",
    desc: "Microsoft 365, Copilot AI, SharePoint, Power Platform, Governance, Cloud Migration — all fixed-scope, no surprises.",
    href: "/products",
    label: "See all Quick-Start Packs →",
  },
  {
    icon: <BookOpen className="w-6 h-6 text-accent-blue" />,
    title: "Browse the Resource Library",
    desc: "Practical guides and deep-dives on M365 architecture, governance, and Copilot rollout.",
    href: "/resources",
    label: "Read something useful →",
  },
  {
    icon: <CalendarDays className="w-6 h-6 text-accent-blue" />,
    title: "Book a Discovery Call",
    desc: "30 minutes. No pitch deck. Just an honest conversation about your Microsoft 365 environment.",
    href: "/book",
    label: "Find a time →",
  },
  {
    icon: <Mail className="w-6 h-6 text-accent-blue" />,
    title: "Contact Shane",
    desc: "If you think this page should exist, let Shane know. He probably forgot to build it.",
    href: "/contact",
    label: "Say hello →",
  },
];

export default function NotFound() {
  return (
    <Layout>
      <SEOMeta
        title="404: This Page Took a Long Lunch Break | Shane McCaw Consulting"
        description="The page you're looking for doesn't exist — but Shane's Microsoft 365 expertise does. Find what you need from the links below."
      />

      {/* Hero */}
      <section className="relative pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 text-center overflow-hidden">
        <div className="max-w-[860px] mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-8">
            Error 404
          </div>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            This page <GradientText>took a long lunch break</GradientText>.
          </h1>
          <p className="text-text-secondary text-lg sm:text-xl leading-relaxed max-w-xl mx-auto mb-10">
            Good news: you didn't break anything.<br className="hidden sm:block" />
            Bad news: this page doesn't exist.
          </p>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary font-semibold border border-white/[0.12] hover:border-white/[0.24] px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Go back to where things made sense
          </button>
        </div>
      </section>

      {/* Action cards */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-accent-blue text-sm font-semibold uppercase tracking-[0.1em] mb-3">Let's Get You Back on Track</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
              Here are some pages that actually exist
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ACTION_CARDS.map((card, i) => (
              <Link key={i} href={card.href} className="group">
                <div className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-6 h-full flex flex-col gap-4 hover:border-accent-blue/40 transition-all duration-200">
                  <div className="w-11 h-11 rounded-xl bg-accent-blue/10 flex items-center justify-center flex-shrink-0">
                    {card.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-display font-bold text-text-primary mb-2 group-hover:text-accent-blue transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">{card.desc}</p>
                  </div>
                  <span className="text-accent-blue text-sm font-semibold">{card.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Cheeky footer note */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8">
            <p className="text-text-secondary text-sm leading-relaxed">
              If you think this page <em>should</em> exist, let Shane know.{" "}
              <Link href="/contact" className="text-accent-blue hover:underline font-medium">
                He probably forgot to build it.
              </Link>
            </p>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
