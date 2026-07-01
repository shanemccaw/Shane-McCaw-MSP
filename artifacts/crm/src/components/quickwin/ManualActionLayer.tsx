import { useRef, useState, useCallback } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import TelemetryFeed from "./TelemetryFeed";
import { QW_COPY } from "@/lib/quickWinCopy";

interface ManualActionLayerProps {
  telemetryLines: string[];
}

export default function ManualActionLayer({ telemetryLines }: ManualActionLayerProps) {
  const { dispatch } = useQuickWinMode();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".json")) return;
    dispatch({ type: "STEP_COMPLETE" });
  }, [dispatch]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify({ script: "quick-win-diagnostic.ps1", version: "1.0" }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quick-win-script-package.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-bold text-[#0A2540]/60 uppercase tracking-wide mb-3">
          {QW_COPY.manualStep.heading}
        </p>

        <button
          onClick={handleDownload}
          className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-[#0078D4] text-white font-bold text-sm shadow-lg shadow-[#0078D4]/25 hover:bg-[#0078D4]/90 active:scale-[0.98]"
          style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {QW_COPY.manualStep.downloadBtn}
        </button>
      </div>

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className="relative rounded-xl border-2 border-dashed px-6 py-8 flex flex-col items-center gap-2 cursor-pointer select-none"
        style={{
          borderColor: isDragging ? "#0078D4" : "rgba(10,37,64,0.2)",
          backgroundColor: isDragging ? "rgba(0,120,212,0.04)" : "rgba(247,249,252,0.6)",
          transition: "all 240ms cubic-bezier(0.42,0,0.58,1)",
        }}
      >
        <div
          className="w-10 h-10 rounded-full border-2 border-[#0078D4]/40 flex items-center justify-center"
          style={{
            animation: "qw-pulse-border 2s cubic-bezier(0.42,0,0.58,1) infinite",
          }}
        >
          <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.manualStep.dropzoneLabel}</p>
        <p className="text-xs text-muted-foreground">{QW_COPY.manualStep.dropzoneHint}</p>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      <TelemetryFeed lines={telemetryLines} />
    </div>
  );
}
