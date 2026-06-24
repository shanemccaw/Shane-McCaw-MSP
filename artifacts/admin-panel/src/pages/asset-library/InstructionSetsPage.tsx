import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  useListInstructionSets,
  useCreateInstructionSet,
  useUpdateInstructionSet,
  useDeleteInstructionSet,
  useListAssetLibraryCategories,
  useCreateAssetLibraryCategory,
  getListInstructionSetsQueryKey,
  getListAssetLibraryCategoriesQueryKey,
  type InstructionSet,
  type InstructionSetInput,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, Download, Upload, Search, X, ChevronUp, ChevronDown, Tag } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportAsJson } from "@/lib/exportJson";
import JsonImportModal from "@/components/JsonImportModal";

function StringListEditor({ label, items, onChange, placeholder }: {
  label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft("");
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-2">{label}</label>
      <div className="space-y-1.5 mb-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex flex-col gap-0.5 pt-1">
              <button type="button" onClick={() => { const a=[...items]; [a[i-1],a[i]]=[a[i],a[i-1]]; onChange(a); }} disabled={i===0} className="text-[#484F58] hover:text-[#7D8590] disabled:opacity-30"><ChevronUp className="w-3 h-3"/></button>
              <button type="button" onClick={() => { const a=[...items]; [a[i],a[i+1]]=[a[i+1],a[i]]; onChange(a); }} disabled={i===items.length-1} className="text-[#484F58] hover:text-[#7D8590] disabled:opacity-30"><ChevronDown className="w-3 h-3"/></button>
            </div>
            <span className="text-xs text-[#7D8590] pt-2 w-4 shrink-0">{i+1}.</span>
            <textarea
              value={item}
              onChange={e => { const a=[...items]; a[i]=e.target.value; onChange(a); }}
              rows={2}
              className="flex-1 text-sm border border-[#30363D] rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            />
            <button type="button" onClick={() => onChange(items.filter((_,j)=>j!==i))} className="mt-1.5 text-[#7D8590] hover:text-red-500"><X className="w-3.5 h-3.5"/></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();add();}}}
          placeholder={placeholder ?? "Add instruction…"}
          className="flex-1 text-sm border border-[#30363D] rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
        />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-[#0078D4] text-white text-sm rounded hover:bg-[#005fa3]">Add</button>
      </div>
    </div>
  );
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const queryClient = useQueryClient();
  const { data: cats = [] } = useListAssetLibraryCategories();
  const createMutation = useCreateAssetLibraryCategory({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAssetLibraryCategoriesQueryKey() }),
    },
  });
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  const allNames = cats.map(c => c.name);
  if (!allNames.includes(value) && value) allNames.push(value);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMutation.mutateAsync({ data: { name } });
      onChange(name);
      setShowNew(false);
      setNewName("");
    } catch {
      /* error toast handled above */
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1">Category</label>
      {!showNew ? (
        <div className="flex gap-2">
          <select
            value={value}
            onChange={e => {
              if (e.target.value === "__new__") { setShowNew(true); }
              else { onChange(e.target.value); }
            }}
            className="flex-1 border border-[#30363D] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4] bg-[#161B22]"
          >
            {allNames.map(n => <option key={n} value={n}>{n}</option>)}
            <option value="__new__">+ New category…</option>
          </select>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleCreate(); } if (e.key === "Escape") { setShowNew(false); setNewName(""); } }}
            placeholder="New category name…"
            className="flex-1 border border-[#30363D] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
          />
          <button type="button" onClick={() => void handleCreate()} disabled={createMutation.isPending || !newName.trim()} className="px-3 py-2 bg-[#0078D4] text-white text-sm rounded hover:bg-[#005fa3] disabled:opacity-50">
            {createMutation.isPending ? "…" : "Create"}
          </button>
          <button type="button" onClick={() => { setShowNew(false); setNewName(""); }} className="px-3 py-2 text-sm text-[#7D8590] border border-[#30363D] rounded hover:bg-[#1C2128]">Cancel</button>
        </div>
      )}
    </div>
  );
}

