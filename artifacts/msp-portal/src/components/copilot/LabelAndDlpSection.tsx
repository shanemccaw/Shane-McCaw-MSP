import React from 'react';
import { LabelCoverageData, DlpMetric } from './types';

interface LabelAndDlpSectionProps {
  labelCoverage: LabelCoverageData;
  dlpMetrics: DlpMetric[];
}

export const LabelAndDlpSection: React.FC<LabelAndDlpSectionProps> = ({
  labelCoverage,
  dlpMetrics
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* LEFT: Label Coverage Analysis */}
      <div className="glass-card p-6 rounded-xl flex flex-col justify-between">
        <h3 className="font-display text-lg font-semibold text-[#f0f0f0] mb-6">
          Label Coverage Analysis
        </h3>

        <div className="flex flex-col sm:flex-row items-center justify-around gap-6 my-auto">
          {/* Donut SVG */}
          <div className="relative w-48 h-48 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              {/* Background ring */}
              <circle
                cx="18"
                cy="18"
                fill="transparent"
                r="15.915"
                stroke="#2b2b2b"
                strokeWidth="3"
              />
              {/* Labeled 75% stroke-dasharray="75 25" offset=0 */}
              <circle
                cx="18"
                cy="18"
                fill="transparent"
                r="15.915"
                stroke="#479ef5"
                strokeDasharray={`${labelCoverage.labeledPercent} ${100 - labelCoverage.labeledPercent}`}
                strokeDashoffset="0"
                strokeWidth="3"
              />
              {/* Unlabeled 20% stroke-dasharray="20 80" offset=-75 */}
              <circle
                cx="18"
                cy="18"
                fill="transparent"
                r="15.915"
                stroke="#333535"
                strokeDasharray={`${labelCoverage.unlabeledPercent} ${100 - labelCoverage.unlabeledPercent}`}
                strokeDashoffset={`-${labelCoverage.labeledPercent}`}
                strokeWidth="3"
              />
              {/* Mislabeled 5% stroke-dasharray="5 95" offset=-95 */}
              <circle
                cx="18"
                cy="18"
                fill="transparent"
                r="15.915"
                stroke="#f44336"
                strokeDasharray={`${labelCoverage.mislabeledPercent} ${100 - labelCoverage.mislabeledPercent}`}
                strokeDashoffset={`-${labelCoverage.labeledPercent + labelCoverage.unlabeledPercent}`}
                strokeWidth="3"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-3xl font-bold text-[#f0f0f0]">
                {labelCoverage.labeledPercent}%
              </span>
              <span className="font-mono text-[10px] text-[#c0c7d3] uppercase tracking-widest">
                COVERAGE
              </span>
            </div>
          </div>

          {/* Breakdown Legend */}
          <div className="space-y-4 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-[#479ef5] rounded-full flex-shrink-0" />
              <div>
                <p className="font-mono text-xs font-semibold text-[#f0f0f0]">Labeled</p>
                <p className="text-[#c0c7d3] font-mono text-[11px]">
                  {labelCoverage.labeledPercent}% ({labelCoverage.labeledCount})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-[#333535] rounded-full flex-shrink-0" />
              <div>
                <p className="font-mono text-xs font-semibold text-[#f0f0f0]">Unlabeled</p>
                <p className="text-[#c0c7d3] font-mono text-[11px]">
                  {labelCoverage.unlabeledPercent}% ({labelCoverage.unlabeledCount})
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-[#f44336] rounded-full flex-shrink-0" />
              <div>
                <p className="font-mono text-xs font-semibold text-[#f0f0f0]">Mislabeled</p>
                <p className="text-[#c0c7d3] font-mono text-[11px]">
                  {labelCoverage.mislabeledPercent}% ({labelCoverage.mislabeledCount})
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: DLP Effectiveness */}
      <div className="glass-card p-6 rounded-xl flex flex-col justify-between">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-display text-lg font-semibold text-[#f0f0f0]">
            DLP Effectiveness
          </h3>
          <span className="font-mono text-[10px] text-[#c0c7d3] uppercase tracking-wider">
            LAST 30 DAYS
          </span>
        </div>

        <div className="flex-1 flex flex-col justify-between gap-5">
          {dlpMetrics.map((item) => (
            <div key={item.id} className="space-y-2">
              <div className="flex justify-between font-mono text-xs">
                <span className="text-[#f0f0f0] font-medium">{item.title}</span>
                <span className="text-[#479ef5] font-semibold">
                  {item.blockedPercent}% Blocked
                </span>
              </div>
              <div className="flex h-6 w-full rounded-sm overflow-hidden bg-[#1a1a1a] p-0.5 border border-[#2b2b2b]">
                <div
                  style={{ width: `${item.blockedPercent}%` }}
                  className="bg-[#479ef5] h-full flex items-center justify-center text-[10px] font-mono font-bold text-black rounded-xs transition-all duration-500"
                >
                  {item.blockedPercent >= 15 && 'BLOCKED'}
                </div>
                {item.overridePercent > 0 && (
                  <div
                    style={{ width: `${item.overridePercent}%` }}
                    className="bg-amber-500 h-full flex items-center justify-center text-[10px] font-mono font-bold text-black rounded-xs transition-all duration-500"
                  >
                    {item.overridePercent >= 10 && 'OVERRIDE'}
                  </div>
                )}
                {item.allowedPercent > 0 && (
                  <div
                    style={{ width: `${item.allowedPercent}%` }}
                    className="bg-[#f44336] h-full flex items-center justify-center text-[10px] font-mono font-bold text-white rounded-xs transition-all duration-500"
                  >
                    {item.allowedPercent >= 8 && 'ALLOWED'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
