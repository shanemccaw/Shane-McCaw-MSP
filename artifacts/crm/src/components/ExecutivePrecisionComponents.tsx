
const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  active:              { label: "Active",              bg: "#d1faf5", text: "#0c7a71" },
  in_progress:         { label: "In Progress",         bg: "#d1faf5", text: "#0c7a71" },
  backlog:             { label: "Backlog",              bg: "#f0f4f8", text: "#4a5568" },
  waiting_on_customer: { label: "Waiting on Client",   bg: "#fef3c7", text: "#92400e" },
  waiting_on_client:   { label: "Waiting on Client",   bg: "#fef3c7", text: "#92400e" },
  completed:           { label: "Completed",           bg: "#dcfce7", text: "#166534" },
  on_hold:             { label: "On Hold",             bg: "#fef3c7", text: "#92400e" },
  paused:              { label: "Paused",              bg: "#f0f4f8", text: "#4a5568" },
  pending:             { label: "Pending",             bg: "#f0f4f8", text: "#4a5568" },
  overdue:             { label: "Overdue",             bg: "#fee2e2", text: "#991b1b" },
  due:                 { label: "Due",                 bg: "#fef3c7", text: "#92400e" },
  paid:                { label: "Paid",                bg: "#dcfce7", text: "#166534" },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status.replace(/_/g, " "), bg: "#f0f4f8", text: "#4a5568" };
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide capitalize whitespace-nowrap"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  );
}

interface ProgressBarProps {
  value: number;
  showLabel?: boolean;
}

export function ExecProgressBar({ value, showLabel = false }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="ep-progress-wrap">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">Progress</span>
          <span className="text-[10px] font-bold text-[#0c9488]">{pct}%</span>
        </div>
      )}
      <div className="h-1 rounded-full bg-[#e2e8f0] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #0c9488 0%, #14b8a6 100%)",
          }}
        />
      </div>
    </div>
  );
}

interface ExecCardProps {
  title: string;
  status: string;
  phase?: string | null;
  progress?: number;
  deadline?: string | null;
  owner?: string | null;
  onClick?: () => void;
}

export function ExecCard({ title, status, phase, progress, deadline, owner, onClick }: ExecCardProps) {
  return (
    <div
      className={`ep-card bg-white rounded-xl p-5 flex flex-col gap-3 ${onClick ? "cursor-pointer hover:-translate-y-0.5" : ""}`}
      style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)", transition: "box-shadow 0.2s, transform 0.2s", borderRadius: 12 }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-[#0f172a] leading-snug flex-1">{title}</h3>
        <StatusBadge status={status} />
      </div>

      {phase && (
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b]">{phase}</p>
      )}

      {progress !== undefined && (
        <ExecProgressBar value={progress} showLabel />
      )}

      {(deadline || owner) && (
        <div className="flex items-center gap-4 mt-1">
          {deadline && (
            <span className="text-[11px] text-[#64748b]">
              <span className="font-semibold uppercase tracking-wider text-[10px] mr-1">Due</span>
              {new Date(deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {owner && (
            <span className="text-[11px] text-[#64748b]">
              <span className="font-semibold uppercase tracking-wider text-[10px] mr-1">Owner</span>
              {owner}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
}

export function KpiTile({ label, value, icon, accent = "#0c9488" }: KpiTileProps) {
  return (
    <div
      className="bg-white rounded-xl p-5 flex items-center gap-4"
      style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)", borderRadius: 12 }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${accent}18` }}
      >
        <span style={{ color: accent }}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-extrabold text-[#0f172a] leading-none">{value}</p>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#64748b] mt-1">{label}</p>
      </div>
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="bg-white rounded-xl p-5 flex items-center gap-4 animate-pulse" style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)", borderRadius: 12 }}>
      <div className="w-10 h-10 rounded-lg bg-[#f1f5f9]" />
      <div className="flex-1">
        <div className="h-7 w-12 bg-[#f1f5f9] rounded mb-2" />
        <div className="h-3 w-24 bg-[#f1f5f9] rounded" />
      </div>
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-5 flex flex-col gap-3 animate-pulse" style={{ boxShadow: "0 2px 10px rgba(15,23,42,0.06)", borderRadius: 12 }}>
      <div className="flex justify-between gap-2">
        <div className="h-4 bg-[#f1f5f9] rounded w-2/3" />
        <div className="h-5 bg-[#f1f5f9] rounded-full w-16" />
      </div>
      <div className="h-3 bg-[#f1f5f9] rounded w-1/3" />
      <div className="h-1 bg-[#f1f5f9] rounded" />
    </div>
  );
}
