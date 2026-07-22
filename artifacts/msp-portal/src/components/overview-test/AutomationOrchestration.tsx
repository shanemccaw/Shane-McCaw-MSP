import React from 'react';
import {
  FileText,
  Edit3,
  Wrench,
  BellRing,
  Download,
  Zap,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { AutomationTask } from './types';

interface AutomationOrchestrationProps {
  tasks: AutomationTask[];
  onTriggerTaskAction: (task: AutomationTask) => void;
}

export const AutomationOrchestration: React.FC<AutomationOrchestrationProps> = ({
  tasks,
  onTriggerTaskAction,
}) => {
  const getTaskIcon = (icon: string) => {
    switch (icon) {
      case 'file-text':
        return <FileText className="w-6 h-6 text-[#479ef5]" />;
      case 'edit-3':
        return <Edit3 className="w-6 h-6 text-[#d6bbf8]" />;
      case 'wrench':
        return <Wrench className="w-6 h-6 text-[#ffb95c]" />;
      case 'bell-ring':
        return <BellRing className="w-6 h-6 text-[#ffb4ab]" />;
      default:
        return <FileText className="w-6 h-6 text-[#479ef5]" />;
    }
  };

  const getTaskIconBg = (icon: string) => {
    switch (icon) {
      case 'file-text':
        return 'bg-[#479ef5]/10 group-hover:bg-[#479ef5] group-hover:text-slate-950';
      case 'edit-3':
        return 'bg-[#d6bbf8]/10 group-hover:bg-[#d6bbf8] group-hover:text-slate-950';
      case 'wrench':
        return 'bg-[#ffb95c]/10 group-hover:bg-[#ffb95c] group-hover:text-slate-950';
      case 'bell-ring':
        return 'bg-[#ffb4ab]/10 group-hover:bg-[#ffb4ab] group-hover:text-slate-950';
      default:
        return 'bg-[#479ef5]/10';
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'pdf':
        return <Download className="w-3.5 h-3.5" />;
      case 'sow':
        return <Zap className="w-3.5 h-3.5" />;
      case 'plan':
        return <Eye className="w-3.5 h-3.5" />;
      case 'alerts':
        return <ArrowRight className="w-3.5 h-3.5" />;
      default:
        return <ArrowRight className="w-3.5 h-3.5" />;
    }
  };

  return (
    <section className="mb-20 max-w-6xl mx-auto">
      <h2 className="text-xl font-bold text-white tracking-tight mb-6">
        Automation & Orchestration
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => onTriggerTaskAction(task)}
            className="glass-panel p-6 rounded-2xl group hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col justify-between hover:border-white/20 hover:bg-[#242830]"
          >
            <div>
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors ${getTaskIconBg(
                  task.icon
                )}`}
              >
                {getTaskIcon(task.icon)}
              </div>

              <h3 className="font-bold text-sm text-white mb-2 group-hover:text-[#479ef5] transition-colors">
                {task.title}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                {task.description}
              </p>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              {task.badge ? (
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${task.badgeColor}`}>
                    {task.badge}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Next: Mon 08:00</span>
                </div>
              ) : (
                <button className="text-xs font-bold text-[#479ef5] flex items-center gap-1.5 group-hover:underline">
                  <span>{task.actionText}</span>
                  {getActionIcon(task.actionType)}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
