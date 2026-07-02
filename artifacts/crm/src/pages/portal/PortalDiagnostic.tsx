import { useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { useAuth } from "@/contexts/AuthContext";

interface PortalProject {
  id: number;
  projectType: string;
  title: string;
}

export default function PortalDiagnostic() {
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>();
  const [, navigate] = useLocation();
  const { state, dispatch } = useQuickWinMode();
  const { fetchWithAuth } = useAuth();
  const bindedRef = useRef(false);

  // Fetch client projects to auto-resolve the quick_win project when no ID in URL
  const { data: projects } = useQuery<PortalProject[]>({
    queryKey: ["portal-projects-for-diagnostic"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/projects");
      if (!res.ok) return [];
      return res.json() as Promise<PortalProject[]>;
    },
    enabled: !urlProjectId,
    staleTime: 0,
  });

  // Dispatch BIND_PROJECT once we have a resolved project ID
  useEffect(() => {
    if (bindedRef.current) return;

    let resolvedId: string | null = null;

    if (urlProjectId) {
      resolvedId = urlProjectId;
    } else if (projects) {
      const qw = projects.find(p => p.projectType === "quick_win");
      if (qw) resolvedId = String(qw.id);
    }

    if (!resolvedId) return;

    bindedRef.current = true;
    dispatch({ type: "BIND_PROJECT", payload: { projectId: resolvedId } });
  }, [urlProjectId, projects, dispatch]);

  // Navigate away when the overlay is dismissed
  useEffect(() => {
    if (state.mode === "Idle" && bindedRef.current) {
      navigate("/portal");
    }
  }, [state.mode, navigate]);

  // The overlay renders via FullScreenWrapper (mounted globally in App.tsx).
  // This page just provides the deep-link entry point and the backdrop.
  return (
    <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
      {!bindedRef.current && (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#0A2540]/50 font-medium">Loading diagnostic…</p>
        </div>
      )}
    </div>
  );
}
