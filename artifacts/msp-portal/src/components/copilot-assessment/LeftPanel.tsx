import React from 'react';
import { AssessmentStep } from '../types';
import { 
  Home, 
  HelpCircle, 
  Activity, 
  Users, 
  Grid, 
  ShieldAlert, 
  ShieldCheck,
  TrendingUp, 
  Award,
  FileCheck, 
  ShoppingCart,
  PanelLeftClose, 
  PanelLeft,
  ChevronRight
} from 'lucide-react';

interface LeftPanelProps {
  currentStep: AssessmentStep;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (step: AssessmentStep) => void;
  quizProgress: number;
}

interface NavItem {
  id: AssessmentStep;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  category?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Assessment Home', icon: Home, category: 'Overview' },
  { id: 'quiz', label: '10-Q Quiz Engine', icon: HelpCircle, badge: '10 Qs', category: 'Inputs' },
  { id: 'telemetry', label: 'Telemetry Signals', icon: Activity, badge: 'Live', category: 'Analysis' },
  { id: 'personas', label: 'Persona Stories', icon: Users, badge: '4 Cohorts', category: 'Insights' },
  { id: 'use-cases', label: 'Use-Case Matrix', icon: Grid, badge: '6 Tiles', category: 'Insights' },
  { id: 'security', label: 'Security', icon: ShieldAlert, badge: 'M365', category: 'Simulation' },
  { id: 'security2', label: 'Security 2', icon: ShieldAlert, badge: 'Blast', category: 'Simulation' },
  { id: 'governance', label: 'Governance', icon: ShieldCheck, badge: 'Sandbox', category: 'Simulation' },
  { id: 'roi', label: 'ROI Modeling', icon: TrendingUp, badge: 'Calc', category: 'Simulation' },
  { id: 'report', label: 'Final Report', icon: Award, badge: 'Executive', category: 'Deliverables' },
  { id: 'documents', label: 'Document Deliverables', icon: FileCheck, badge: '6 Reports', category: 'Deliverables' },
  { id: 'sow', label: 'SOW & Purchase', icon: ShoppingCart, badge: 'Checkout', category: 'Deliverables' },
];

export const LeftPanel: React.FC<LeftPanelProps> = ({
  currentStep,
  isCollapsed,
  onToggleCollapse,
  onNavigate,
  quizProgress
}) => {
  return (
    <aside 
      className={`bg-[#111111] border-r border-[#2D2D2D] flex flex-col transition-all duration-300 z-20 shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Top Header / Toggle */}
      <div className="h-12 border-b border-[#2D2D2D] flex items-center justify-between px-4 shrink-0">
        {!isCollapsed && (
          <div className="text-[10px] uppercase tracking-widest text-[#666666] font-bold">
            Steps
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors ml-auto cursor-pointer"
          title={isCollapsed ? "Expand Navigation" : "Collapse Navigation"}
        >
          {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-thin">
        {NAV_ITEMS.map((item, idx) => {
          const Icon = item.icon;
          const isActive = currentStep === item.id;
          const numStr = String(idx).padStart(2, '0');

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-md text-xs transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#1F1F1F] text-white font-semibold border-l-2 border-[#0078D4]'
                  : 'text-[#A1A1A1] hover:bg-[#1A1A1A] hover:text-white'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              {isActive ? (
                <span className="text-[#0078D4] text-xs leading-none shrink-0">■</span>
              ) : (
                <span className="text-xs font-mono text-[#666666] shrink-0">{numStr}</span>
              )}

              {!isCollapsed && (
                <div className="flex-1 flex items-center justify-between overflow-hidden">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ml-1 ${
                      isActive 
                        ? 'bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40' 
                        : 'bg-[#1F1F1F] text-[#888888] border border-[#2D2D2D]'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Status / Footer */}
      {!isCollapsed && (
        <div className="mt-auto p-4 border-t border-[#2D2D2D] bg-[#0A0A0A]">
          <div className="text-[10px] text-[#555555] font-mono leading-relaxed uppercase">
            Assessment ID: CP-992-X<br/>
            Engine: v4.2 Stable
          </div>
        </div>
      )}
    </aside>
  );
};
