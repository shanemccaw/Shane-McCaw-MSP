import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface OutputSchema {
  required?: string[];
  properties?: Record<string, { type: string }>;
}

export interface ManualScriptRecord {
  runResultId: number;
  scriptId: number;
  scriptName: string;
  description: string | null;
  manualRequirements: string[];
  /** JSON schema used to validate uploaded output client-side before POSTing */
  outputSchema: OutputSchema | null;
  status: "awaiting_upload" | "completed";
  createdAt: string;
  uploadedAt: string | null;
  /** Plain-text instruction document from generateManualScriptPackage */
  instructions: string;
  /** Filename for the .ps1 download (e.g. "My_Script.ps1") */
  filename: string;
  /** AI-analyzed findings from the uploaded JSON output */
  findings?: string[];
  /** AI-generated recommendations from the uploaded JSON output */
  recommendations?: string[];
}

/**
 * Runs a lightweight client-side schema check against the uploaded JSON data.
 * Returns an array of human-readable error strings (empty = valid).
 */
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: OutputSchema,
  scriptName: string,
): string[] {
  const errors: string[] = [];

  if (Array.isArray(schema.required)) {
    const missing = schema.required.filter(key => !(key in data));
    if (missing.length > 0) {
      errors.push(
        `Missing required field${missing.length > 1 ? "s" : ""} for "${scriptName}": ${missing.map(k => `"${k}"`).join(", ")}. Please re-run the script and upload the correct output file.`,
      );
    }
  }

  if (schema.properties) {
    for (const [key, def] of Object.entries(schema.properties)) {
      if (!(key in data)) continue;
      const value = data[key];
      const expectedType = def.type;
      let actualType: string = typeof value;
      if (Array.isArray(value)) actualType = "array";
      if (actualType !== expectedType) {
        errors.push(`"${key}" must be of type ${expectedType} but got ${actualType}.`);
      }
    }
  }

  return errors;
}

interface Props {
  script: ManualScriptRecord;
  projectId: number;
  onCompleted: () => void;
  /** When true, suppresses the outer border/banner so the card can be
   *  embedded inside an already-styled container without double borders. */
  embedded?: boolean;
}

function StatusChip({ status }: { status: "awaiting_upload" | "completed" | "processing" }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-green-100 text-green-700 border border-green-200">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Completed
      </span>
    );
  }
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        Processing…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Awaiting Upload
    </span>
  );
}

