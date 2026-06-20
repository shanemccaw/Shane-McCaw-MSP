import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListChecklists,
  useCreateChecklist,
  useUpdateChecklist,
  useDeleteChecklist,
  getListChecklistsQueryKey,
  type Checklist,
  type ChecklistInput,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, Download, Upload, Search, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportAsJson } from "@/lib/exportJson";

interface ChecklistItem { id: string; label: string; }

function ChecklistItemsEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (v: ChecklistItem[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, { id: crypto.randomUUID(), label: t }]);
    setDraft("");
  };
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Items</label>
      <div className="space-y-1.5 mb-2">
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-5 shrink-0">☐</span>
            <input value={item.label} onChange={e => { const a=[...items]; a[i]={...a[i],label:e.target.value}; onChange(a); }}
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0078D4]" />
            <button type="button" onClick={() => onChange(items.filter((_,j)=>j!==i))} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5"/></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();add();}}}
          placeholder="Add checklist item…"
          className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
        />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-[#0078D4] text-white text-sm rounded hover:bg-[#005fa3]">Add</button>
      </div>
    </div>
  );
}

function EditorSheet({ record, onClose }: {
  record: Partial<Checklist> | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = record && "id" in record && typeof record.id === "number";
  const [form, setForm] = useState({
    title: record?.title ?? "",
    items: (record?.items ?? []) as ChecklistItem[],
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });

  const createMutation = useCreateChecklist({
    mutation: {
      onSuccess: () => { toast({ title: "Checklist created" }); invalidate(); onClose(); },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateChecklist({
    mutation: {
      onSuccess: () => { toast({ title: "Checklist updated" }); invalidate(); onClose(); },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const save = () => {
    if (!form.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    const data: ChecklistInput = { title: form.title, items: form.items };
    if (isEdit) {
      updateMutation.mutate({ id: (record as Checklist).id, data });
    } else {
      createMutation.mutate({ data });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">{isEdit ? "Edit Checklist" : "New Checklist"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Title *</label>
            <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
              className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]" placeholder="e.g. SharePoint Migration Checklist" />
          </div>
          <ChecklistItemsEditor items={form.items} onChange={v=>setForm(f=>({...f,items:v}))} />
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#0078D4] text-white rounded hover:bg-[#005fa3] disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ChecklistImportSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, "title is required"),
  items: z.array(
    z.object({ id: z.string().min(1, "item id must be a non-empty string"), label: z.string().min(1, "item label must be a non-empty string") }),
    { invalid_type_error: "items must be an array of {id, label} objects" }
  ).optional(),
});

type ImportRecord = z.infer<typeof ChecklistImportSchema>;

function JsonImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [raw, setRaw] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErrors([]);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { setErrors(["Invalid JSON — check syntax and try again."]); return; }

    const isBulk = Array.isArray(parsed);
    const records = isBulk ? (parsed as unknown[]) : [parsed];

    const allErrors: string[] = [];
    const validatedRecords: ImportRecord[] = [];
    records.forEach((rec, idx) => {
      const result = ChecklistImportSchema.safeParse(rec);
      if (!result.success) {
        result.error.errors.forEach(e => {
          const path = e.path.length ? e.path.join(".") + ": " : "";
          allErrors.push(isBulk ? `[${idx}] ${path}${e.message}` : `${path}${e.message}`);
        });
      } else {
        validatedRecords.push(result.data);
      }
    });

    if (allErrors.length > 0) { setErrors(allErrors); return; }

    setSaving(true);
    let created = 0, updated = 0;
    const networkErrors: string[] = [];

    for (const data of validatedRecords) {
      const hasId = typeof data.id === "number";
      const url = hasId ? `/api/admin/asset-library/checklists/${data.id}` : "/api/admin/asset-library/checklists";
      try {
        const res = await fetchWithAuth(url, { method: hasId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        if (!res.ok) { const j = await res.json().catch(()=>({error:"Unknown error"})); networkErrors.push((j as {error?:string}).error ?? "Request failed"); }
        else if (hasId) { updated++; } else { created++; }
      } catch { networkErrors.push("Network error — please try again."); }
    }

    setSaving(false);

    if (networkErrors.length > 0) {
      setErrors(networkErrors);
      if (created > 0 || updated > 0) { toast({ title: `Partial import: ${created} created, ${updated} updated` }); onImported(); }
      return;
    }

    toast({ title: isBulk ? `${created} created, ${updated} updated` : (validatedRecords[0] && typeof validatedRecords[0].id === "number" ? "Checklist updated via import" : "Checklist created via import") });
    onImported();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">JSON Import</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <p className="text-sm text-gray-500 mb-3">Paste a single record or an array of records as JSON. Records with an <code className="bg-gray-100 px-1 rounded">id</code> field are updated; without one, a new record is created.</p>
        <textarea value={raw} onChange={e=>setRaw(e.target.value)} rows={10} spellCheck={false}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
          placeholder={'[{"title": "Checklist A", "items": [{"id": "1", "label": "Item 1"}]}, {"title": "Checklist B"}]'} />
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {errors.map((e, i) => <li key={i} className="text-sm text-red-600">{e}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:text-gray-900">Cancel</button>
          <button onClick={submit} disabled={saving || !raw.trim()} className="px-4 py-2 text-sm bg-[#0078D4] text-white rounded hover:bg-[#005fa3] disabled:opacity-50">
            {saving ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [editorRecord, setEditorRecord] = useState<Partial<Checklist> | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Checklist | null>(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: rows = [], isLoading } = useListChecklists(debouncedQ ? { q: debouncedQ } : undefined);

  const deleteMutation = useDeleteChecklist({
    mutation: {
      onSuccess: () => {
        toast({ title: "Deleted" });
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Checklists</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reusable checkbox item lists for workflow tasks.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
            <Upload className="w-4 h-4"/> JSON Import
          </button>
          <button onClick={() => exportAsJson(rows, "checklists-export.json")} disabled={rows.length === 0} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="w-4 h-4"/> Export All
          </button>
          <button onClick={() => setEditorRecord({})} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[#0078D4] text-white rounded-lg hover:bg-[#005fa3]">
            <Plus className="w-4 h-4"/> New
          </button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by title…"
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"/>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin"/></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No checklists yet</p>
          <p className="text-sm mt-1">Click "New" to create your first one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-12">ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Items</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">Created</th>
                <th className="px-4 py-3 w-28"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{row.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{row.title}</td>
                  <td className="px-4 py-3 text-gray-500">{row.items.length}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditorRecord(row)} className="p-1.5 text-gray-400 hover:text-[#0078D4] rounded" title="Edit"><Pencil className="w-3.5 h-3.5"/></button>
                      <button onClick={() => exportAsJson(row, `checklist-${row.id}.json`)} className="p-1.5 text-gray-400 hover:text-[#0078D4] rounded" title="Export JSON"><Download className="w-3.5 h-3.5"/></button>
                      <button onClick={() => setDeleteTarget(row)} className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="Delete"><Trash2 className="w-3.5 h-3.5"/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorRecord !== undefined && (
        <EditorSheet record={editorRecord} onClose={() => setEditorRecord(undefined)} />
      )}
      {showImport && (
        <JsonImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            void queryClient.invalidateQueries({ queryKey: getListChecklistsQueryKey() });
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete checklist?</AlertDialogTitle>
            <AlertDialogDescription>"<strong>{deleteTarget?.title}</strong>" will be permanently deleted.</AlertDialogDescription>
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
