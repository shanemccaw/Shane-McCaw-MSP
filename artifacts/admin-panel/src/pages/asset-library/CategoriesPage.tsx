import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  useListAssetLibraryCategories,
  useCreateAssetLibraryCategory,
  useUpdateAssetLibraryCategory,
  useDeleteAssetLibraryCategory,
  getListAssetLibraryCategoriesQueryKey,
  type AssetLibraryCategory,
} from "@workspace/api-client-react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function CategoriesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AssetLibraryCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: cats = [], isLoading } = useListAssetLibraryCategories();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAssetLibraryCategoriesQueryKey() });

  const createMutation = useCreateAssetLibraryCategory({
    mutation: {
      onSuccess: () => { toast({ title: "Category created" }); invalidate(); setNewName(""); },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to create category";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const updateMutation = useUpdateAssetLibraryCategory({
    mutation: {
      onSuccess: () => { toast({ title: "Category renamed" }); invalidate(); setEditingId(null); setEditingName(""); },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to rename category";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const deleteMutation = useDeleteAssetLibraryCategory({
    mutation: {
      onSuccess: () => { toast({ title: "Category deleted" }); invalidate(); setDeleteTarget(null); setDeleteError(null); },
      onError: (err) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to delete category";
        setDeleteError(msg);
      },
    },
  });

  const startEdit = (cat: AssetLibraryCategory) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const cancelEdit = () => { setEditingId(null); setEditingName(""); };

  const saveEdit = (id: number) => {
    if (!editingName.trim()) return;
    updateMutation.mutate({ id, data: { name: editingName.trim() } });
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ data: { name: newName.trim() } });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Asset Library Categories</h1>
        <p className="text-sm text-gray-500 mt-0.5">Shared categories for Instruction Sets, Checklists, Artifact Sets, and Deliverable Sets. Renaming a category updates all assets using it.</p>
      </div>

      {/* Create new category */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">New Category</label>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
            placeholder="Category name…"
            className="flex-1 border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
          />
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending || !newName.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0078D4] text-white rounded hover:bg-[#005fa3] disabled:opacity-50"
          >
            <Plus className="w-4 h-4"/>
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin"/></div>
      ) : cats.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No categories yet</p>
          <p className="text-sm mt-1">Create one above to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-40">Created</th>
                <th className="px-4 py-3 w-28"/>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cats.map(cat => (
                <tr key={cat.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    {editingId === cat.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") { e.preventDefault(); saveEdit(cat.id); }
                          if (e.key === "Escape") cancelEdit();
                        }}
                        className="w-full border border-[#0078D4] rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                      />
                    ) : (
                      <span className="font-medium text-gray-900">{cat.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(cat.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {editingId === cat.id ? (
                        <>
                          <button
                            onClick={() => saveEdit(cat.id)}
                            disabled={updateMutation.isPending || !editingName.trim()}
                            className="p-1.5 text-[#0078D4] hover:text-[#005fa3] rounded disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5"/>
                          </button>
                          <button onClick={cancelEdit} className="p-1.5 text-gray-400 hover:text-gray-600 rounded" title="Cancel">
                            <X className="w-3.5 h-3.5"/>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(cat)}
                            className="p-1.5 text-gray-400 hover:text-[#0078D4] rounded"
                            title="Rename"
                          >
                            <Pencil className="w-3.5 h-3.5"/>
                          </button>
                          <button
                            onClick={() => { setDeleteTarget(cat); setDeleteError(null); }}
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) { setDeleteTarget(null); setDeleteError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-red-600">{deleteError}</span>
              ) : (
                <>Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>? This is only possible if no assets are using it.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteTarget(null); setDeleteError(null); }}>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id })}
                className="bg-red-600 hover:bg-red-700"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