export function ManualScriptUploadCard({ script, projectId, onCompleted, embedded = false }: Props) {
  const { fetchWithAuth } = useAuth();
  const [status, setStatus] = useState<"awaiting_upload" | "completed" | "processing">(script.status);
  const [findings, setFindings] = useState<string[]>(script.findings ?? []);
  const [recommendations, setRecommendations] = useState<string[]>(script.recommendations ?? []);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"mismatch" | "generic">("generic");
  const [downloading, setDownloading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetchWithAuth(
        `/api/portal/projects/${projectId}/manual-scripts/${script.runResultId}/download`
      );
      if (!res.ok) {
        setError("Failed to download script. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = script.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed. Please check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  };

  const submitJson = useCallback(async (parsed: Record<string, unknown>) => {
    setStatus("processing");
    try {
      const res = await fetchWithAuth(`/api/portal/manual-scripts/${script.runResultId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonData: parsed }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        if (res.status === 422) {
          setErrorKind("mismatch");
          setError(data.error ?? "The uploaded file does not match the expected schema for this script.");
        } else {
          setErrorKind("generic");
          setError(data.error ?? "Upload failed. Please try again.");
        }
        setStatus("awaiting_upload");
        return;
      }

      const result = await res.json() as {
        runResultId: number;
        status: string;
        findings?: string[];
        recommendations?: string[];
      };
      if (result.findings && result.findings.length > 0) setFindings(result.findings);
      if (result.recommendations && result.recommendations.length > 0) setRecommendations(result.recommendations);

      setStatus("completed");
      onCompleted();
    } catch {
      setErrorKind("generic");
      setError("Upload failed due to a network error. Please check your connection and try again.");
      setStatus("awaiting_upload");
    }
  }, [fetchWithAuth, script.runResultId, onCompleted]);

  const processFile = useCallback(async (file: File) => {
    setError(null);

    if (!file.name.endsWith(".json") && file.type !== "application/json") {
      setError("Only .json files are accepted. Please run the PowerShell script first, then upload the JSON output file it creates.");
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const text = await file.text();
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      setError("The file you selected is not valid JSON. Please upload the exact JSON file generated by the PowerShell script.");
      return;
    }

    if (typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      setError("The JSON file is empty or not in the expected format. Please upload the output file created by the PowerShell script.");
      return;
    }

    if (!("data" in parsed)) {
      setError("The JSON file is missing the required 'data' key. Make sure you are uploading the file generated by the downloaded PowerShell script, not a manually created file.");
      return;
    }

    if (script.outputSchema) {
      const schemaErrors = validateAgainstSchema(parsed, script.outputSchema, script.scriptName);
      if (schemaErrors.length > 0) {
        setErrorKind("mismatch");
        setError(schemaErrors.join(" "));
        return;
      }
    }

    await submitJson(parsed);
  }, [submitJson, script.outputSchema, script.scriptName]);

  const handlePasteSubmit = useCallback(async () => {
    setError(null);
    const trimmed = pasteText.trim();

    if (!trimmed) {
      setError("Please paste your JSON output into the text area before submitting.");
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      setError("The text you pasted is not valid JSON. Copy the full terminal output from the PowerShell script and paste it here.");
      return;
    }

    if (typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      setError("The pasted JSON is empty or not in the expected format. Make sure you copy the complete output from the PowerShell script.");
      return;
    }

    if (!("data" in parsed)) {
      setError("The pasted JSON is missing the required 'data' key. Make sure you are copying the full output produced by the downloaded PowerShell script.");
      return;
    }

    if (script.outputSchema) {
      const schemaErrors = validateAgainstSchema(parsed, script.outputSchema, script.scriptName);
      if (schemaErrors.length > 0) {
        setErrorKind("mismatch");
        setError(schemaErrors.join(" "));
        return;
      }
    }

    await submitJson(parsed);
  }, [pasteText, submitJson, script.outputSchema, script.scriptName]);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = "";
  }, [processFile]);

  const handleModeSwitch = (mode: "file" | "paste") => {
    setUploadMode(mode);
    setError(null);
    setErrorKind("generic");
  };

  const inner = (
    <div className={embedded ? "space-y-4" : "p-5 space-y-4"}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <h3 className="text-sm font-bold text-[#0A2540]">{script.scriptName}</h3>
            </div>
            {script.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{script.description}</p>
            )}
          </div>
          <StatusChip status={status} />
        </div>

        {/* What this script collects */}
        {script.manualRequirements.length > 0 && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 mb-1.5">Why this must run locally</p>
            <ul className="space-y-0.5">
              {script.manualRequirements.map((req, i) => (
                <li key={i} className="text-xs text-blue-800 flex items-start gap-1.5">
                  <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                  {req}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Completed state */}
        {status === "completed" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-green-800">Results received — thank you!</p>
                {script.uploadedAt && (
                  <p className="text-xs text-green-600 mt-0.5">
                    Uploaded {new Date(script.uploadedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>

            {(findings.length > 0 || recommendations.length > 0) && (
              <div className="rounded-lg border border-[#0078D4]/20 bg-[#F7F9FC] divide-y divide-[#0078D4]/10 overflow-hidden">
                {findings.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#0078D4] mb-2 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Findings
                    </p>
                    <ul className="space-y-1">
                      {findings.map((f, i) => (
                        <li key={i} className="text-xs text-[#0A2540] flex items-start gap-1.5">
                          <span className="text-[#0078D4] mt-0.5 flex-shrink-0">•</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {recommendations.length > 0 && (
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 mb-2 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                      Next Steps
                    </p>
                    <ul className="space-y-1">
                      {recommendations.map((r, i) => (
                        <li key={i} className="text-xs text-[#0A2540] flex items-start gap-1.5">
                          <span className="text-green-600 mt-0.5 flex-shrink-0">→</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active (awaiting) state */}
        {status !== "completed" && (
          <>
            {/* Download + Instructions row */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleDownload()}
                disabled={downloading}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0A2540] text-white hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
              >
                {downloading ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                {downloading ? "Downloading…" : "Download Script (.ps1)"}
              </button>

              <button
                onClick={() => setInstructionsOpen(o => !o)}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-border text-[#0A2540] hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {instructionsOpen ? "Hide Instructions" : "Step-by-Step Instructions"}
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${instructionsOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Collapsible instructions — content generated server-side by generateManualScriptPackage */}
            {instructionsOpen && (
              <div className="bg-[#F7F9FC] border border-border rounded-lg p-4">
                <pre className="text-[11px] font-mono text-[#0A2540] whitespace-pre-wrap leading-relaxed overflow-x-auto">
                  {script.instructions}
                </pre>
              </div>
            )}

            {/* Upload zone with file/paste tabs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[#0A2540]">Upload Your Results (JSON)</p>
                {/* Mode toggle */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => handleModeSwitch("file")}
                    disabled={status === "processing"}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                      uploadMode === "file"
                        ? "bg-white text-[#0A2540] shadow-sm"
                        : "text-gray-500 hover:text-[#0A2540]"
                    } disabled:opacity-40`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    Upload file
                  </button>
                  <button
                    onClick={() => handleModeSwitch("paste")}
                    disabled={status === "processing"}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                      uploadMode === "paste"
                        ? "bg-white text-[#0A2540] shadow-sm"
                        : "text-gray-500 hover:text-[#0A2540]"
                    } disabled:opacity-40`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
                    </svg>
                    Paste JSON
                  </button>
                </div>
              </div>

              {/* File upload zone */}
              {uploadMode === "file" && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl px-6 py-8 flex flex-col items-center gap-2 cursor-pointer transition-all ${
                    status === "processing"
                      ? "border-blue-300 bg-blue-50 cursor-not-allowed pointer-events-none"
                      : dragOver
                      ? "border-[#0078D4] bg-[#0078D4]/5"
                      : "border-gray-200 bg-gray-50 hover:border-[#0078D4]/50 hover:bg-[#0078D4]/5"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileChange}
                    className="sr-only"
                    disabled={status === "processing"}
                  />
                  {status === "processing" ? (
                    <>
                      <div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm font-semibold text-blue-700">Processing your results…</p>
                      <p className="text-xs text-blue-500">This may take a moment</p>
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <p className="text-sm font-semibold text-[#0A2540]">
                        {dragOver ? "Drop your JSON file here" : "Drag & drop your JSON file here"}
                      </p>
                      <p className="text-xs text-muted-foreground">or <span className="text-[#0078D4] font-semibold">choose a file</span> · .json files only</p>
                    </>
                  )}
                </div>
              )}

              {/* Paste JSON zone */}
              {uploadMode === "paste" && (
                <div className="space-y-2">
                  {status === "processing" ? (
                    <div className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl px-6 py-8 flex flex-col items-center gap-2">
                      <div className="w-8 h-8 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm font-semibold text-blue-700">Processing your results…</p>
                      <p className="text-xs text-blue-500">This may take a moment</p>
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={pasteText}
                        onChange={e => setPasteText(e.target.value)}
                        placeholder={`Paste the JSON output from the PowerShell script here…\n\nExample:\n{\n  "data": { ... },\n  "meta": { ... }\n}`}
                        rows={8}
                        className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-xs font-mono text-[#0A2540] placeholder:text-gray-400 focus:outline-none focus:border-[#0078D4] focus:bg-white transition-all resize-y"
                        spellCheck={false}
                      />
                      <button
                        onClick={() => void handlePasteSubmit()}
                        disabled={!pasteText.trim()}
                        className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-[#0078D4] text-white hover:bg-[#0078D4]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Submit JSON
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Error state */}
            {error && errorKind === "mismatch" && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Wrong script output — file doesn't match</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">{error}</p>
                </div>
              </div>
            )}
            {error && errorKind === "generic" && (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-red-700">Upload error</p>
                  <p className="text-xs text-red-600 mt-0.5">{error}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
  );

  if (embedded) return inner;

  return (
    <div className={`rounded-xl border-2 overflow-hidden shadow-sm transition-all ${
      status === "completed" ? "border-green-200 bg-green-50/30" : "border-amber-300 bg-white"
    }`}>
      {status !== "completed" && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-wide text-amber-700">
            Action Required — Manual Script
          </span>
        </div>
      )}
      {inner}
    </div>
  );
}
