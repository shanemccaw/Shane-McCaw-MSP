import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
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
  couponCode: string | null;
  discountAmount: string | null;
}

const DEFAULT_AGREEMENT_BODY = `1. SCOPE OF SERVICES
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
This agreement is governed by the laws of the State of Florida, without regard to conflict-of-law principles. Any dispute not resolved by good-faith negotiation shall be submitted to binding arbitration in the State of Florida under the AAA Commercial Arbitration Rules.

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

function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i} className="font-bold text-[#0A2540]">{part.slice(2, -2)}</strong>
      : part
  );
}

function AgreementBodyRenderer({ text }: { text: string }) {
  const numberedHeading = /^\d+\.\s+/;
  type Block = { type: "heading" | "para" | "hr" | "bold-heading"; text: string };
  const blocks: Block[] = [];
  let currentPara: string[] = [];

  const flushPara = () => {
    if (currentPara.length > 0) {
      const joined = currentPara.join(" ").trim();
      if (joined) blocks.push({ type: "para", text: joined });
      currentPara = [];
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "---") {
      flushPara();
      blocks.push({ type: "hr", text: "" });
    } else if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      // Line is entirely **bold** — treat as a section heading
      flushPara();
      blocks.push({ type: "bold-heading", text: trimmed.slice(2, -2) });
    } else if (numberedHeading.test(trimmed)) {
      flushPara();
      blocks.push({ type: "heading", text: trimmed });
    } else if (trimmed === "") {
      flushPara();
    } else {
      currentPara.push(trimmed);
    }
  }
  flushPara();

  return (
    <div>
      {blocks.map((block, i) => {
        if (block.type === "hr") {
          return <hr key={i} className="border-slate-200 my-6" />;
        }
        if (block.type === "bold-heading") {
          return (
            <h3 key={i} className="text-[0.7rem] font-bold uppercase tracking-widest text-[#0A2540] mt-4 mb-1.5">
              {block.text}
            </h3>
          );
        }
        if (block.type === "heading") {
          return (
            <h3 key={i} className="text-[0.7rem] font-bold uppercase tracking-widest text-[#0A2540] mt-6 mb-1.5 first:mt-0">
              {block.text}
            </h3>
          );
        }
        return (
          <p key={i} className="text-[0.8rem] text-[#374151] leading-relaxed mb-2">
            {renderInlineBold(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ""}`} />;
}

