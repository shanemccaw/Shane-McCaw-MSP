import { useCallback, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCreateService } from "@/hooks/useServices";
import { PRODUCT_TYPE_CONFIGS, PRODUCT_TYPE_LIST, type ProductTypeKey } from "@/lib/productTypeConfig";

interface Props {
  onClose: () => void;
  onCreated: (id: number) => void;
  panelMode?: boolean;
}

// New-product flow: pick a ProductTypeKey, then name + slug it. Creation itself
// stays on the same useCreateService mutation the rest of the catalog uses —
// this component only owns the type-picker/name-entry UI around it.
export default function TypePickerDialog({ onClose, onCreated, panelMode = false }: Props) {
  const { toast } = useToast();
  const createService = useCreateService();

  const [createType, setCreateType] = useState<ProductTypeKey | null>(null);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim() || !createType) return;
    const typeConfig = PRODUCT_TYPE_CONFIGS[createType];
    setCreating(true);
    try {
      const created = await createService.mutateAsync({
        name: createName.trim(),
        slug: createSlug.trim() || createName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        billingType: typeConfig.defaultBillingType,
        visibility: "private",
        isPublic: false,
        serviceClass: typeConfig.serviceClass ?? undefined,
        deliveryType: typeConfig.deliveryType ?? undefined,
        fulfillmentType: typeConfig.fulfillmentType ?? undefined,
      });
      toast({ title: "Service created" });
      onCreated(created.id);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally { setCreating(false); }
  }, [createName, createSlug, createType, createService, toast, onCreated]);

  if (!createType) {
    return (
      <div className="flex h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            {!panelMode && (
              <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h2 className="text-xl font-bold text-foreground">New Product</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Choose a product type to get started</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PRODUCT_TYPE_LIST.map(cfg => (
              <button
                key={cfg.key}
                type="button"
                onClick={() => setCreateType(cfg.key)}
                className="flex flex-col items-start gap-2 p-5 bg-card border border-border rounded-xl text-left hover:border-primary hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-bold text-foreground group-hover:text-primary">{cfg.label}</span>
                  <span className="text-[10px] font-mono text-muted-foreground/60 bg-accent px-2 py-0.5 rounded">
                    {cfg.defaultBillingType === "recurring_monthly" ? "recurring" : cfg.defaultBillingType}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{cfg.description}</p>
                {(cfg.showFields.assignToClient || cfg.showFields.genPdf || cfg.showFields.projectTemplate) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cfg.showFields.assignToClient && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">Assign to Client</span>}
                    {cfg.showFields.projectTemplate && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">Project Template</span>}
                    {cfg.showFields.genPdf && <span className="text-[10px] bg-accent text-muted-foreground px-1.5 py-0.5 rounded">PDF Overview</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const selectedTypeConfig = PRODUCT_TYPE_CONFIGS[createType];
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 max-w-xl">
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={() => setCreateType(null)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-foreground">New {selectedTypeConfig.label}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{selectedTypeConfig.description}</p>
          </div>
        </div>
        <form onSubmit={e => void handleCreate(e)} className="bg-card rounded-xl border border-border p-6 space-y-5">
          <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
            <span className="text-xs font-semibold text-primary">Type: {selectedTypeConfig.label}</span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">{selectedTypeConfig.defaultBillingType}</span>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Name <span className="text-red-500">*</span></label>
            <input type="text" required autoFocus value={createName} onChange={e => {
              const name = e.target.value;
              setCreateName(name);
              setCreateSlug(prev => prev || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
            }} placeholder="e.g. Microsoft 365 Audit"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Slug <span className="text-red-500">*</span></label>
            <input type="text" required value={createSlug}
              onChange={e => setCreateSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
              placeholder="url-friendly-slug"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <p className="text-xs text-muted-foreground">Visibility defaults to <strong className="text-foreground">Private</strong>. You can change all other settings after saving.</p>
          <button type="submit" disabled={creating || !createName.trim()}
            className="w-full bg-primary text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#006CBE] transition-colors disabled:opacity-60">
            {creating ? "Creating…" : `Create ${selectedTypeConfig.label}`}
          </button>
        </form>
      </div>
    </div>
  );
}
