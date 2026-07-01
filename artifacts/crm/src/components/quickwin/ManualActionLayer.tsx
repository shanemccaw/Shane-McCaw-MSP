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
  const [fileError, setFileError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    setFileError(null);
    if (!file.name.endsWith(".json")) {
      setFileError("Only .json files are accepted. Please upload the output file from the diagnostic script.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      try {
        JSON.parse(text);
        dispatch({ type: "STEP_COMPLETE" });
      } catch {
        setFileError("The file could not be parsed as valid JSON. Please re-run the script and upload the output file it generates.");
      }
    };
    reader.onerror = () => {
      setFileError("The file could not be read. Please try again.");
    };
    reader.readAsText(file);
  }, [dispatch]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const dropzoneBorderColor = fileError
    ? "#ef4444"
    : isDragging
    ? "#0078D4"
    : "rgba(10,37,64,0.2)";
  const dropzoneBgColor = fileError
    ? "rgba(239,68,68,0.04)"
    : isDragging
    ? "rgba(0,120,212,0.04)"
    : "rgba(247,249,252,0.6)";

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
          borderColor: dropzoneBorderColor,
          backgroundColor: dropzoneBgColor,
          transition: "all 240ms cubic-bezier(0.42,0,0.58,1)",
        }}
      >
        <div
          className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${fileError ? "border-red-400/60" : "border-[#0078D4]/40"}`}
          style={fileError ? undefined : {
            animation: "qw-pulse-border 2s cubic-bezier(0.42,0,0.58,1) infinite",
          }}
        >
          {fileError ? (
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
        </div>
        {fileError ? (
          <>
            <p className="text-sm font-bold text-red-600 text-center">Invalid file</p>
            <p className="text-xs text-red-500 text-center max-w-xs">{fileError}</p>
            <p className="text-xs text-muted-foreground mt-1">Click or drop to try again</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.manualStep.dropzoneLabel}</p>
            <p className="text-xs text-muted-foreground">{QW_COPY.manualStep.dropzoneHint}</p>
          </>
        )}
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