export default function PortalContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
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
        <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto text-center">
          <p className="text-muted-foreground">Contract not found.</p>
          <Link href="/portal/billing">
            <span className="mt-4 inline-block text-[#0078D4] text-sm font-semibold hover:underline">← Back to Billing</span>
          </Link>
        </div>
      </PortalLayout>
    );
  }

  const workflowStepMap = new Map<string, WizardStep>(
    (data?.orderWorkflow ?? []).map(s => [s.id, s])
  );

  const wizardItems = (Array.isArray(data?.wizardSelections) ? data.wizardSelections : []).map(sel => {
    const step = workflowStepMap.get(sel.stepId);
    const option = step?.options.find(o => o.id === sel.optionId);
    const priceAdjustment = sel.priceAdjustment ?? option?.priceAdjustment ?? null;
    return {
      ...sel,
      stepTitle: sel.stepTitle ?? step?.title,
      optionLabel: sel.optionLabel ?? option?.label,
      priceAdjustment,
    };
  });

  return (
    <PortalLayout>
      <div className="min-h-screen bg-slate-100 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">

          {/* Back button */}
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : navigate("/portal/billing")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-[#0078D4] transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Link href="/portal/billing">
              <span className="hover:text-[#0078D4] cursor-pointer">Billing</span>
            </Link>
            <span>/</span>
            <span className="text-[#0A2540] font-medium">
              {loading ? "Loading…" : `${data?.serviceName ?? "Contract"} — ${data?.contractVersion ?? ""}`}
            </span>
          </nav>

          {/* Toolbar — outside the paper */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-semibold text-green-700">
                {loading ? "" : `Signed ${data ? formatDate(data.signedAt) : ""}`}
              </span>
            </div>
            {(loading || data?.pdfFilename) && (
              <button
                onClick={() => void handleDownloadPdf()}
                disabled={loading || !data?.pdfFilename}
                className="flex items-center gap-1.5 bg-white border border-border text-sm font-semibold px-3 py-2 rounded-lg hover:border-[#0078D4]/40 hover:text-[#0078D4] transition-colors shadow-sm disabled:opacity-40"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download PDF
              </button>
            )}
          </div>

          {/* ── PAPER DOCUMENT ── */}
          <div className="bg-white shadow-lg rounded-sm px-6 sm:px-14 py-8 sm:py-12 mb-8">

            {loading ? (
              <div className="space-y-4">
                <SkeletonBlock className="h-8 w-48 mx-auto" />
                <SkeletonBlock className="h-1 w-full" />
                <SkeletonBlock className="h-6 w-64 mx-auto" />
                <SkeletonBlock className="h-4 w-full mt-6" />
                <SkeletonBlock className="h-4 w-5/6" />
                {Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonBlock key={i} className={`h-3 ${i % 4 === 3 ? "w-3/4" : "w-full"}`} />
                ))}
              </div>
            ) : (
              <>
                {/* ── LETTERHEAD ── */}
                <div className="text-center mb-2">
                  <p className="text-xl font-extrabold tracking-tight text-[#0A2540] leading-none">
                    Shane McCaw Consulting
                  </p>
                  <p className="text-[0.7rem] font-medium text-[#0078D4] uppercase tracking-widest mt-1">
                    Lead Microsoft 365 Architect
                  </p>
                </div>
                <div className="h-[2px] bg-[#0078D4] w-full mb-6" />

                {/* ── TITLE ── */}
                <div className="text-center mb-6">
                  <h1 className="text-base font-extrabold uppercase tracking-widest text-[#0A2540]">
                    Service Agreement
                  </h1>
                  <p className="text-[0.7rem] text-muted-foreground mt-1 tracking-wide">
                    {data!.contractVersion}
                  </p>
                </div>

                {/* ── PARTIES BLOCK ── */}
                <div className="bg-slate-50 border border-slate-200 rounded px-5 py-4 mb-6 text-[0.8rem] text-[#374151] leading-relaxed">
                  This Agreement is entered into as of{" "}
                  <strong className="text-[#0A2540]">{formatDate(data!.signedAt)}</strong>, between{" "}
                  <strong className="text-[#0A2540]">Shane McCaw Consulting</strong> (&ldquo;Consultant&rdquo;) and{" "}
                  <strong className="text-[#0A2540]">{data!.signerName ?? "Client"}</strong> (&ldquo;Client&rdquo;).
                </div>

                {/* ── SERVICE ORDER DETAILS ── */}
                {wizardItems.length > 0 && (
                  <div className="mb-6">
                    <h2 className="text-[0.65rem] font-bold uppercase tracking-widest text-[#0A2540] mb-3">
                      Service Order Details
                    </h2>
                    <div className="overflow-x-auto">
                    <table className="w-full text-[0.8rem] border-collapse">
                      <tbody>
                        {wizardItems.map(sel => (
                          <tr key={sel.stepId} className="border-b border-slate-100">
                            <td className="py-1.5 text-muted-foreground pr-4 w-1/3">
                              {sel.stepTitle ?? formatKey(sel.stepId)}
                            </td>
                            <td className="py-1.5 font-medium text-[#0A2540]">
                              {sel.optionLabel ?? sel.optionId}
                            </td>
                            <td className="py-1.5 text-right font-medium text-[#0A2540] pl-4 whitespace-nowrap">
                              {sel.priceAdjustment != null
                                ? formatCurrency(sel.priceAdjustment)
                                : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        ))}
                        {data!.finalPrice && (() => {
                          const discount = data!.discountAmount ? parseFloat(data!.discountAmount) : 0;
                          const original = parseFloat(data!.finalPrice!);
                          const discounted = Math.max(0, original - discount);
                          return (
                            <>
                              {discount > 0 && (
                                <tr className="border-t border-slate-200">
                                  <td className="pt-2 pb-1 text-green-700 flex items-center gap-1.5">
                                    <span>Promotional discount</span>
                                    {data!.couponCode && (
                                      <span className="font-mono text-[0.7rem] bg-green-100 border border-green-200 text-green-700 px-1.5 py-0.5 rounded ml-1">
                                        {data!.couponCode}
                                      </span>
                                    )}
                                  </td>
                                  <td />
                                  <td className="pt-2 pb-1 text-right font-semibold text-green-700 pl-4">
                                    −{formatCurrency(discount)}
                                  </td>
                                </tr>
                              )}
                              <tr className="border-t-2 border-slate-300">
                                <td className="pt-2.5 font-bold text-[#0A2540]">
                                  {discount > 0 ? "Total Due" : "Total"}
                                </td>
                                <td />
                                <td className="pt-2.5 text-right font-bold text-[#0A2540] pl-4">
                                  {formatCurrency(discount > 0 ? discounted : original)}
                                </td>
                              </tr>
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}

                {/* ── DIVIDER ── */}
                <div className="border-t border-slate-200 mb-6" />

                {/* ── AGREEMENT BODY ── */}
                <AgreementBodyRenderer text={data!.agreementBody ?? DEFAULT_AGREEMENT_BODY} />

                {/* ── DIVIDER ── */}
                <div className="border-t border-slate-200 mt-8 mb-8" />

                {/* ── SIGNATURE BLOCK ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-10">
                  {/* Consultant column */}
                  <div>
                    <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground mb-6">
                      Consultant
                    </p>
                    {/* Signature line */}
                    <div className="flex items-end h-14 mb-1">
                      <p className="text-lg italic font-bold text-[#0A2540]" style={{ fontFamily: "Georgia, serif" }}>
                        Shane McCaw
                      </p>
                    </div>
                    <div className="border-t-2 border-[#0A2540] pt-1.5">
                      <p className="text-[0.7rem] text-[#0A2540] font-semibold">Shane McCaw</p>
                      <p className="text-[0.65rem] text-muted-foreground">Shane McCaw Consulting</p>
                    </div>
                  </div>

                  {/* Client column */}
                  <div>
                    <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground mb-6">
                      Client
                    </p>
                    {/* Signature image or blank line */}
                    <div className="flex items-end h-14 mb-1">
                      {data!.signatureData ? (
                        <img
                          src={data!.signatureData}
                          alt="Client signature"
                          className="max-h-14 max-w-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-px border-b border-dashed border-slate-300" />
                      )}
                    </div>
                    <div className="border-t-2 border-[#0A2540] pt-1.5">
                      <p className="text-[0.7rem] text-[#0A2540] font-semibold">
                        {data!.signerName ?? "—"}
                      </p>
                      {data!.signedAt && (
                        <p className="text-[0.65rem] text-muted-foreground">
                          {formatDateTime(data!.signedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Electronic signature notice ── */}
                <div className="mt-8 flex items-start gap-2 text-[0.65rem] text-muted-foreground border-t border-slate-100 pt-4">
                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-green-600 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>
                    Signed electronically on {formatDateTime(data!.signedAt)}
                    {data!.signerName && <> by <strong className="text-[#0A2540]">{data!.signerName}</strong></>}.
                    This electronic signature has the same legal effect as a handwritten signature.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
