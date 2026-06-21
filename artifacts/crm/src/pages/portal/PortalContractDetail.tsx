import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface WizardOption {
  id: string;
  label: string;
  priceAdjustment: number;
}

interface WizardStep {
  id: string;
  title: string;
  options: WizardOption[];
}

interface ContractDetail {
  id: number;
  userId: number;
  serviceId: number;
  serviceName: string;
  orderWorkflow: WizardStep[] | null;
  signedAt: string;
  signatureData: string | null;
  signerName: string | null;
  contractVersion: string;
  projectId: number | null;
  pdfFilename: string | null;
  finalPrice: string | null;
  wizardSelections: Array<{ stepId: string; stepTitle?: string; optionId: string; optionLabel?: string; priceAdjustment?: number }> | null;
  agreementBody: string | null;
  createdAt: string;
}

const DEFAULT_AGREEMENT_BODY = `SHANE McCAW CONSULTING — STANDARD SERVICE AGREEMENT

1. SCOPE OF SERVICES
Shane McCaw Consulting ("Consultant") agrees to provide the Microsoft 365 and related technology consulting services described in the applicable service order or statement of work accepted by the Client. Services are performed remotely unless otherwise agreed in writing.

2. PAYMENT TERMS
Fees are due as specified in the service order. Fixed-price engagements are billed in full upon acceptance. Retainer arrangements are billed monthly in advance. All invoices are payable within 15 days of issuance. Overdue balances accrue interest at 1.5% per month.

3. INTELLECTUAL PROPERTY
Work product created specifically for Client under a paid engagement becomes Client's property upon receipt of full payment. Pre-existing tools, templates, methodologies, and know-how developed independently by Consultant remain Consultant's property. Consultant retains the right to describe the nature of services performed for portfolio and reference purposes.

4. CONFIDENTIALITY
Each party agrees to keep confidential all non-public information of the other party that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and circumstances of disclosure. This obligation survives termination for three (3) years.

5. LIMITATION OF LIABILITY
Consultant's total liability for any claim arising out of or relating to this agreement shall not exceed the fees paid by Client in the three (3) months preceding the claim. In no event shall either party be liable for indirect, incidental, special, or consequential damages, even if advised of the possibility of such damages.

6. TERM AND TERMINATION
Either party may terminate ongoing services with 14 days' written notice. Client remains responsible for fees earned through the termination date. Fixed-price project engagements may only be terminated for material breach that remains uncured for 10 business days after written notice.

7. INDEPENDENT CONTRACTOR
Consultant is an independent contractor. Nothing in this agreement creates an employment, partnership, or joint-venture relationship between the parties.

8. GOVERNING LAW
This agreement is governed by the laws of the State of Virginia, without regard to conflict-of-law principles. Any dispute not resolved by good-faith negotiation shall be submitted to binding arbitration in Fairfax County, Virginia under the AAA Commercial Arbitration Rules.

9. ENTIRE AGREEMENT
This agreement, together with any applicable service order, constitutes the entire agreement between the parties regarding its subject matter and supersedes all prior discussions and representations.`;

