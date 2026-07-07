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
      href: "/services#copilot-assessment",
    },
  },
  {
    keywords: ["governance", "compliance"],
    assessment: {
      label: "Take the Free Governance Maturity Assessment",
      href: "/services#governance-assessment",
    },
  },
  {
    keywords: ["sharepoint"],
    assessment: {
      label: "Take the Free SharePoint Readiness Assessment",
      href: "/services#sharepoint-assessment",
    },
  },
  {
    keywords: ["teams"],
    assessment: {
      label: "Take the Free Teams Maturity Assessment",
      href: "/services#teams-assessment",
    },
  },
  {
    keywords: ["security"],
    assessment: {
      label: "Take the Free Security & Compliance Assessment",
      href: "/services#security-assessment",
    },
  },
  {
    keywords: ["power platform"],
    assessment: {
      label: "Take the Free Power Platform Readiness Assessment",
      href: "/services#power-platform-assessment",
    },
  },
  {
    keywords: ["migration", "cloud migration"],
    assessment: {
      label: "Take the Free Migration Readiness Assessment",
      href: "/services#migration-assessment",
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
    <div className="mt-10 mb-2 rounded-xl border-l-4 border-[#0078D4] bg-[#00B4D8]/8 px-6 py-6">
      <p className="text-sm font-semibold text-[#0A2540] mb-2">
        Ready to see where you stand?
      </p>
      <Link
        href={assessment.href}
        className="inline-flex items-center gap-1.5 text-[#0078D4] font-bold hover:underline text-base"
      >
        → {assessment.label}
      </Link>
    </div>
  );
}
