import React, { useState } from 'react';
import { SkuItem } from './types';
import { Layers, ChevronRight, BarChart2, CheckCircle2 } from 'lucide-react';

interface SkuInventoryProps {
  skus: SkuItem[];
  onSelectSku?: (sku: SkuItem) => void;
}

export const SkuInventory: React.FC<SkuInventoryProps> = ({ skus, onSelectSku }) => {
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);

  return (
    <div className="glass-card p-6 rounded-xl h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#479ef5]" />
            <h3 className="font-headline text-lg font-semibold text-[#e2e2e2]">
              SKU Inventory &amp; Utilization
            </h3>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono-tech">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-[#a0c9ff] rounded-xs"></div>
              <span className="text-[#c0c7d3]">Assigned</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-[#404752] rounded-xs"></div>
              <span className="text-[#c0c7d3]">Unassigned</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {skus.map((sku) => {
            const isSelected = selectedSkuId === sku.id;
            const isLowUtil = sku.utilizationPercent < 60;

            return (
              <div
                key={sku.id}
                onClick={() => {
                  setSelectedSkuId(isSelected ? null : sku.id);
                  if (onSelectSku) onSelectSku(sku);
                }}
                className={`p-3 rounded-lg transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-[#1a1c1c] border-[#479ef5]'
                    : 'bg-transparent border-transparent hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex justify-between text-xs font-mono-tech mb-1.5">
                  <span className="font-semibold text-[#e2e2e2] flex items-center gap-2">
                    {sku.name}
                    {isSelected && (
                      <span className="text-[10px] text-[#479ef5] bg-[#479ef5]/10 px-1.5 py-0.5 rounded">
                        Expanded
                      </span>
                    )}
                  </span>
                  <span className={isLowUtil ? 'text-[#ffb4ab] font-bold' : 'text-[#479ef5] font-semibold'}>
                    {sku.utilizationPercent}% Utilization
                  </span>
                </div>

                {/* Progress Bar Container */}
                <div className="flex h-9 w-full bg-[#1a1c1c] overflow-hidden rounded-sm border border-white/5 relative group">
                  <div
                    className="bg-[#a0c9ff] h-full transition-all duration-700 ease-out border-r border-[#121414] flex items-center px-3"
                    style={{ width: `${sku.utilizationPercent}%` }}
                  >
                    <span className="text-[10px] font-mono-tech text-[#003259] font-bold truncate">
                      {sku.assignedCount.toLocaleString()} Seats Assigned
                    </span>
                  </div>
                  <div
                    className="bg-[#404752] h-full flex items-center justify-end px-3 transition-all"
                    style={{ width: `${100 - sku.utilizationPercent}%` }}
                  >
                    {100 - sku.utilizationPercent >= 10 && (
                      <span className="text-[10px] font-mono-tech text-[#c0c7d3] truncate">
                        {sku.unassignedCount.toLocaleString()} Idle
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isSelected && (
                  <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono-tech">
                    <div className="bg-[#121414] p-2 rounded">
                      <span className="text-[#c0c7d3] text-[10px] block">Total Allocated</span>
                      <span className="text-[#e2e2e2] font-bold">{sku.totalCount.toLocaleString()}</span>
                    </div>
                    <div className="bg-[#121414] p-2 rounded">
                      <span className="text-[#c0c7d3] text-[10px] block">Rate / Seat</span>
                      <span className="text-[#a0c9ff] font-bold">${sku.monthlyCostPerSeat}/mo</span>
                    </div>
                    <div className="bg-[#121414] p-2 rounded">
                      <span className="text-[#c0c7d3] text-[10px] block">Unassigned Waste</span>
                      <span className="text-[#ffb4ab] font-bold">
                        ${(sku.unassignedCount * sku.monthlyCostPerSeat).toLocaleString()}/mo
                      </span>
                    </div>
                    <div className="bg-[#121414] p-2 rounded flex items-center justify-center">
                      <button className="text-[11px] text-[#479ef5] hover:underline flex items-center gap-1 font-bold">
                        Manage SKU <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-xs font-mono-tech text-[#c0c7d3]">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> Auto-sync enabled via Graph API
        </span>
        <span className="text-[10px] text-[#c0c7d3]/70">Last telemetry pull: 4m ago</span>
      </div>
    </div>
  );
};
