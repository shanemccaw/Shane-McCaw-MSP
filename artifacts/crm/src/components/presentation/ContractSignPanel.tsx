import { useRef, useState, useEffect } from "react";
import SignatureCanvas from "react-signature-canvas";

const DEFAULT_AGREEMENT_BODY = `1. SCOPE OF SERVICES
Shane McCaw Consulting ("Consultant") agrees to provide the Microsoft 365 and related technology consulting services described in the Statement of Work accepted by the Client. Services are performed remotely unless otherwise agreed in writing.

2. PAYMENT TERMS
Fees are due as specified in the service order. For phased engagements, each phase is invoiced upon completion. All invoices are payable within 15 days of issuance. Overdue balances accrue interest at 1.5% per month.

3. INTELLECTUAL PROPERTY
Work product created specifically for Client under a paid engagement becomes Client's property upon receipt of full payment. Pre-existing tools, templates, methodologies, and know-how remain Consultant's property.

4. CONFIDENTIALITY
Each party agrees to keep confidential all non-public information of the other party. This obligation survives termination for three (3) years.

5. LIMITATION OF LIABILITY
Consultant's total liability shall not exceed the fees paid in the three (3) months preceding the claim. Neither party is liable for indirect or consequential damages.

6. TERM AND TERMINATION
Either party may terminate with 14 days' written notice. Client remains responsible for fees earned through the termination date.

7. GOVERNING LAW
This agreement is governed by the laws of the State of Florida. Disputes shall be submitted to binding arbitration under the AAA Commercial Arbitration Rules.

8. ENTIRE AGREEMENT
This agreement, together with the Statement of Work, constitutes the entire agreement between the parties.`;

interface SowPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  selected: boolean;
}

interface ContractSignPanelProps {
  signerName: string;
  selectedPhases: SowPhase[];
  totalPrice: number;
  onChangeName: (name: string) => void;
  onSign: (signatureData: string, signerName: string) => Promise<void>;
  signing: boolean;
  alreadySigned?: boolean;
  contractBody?: string | null;
  onReady?: () => void;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function ContractSignPanel({
  signerName,
  selectedPhases,
  totalPrice,
  onChangeName,
  onSign,
  signing,
  alreadySigned = false,
  contractBody,
  onReady,
}: ContractSignPanelProps) {
  const agreementBody = contractBody ?? DEFAULT_AGREEMENT_BODY;
  const sigPad = useRef<SignatureCanvas | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { onReady?.(); });
    return () => cancelAnimationFrame(raf);
  }, [onReady]);

  const handleClear = () => {
    sigPad.current?.clear();
    setIsEmpty(true);
  };

  const handleSign = async () => {
    if (!signerName.trim()) {
      setError("Please enter your full name before signing.");
      return;
    }
    if (sigPad.current?.isEmpty()) {
      setError("Please draw your signature before proceeding.");
      return;
    }
    setError(null);
    const dataUrl = sigPad.current!.getTrimmedCanvas().toDataURL("image/png");
    await onSign(dataUrl, signerName.trim());
  };

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Letterhead */}
      <div className="bg-white rounded-xl border border-border shadow-sm mb-4 overflow-hidden flex-shrink-0">
        <div className="px-6 py-4 border-b border-border text-center">
          <p className="text-base font-extrabold tracking-tight text-[#0A2540]">Shane McCaw Consulting</p>
          <p className="text-[0.65rem] font-bold uppercase tracking-widest text-[#0078D4] mt-0.5">Service Agreement</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Parties block */}
          <div className="bg-slate-50 rounded-lg px-4 py-3 text-sm text-[#374151]">
            This Agreement is entered into as of <strong className="text-[#0A2540]">{today}</strong>, between{" "}
            <strong className="text-[#0A2540]">Shane McCaw Consulting</strong> (&ldquo;Consultant&rdquo;) and{" "}
            <strong className="text-[#0A2540]">{signerName || "[Client Name]"}</strong> (&ldquo;Client&rdquo;).
          </div>

          {/* Selected phases / SOW summary */}
          {selectedPhases.length > 0 && (
            <div>
              <h4 className="text-[0.65rem] font-bold uppercase tracking-widest text-[#0A2540] mb-2">Statement of Work — Selected Phases</h4>
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {selectedPhases.map((phase) => (
                    <tr key={phase.id} className="border-b border-slate-100">
                      <td className="py-1.5 text-[#374151] pr-4">{phase.title}</td>
                      <td className="py-1.5 text-right font-semibold text-[#0A2540]">{formatCurrency(phase.price)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300">
                    <td className="pt-2 font-bold text-[#0A2540]">Total</td>
                    <td className="pt-2 text-right font-extrabold text-[#0A2540]">{formatCurrency(totalPrice)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Agreement body (truncated preview) */}
          <div>
            <h4 className="text-[0.65rem] font-bold uppercase tracking-widest text-[#0A2540] mb-2">Terms & Conditions</h4>
            <div className="text-[0.75rem] text-[#374151] leading-relaxed max-h-40 overflow-y-auto bg-slate-50 rounded-lg px-3 py-2 space-y-2">
              {agreementBody.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Signature section */}
      {!alreadySigned ? (
        <div className="bg-white rounded-xl border border-border shadow-sm p-5 flex-shrink-0">
          <h3 className="text-sm font-extrabold text-[#0A2540] mb-4">Sign the Agreement</h3>

          {/* Name input */}
          <div className="mb-4">
            <label className="block text-xs font-bold text-[#0A2540] uppercase tracking-widest mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="Your full legal name"
              className="w-full px-3 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4]"
            />
          </div>

          {/* Signature canvas */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-[#0A2540] uppercase tracking-widest">
                Signature <span className="text-red-500">*</span>
              </label>
              <button
                onClick={handleClear}
                className="text-xs text-muted-foreground hover:text-[#0078D4] transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50 hover:border-[#0078D4]/50 transition-colors">
              <SignatureCanvas
                ref={sigPad}
                penColor="#0A2540"
                canvasProps={{
                  width: 560,
                  height: 120,
                  className: "signature-canvas w-full",
                  style: { width: "100%", height: "120px" },
                }}
                onBegin={() => setIsEmpty(false)}
              />
            </div>
            {isEmpty && !alreadySigned && (
              <p className="text-xs text-muted-foreground mt-1">Draw your signature above</p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
          )}

          <button
            onClick={() => void handleSign()}
            disabled={signing || alreadySigned}
            className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.99] disabled:opacity-50 transition-all"
          >
            {signing ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing…
              </span>
            ) : (
              "Sign & Continue to Payment"
            )}
          </button>

          <p className="text-[10px] text-muted-foreground text-center mt-2">
            By signing, you agree to the terms above. This electronic signature has the same legal effect as a handwritten signature.
          </p>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">Agreement Signed</p>
            <p className="text-xs text-green-700 mt-0.5">You've signed this agreement. Proceed to choose your payment plan.</p>
          </div>
        </div>
      )}
    </div>
  );
}