function EditorSheet({ record, onClose }: {
  record: Partial<InstructionSet> | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = record && "id" in record && typeof record.id === "number";
  const [form, setForm] = useState({
    title: record?.title ?? "",
    description: record?.description ?? "",
    instructions: record?.instructions ?? ([] as string[]),
    category: record?.category ?? "Generic",
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInstructionSetsQueryKey() });

  const createMutation = useCreateInstructionSet({
    mutation: {
      onSuccess: () => { toast({ title: "Instruction set created" }); invalidate(); onClose(); },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateInstructionSet({
    mutation: {
      onSuccess: () => { toast({ title: "Instruction set updated" }); invalidate(); onClose(); },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const save = () => {
    if (!form.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    const data: InstructionSetInput = {
      title: form.title,
      description: form.description || undefined,
      instructions: form.instructions,
      category: form.category || "Generic",
    };
    if (isEdit) {
      updateMutation.mutate({ id: (record as InstructionSet).id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-[#161B22] h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-[#E6EDF3]">{isEdit ? "Edit Instruction Set" : "New Instruction Set"}</h2>
          <button onClick={onClose} className="text-[#7D8590] hover:text-[#7D8590]"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1">Title *</label>
            <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
              className="w-full border border-[#30363D] rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]" placeholder="e.g. Copilot Governance Checklist" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#C9D1D9] uppercase tracking-wide mb-1">Description</label>
            <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={2}
              className="w-full border border-[#30363D] rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#0078D4]" placeholder="Optional description" />
          </div>
          <CategoryPicker value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} />
          <StringListEditor label="Instructions" items={form.instructions} onChange={v=>setForm(f=>({...f,instructions:v}))} placeholder="Add instruction step…" />
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#7D8590] hover:text-[#E6EDF3] border border-[#30363D] rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#0078D4] text-white rounded hover:bg-[#005fa3] disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const InstructionSetImportSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, "title is required"),
  description: z.string().optional().nullable(),
  instructions: z.array(z.string(), { invalid_type_error: "instructions must be an array of strings" }).optional(),
  category: z.string().optional(),
});

const INSTRUCTION_SET_EXAMPLE = JSON.stringify([
  { title: "Copilot Governance Setup", category: "Governance", instructions: ["Enable Copilot in M365 admin", "Configure sensitivity labels", "Run adoption workshop"] },
  { title: "SharePoint Migration Prep", category: "Migration", description: "Pre-migration checklist", instructions: ["Audit source content", "Map permissions"] },
], null, 2);

export default function InstructionSetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [editorRecord, setEditorRecord] = useState<Partial<InstructionSet> | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<InstructionSet | null>(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: rows = [], isLoading } = useListInstructionSets(debouncedQ ? { q: debouncedQ } : undefined);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const cat = row.category ?? "Generic";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(row);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "Generic") return 1;
      if (b === "Generic") return -1;
      return a.localeCompare(b);
    });
    return keys.map(k => ({ category: k, items: map.get(k)! }));
  }, [rows]);

  const deleteMutation = useDeleteInstructionSet({
    mutation: {
      onSuccess: () => {
        toast({ title: "Deleted" });
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: getListInstructionSetsQueryKey() });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Instruction Sets</h1>
          <p className="text-sm text-[#7D8590] mt-0.5">Reusable ordered instruction lists for workflow tasks.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[#30363D] rounded-lg hover:bg-[#1C2128] text-[#7D8590]">
            <Upload className="w-4 h-4"/> JSON Import
          </button>
          <button onClick={() => exportAsJson(rows, "instruction-sets-export.json")} disabled={rows.length === 0} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[#30363D] rounded-lg hover:bg-[#1C2128] text-[#7D8590] disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4"/> Export All
          </button>
          <button onClick={() => setEditorRecord({})} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[#0078D4] text-white rounded-lg hover:bg-[#005fa3]">
            <Plus className="w-4 h-4"/> New
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#7D8590]"/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by title or description…"
          className="w-full pl-9 pr-4 py-2 border border-[#30363D] rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"/>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin"/></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-[#7D8590]">
          <p className="font-medium">No instruction sets yet</p>
          <p className="text-sm mt-1">Click "New" to create your first one.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.category}>
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-3.5 h-3.5 text-[#7D8590]"/>
                <span className="text-xs font-semibold text-[#7D8590] uppercase tracking-wide">{group.category}</span>
                <span className="text-xs text-[#7D8590]">({group.items.length})</span>
              </div>
              <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#30363D] bg-[#161B22]">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-[#7D8590] uppercase tracking-wide w-12">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-[#7D8590] uppercase tracking-wide">Title</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-[#7D8590] uppercase tracking-wide w-24">Steps</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-[#7D8590] uppercase tracking-wide w-36">Created</th>
                      <th className="px-4 py-3 w-28"/>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363D]">
                    {group.items.map(row => (
                      <tr key={row.id} className="hover:bg-[#1C2128]/50">
                        <td className="px-4 py-3 text-[#7D8590] font-mono text-xs">#{row.id}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#E6EDF3]">{row.title}</div>
                          {row.description && <div className="text-xs text-[#7D8590] mt-0.5 truncate max-w-sm">{row.description}</div>}
                        </td>
                        <td className="px-4 py-3 text-[#7D8590]">{row.instructions.length}</td>
                        <td className="px-4 py-3 text-[#7D8590] text-xs">{new Date(row.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditorRecord(row)} className="p-1.5 text-[#7D8590] hover:text-[#0078D4] rounded" title="Edit">
                              <Pencil className="w-3.5 h-3.5"/>
                            </button>
                            <button onClick={() => exportAsJson(row, `instruction-set-${row.id}.json`)} className="p-1.5 text-[#7D8590] hover:text-[#0078D4] rounded" title="Export JSON">
                              <Download className="w-3.5 h-3.5"/>
                            </button>
                            <button onClick={() => setDeleteTarget(row)} className="p-1.5 text-[#7D8590] hover:text-red-500 rounded" title="Delete">
                              <Trash2 className="w-3.5 h-3.5"/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {editorRecord !== undefined && (
        <EditorSheet record={editorRecord} onClose={() => setEditorRecord(undefined)} />
      )}

      {showImport && (
        <JsonImportModal
          collection="instruction-sets"
          schema={InstructionSetImportSchema}
          exampleJson={INSTRUCTION_SET_EXAMPLE}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            void queryClient.invalidateQueries({ queryKey: getListInstructionSetsQueryKey() });
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete instruction set?</AlertDialogTitle>
            <AlertDialogDescription>
              "<strong>{deleteTarget?.title}</strong>" will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
