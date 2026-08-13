import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Link } from "wouter";

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  time: string;
  icon?: LucideIcon;
  status?: "default" | "success" | "warning" | "error" | "info";
  /** Optional deep link — wraps the event row in a <Link> when set (e.g. cross-tenant views linking into a customer's detail page). */
  href?: string;
}

export interface TimelineListProps {
  title: string;
  description?: string;
  events: TimelineEvent[];
  className?: string;
}

const statusColors = {
  default: "bg-slate-800 text-slate-400 border-slate-700",
  success: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  warning: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  error: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export function TimelineList({
  title,
  description,
  events,
  className,
}: TimelineListProps) {
  return (
    <Card className={cn("flex flex-col border-slate-800 bg-slate-950/40", className)}>
      <CardHeader className="items-start pb-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1">
        <div className="space-y-4">
          {events.map((event, index) => {
            const isLast = index === events.length - 1;
            const Icon = event.icon;
            const statusStyle = statusColors[event.status || "default"];

            return (
              <div key={event.id} className="relative flex gap-4">
                {/* Vertical Line */}
                {!isLast && (
                  <div className="absolute left-4 top-8 bottom-[-16px] w-px bg-slate-800" />
                )}
                
                {/* Icon Marker */}
                <div
                  className={cn(
                    "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border",
                    statusStyle
                  )}
                >
                  {Icon ? (
                    <Icon className="size-4" />
                  ) : (
                    <div className="size-2 rounded-full bg-current" />
                  )}
                </div>

                {/* Content */}
                <div className="flex flex-col flex-1 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    {event.href ? (
                      <Link
                        href={event.href}
                        className="text-sm font-medium text-slate-200 hover:underline underline-offset-2"
                      >
                        {event.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-slate-200">
                        {event.title}
                      </p>
                    )}
                    <time className="text-xs text-slate-500 shrink-0">
                      {event.time}
                    </time>
                  </div>
                  {event.description && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
