import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";

const TABS = [
  {
    label: "Script Catalog",
    path: "/m365-scripts",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    label: "Script Runner",
    path: "/script-runner",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Run Results",
    path: "/m365-run-results",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Script Generator",
    path: "/script-generator",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
] as const;

export default function ScriptsTabBar({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const isIDE = location === "/script-generator";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-3 pb-0 bg-[#0D1117] border-b border-[#21262D]">
        {TABS.map(tab => {
          const isActive = location === tab.path;
          return (
            <Link key={tab.path} href={tab.path}>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "border-[#0078D4] text-[#0078D4] bg-[#0078D4]/8"
                    : "border-transparent text-[#7D8590] hover:text-[#C9D1D9] hover:bg-[#161B22]"
                }`}
              >
                {tab.icon}
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
      <div className={`flex-1 min-h-0 ${isIDE ? "overflow-hidden" : "overflow-y-auto"}`}>
        {children}
      </div>
    </div>
  );
}
