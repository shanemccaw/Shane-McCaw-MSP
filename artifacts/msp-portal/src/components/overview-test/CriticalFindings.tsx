import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
  UserSearch,
  ChevronRight,
  Search,
  CheckCircle,
  Wrench,
} from 'lucide-react';
import { CriticalFinding, SeverityLevel } from '../types';

interface CriticalFindingsProps {
  findings: CriticalFinding[];
  onSelectFinding: (finding: CriticalFinding) => void;
  selectedCategory: string | null;
}

export const CriticalFindings: React.FC<CriticalFindingsProps> = ({
  findings,
  onSelectFinding,
  selectedCategory,
}) => {
  const [severityFilter, setSeverityFilter] = useState<SeverityLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const getSeverityBadge = (severity: SeverityLevel) => {
    switch (severity) {
      case 'red':
        return (
          <span className="px-2.5 py-1 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-[11px] font-bold uppercase tracking-wider">
            Red
          </span>
        );
      case 'amber':
        return (
          <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-md text-[11px] font-bold uppercase tracking-wider">
            Amber
          </span>
        );
      case 'yellow':
        return (
          <span className="px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-md text-[11px] font-bold uppercase tracking-wider">
            Yellow
          </span>
        );
    }
  };

  const getFindingIcon = (title: string, severity: SeverityLevel) => {
    if (title.toLowerCase().includes('mfa')) {
      return (
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center text-red-400">
          <AlertCircle className="w-5 h-5" />
        </div>
      );
    }
    if (title.toLowerCase().includes('legacy auth')) {
      return (
        <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400">
          <AlertTriangle className="w-5 h-5" />
        </div>
      );
    }
    if (title.toLowerCase().includes('app registration')) {
      return (
        <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center text-amber-400">
          <AppWindow className="w-5 h-5" />
        </div>
      );
    }
    if (title.toLowerCase().includes('guest sharing')) {
      return (
        <div className="w-10 h-10 rounded-full bg-yellow-500/15 flex items-center justify-center text-yellow-400">
          <UserSearch className="w-5 h-5" />
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-full bg-slate-500/15 flex items-center justify-center text-slate-300">
        <AlertCircle className="w-5 h-5" />
      </div>
    );
  };

  const filteredFindings = findings.filter((f) => {
    const matchesSeverity = severityFilter === 'all' || f.severity === severityFilter;
    const matchesSearch =
      f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.affectedEntities.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  const activeActionableCount = findings.filter((f) => f.status === 'active').length;

  return (
    <section id="critical-findings" className="mb-12 max-w-6xl mx-auto scroll-mt-20">
      <div className="glass-panel rounded-3xl overflow-hidden shadow-xl border border-white/10">
        
        {/* Header & Controls */}
        <div className="p-5 sm:p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#1c2025]">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white tracking-tight">Critical Findings</h2>
            {activeActionableCount > 0 ? (
              <span className="px-3 py-1 bg-red-500/20 text-red-400 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 border border-red-500/30">
                <span className="w-2 h-2 bg-red-400 rounded-full animate-ping" />
                Action Required ({activeActionableCount})
              </span>
            ) : (
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-500/30">
                <CheckCircle className="w-3.5 h-3.5" />
                All Remediated
              </span>
            )}
          </div>

          {/* Search and Severity Filter Bar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search findings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#101419] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#479ef5]"
              />
            </div>

            <div className="flex items-center bg-[#101419] p-1 rounded-lg border border-white/10 text-xs">
              {(['all', 'red', 'amber', 'yellow'] as const).map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 rounded-md capitalize font-medium transition-all ${
                    severityFilter === sev
                      ? 'bg-[#479ef5]/20 text-[#479ef5] font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Findings List */}
        <div className="divide-y divide-white/5 bg-[#1a1e24]/80">
          {filteredFindings.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No findings match your search filter criteria.
            </div>
          ) : (
            filteredFindings.map((finding) => (
              <div
                key={finding.id}
                onClick={() => onSelectFinding(finding)}
                className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:bg-[#242830] transition-all cursor-pointer"
              >
                <div className="flex items-start sm:items-center gap-4">
                  {getFindingIcon(finding.title, finding.severity)}
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm sm:text-base text-white group-hover:text-[#479ef5] transition-colors">
                        {finding.title}
                      </h4>
                      {finding.status === 'remediated' && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30">
                          Remediated
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400 mt-0.5 leading-relaxed">
                      {finding.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-white/5 pt-3 sm:pt-0">
                  {getSeverityBadge(finding.severity)}
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#479ef5]/10 hover:bg-[#479ef5] text-[#479ef5] hover:text-slate-950 font-semibold text-xs rounded-lg transition-all border border-[#479ef5]/20">
                    <Wrench className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Remediate</span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-950 transition-transform group-hover:translate-x-0.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </section>
  );
};
