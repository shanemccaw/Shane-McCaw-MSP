import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ManualScriptUploadCard, type ManualScriptRecord } from "./ManualScriptUploadCard";

interface Props {
  projectId: number;
}

export function ManualScriptsSection({ projectId }: Props) {
  const { fetchWithAuth } = useAuth();
  const [scripts, setScripts] = useState<ManualScriptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchWithAuth(`/api/portal/projects/${projectId}/manual-scripts`)
      .then(r => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<ManualScriptRecord[]>;
      })
      .then(data => setScripts(data))
      .catch(() => setError("Could not load manual scripts. Please refresh the page."))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, projectId]);

  useEffect(() => { load(); }, [load]);

  const handleCompleted = useCallback((runResultId: number) => {
    setScripts(prev => prev.map(s =>
      s.runResultId === runResultId
        ? { ...s, status: "completed", uploadedAt: new Date().toISOString() }
        : s
    ));
  }, []);

  const pending = scripts.filter(s => s.status === "awaiting_upload");
  const completed = scripts.filter(s => s.status === "completed");

  if (loading) {
    return (
      <div className="bg-white border border-border rounded-2xl p-5 shadow-sm mb-5">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="w-5 h-5 rounded-full bg-gray-200 flex-shrink-0" />
          <div className="h-4 w-48 bg-gray-200 rounded" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-20 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 flex items-center gap-3">
        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (scripts.length === 0) return null;

  return (
    <div className="mb-5">
      {/* Pending scripts — action required header */}
      {pending.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-[#0A2540]">
            Action Required
            <span className="ml-2 inline-flex items-center justify-center text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded-full w-5 h-5">
              {pending.length}
            </span>
          </h2>
        </div>
      )}

      {/* All pending scripts */}
      {pending.length > 0 && (
        <div className="space-y-4 mb-4">
          {pending.map(script => (
            <ManualScriptUploadCard
              key={script.runResultId}
              script={script}
              projectId={projectId}
              onCompleted={() => handleCompleted(script.runResultId)}
            />
          ))}
        </div>
      )}

      {/* Completed scripts — always visible so clients can review their findings */}
      {completed.length > 0 && (
        <>
          {pending.length > 0 && (
            <div className="border-t border-border my-4" />
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-500 flex-shrink-0">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-[#0A2540]">
              Completed Scripts
              <span className="ml-2 inline-flex items-center justify-center text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 rounded-full w-5 h-5">
                {completed.length}
              </span>
            </h2>
          </div>
          <div className="space-y-4">
            {completed.map(script => (
              <ManualScriptUploadCard
                key={script.runResultId}
                script={script}
                projectId={projectId}
                onCompleted={() => handleCompleted(script.runResultId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
