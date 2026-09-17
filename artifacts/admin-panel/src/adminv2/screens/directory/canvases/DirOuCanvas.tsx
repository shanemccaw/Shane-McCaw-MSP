/**
 * Organizational Unit canvas — Phase 5's placeholder object: a real,
 * creatable/browsable container with explicitly no policy semantics yet
 * (per Shane, reserved for a future version — do not add policy columns or
 * an object-to-OU membership model here, matching
 * `lib/active-directory.ts`'s own header comment on `OuRow`/`OuNode`).
 */

import { useCallback, useEffect, useState } from "react";
import { FolderCog } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { deleteDirOu, fetchDirTree, renameDirOu } from "../dirApi";
import { setDirCachedRecord } from "../dirNameCache";
import { requestDirTreeRefresh } from "../dirEvents";
import type { DirTreeOu } from "../dirTypes";
import { DirArmedButton, DirButton, DirCanvasBody, DirCanvasColumn, DirCanvasHeader, DirLoadError, DirLoading, DirOutcome, DirSection } from "../dirKit";

export function DirOuCanvas({ ouId }: { ouId: number }) {
  const { fetchWithAuth } = useAuth();
  const [ou, setOu] = useState<DirTreeOu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await fetchDirTree(fetchWithAuth);
      const found = tree.ous.find((o) => o.id === ouId);
      if (!found) {
        setError("This organizational unit no longer exists.");
        return;
      }
      setOu(found);
      setDirCachedRecord("ou", String(ouId), { title: found.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this organizational unit.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, ouId]);

  useEffect(() => {
    setOutcome(null);
    setDeleted(false);
    void load();
  }, [load]);

  async function onRename() {
    if (!ou) return;
    const name = window.prompt("Rename organizational unit:", ou.name);
    if (!name?.trim() || name.trim() === ou.name) return;
    try {
      await renameDirOu(fetchWithAuth, ou.id, name.trim());
      requestDirTreeRefresh();
      setOutcome({ tone: "ok", message: "Renamed." });
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to rename." });
    }
  }

  async function onDelete() {
    if (!ou) return;
    try {
      await deleteDirOu(fetchWithAuth, ou.id);
      requestDirTreeRefresh();
      setDeleted(true);
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to delete." });
    }
  }

  if (loading) return (
    <DirCanvasColumn>
      <DirLoading />
    </DirCanvasColumn>
  );
  if (deleted) return (
    <DirCanvasColumn>
      <div style={{ padding: 24, fontSize: 12.5 }}>Deleted. Close this tab.</div>
    </DirCanvasColumn>
  );
  if (error || !ou) return (
    <DirCanvasColumn>
      <DirLoadError message={error ?? "Not found."} />
    </DirCanvasColumn>
  );

  return (
    <DirCanvasColumn>
      <DirCanvasHeader
        icon={FolderCog}
        name={ou.name}
        kindLabel="Organizational unit"
        actions={
          <>
            <DirButton label="Rename" onClick={() => void onRename()} />
            <DirArmedButton label="Delete" tone="danger" onConfirm={() => void onDelete()} />
          </>
        }
      />
      {outcome && <DirOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}
      <DirCanvasBody>
        <DirSection
          title="Placeholder object"
          note="A real, persisted container node with no policy semantics yet — reserved for a future version. It carries no members and enforces nothing today."
        >
          <div />
        </DirSection>
      </DirCanvasBody>
    </DirCanvasColumn>
  );
}
