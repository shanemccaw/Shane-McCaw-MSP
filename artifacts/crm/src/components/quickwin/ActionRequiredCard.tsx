import { useCallback, useRef } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";

export type DownloadState = "idle" | "waiting";

interface ActionRequiredCardProps {
  stepTitle: string;
  procedureNumber?: number;
  isExiting?: boolean;
  downloadState: DownloadState;
  onDownloadClick: () => void;
}

export default function ActionRequiredCard({
  stepTitle,
  procedureNumber = 1,
  isExiting,
  downloadState,
  onDownloadClick,
}: ActionRequiredCardProps) {
  const { dispatch } = useQuickWinMode();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDownload = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ script: "quick-win-diagnostic.ps1", version: "1.0", step: stepTitle }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quick-win-script-${procedureNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onDownloadClick();
  }, [stepTitle, procedureNumber, onDownloadClick]);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".json")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        JSON.parse(e.target?.result as string);
        dispatch({ type: "STEP_COMPLETE" });
      } catch { /* ignore invalid */ }
    };
    reader.readAsText(file);
  }, [dispatch]);

  const PROCEDURE_STEPS = [
    { num: "01", title: "Provision Payload", desc: "Generate unique encrypted .ps1 diagnostic script." },
    { num: "02", title: "Elevated Execution", desc: "Run script with administrative privileges on target host." },
    { num: "03", title: "Telemetry Sync", desc: "System auto-detects completion via secure handshake.", dimmed: downloadState === "idle" },
  ];

  return (
    <div
      className="rounded-xl p-8 flex flex-col w-full max-w-[380px] h-[420px] bg-white/80 border border-black/10 shadow-lg"
      style={{
        backdropFilter: "blur(12px)",
        transform: isExiting ? "translateX(100%) scale(0.96)" : "translateX(0)",
        opacity: isExiting ? 0 : 1,
        transition: "transform 400ms cubic-bezier(0.42,0,0.58,1), opacity 400ms cubic-bezier(0.42,0,0.58,1)",
      }}
    >
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#1160a4]/10 text-[#1160a4] flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div>
            <h2 className="text-[18px] font-semibold text-[#191c1e] leading-tight">{stepTitle}</h2>
            <p className="text-[11px] text-black/50 uppercase tracking-widest font-bold">
              Procedure {String(procedureNumber).padStart(2, "0")}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-500/20 rounded-full shadow-sm">
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Server Sync</span>
              <span className="text-[8px] text-emerald-600/70">Verified</span>
            </div>
          </div>
          <div className="px-2.5 py-0.5 rounded-full border border-[#1160a4]/30 text-[#1160a4] text-[11px] font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1160a4]" />
            Manual
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="relative space-y-3 overflow-y-auto pr-2 no-scrollbar flex-1">
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-black/10" />
          {PROCEDURE_STEPS.map((step) => (
            <div
              key={step.num}
              className="relative flex gap-4 items-start py-2.5"
              style={{ opacity: step.dimmed ? 0.4 : 1, transition: "opacity 300ms" }}
            >
              <div className="w-6 h-6 rounded-full bg-white border border-[#0078D4] text-[#0078D4] flex items-center justify-center text-[10px] font-bold shrink-0 z-10">
                {step.num}
              </div>
              <div className="space-y-0.5">
                <p className="text-[14px] font-semibold text-[#191c1e]">{step.title}</p>
                <p className="text-[11px] text-black/50">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer: idle → Download button; waiting → shimmer "Awaiting Data Return" */}
        <div className="mt-4">
          {downloadState === "idle" ? (
            <button
              onClick={handleDownload}
              className="w-full bg-[#0078D4] text-white py-3 rounded-lg font-semibold text-[14px] hover:bg-[#0078D4]/90 transition-all flex items-center justify-center gap-2 shadow-md"
              style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
            >
              Download Script
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          ) : (
            <div className="w-full flex flex-col gap-3">
              <div className="h-1.5 w-full bg-black/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#0078D4] rounded-full"
                  style={{
                    width: "100%",
                    animation: "shimmer 2s infinite",
                    background: "linear-gradient(90deg, #0078D4 25%, #00B4D8 50%, #0078D4 75%)",
                    backgroundSize: "200% 100%",
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-[#0078D4]">Awaiting Data Return</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-[11px] font-bold text-black/40 hover:text-[#0078D4] underline underline-offset-2"
                  style={{ transition: "color 200ms" }}
                >
                  Upload output
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>
    </div>
  );
}
