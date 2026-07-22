import React, { useState } from 'react';
import { Info, X, Shield, FileCheck, AlertTriangle } from 'lucide-react';
import { LabelBreakdown } from './types';

interface LabelCoverageCardProps {
  data: LabelBreakdown;
}

export const LabelCoverageCard: React.FC<LabelCoverageCardProps> = ({ data }) => {
  const [showInfo, setShowInfo] = useState(false);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);

  return (
    <div className="card-obsidian p-6 relative">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-['Hanken_Grotesk'] text-[18px] leading-[24px] font-semibold text-[#e2e2e2]">
          Label Coverage
        </h3>
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="text-[#c0c7d3] hover:text-[#a0c9ff] p-1 transition-colors rounded-md hover:bg-[#1a1c1c]"
          title="Information"
        >
          <Info className="w-5 h-5" />
        </button>
      </div>

      {/* Donut and Legend Layout */}
      <div className="flex items-center gap-8 h-48">
        {/* SVG Donut */}
        <div className="relative w-40 h-40 flex items-center justify-center shrink-0">
          <svg className="w-full h-full transform -rotate-90">
            {/* Background Circle */}
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="transparent"
              stroke="#333535"
              strokeWidth="12"
            />
            {/* Labeled Segment (68%) */}
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="transparent"
              stroke="#479ef5"
              strokeDasharray="440"
              strokeDashoffset={440 - (440 * data.labeledPercentage) / 100}
              strokeWidth="12"
              className="transition-all duration-500 cursor-pointer"
              onMouseEnter={() => setHoveredSegment('Labeled')}
              onMouseLeave={() => setHoveredSegment(null)}
            />
            {/* Mislabeled Segment (8%) */}
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="transparent"
              stroke="#ffb4ab"
              strokeDasharray="440"
              strokeDashoffset="400"
              strokeWidth="12"
              className="transition-all duration-500 cursor-pointer"
              onMouseEnter={() => setHoveredSegment('Mislabeled')}
              onMouseLeave={() => setHoveredSegment(null)}
            />
          </svg>

          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-['Hanken_Grotesk'] text-[24px] leading-[32px] font-semibold text-[#e2e2e2]">
              {hoveredSegment === 'Unlabeled' ? `${data.unlabeledPercentage}%` :
               hoveredSegment === 'Mislabeled' ? `${data.mislabeledPercentage}%` :
               `${data.labeledPercentage}%`}
            </span>
            <span className="font-['JetBrains_Mono'] text-[10px] leading-[14px] font-medium text-[#c0c7d3] tracking-widest uppercase">
              {hoveredSegment ? hoveredSegment : 'TOTAL'}
            </span>
          </div>
        </div>

        {/* Legend List */}
        <div className="flex-1 space-y-4">
          <div 
            onMouseEnter={() => setHoveredSegment('Labeled')}
            onMouseLeave={() => setHoveredSegment(null)}
            className="flex justify-between items-center p-1.5 rounded hover:bg-[#1a1c1c] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#479ef5]" />
              <span className="text-[14px] font-['Inter'] text-[#e2e2e2]">Labeled</span>
            </div>
            <span className="font-['JetBrains_Mono'] text-[12px] font-medium text-[#e2e2e2]">
              {data.labeledPercentage}%
            </span>
          </div>

          <div 
            onMouseEnter={() => setHoveredSegment('Unlabeled')}
            onMouseLeave={() => setHoveredSegment(null)}
            className="flex justify-between items-center p-1.5 rounded hover:bg-[#1a1c1c] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#333535]" />
              <span className="text-[14px] font-['Inter'] text-[#e2e2e2]">Unlabeled</span>
            </div>
            <span className="font-['JetBrains_Mono'] text-[12px] font-medium text-[#e2e2e2]">
              {data.unlabeledPercentage}%
            </span>
          </div>

          <div 
            onMouseEnter={() => setHoveredSegment('Mislabeled')}
            onMouseLeave={() => setHoveredSegment(null)}
            className="flex justify-between items-center p-1.5 rounded hover:bg-[#1a1c1c] transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#ffb4ab]" />
              <span className="text-[14px] font-['Inter'] text-[#e2e2e2]">Mislabeled</span>
            </div>
            <span className="font-['JetBrains_Mono'] text-[12px] font-medium text-[#e2e2e2]">
              {data.mislabeledPercentage}%
            </span>
          </div>
        </div>
      </div>

      {/* Info Modal */}
      {showInfo && (
        <div className="absolute inset-0 z-20 bg-[#242424] border border-[#a0c9ff]/30 p-5 rounded-lg flex flex-col justify-between animate-in fade-in">
          <div>
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-['Hanken_Grotesk'] font-bold text-sm text-[#a0c9ff] flex items-center gap-2">
                <Shield className="w-4 h-4" /> Classification Hygiene Breakdown
              </h4>
              <button onClick={() => setShowInfo(false)} className="text-[#c0c7d3] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#c0c7d3] leading-relaxed">
              Analyzes automated sensitivity labeling across 3.2M detected files. 
              <span className="text-[#a0c9ff] font-medium"> Labeled (68%)</span> files contain explicit MIP tags. 
              <span className="text-[#ffb4ab] font-medium"> Mislabeled (8%)</span> files contain confidential keywords without matching security metadata.
            </p>
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={() => setShowInfo(false)}
              className="px-3 py-1 bg-[#479ef5] text-[#003259] font-bold text-xs rounded hover:opacity-90"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
