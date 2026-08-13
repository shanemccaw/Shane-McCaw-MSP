import React from 'react';
import { PersonaStory } from './types';
import { 
  X, 
  ShieldAlert, 
  TrendingUp, 
  Clock, 
  FileText, 
  CheckCircle2, 
  Award,
  Zap
} from 'lucide-react';

interface PersonaModalProps {
  persona: PersonaStory | null;
  onClose: () => void;
}

export const PersonaModal: React.FC<PersonaModalProps> = ({ persona, onClose }) => {
  if (!persona) return null;

  // #186: PersonaStory's real shape (shortStory/expandedNarrative/
  // sensitivityExposure/collaborationFriction/valuePotential) replaced the
  // narrower mock fields this modal used to read directly.
  const evidence = [
    ...persona.sensitivityExposure.map(e => `${e.label} (${e.severity})`),
    ...persona.collaborationFriction.map(f => `${f.label} (${f.severity})`),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#161616] border border-[#2D2D2D] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl space-y-6 p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#2D2D2D] pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-lg bg-[#111111] border border-[#2D2D2D] flex items-center justify-center text-2xl">
              {persona.avatar}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-bold text-white">{persona.name}</h2>
                <span className="text-xs font-mono bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/40 px-2 py-0.5 rounded">
                  {persona.department}
                </span>
              </div>
              <p className="text-xs text-[#A1A1A1]">{persona.role}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#A1A1A1] hover:text-white hover:bg-[#2D2D2D] rounded transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Narrative Story Section */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[#0078D4] uppercase tracking-wider font-mono">
            Detailed Persona Narrative
          </span>
          <p className="text-sm text-[#E1E1E1] leading-relaxed bg-[#111111] p-4 rounded-lg border border-[#2D2D2D]">
            "{persona.shortStory.summary}"
          </p>
        </div>

        {/* Telemetry Evidence Grid */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[#A1A1A1] uppercase tracking-wider font-mono flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[#0078D4]" />
            Common Patterns for This Persona
          </span>
          <div className="space-y-2">
            {evidence.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center space-x-2.5 bg-[#111111] border border-[#2D2D2D] p-2.5 rounded-md text-xs text-[#E1E1E1]"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-mono">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ROI Preview Panel */}
        <div className="bg-[#1F1F1F] border border-[#2D2D2D] p-4 rounded-lg space-y-3">
          <span className="text-xs font-semibold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-[#0078D4]" />
            ROI & Value Realization Preview
          </span>

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#111111] p-3 rounded-md border border-[#2D2D2D]">
              <span className="text-[10px] text-[#888888] block">Weekly Time Saved</span>
              <span className="text-base font-bold text-emerald-400 font-mono">
                +{persona.valuePotential.hoursSavedPerWeek} hrs / wk
              </span>
            </div>

            <div className="bg-[#111111] p-3 rounded-md border border-[#2D2D2D]">
              <span className="text-[10px] text-[#888888] block">Annual Seat Value</span>
              <span className="text-base font-bold text-[#0078D4] font-mono">
                {persona.valuePotential.annualValuePerSeat}
              </span>
            </div>

            <div className="bg-[#111111] p-3 rounded-md border border-[#2D2D2D]">
              <span className="text-[10px] text-[#888888] block">Primary Benefit Driver</span>
              <span className="text-xs font-medium text-[#E1E1E1]">
                {persona.valuePotential.primaryBenefit}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="bg-[#0078D4] hover:bg-[#0086F0] text-white font-bold px-5 py-2 rounded-md text-xs transition-colors cursor-pointer"
          >
            Close Story
          </button>
        </div>
      </div>
    </div>
  );
};
