import React from 'react';
import { AutomationTask } from '../types';

interface AutomationPotentialProps {
  tasks: AutomationTask[];
  onExecuteAutomation: (taskId: string) => void;
}

export const AutomationPotential: React.FC<AutomationPotentialProps> = ({
  tasks,
  onExecuteAutomation
}) => {
  const getButtonStyles = (task: AutomationTask) => {
    switch (task.accentColor) {
      case 'primary':
        return 'bg-[#479ef5] text-[#003259] hover:bg-sky-400 group-hover:shadow-[0_0_15px_rgba(71,158,245,0.4)]';
      case 'secondary':
        return 'bg-[#b388ff] text-[#421871] hover:bg-purple-300 group-hover:shadow-[0_0_15px_rgba(179,136,255,0.4)]';
      case 'error':
        return 'bg-[#f44336] text-white hover:bg-red-600 group-hover:shadow-[0_0_15px_rgba(244,67,54,0.4)]';
      default:
        return 'bg-white text-black';
    }
  };

  const getBadge = (task: AutomationTask) => {
    switch (task.accentColor) {
      case 'primary':
        return 'text-[#479ef5] border-[#479ef5]/20 bg-[#479ef5]/10';
      case 'secondary':
        return 'text-[#b388ff] border-[#b388ff]/20 bg-[#b388ff]/10';
      case 'error':
        return 'text-red-400 border-red-500/20 bg-red-500/10';
    }
  };

  const getIcon = (accentColor: string) => {
    switch (accentColor) {
      case 'primary':
        return (
          <span className="material-symbols-outlined text-[#479ef5] bg-[#479ef5]/10 p-2 rounded-lg text-2xl">
            shutter_speed
          </span>
        );
      case 'secondary':
        return (
          <span className="material-symbols-outlined text-[#b388ff] bg-[#b388ff]/10 p-2 rounded-lg text-2xl">
            label_important
          </span>
        );
      case 'error':
        return (
          <span className="material-symbols-outlined text-red-400 bg-red-500/10 p-2 rounded-lg text-2xl">
            block
          </span>
        );
    }
  };

  return (
    <section className="pb-6">
      <h3 className="font-display text-lg font-semibold text-[#f0f0f0] mb-6">
        Copilot Automation Potential
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="glass-card p-6 rounded-xl group hover:border-[#404752] transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-4">
                {getIcon(task.accentColor)}
                <span
                  className={`font-mono text-[10px] uppercase font-bold px-2 py-0.5 border rounded ${getBadge(
                    task
                  )}`}
                >
                  {task.type}
                </span>
              </div>

              <h4 className="font-display text-base font-bold text-white mb-2">
                {task.title}
              </h4>
              <p className="font-body text-xs text-[#c0c7d3] leading-relaxed">
                {task.description}
              </p>
            </div>

            <div className="mt-6">
              {task.status === 'running' ? (
                <div className="space-y-2">
                  <div className="flex justify-between font-mono text-xs text-[#c0c7d3]">
                    <span>EXECUTING AUTOMATION...</span>
                    <span>{task.progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#1a1a1a] rounded-full overflow-hidden border border-[#2b2b2b]">
                    <div
                      className="h-full bg-[#479ef5] transition-all duration-300 rounded-full"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>
              ) : task.status === 'completed' ? (
                <div className="py-2.5 px-3 bg-emerald-950/40 border border-emerald-500/30 rounded text-emerald-400 font-mono text-xs text-center font-bold flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-base">
                    check_circle
                  </span>
                  AUTOMATION EXECUTED
                </div>
              ) : (
                <button
                  onClick={() => onExecuteAutomation(task.id)}
                  className={`w-full py-2.5 font-mono text-xs font-bold rounded-sm transition-all duration-200 uppercase tracking-wider ${getButtonStyles(
                    task
                  )}`}
                >
                  {task.buttonText}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
