import { Link } from "wouter";

interface Assessment {
  label: string;
  href: string;
}

const ASSESSMENT_MAP: Array<{ keywords: string[]; assessment: Assessment }> = [
  {
    keywords: ["copilot"],
    assessment: {
      label: "Take the Free Copilot Readiness Assessment",
      href: "/solutions/copilot",
    },
  },
  {
    keywords: ["governance", "compliance"],
    assessment: {
      label: "Take the Free Governance Maturity Assessment",
      href: "/solutions/governance",
    },
  },
  {
    keywords: ["sharepoint"],
    assessment: {
      label: "Take the Free SharePoint Readiness Assessment",
      href: "/solutions/sharepoint",
    },
  },
  {
    keywords: ["teams"],
    assessment: {
      label: "Take the Free Teams Maturity Assessment",
      href: "/solutions/teams",
    },
  },
  {
    keywords: ["security"],
    assessment: {
      label: "Take the Free Security & Compliance Assessment",
      href: "/solutions/security-compliance",
    },
  },
  {
    keywords: ["power platform"],
    assessment: {
      label: "Take the Free Power Platform Readiness Assessment",
      href: "/solutions/power-platform",
    },
  },
  {
    keywords: ["migration", "cloud migration"],
    assessment: {
      label: "Take the Free Migration Readiness Assessment",
      href: "/solutions/migration",
    },
  },
];

function resolveAssessment(category: string, title: string): Assessment | null {
  const hayCategory = category.toLowerCase();
  const hayTitle = title.toLowerCase();

  for (const { keywords, assessment } of ASSESSMENT_MAP) {
    for (const kw of keywords) {
      if (hayCategory.includes(kw)) return assessment;
    }
  }

  for (const { keywords, assessment } of ASSESSMENT_MAP) {
    for (const kw of keywords) {
      if (hayTitle.includes(kw)) return assessment;
    }
  }

  return null;
}

interface ArticleAssessmentCTAProps {
  category: string;
  title: string;
}

export function ArticleAssessmentCTA({ category, title }: ArticleAssessmentCTAProps) {
  const assessment = resolveAssessment(category, title);
  if (!assessment) return null;

  return (
    <div className="mt-10 mb-2 rounded-xl border-l-4 border-accent-blue bg-accent-blue/[0.08] px-6 py-6">
      <p className="text-sm font-semibold text-text-primary mb-2">
        Ready to see where you stand?
      </p>
      <Link
        href={assessment.href}
        className="inline-flex items-center gap-1.5 text-accent-blue font-bold hover:underline text-base"
      >
        → {assessment.label}
      </Link>
    </div>
  );
}
