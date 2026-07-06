import { useEffect, useState } from "react";
import { useParams, useSearch, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PresentationFlow from "@/components/presentation/PresentationFlow";
import SowPendingPlaceholder from "@/components/presentation/SowPendingPlaceholder";
import PortalLayout from "@/components/PortalLayout";

interface PresentationData {
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  shareToken: string | null;
  documents: Array<{
    id: number;
    title: string;
    category: "report" | "consulting";
    docType: string;
    htmlContent: string;
    createdAt: string | null;
  }>;
  sowPhases: Array<{
    id: string;
    title: string;
    description: string;
    price: number;
    selected: boolean;
  }>;
  selectedPhaseIds: string[];
  totalPrice: number;
  signatureData: string | null;
  signedAt: string | null;
  signerName: string | null;
  paymentPlan: "full" | "phased" | null;
  status: "draft" | "signed" | "paid";
  projectTitle: string | null;
  clientName: string | null;
  contractBody: string | null;
  workflowName: string | null;
}

export default function PortalPresentation() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const { user, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const token = new URLSearchParams(search).get("token");
  const isPublic = !!token && !user;

  const [data, setData] = useState<PresentationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    const url = token
      ? `/api/portal/presentations/${id}?token=${encodeURIComponent(token)}`
      : `/api/portal/presentations/${id}`;

    const fetcher = user ? fetchWithAuth(url) : fetch(url);
    Promise.resolve(fetcher)
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) { setError("Presentation not found."); return; }
          if (res.status === 403) { setError("Access denied."); return; }
          setError("Failed to load presentation.");
          return;
        }
        const d = await res.json() as PresentationData;
        setData(d);
      })
      .catch(() => setError("Failed to load presentation."))
      .finally(() => setLoading(false));
  }, [id, token, user, fetchWithAuth]);

  if (loading) {
    return (
      <PortalLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  if (error) {
    return (
      <PortalLayout>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <p className="text-lg font-bold text-[#0A2540]">{error}</p>
          <button
            onClick={() => navigate("/portal")}
            className="text-sm text-[#0078D4] hover:underline"
          >
            Return to portal
          </button>
        </div>
      </PortalLayout>
    );
  }

  if (!data) return null;

  // No SOW phases yet — show the full-screen holding page (no PortalLayout wrapper)
  if (data.sowPhases.length === 0) {
    const fetchFn = (url: string, opts?: RequestInit) =>
      user ? fetchWithAuth(url, opts) : fetch(url, opts);
    return (
      <SowPendingPlaceholder
        projectTitle={data.projectTitle}
        clientName={data.clientName}
        presentationId={data.id}
        shareToken={token ?? data.shareToken}
        fetchFn={fetchFn}
        onClose={() => navigate(user ? "/portal" : "/")}
      />
    );
  }

  // Detect return from Stripe — navigate directly to payment/confirmation step
  const returnedWithPayment = new URLSearchParams(search).get("payment") === "success";

  return (
    <PresentationFlow
      presentationId={parseInt(id ?? "0", 10)}
      initialData={data}
      readOnly={isPublic}
      shareToken={token ?? undefined}
      startAtPayment={returnedWithPayment}
      onClose={() => navigate(user ? "/portal" : "/")}
    />
  );
}
