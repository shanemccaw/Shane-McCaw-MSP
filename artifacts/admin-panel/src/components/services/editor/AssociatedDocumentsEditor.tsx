import { Plus, Trash2 } from "lucide-react";

// Structured mapping that drives the seeded Assessment document-generation
// workflow: each entry is one document to generate, with the docType/category
// that select the generator path and a customerVisible flag controlling whether
// it appears in the customer-facing presentation. docTypes mirror the taxonomy in
// api-server document-generator.ts. The consolidated SOW is intentionally NOT
// listed here — it is always generated last (so it grounds against these docs)
// and is always customer-visible. task_execution_guide is also omitted because it
// derives from the SOW, which does not yet exist during this document pass.

export type AssociatedDocument = {
  docType: string;
  category: "report" | "consulting";
  title: string;
  customerVisible: boolean;
};

const ASSOC_DOC_TYPE_OPTIONS: { docType: string; category: "report" | "consulting"; label: string }[] = [
  { docType: "executive_summary", category: "report", label: "Executive Summary" },
  { docType: "full_readiness_report", category: "report", label: "Full Readiness Report" },
  { docType: "security_posture_report", category: "report", label: "Security Posture Report" },
  { docType: "governance_maturity_report", category: "report", label: "Governance Maturity Report" },
  { docType: "data_exposure_risk_report", category: "report", label: "Data Exposure Risk Report" },
  { docType: "license_optimization_report", category: "report", label: "License Optimization Report" },
  { docType: "remediation_plan", category: "consulting", label: "Remediation Plan" },
  { docType: "deployment_plan", category: "consulting", label: "Deployment Plan" },
  { docType: "governance_framework", category: "consulting", label: "Governance Framework" },
  { docType: "security_hardening_plan", category: "consulting", label: "Security Hardening Plan" },
  { docType: "copilot_enablement_plan", category: "consulting", label: "Copilot Enablement Plan" },
  { docType: "identity_modernization_plan", category: "consulting", label: "Identity Modernization Plan" },
];

export default function AssociatedDocumentsEditor({ value, onChange }: { value: AssociatedDocument[]; onChange: (v: AssociatedDocument[]) => void }) {
  const rows = value ?? [];
  const isDefaultTitle = (t: string) => ASSOC_DOC_TYPE_OPTIONS.some(o => o.label === t);
  const addDoc = () => {
    const used = new Set(rows.map(r => r.docType));
    const opt = ASSOC_DOC_TYPE_OPTIONS.find(o => !used.has(o.docType)) ?? ASSOC_DOC_TYPE_OPTIONS[0];
    onChange([...rows, { docType: opt.docType, category: opt.category, title: opt.label, customerVisible: true }]);
  };
  const updateDoc = (i: number, patch: Partial<AssociatedDocument>) =>
    onChange(rows.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDoc = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const onDocTypeChange = (i: number, docType: string) => {
    const opt = ASSOC_DOC_TYPE_OPTIONS.find(o => o.docType === docType);
    if (!opt) return;
    // Auto-set category from docType; refresh the title only if it was still a default.
    updateDoc(i, {
      docType: opt.docType,
      category: opt.category,
      title: isDefaultTitle(rows[i].title) ? opt.label : rows[i].title,
    });
  };
  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No documents mapped yet. Add the documents this service's assessment should generate.
        </p>
      )}
      {rows.map((doc, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
          <select
            value={doc.docType}
            onChange={e => onDocTypeChange(i, e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <optgroup label="Reports">
              {ASSOC_DOC_TYPE_OPTIONS.filter(o => o.category === "report").map(o => (
                <option key={o.docType} value={o.docType}>{o.label}</option>
              ))}
            </optgroup>
            <optgroup label="Consulting">
              {ASSOC_DOC_TYPE_OPTIONS.filter(o => o.category === "consulting").map(o => (
                <option key={o.docType} value={o.docType}>{o.label}</option>
              ))}
            </optgroup>
          </select>
          <input
            type="text"
            value={doc.title}
            onChange={e => updateDoc(i, { title: e.target.value })}
            placeholder="Document title"
            className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
            <input
              type="checkbox"
              checked={doc.customerVisible}
              onChange={e => updateDoc(i, { customerVisible: e.target.checked })}
            />
            Customer-visible
          </label>
          <button
            type="button"
            onClick={() => removeDoc(i)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
            aria-label="Remove document"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addDoc}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
      >
        <Plus className="h-4 w-4" /> Add document
      </button>
      <p className="text-xs text-muted-foreground">
        Documents marked <strong>customer-visible</strong> appear in the client presentation. Uncheck to generate a
        document internal-only (it grounds the SOW's accuracy but is hidden from the customer). The consolidated
        Statement of Work is always generated last and always shown — you don't need to add it here.
      </p>
    </div>
  );
}
