import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LucideIcon } from "lucide-react";

export interface DashboardTabConfig {
  id: string;
  label: string;
  icon?: LucideIcon;
  component: ReactNode;
}

export interface DashboardTemplateProps {
  title?: string;
  description?: string;
  tabs: DashboardTabConfig[];
  defaultTabId?: string;
  headerContent?: ReactNode;
}

export function DashboardTemplate({
  title,
  description,
  tabs,
  defaultTabId,
  headerContent,
}: DashboardTemplateProps) {
  const [activeTab, setActiveTab] = useState(defaultTabId ?? tabs[0]?.id);

  const activeContent = tabs.find((t) => t.id === activeTab)?.component;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header section */}
      {(title || description || headerContent) && (
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-2xl font-bold tracking-tight">{title}</h2>}
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          {headerContent && <div>{headerContent}</div>}
        </div>
      )}

      {/* Main dashboard area with sidebar navigation */}
      <div className="flex flex-col md:flex-row gap-6 h-full min-h-[600px]">
        {/* Mobile Navigation (Dropdown) */}
        <div className="md:hidden">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full bg-slate-900/50 border-slate-800">
              <SelectValue placeholder="Select a view" />
            </SelectTrigger>
            <SelectContent>
              {tabs.map((tab) => (
                <SelectItem key={tab.id} value={tab.id}>
                  <div className="flex items-center gap-2">
                    {tab.icon && <tab.icon className="size-4" />}
                    {tab.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop Navigation (Sidebar) */}
        <div className="hidden md:flex flex-col w-64 shrink-0 bg-slate-900/20 border border-slate-800 rounded-xl overflow-hidden">
          <ScrollArea className="h-full py-2">
            <div className="px-3 space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center w-full gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200",
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                      : "text-muted-foreground hover:bg-slate-800/50 hover:text-foreground border border-transparent"
                  )}
                >
                  {tab.icon && (
                    <tab.icon
                      className={cn(
                        "size-4 shrink-0",
                        activeTab === tab.id ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  )}
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0 bg-slate-950/20 border border-slate-800/50 rounded-xl p-4 sm:p-6 overflow-hidden">
          {activeContent}
        </div>
      </div>
    </div>
  );
}
