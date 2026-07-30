import React from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  ShieldCheck, 
  Clock, 
  Search, 
  CheckCircle2, 
  Zap, 
  Award,
  Layers
} from 'lucide-react';

interface HomeScreenProps {
  onStart: () => void;
  onOpenSpec: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onStart, onOpenSpec }) => {
  return (
    <div className="flex flex-col min-h-full bg-[#0F0F0F]">
      {/* Hero Content Area */}
      <div className="flex-1 p-8 md:p-12 flex flex-col items-center justify-center text-center">
        <div className="mb-4 px-4 py-1.5 border border-[#0078D4]/30 bg-[#0078D4]/10 rounded-full inline-block">
          <span className="text-[#0078D4] text-[10px] font-bold uppercase tracking-[2px]">Enterprise Pilot Mode</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-light text-white mb-6 tracking-tight leading-tight max-w-2xl">
          Start Your Copilot <span className="font-bold">Assessment</span>
        </h1>
        <p className="text-base md:text-lg text-[#A1A1A1] max-w-xl mb-10 leading-relaxed">
          This guided experience analyzes your tenant architecture, user personas, active use cases, and governance posture to generate an ROI-driven roadmap.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={onStart}
            className="px-10 py-4 bg-[#0078D4] text-white font-bold rounded-md hover:bg-[#0086F0] transition-transform active:scale-95 shadow-lg shadow-[#0078D4]/20 cursor-pointer text-sm"
          >
            Begin Assessment
          </button>
          <button
            onClick={onOpenSpec}
            className="px-6 py-4 bg-[#1F1F1F] text-[#E1E1E1] hover:text-white border border-[#2D2D2D] hover:border-[#444444] font-semibold rounded-md transition-colors cursor-pointer text-sm"
          >
            Explore Architecture Spec
          </button>
        </div>
      </div>

      {/* Bottom Info Cards Section */}
      <div className="p-8 bg-[#161616] border-t border-[#2D2D2D]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-[#444444] transition-colors">
            <div className="text-[#0078D4] mb-3">
              <Award className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">What You'll Get</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              Full readiness report, governance roadmap, and personalized ROI model based on tenant telemetry.
            </p>
          </div>

          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-[#444444] transition-colors">
            <div className="text-[#0078D4] mb-3">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">How Long It Takes</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              Estimated 15 minutes. Progress is saved automatically at each of the 8 deterministic checkpoints.
            </p>
          </div>

          <div className="bg-[#1F1F1F] p-5 rounded-lg border border-[#2D2D2D] hover:border-[#444444] transition-colors">
            <div className="text-[#0078D4] mb-3">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-white font-semibold mb-2 text-sm">What We Analyze</h3>
            <p className="text-xs text-[#A1A1A1] leading-relaxed">
              Correlation between tenant signals, persona behaviors, use-case intensity, and security risk levels.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
