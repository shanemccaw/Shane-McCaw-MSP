import React from 'react';
import { AppInventory } from './types';

interface AppRegistrationInventoryProps {
  inventory: AppInventory;
}

export const AppRegistrationInventory: React.FC<AppRegistrationInventoryProps> = ({
  inventory,
}) => {
  // Compute percentage angles for donut graphic representation
  const healthyPct = (inventory.healthy / inventory.total) * 100;
  const medPct = (inventory.mediumRisk / inventory.total) * 100;
  const highPct = (inventory.highRisk / inventory.total) * 100;

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#333535] bg-[#1e2020] p-5 shadow-lg h-full">
      <h2 className="font-display text-base font-semibold text-[#e2e2e2] mb-4">
        App Registration Inventory
      </h2>

      <div className="flex items-center justify-around gap-4 py-2">
        {/* Polygon / Donut ring visual */}
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
          <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
            {/* Background ring */}
            <circle
              cx="50"
              cy="50"
              r="38"
              className="stroke-[#121414]"
              strokeWidth="10"
              fill="transparent"
            />
            {/* Healthy (Blue) segment */}
            <circle
              cx="50"
              cy="50"
              r="38"
              className="stroke-[#479ef5]"
              strokeWidth="10"
              strokeDasharray={`${healthyPct * 2.38} 238`}
              strokeDashoffset="0"
              fill="transparent"
            />
            {/* Med Risk (Orange) segment */}
            <circle
              cx="50"
              cy="50"
              r="38"
              className="stroke-[#f59e0b]"
              strokeWidth="10"
              strokeDasharray={`${medPct * 2.38} 238`}
              strokeDashoffset={`-${healthyPct * 2.38}`}
              fill="transparent"
            />
            {/* High Risk (Red) segment */}
            <circle
              cx="50"
              cy="50"
              r="38"
              className="stroke-[#ef4444]"
              strokeWidth="10"
              strokeDasharray={`${highPct * 2.38} 238`}
              strokeDashoffset={`-${(healthyPct + medPct) * 2.38}`}
              fill="transparent"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center text-center">
            <span className="font-display text-2xl font-bold text-white leading-none">
              {inventory.total}
            </span>
          </div>
        </div>

        {/* Breakdown Legend */}
        <div className="space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#479ef5]" />
              <span className="text-[#c0c7d3]">Healthy Apps</span>
            </div>
            <span className="font-bold text-[#e2e2e2]">{inventory.healthy}</span>
          </div>

          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#f59e0b]" />
              <span className="text-[#c0c7d3]">Medium Risk</span>
            </div>
            <span className="font-bold text-[#e2e2e2]">{inventory.mediumRisk}</span>
          </div>

          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[#ef4444]" />
              <span className="text-[#c0c7d3]">High Risk</span>
            </div>
            <span className="font-bold text-[#e2e2e2]">{inventory.highRisk}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
