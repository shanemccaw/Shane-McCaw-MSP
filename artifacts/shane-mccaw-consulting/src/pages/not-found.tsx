import { Bot, Brain, Layers, BookOpen, CalendarDays, Mail, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

const ACTION_CARDS = [
  {
    icon: <Bot className="w-6 h-6 text-[#0078D4]" />,
    title: "Take the Copilot Readiness Quiz",
    desc: "Find out if your M365 tenant is actually ready for Copilot — before you buy the licenses.",
    href: "/copilot-quiz",
    label: "Start the quiz →",
  },
  {
    icon: <Brain className="w-6 h-6 text-[#0078D4]" />,
    title: "Take the Retainer Selector Quiz",
    desc: "Not sure which retainer tier fits? Answer five questions and get a straight recommendation.",
    href: "/retainer-quiz",
    label: "Find my tier →",
  },
  {
    icon: <Layers className="w-6 h-6 text-[#0078D4]" />,
    title: "Explore Services",
    desc: "Microsoft 365, Copilot AI, SharePoint, Power Platform, Governance, Cloud Migration — all fixed-scope, no surprises.",
    href: "/services",
    label: "See all services →",
  },
  {
    icon: <BookOpen className="w-6 h-6 text-[#0078D4]" />,
    title: "Browse the Resource Library",
    desc: "Practical guides and deep-dives on M365 architecture, governance, and Copilot rollout.",
    href: "/resources",
    label: "Read something useful →",
  },
  {
    icon: <CalendarDays className="w-6 h-6 text-[#0078D4]" />,
    title: "Book a Discovery Call",
    desc: "30 minutes. No pitch deck. Just an honest conversation about your Microsoft 365 environment.",
    href: "/book",
    label: "Find a time →",
  },
  {
    icon: <Mail className="w-6 h-6 text-[#0078D4]" />,
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
      <section className="bg-[#0A2540] pt-[172px] pb-16 text-center">
        <div className="max-w-[860px] mx-auto px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 mb-8">
            <span className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest">Error 404</span>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6">
            This page took a long lunch break.
          </h1>
          <p className="text-white/60 text-lg md:text-xl leading-relaxed max-w-xl mx-auto mb-10">
            Good news: you didn't break anything.<br className="hidden sm:block" />
            Bad news: this page doesn't exist.
          </p>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center gap-2 text-white/70 hover:text-white font-semibold border border-white/20 hover:border-white/40 px-6 py-3 rounded-xl transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Go back to where things made sense
          </button>
        </div>
      </section>

      {/* Action cards */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-3">Let's Get You Back on Track</p>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540]">
              Here are some pages that actually exist
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ACTION_CARDS.map((card, i) => (
              <Link key={i} href={card.href} className="group">
                <div className="bg-white border border-border rounded-2xl p-6 h-full flex flex-col gap-4 hover:border-[#0078D4]/40 hover:shadow-md transition-all duration-200">
                  <div className="w-11 h-11 rounded-xl bg-[#0078D4]/8 flex items-center justify-center flex-shrink-0">
                    {card.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-extrabold text-[#0A2540] mb-2 group-hover:text-[#0078D4] transition-colors">
                      {card.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{card.desc}</p>
                  </div>
                  <span className="text-[#0078D4] text-sm font-semibold">{card.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Cheeky footer note */}
      <section className="bg-white py-10 border-t border-border">
        <div className="max-w-[860px] mx-auto px-6 text-center">
          <p className="text-muted-foreground text-sm leading-relaxed">
            If you think this page <em>should</em> exist, let Shane know.{" "}
            <Link href="/contact" className="text-[#0078D4] hover:underline font-medium">
              He probably forgot to build it.
            </Link>
          </p>
        </div>
      </section>
    </Layout>
  );
}
