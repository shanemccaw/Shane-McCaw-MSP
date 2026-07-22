import React, { useState } from 'react';
import { EnablementControl } from '../types';

interface EnablementControlsProps {
  controls: EnablementControl[];
}

export const EnablementControls: React.FC<EnablementControlsProps> = ({
  controls
}) => {
  const [activeControl, setActiveControl] = useState<EnablementControl | null>(
    null
  );

  const getStatusBadge = (control: EnablementControl) => {
    switch (control.statusType) {
      case 'active':
      case 'ready':
      case 'percent':
        return (
          <span className="text-xs font-mono font-medium bg-[#4caf50]/10 text-[#4caf50] px-2 py-0.5 rounded border border-[#4caf50]/20">
            {control.statusText}
          </span>
        );
      case 'warning':
        return (
          <span className="text-xs font-mono font-medium bg-red-500/10 text-red-400 px-2 py-0.5 rounded border border-red-500/20">
            {control.statusText}
          </span>
        );
      case 'pending':
        return (
          <span className="text-xs font-mono font-medium bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded border border-amber-500/20">
            {control.statusText}
          </span>
        );
      case 'running':
        return (
          <span className="text-xs font-mono font-medium bg-[#479ef5]/10 text-[#479ef5] px-2 py-0.5 rounded border border-[#479ef5]/20 animate-pulse">
            {control.statusText}
          </span>
        );
      default:
        return null;
    }
  };

  const getIcon = (control: EnablementControl) => {
    switch (control.statusType) {
      case 'active':
      case 'ready':
      case 'percent':
        return (
          <span className="material-symbols-outlined text-[#4caf50] text-xl">
            check_circle
          </span>
        );
      case 'warning':
        return (
          <span className="material-symbols-outlined text-red-400 text-xl">
            warning
          </span>
        );
      case 'pending':
        return (
          <span className="material-symbols-outlined text-amber-500 text-xl">
            pending
          </span>
        );
      case 'running':
        return (
          <span className="material-symbols-outlined text-[#479ef5] text-xl animate-spin">
            sync
          </span>
        );
    }
  };

  return (
    <section className="glass-card rounded-xl p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#f0f0f0]">
            Enablement Controls Readiness
          </h3>
          <p className="font-body text-xs text-[#c0c7d3] mt-0.5">
            Key operational controls governing identity, conditional access, and data compliance policies.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {controls.map((control) => (
          <div
            key={control.id}
            onClick={() =>
              setActiveControl(activeControl?.id === control.id ? null : control)
            }
            className={`flex items-center justify-between p-4 border border-[#2b2b2b] rounded-lg bg-[#1a1c1c] hover:border-[#404752] transition-all cursor-pointer ${
              control.statusType === 'running' ? 'animate-pulse-subtle' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              {getIcon(control)}
              <span className="font-mono text-xs font-semibold text-[#f0f0f0]">
                {control.name}
              </span>
            </div>
            {getStatusBadge(control)}
          </div>
        ))}
      </div>

      {/* Detail Inspector Dropdown if clicked */}
      {activeControl && (
        <div className="mt-4 p-4 rounded-lg bg-[#121414] border border-[#479ef5]/30 flex items-start justify-between gap-4 animate-fadeIn">
          <div className="space-y-1">
            <span className="font-mono text-xs text-[#479ef5] font-semibold uppercase">
              {activeControl.name} Diagnostic
            </span>
            <p className="font-body text-xs text-[#c0c7d3]">
              {activeControl.detail}
            </p>
          </div>
          <button
            onClick={() => setActiveControl(null)}
            className="text-[#8a919d] hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}
    </section>
  );
};