function formatCurrency(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDateTime(d: string | Date): string {
  return new Date(d).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function formatKey(k: string): string {
  return k
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function AgreementBodyRenderer({ text }: { text: string }) {
  const numberedHeading = /^\d+\.\s+/;
  const blocks: { type: "heading" | "para"; text: string }[] = [];
  let currentPara: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (numberedHeading.test(line.trimStart())) {
      if (currentPara.length > 0) {
        const joined = currentPara.join(" ").trim();
        if (joined) blocks.push({ type: "para", text: joined });
        currentPara = [];
      }
      blocks.push({ type: "heading", text: line.trim() });
    } else if (line.trim() === "") {
      if (currentPara.length > 0) {
        const joined = currentPara.join(" ").trim();
        if (joined) blocks.push({ type: "para", text: joined });
        currentPara = [];
      }
    } else {
      currentPara.push(line.trim());
    }
  }
  if (currentPara.length > 0) {
    const joined = currentPara.join(" ").trim();
    if (joined) blocks.push({ type: "para", text: joined });
  }

  return (
    <div className="space-y-1">
      {blocks.map((block, i) =>
        block.type === "heading" ? (
          <h3
            key={i}
            className="text-[0.7rem] font-bold uppercase tracking-widest text-[#0078D4] border-b-2 border-slate-200 pb-1 mt-5 first:mt-0"
          >
            {block.text}
          </h3>
        ) : (
          <p key={i} className="text-xs text-[#374151] leading-relaxed">
            {block.text}
          </p>
        )
      )}
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ""}`} />;
}

export default function PortalContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchWithAuth(`/api/portal/contracts/${id}`)
      .then(async r => {
        if (r.status === 404 || r.status === 403) { setNotFound(true); return; }
        const d = await r.json() as ContractDetail;
        setData(d);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [fetchWithAuth, id]);

  const handleDownloadPdf = async () => {
    if (!id || !data?.pdfFilename) return;
    const r = await fetchWithAuth(`/api/portal/contracts/${id}/download`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.pdfFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (notFound) {
    return (
      <PortalLayout>
        <div className="px-6 py-8 max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground">Contract not found.</p>
          <Link href="/portal/billing">
            <span className="mt-4 inline-block text-[#0078D4] text-sm font-semibold hover:underline">← Back to Billing</span>
          </Link>
        </div>
      </PortalLayout>
    );
  }

  // Build a lookup map from the service's order_workflow so that old contracts
  // that only stored stepId/optionId (no labels) still display human-readable text.
  const workflowStepMap = new Map<string, WizardStep>(
    (data?.orderWorkflow ?? []).map(s => [s.id, s])
  );

  const wizardItems = (Array.isArray(data?.wizardSelections) ? data.wizardSelections : []).map(sel => {
    const step = workflowStepMap.get(sel.stepId);
    const option = step?.options.find(o => o.id === sel.optionId);
    return {
      ...sel,
      stepTitle: sel.stepTitle ?? step?.title,
      optionLabel: sel.optionLabel ?? option?.label,
    };
  });

  return (
    <PortalLayout>
      <div className="px-6 py-8 max-w-3xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/billing">
            <span className="hover:text-[#0078D4] cursor-pointer">Billing</span>
          </Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium">
            {loading ? "Loading…" : `${data?.serviceName ?? "Contract"} — ${data?.contractVersion ?? ""}`}
          </span>
        </nav>

        {/* Header */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          {loading ? (
            <div className="space-y-3">
              <SkeletonBlock className="h-7 w-64" />
              <SkeletonBlock className="h-4 w-32" />
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#00B4D8]/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h1 className="text-xl font-extrabold text-[#0A2540]">{data!.serviceName}</h1>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-[#0078D4]/10 text-[#0078D4] border-[#0078D4]/20">
                      {data!.contractVersion}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Service Agreement</p>
                </div>
              </div>
              {data!.pdfFilename && (
                <button
                  onClick={() => void handleDownloadPdf()}
                  className="flex items-center gap-1.5 border border-border text-sm font-semibold px-3 py-2 rounded-lg hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PDF
                </button>
              )}
            </div>
          )}
        </div>

        {/* Metadata grid */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">Contract Details</h2>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <SkeletonBlock className="h-3 w-20" />
                  <SkeletonBlock className="h-4 w-32" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Signed Date</p>
                <p className="text-sm font-semibold text-[#0A2540]">{formatDate(data!.signedAt)}</p>
              </div>
              {data!.signerName && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Signer</p>
                  <p className="text-sm font-semibold text-[#0A2540]">{data!.signerName}</p>
                </div>
              )}
              {data!.finalPrice && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Final Price</p>
                  <p className="text-sm font-semibold text-[#0A2540]">{formatCurrency(data!.finalPrice)}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wizard selections */}
        {(loading || wizardItems.length > 0) && (
          <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#0A2540] mb-4">Selected Options</h2>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <SkeletonBlock className="h-3 w-32" />
                    <SkeletonBlock className="h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {wizardItems.map((sel) => (
                  <div key={sel.stepId} className="flex items-start justify-between gap-4 px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {sel.stepTitle ?? formatKey(sel.stepId)}
                    </p>
                    <p className="text-sm text-[#0A2540] font-medium text-right max-w-[60%]">
                      {sel.optionLabel ?? sel.optionId}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Agreement body */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">Agreement Terms</h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBlock key={i} className={`h-3 ${i % 3 === 2 ? "w-3/4" : "w-full"}`} />
              ))}
            </div>
          ) : data!.agreementBody ? (
            <div className="border border-border rounded-xl bg-[#F7F9FC] p-5 max-h-96 overflow-y-auto">
              <AgreementBodyRenderer text={data!.agreementBody} />
            </div>
          ) : (
            <div className="border border-border rounded-xl bg-[#F7F9FC] p-5 max-h-96 overflow-y-auto">
              <AgreementBodyRenderer text={DEFAULT_AGREEMENT_BODY} />
            </div>
          )}
        </div>

        {/* Signature */}
        <div className="bg-white border border-border rounded-2xl p-6 mb-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] mb-4">Electronic Signature</h2>
          {loading ? (
            <SkeletonBlock className="h-24 w-full" />
          ) : data!.signatureData ? (
            <div>
              <div className="border border-border rounded-xl bg-[#F7F9FC] p-4 mb-4 flex items-center justify-center">
                <img
                  src={data!.signatureData}
                  alt="Electronic signature"
                  className="max-h-28 max-w-full object-contain"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <svg className="w-4 h-4 flex-shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>
                  This document was signed electronically on{" "}
                  <strong className="text-[#0A2540]">{formatDateTime(data!.signedAt)}</strong>
                  {data!.signerName && (
                    <> by <strong className="text-[#0A2540]">{data!.signerName}</strong></>
                  )}.
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No signature on file.</p>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}
