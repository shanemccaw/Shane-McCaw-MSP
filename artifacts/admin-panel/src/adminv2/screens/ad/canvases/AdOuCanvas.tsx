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
import { deleteAdOu, fetchAdTree, renameAdOu } from "../adApi";
import { setAdCachedRecord } from "../adNameCache";
import { requestAdTreeRefresh } from "../adEvents";
import type { AdTreeOu } from "../adTypes";
import { AdArmedButton, AdButton, AdCanvasBody, AdCanvasColumn, AdCanvasHeader, AdLoadError, AdLoading, AdOutcome, AdSection } from "../adKit";

export function AdOuCanvas({ ouId }: { ouId: number }) {
  const { fetchWithAuth } = useAuth();
  const [ou, setOu] = useState<AdTreeOu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await fetchAdTree(fetchWithAuth);
      const found = tree.ous.find((o) => o.id === ouId);
      if (!found) {
        setError("This organizational unit no longer exists.");
        return;
      }
      setOu(found);
      setAdCachedRecord("ou", String(ouId), { title: found.name });
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
      await renameAdOu(fetchWithAuth, ou.id, name.trim());
      requestAdTreeRefresh();
      setOutcome({ tone: "ok", message: "Renamed." });
      await load();
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to rename." });
    }
  }

  async function onDelete() {
    if (!ou) return;
    try {
      await deleteAdOu(fetchWithAuth, ou.id);
      requestAdTreeRefresh();
      setDeleted(true);
    } catch (err) {
      setOutcome({ tone: "error", message: err instanceof Error ? err.message : "Failed to delete." });
    }
  }

  if (loading) return (
    <AdCanvasColumn>
      <AdLoading />
    </AdCanvasColumn>
  );
  if (deleted) return (
    <AdCanvasColumn>
      <div style={{ padding: 24, fontSize: 12.5 }}>Deleted. Close this tab.</div>
    </AdCanvasColumn>
  );
  if (error || !ou) return (
    <AdCanvasColumn>
      <AdLoadError message={error ?? "Not found."} />
    </AdCanvasColumn>
  );

  return (
    <AdCanvasColumn>
      <AdCanvasHeader
        icon={FolderCog}
        name={`OU=${ou.name}`}
        kindLabel="Organizational unit"
        actions={
          <>
            <AdButton label="Rename" onClick={() => void onRename()} />
            <AdArmedButton label="Delete" tone="danger" onConfirm={() => void onDelete()} />
          </>
        }
      />
      {outcome && <AdOutcome tone={outcome.tone} message={outcome.message} onDismiss={() => setOutcome(null)} />}
      <AdCanvasBody>
        <AdSection
          title="Placeholder object"
          note="A real, persisted container node with no policy semantics yet — reserved for a future version. It carries no members and enforces nothing today."
        >
          <div />
        </AdSection>
      </AdCanvasBody>
    </AdCanvasColumn>
  );
}
