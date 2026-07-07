/**
 * FlowCanvas.tsx
 *
 * Power Automate-style vertical workflow builder.
 * Receives the flat nodes+edges graph and renders it as a nested step list.
 * All mutations emit the updated flat graph via onGraphChange — the executor
 * save format is never changed.
 */

import React, { useState, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { createPortal } from "react-dom";
import {
  graphToTree,
  graphInsertStep,
  graphRemoveStep,
  graphMoveStepUp,
  graphMoveStepDown,
  treeInsertStepAfter,
  treeInsertStepAtBranchStart,
  treeReorderStep,
  treeMoveStepIntoBranch,
  treeFindStepParent,
  treeFindStep,
  treeToGraph,
  isContainerNode,
  deepCloneStep,
} from "./flowTree";
import type { FlowStep, StoredNode, StoredEdge } from "./flowTree";

// ── Re-exported types so WorkflowBuilderPage can import from one place ────────
export type { StoredNode, StoredEdge };

// ── Prop types ─────────────────────────────────────────────────────────────────

interface NodeStyle {
  bg: string;
  border: string;
  icon: string;
  label: string;
}

interface LibraryNode {
  type: string;
  label: string;
  description: string;
  tags: string[];
}

interface LibraryCategory {
  name: string;
  nodes: LibraryNode[];
}

export type StepResult = {
  status: "ok" | "error" | "skipped";
  durationMs?: number | null;
  errorMessage?: string | null;
  logPreview?: string | null;
  /** Full log lines for the step — shown in the expanded inline drawer */
  fullLogs?: string[];
};

export interface FlowCanvasProps {
  nodes: StoredNode[];
  edges: StoredEdge[];
  selectedNodeId: string | null;
  isArchived: boolean;
  isLoading?: boolean;
  nodeStyles: Record<string, NodeStyle>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodeIdCounter: React.MutableRefObject<number>;
  onSelectNode: (id: string | null) => void;
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
  /** Distinct categories derived from all event triggers (e.g. ["CRM", "Payments"]). */
  triggerCategories?: string[];
  /** Currently copied step (null when clipboard is empty). */
  copiedStep?: FlowStep | null;
  /** Called when the user copies a step (via menu or Ctrl+C). */
  onCopyStep?: (step: FlowStep) => void;
  /**
   * When set, renders a status badge on each step card that has a result.
   * Keys are node IDs, values are run outputs from the last inspect run.
   */
  stepResultMap?: Record<string, StepResult>;
}

// ── Node Picker Popover ────────────────────────────────────────────────────────

function NodePicker({
  libraryCategories,
  allLibraryNodes,
  nodeStyles,
  pos,
  onPick,
  onClose,
}: {
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodeStyles: Record<string, NodeStyle>;
  pos: { top: number; left: number };
  onPick: (type: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = search
    ? allLibraryNodes.filter(n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ||
        n.description.toLowerCase().includes(search.toLowerCase()) ||
        n.tags.some(t => t.includes(search.toLowerCase()))
      )
    : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[99]" onClick={onClose} />
      <div
        className="fixed z-[100] w-72 bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-hidden"
        style={{ top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
        onClick={e => e.stopPropagation()}
      >
      <div className="p-2 border-b border-[#30363D]">
        <input
          ref={inputRef}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search nodes…"
          className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] placeholder-[#484F58] outline-none focus:border-[#0078D4]/60"
        />
      </div>
      <div className="max-h-80 overflow-y-auto p-2 space-y-2">
        {(filtered ?? []).length === 0 && search && (
          <p className="text-xs text-[#484F58] text-center py-3">No nodes match</p>
        )}
        {filtered
          ? (
            <div className="space-y-0.5">
              {filtered.map(n => {
                const s = nodeStyles[n.type] ?? nodeStyles["action"] ?? { bg: "#1C2128", border: "#30363D", icon: "⚡", label: n.label };
                return (
                  <button
                    key={n.type}
                    onClick={() => { onPick(n.type); onClose(); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-left"
                  >
                    <span className="flex-shrink-0 text-base w-6 text-center">{s.icon}</span>
                    <span className="text-xs text-[#E6EDF3] truncate">{n.label}</span>
                  </button>
                );
              })}
            </div>
          )
          : libraryCategories.map(cat => (
            <div key={cat.name}>
              <p className="text-[9px] uppercase tracking-widest font-bold text-[#484F58] px-1 mb-0.5">{cat.name}</p>
              <div className="space-y-0.5">
                {cat.nodes.map(n => {
                  const s = nodeStyles[n.type] ?? nodeStyles["action"] ?? { bg: "#1C2128", border: "#30363D", icon: "⚡", label: n.label };
                  return (
                    <button
                      key={n.type}
                      onClick={() => { onPick(n.type); onClose(); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-left"
                    >
                      <span className="flex-shrink-0 text-base w-6 text-center">{s.icon}</span>
                      <span className="text-xs text-[#E6EDF3] truncate">{n.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  </>,
  document.body
  );
}

// ── Add Step Button ────────────────────────────────────────────────────────────

function AddButton({
  afterNodeId,
  sourceHandle,
  label,
  branchKey,
  isArchived,
  nodeIdCounter,
  nodeStyles,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  onGraphChange,
  onInsert,
}: {
  afterNodeId: string;
  sourceHandle?: string;
  /** Optional badge shown beside the + connector (e.g. "After loop") */
  label?: string;
  /**
   * When this button inserts at the start of a container branch (not after an
   * existing step), pass the tree-level branch key so paste can use
   * treeInsertStepAtBranchStart instead of treeInsertStepAfter.
   */
  branchKey?: string;
  isArchived: boolean;
  nodeIdCounter: React.MutableRefObject<number>;
  nodeStyles: Record<string, NodeStyle>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  /** Optional override — if provided, called instead of graphInsertStep. */
  onInsert?: (newNode: StoredNode) => void;
}) {
  const ctx = React.useContext(FlowCanvasContext);
  const [open, setOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [pasteMenuOpen, setPasteMenuOpen] = useState(false);
  const [pasteMenuPos, setPasteMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pasteMenuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!pasteMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!pasteMenuRef.current?.contains(e.target as Node)) setPasteMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPasteMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pasteMenuOpen]);

  if (isArchived) return null;

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const PICKER_HEIGHT = 380; // approximate max height of the picker
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow >= PICKER_HEIGHT
        ? r.bottom + 6
        : Math.max(8, r.top - PICKER_HEIGHT - 6);
      // clamp horizontally so the picker doesn't bleed off the right/left edge
      const rawLeft = r.left + r.width / 2;
      const left = Math.min(Math.max(144, rawLeft), window.innerWidth - 144);
      setPickerPos({ top, left });
    }
    setOpen(v => !v);
  }

  function handlePick(nodeType: string) {
    const style = nodeStyles[nodeType] ?? nodeStyles["action"] ?? { label: nodeType };

    // ── Parallel: create parallel + join pair atomically ───────────────────
    if (nodeType === "parallel") {
      const parallelId = `node-${++nodeIdCounter.current}`;
      const joinId     = `node-${++nodeIdCounter.current}`;
      const parallelNode: StoredNode = {
        id: parallelId,
        type: "parallel",
        position: { x: 0, y: 0 },
        data: {
          nodeType: "parallel",
          label: style.label,
          branchCount: 2,
          joinNodeId: joinId,
          branchLabels: ["Branch 1", "Branch 2"],
          branchWait: [true, true],
        },
      };
      const joinNode: StoredNode = {
        id: joinId,
        type: "join",
        position: { x: 0, y: 0 },
        data: { nodeType: "join", label: "Join", parallelNodeId: parallelId },
      };

      // Find the existing edge from afterNodeId (with optional sourceHandle)
      const sh = sourceHandle || undefined;
      const existingEdge = edges.find(e =>
        e.source === afterNodeId && (sh ? e.sourceHandle === sh : !e.sourceHandle),
      );
      const nextId  = existingEdge?.target;
      const newEdges = edges.filter(e => e !== existingEdge);
      // afterNodeId → parallel
      newEdges.push({ id: `e-ins-${parallelId}-a`, source: afterNodeId, target: parallelId, sourceHandle: sh });
      // parallel → join (empty branch_1 and branch_2 edges)
      newEdges.push({ id: `e-par-b1-${parallelId}`, source: parallelId, target: joinId, sourceHandle: "branch_1" });
      newEdges.push({ id: `e-par-b2-${parallelId}`, source: parallelId, target: joinId, sourceHandle: "branch_2" });
      // join → next (if there was a successor)
      if (nextId) {
        newEdges.push({ id: `e-ins-${joinId}-c`, source: joinId, target: nextId });
      }
      onGraphChange([...nodes, parallelNode, joinNode], newEdges);
      return;
    }

    const extraData: Record<string, unknown> = {};
    if (nodeType === "switch_case") {
      // Seed one Case so the canvas immediately shows Case 1 + Default columns
      extraData.cases = [{ id: `c${Date.now()}`, matchValue: "", label: "Case 1" }];
    }
    const newNode: StoredNode = {
      id: `node-${++nodeIdCounter.current}`,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: { nodeType, label: style.label, ...extraData },
    };
    if (onInsert) {
      onInsert(newNode);
    } else {
      const updated = graphInsertStep(nodes, edges, newNode, afterNodeId, sourceHandle);
      onGraphChange(updated.nodes, updated.edges);
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!ctx.copiedStep) return;
    e.preventDefault();
    e.stopPropagation();
    setPasteMenuPos({ top: e.clientY + 4, left: e.clientX });
    setPasteMenuOpen(true);
  }

  function handlePaste() {
    setPasteMenuOpen(false);
    if (!ctx.copiedStep) return;
    if (branchKey) {
      ctx.onPasteAtBranchStart(afterNodeId, branchKey);
    } else {
      ctx.onPasteAfterNode(afterNodeId);
    }
  }

  const pastedLabel = ctx.copiedStep
    ? ((ctx.copiedStep.data.label as string | undefined) || ctx.copiedStep.nodeType)
    : "";

  return (
    <div className="flex justify-center my-1">
      <div className="flex flex-col items-center">
        <div className="w-px h-3 bg-[#30363D]" />
        {label && (
          <span className="mb-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest bg-[#A855F7]/15 text-[#A855F7] border border-[#A855F7]/30 select-none">
            {label}
          </span>
        )}
        <button
          ref={btnRef}
          onClick={handleOpen}
          onContextMenu={handleContextMenu}
          className="w-6 h-6 rounded-full bg-[#1C2128] border border-[#30363D] hover:border-[#0078D4] hover:bg-[#0078D4]/10 text-[#484F58] hover:text-[#0078D4] flex items-center justify-center transition-colors text-sm font-bold leading-none"
          title={label ? `Add step after loop (runs once when all iterations finish)` : "Add step"}
        >
          +
        </button>
        <div className="w-px h-3 bg-[#30363D]" />
      </div>

      {open && pickerPos && (
        <NodePicker
          libraryCategories={libraryCategories}
          allLibraryNodes={allLibraryNodes}
          nodeStyles={nodeStyles}
          pos={pickerPos}
          onPick={handlePick}
          onClose={close}
        />
      )}

      {pasteMenuOpen && pasteMenuPos && createPortal(
        <div
          ref={pasteMenuRef}
          className="fixed z-[9999] bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1 min-w-[180px] text-xs"
          style={{ top: pasteMenuPos.top, left: pasteMenuPos.left }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={handlePaste}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
          >
            <span className="opacity-60">⎘</span>
            Paste "{pastedLabel}"
          </button>
          <div className="border-t border-[#30363D] my-1" />
          <button
            onClick={() => { setPasteMenuOpen(false); handleOpen(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
          >
            <span className="opacity-60">+</span>
            Add step…
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Category badge ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  CRM:        { bg: "#064E3B", text: "#34D399" },
  Payments:   { bg: "#451A03", text: "#F59E0B" },
  Scheduling: { bg: "#2E1065", text: "#A855F7" },
  M365:       { bg: "#0C2340", text: "#60A5FA" },
};

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] ?? { bg: "#1C2128", text: "#7D8590" };
  return (
    <span
      className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      style={{ background: colors.bg, color: colors.text }}
    >
      {category}
    </span>
  );
}

// ── Step Annotation ────────────────────────────────────────────────────────────

function StepAnnotation({
  step, isSelected, isArchived, nodes, edges, onGraphChange,
}: {
  step: FlowStep;
  isSelected: boolean;
  isArchived: boolean;
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
}) {
  const annotation = (step.data?.annotation as string | undefined) ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation);
  if (!isSelected && !annotation) return null;
  return (
    <div className="px-3 py-1.5 border-t border-[#30363D] flex items-start gap-1.5">
      <svg className="w-3 h-3 text-amber-400/70 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
      {editing ? (
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== annotation) {
              const updated = nodes.map(n => n.id === step.id ? { ...n, data: { ...n.data, annotation: draft } } : n);
              onGraphChange(updated, edges);
            }
          }}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); setDraft(annotation); } e.stopPropagation(); }}
          onClick={e => e.stopPropagation()}
          placeholder="Add a note…"
          className="flex-1 bg-transparent text-[10px] text-amber-200/80 placeholder-[#484F58] outline-none resize-none leading-relaxed"
        />
      ) : (
        <p
          onClick={e => { if (!isArchived) { e.stopPropagation(); setEditing(true); setDraft(annotation); } }}
          className={`flex-1 text-[10px] leading-relaxed ${annotation ? "text-amber-200/70" : "text-[#484F58] italic"} ${!isArchived ? "cursor-text hover:text-amber-200/90" : ""}`}
        >
          {annotation || (isSelected ? "Click to add a note…" : "")}
        </p>
      )}
    </div>
  );
}

// ── Step Card ──────────────────────────────────────────────────────────────────

function StepCard({
  step,
  isSelected,
  isArchived,
  nodeStyles,
  nodeIdCounter,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  onSelect,
  onGraphChange,
  onDuplicateNode,
  branchContainerId,
  parentBranchKey,
}: {
  step: FlowStep;
  isSelected: boolean;
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  nodeIdCounter: React.MutableRefObject<number>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onSelect: () => void;
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
  /** When this card lives inside a parallel branch, the container and branch key. */
  branchContainerId?: string;
  parentBranchKey?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [stepLogOpen, setStepLogOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPortalRef = useRef<HTMLDivElement>(null);
  const style = nodeStyles[step.nodeType] ?? nodeStyles["action"] ?? {
    bg: "#1C2128", border: "#30363D", icon: "⚡", label: step.nodeType,
  };

  const label = (step.data.label as string) || style.label;

  React.useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      const inBtn = menuRef.current?.contains(e.target as Node);
      const inPortal = menuPortalRef.current?.contains(e.target as Node);
      if (!inBtn && !inPortal) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const ctx = React.useContext(FlowCanvasContext);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (step.nodeType === "start") return;
    setMenuOpen(false);
    const updated = graphRemoveStep(nodes, edges, step.id);
    onGraphChange(updated.nodes, updated.edges);
  }

  function handleMoveUp(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    const updated = graphMoveStepUp(nodes, edges, step.id);
    onGraphChange(updated.nodes, updated.edges);
  }

  function handleMoveDown(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    const updated = graphMoveStepDown(nodes, edges, step.id);
    onGraphChange(updated.nodes, updated.edges);
  }

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    onDuplicateNode(step.id);
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    ctx.onCopyStep(step);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctx.onSetLastInteracted(step.id);
    setMenuPos({ top: e.clientY + 4, right: Math.max(0, window.innerWidth - e.clientX) });
    setMenuOpen(true);
  }

  const storedNode: StoredNode = { id: step.id, position: { x: 0, y: 0 }, data: step.data };
  const isContainer = isContainerNode(storedNode);
  const isDragging = ctx.draggedId === step.id;
  const isDropTarget = ctx.dropTargetId === step.id && !isDragging;

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", step.id);
    setTimeout(() => ctx.onDragStart(step.id), 0);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    ctx.onDragOver(step.id, e.clientY < midY ? "before" : "after");
    // Also highlight the enclosing parallel branch column so the drop zone is
    // visible even when hovering over an existing card inside that branch.
    if (branchContainerId && parentBranchKey) {
      ctx.onDragOverBranchColumn(branchContainerId, parentBranchKey);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    ctx.onDrop(step.id, e.clientY < midY ? "before" : "after");
  }

  // ── Comment node — sticky-note card ──────────────────────────────────────────
  if (step.nodeType === "comment") {
    const text = ((step.data.params as Record<string, unknown> | undefined)?.text as string | undefined) ?? "";
    return (
      <div
        className={`relative transition-all cursor-pointer select-none ${isDragging ? "opacity-40" : ""}`}
        style={{
          background: "#1A1600",
          border: `1.5px solid ${isSelected ? "#0078D4" : "#78530A"}`,
          borderRadius: 10,
          padding: "10px 14px 12px",
          minWidth: 0,
          boxShadow: isSelected
            ? "0 0 0 3px #0078D440, 0 2px 8px rgba(202,138,4,0.15)"
            : "0 2px 6px rgba(0,0,0,0.35)",
        }}
        onClick={e => { e.stopPropagation(); onSelect(); }}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={e => { e.stopPropagation(); }}
      >
        {/* Drop indicators */}
        {isDropTarget && ctx.dropPosition === "before" && (
          <div className="absolute -top-1 left-0 right-0 h-0.5 bg-[#0078D4] rounded-full z-10 pointer-events-none" />
        )}
        {isDropTarget && ctx.dropPosition === "after" && (
          <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-[#0078D4] rounded-full z-10 pointer-events-none" />
        )}

        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-2">
          {/* Drag handle */}
          {!isArchived && (
            <div
              draggable
              onDragStart={handleDragStart}
              onDragEnd={e => { e.stopPropagation(); ctx.onDragEnd(); }}
              onClick={e => e.stopPropagation()}
              className="flex-shrink-0 cursor-grab active:cursor-grabbing px-0.5 py-0.5 rounded"
              style={{ color: "#78530A", opacity: 0.7 }}
              title="Drag to reorder"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
                <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
                <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
              </svg>
            </div>
          )}
          <span style={{ fontSize: 13, lineHeight: 1 }}>📝</span>
          <span
            className="text-[9px] uppercase tracking-widest font-bold flex-1"
            style={{ color: "#CA8A04" }}
          >
            Note
          </span>
          {/* Three-dot menu */}
          {!isArchived && (
            <div className="relative" ref={menuRef}>
              <button
                ref={menuBtnRef}
                onClick={e => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                  setMenuOpen(v => !v);
                }}
                className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                style={{ color: "#CA8A04", opacity: 0.7 }}
                title="Options"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" />
                </svg>
              </button>
              {menuOpen && menuPos && createPortal(
                <div
                  ref={menuPortalRef}
                  className="fixed z-[9999] bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1 min-w-[140px] text-xs"
                  style={{ top: menuPos.top, right: menuPos.right }}
                >
                  <button onClick={handleMoveUp}   className="w-full text-left px-3 py-1.5 text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Move Up</button>
                  <button onClick={handleMoveDown} className="w-full text-left px-3 py-1.5 text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Move Down</button>
                  <button onClick={handleDuplicate} className="w-full text-left px-3 py-1.5 text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Duplicate</button>
                  <button onClick={handleCopy}      className="w-full text-left px-3 py-1.5 text-[#E6EDF3] hover:bg-[#21262D] transition-colors">Copy</button>
                  <div className="border-t border-[#30363D] my-1" />
                  <button onClick={handleDelete} className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-[#21262D] transition-colors">Delete</button>
                </div>,
                document.body
              )}
            </div>
          )}
        </div>

        {/* Comment text */}
        <p
          style={{
            color: text ? "#D4B896" : "#78530A",
            fontSize: 12,
            lineHeight: "1.55",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontStyle: text ? "normal" : "italic",
          }}
        >
          {text || "Add a note…"}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-xl border transition-all cursor-pointer select-none ${isDragging ? "opacity-40" : ""} ${
        isSelected
          ? "border-[#0078D4] ring-1 ring-[#0078D4]/40 shadow-[0_0_0_3px_rgba(0,120,212,0.12)]"
          : `hover:border-[#484F58]`
      }`}
      style={{ borderColor: isSelected ? "#0078D4" : style.border }}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={e => { e.stopPropagation(); }}
    >
      {/* Drop indicator lines */}
      {isDropTarget && ctx.dropPosition === "before" && (
        <div className="absolute -top-1 left-0 right-0 h-0.5 bg-[#0078D4] rounded-full z-10 pointer-events-none" />
      )}
      {isDropTarget && ctx.dropPosition === "after" && (
        <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-[#0078D4] rounded-full z-10 pointer-events-none" />
      )}

      {/* Card header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 rounded-t-xl"
        style={{ background: style.bg, borderRadius: collapsed || !isContainer ? "0.75rem" : "0.75rem 0.75rem 0 0" }}
      >
        {/* Drag handle */}
        {!isArchived && (
          <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={e => { e.stopPropagation(); ctx.onDragEnd(); }}
            onClick={e => e.stopPropagation()}
            className="flex-shrink-0 cursor-grab active:cursor-grabbing text-[#484F58] hover:text-[#7D8590] px-0.5 py-0.5 rounded"
            title="Drag to reorder"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
              <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
              <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
            </svg>
          </div>
        )}

        <span className="text-base flex-shrink-0">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#E6EDF3] truncate">{label}</p>
          <p className="text-[10px] text-[#7D8590] truncate">{step.id}</p>
        </div>

        {/* Execution result badge (inspect mode overlay) — click to expand log */}
        {ctx.stepResultMap[step.id] && (() => {
          const r = ctx.stepResultMap[step.id];
          const colors = { ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", error: "bg-red-500/20 text-red-300 border-red-500/30", skipped: "bg-amber-500/20 text-amber-300 border-amber-500/30" };
          const labels = { ok: "✓", error: "✕", skipped: "↷" };
          return (
            <button
              className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity ${colors[r.status]}`}
              title={r.errorMessage ? `Click to expand: ${r.errorMessage}` : (r.logPreview ? `Click to expand log` : "Click to view step result")}
              onClick={e => { e.stopPropagation(); setStepLogOpen(v => !v); }}
            >
              {labels[r.status]}
              {r.durationMs != null && <span className="font-normal opacity-80">{r.durationMs}ms</span>}
            </button>
          );
        })()}

        {step.nodeType === "start" && ctx.triggerCategories.length > 0 && (
          <span className="flex items-center gap-1 flex-wrap">
            {ctx.triggerCategories.map(cat => (
              <CategoryBadge key={cat} category={cat} />
            ))}
          </span>
        )}

        {/* Collapse/expand toggle for container nodes */}
        {isContainer && (
          <button
            onClick={e => { e.stopPropagation(); setCollapsed(v => !v); }}
            className="flex-shrink-0 p-1 rounded hover:bg-black/20 text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
            title={collapsed ? "Expand" : "Collapse"}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}

        {!isArchived && (
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              ref={menuBtnRef}
              onClick={e => {
                e.stopPropagation();
                if (!menuOpen && menuBtnRef.current) {
                  const r = menuBtnRef.current.getBoundingClientRect();
                  setMenuPos({ top: r.bottom + 4, right: Math.max(0, window.innerWidth - r.right) });
                }
                setMenuOpen(v => !v);
              }}
              className="p-1 rounded hover:bg-black/20 text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
              title="Step actions"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </div>
        )}
        {!isArchived && menuOpen && menuPos && createPortal(
          <div
            ref={menuPortalRef}
            className="fixed z-[9999] bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1 min-w-[140px] text-xs"
            style={{ top: menuPos.top, right: menuPos.right }}
            onClick={e => e.stopPropagation()}
          >
                {step.nodeType !== "parallel" && step.nodeType !== "join" && (
                  <>
                    <button
                      onClick={handleMoveUp}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                    >
                      ↑ Move Up
                    </button>
                    <button
                      onClick={handleMoveDown}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                    >
                      ↓ Move Down
                    </button>
                  </>
                )}
                <button
                  onClick={handleDuplicate}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  ⧉ Duplicate
                </button>
                <button
                  onClick={handleCopy}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  ⎘ Copy
                </button>
                {step.nodeType !== "start" && (
                  <>
                    <div className="border-t border-[#30363D] my-1" />
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      ✕ Delete
                    </button>
                  </>
                )}
          </div>,
          document.body
        )}
      </div>

      {/* generate_script: show source mode + target summary */}
      {step.nodeType === "generate_script" && (
        <div className="px-3 py-1.5 border-t border-[#30363D] text-[10px] text-[#7D8590] flex items-center gap-1.5 truncate">
          <span className="flex-shrink-0">
            {(step.data.sourceMode as string | undefined) === "document" ? "📄 Document" : "⚙️ Service"}
          </span>
          <span className="text-[#484F58]">→</span>
          <span className="truncate">
            {(step.data.targetName as string | undefined)?.trim() || (step.data.targetId as string | undefined)?.trim() || "Not configured"}
          </span>
        </div>
      )}

      {/* One-line inline preview (inspect mode) — always visible when result exists */}
      {!stepLogOpen && ctx.stepResultMap[step.id] && (() => {
        const r = ctx.stepResultMap[step.id];
        const preview = r.errorMessage ?? r.logPreview;
        if (!preview) return null;
        const previewColors = { ok: "text-emerald-300/60", error: "text-red-400/70", skipped: "text-amber-300/60" };
        return (
          <div
            className={`px-3 py-0.5 border-t border-[#30363D]/40 text-[10px] font-mono truncate cursor-pointer hover:opacity-80 ${previewColors[r.status]}`}
            onClick={e => { e.stopPropagation(); setStepLogOpen(true); }}
            title="Click to expand log"
          >
            {preview}
          </div>
        );
      })()}

      {/* Expandable step log drawer (inspect mode) — shows full log lines inline */}
      {stepLogOpen && ctx.stepResultMap[step.id] && (() => {
        const r = ctx.stepResultMap[step.id];
        const logs = r.fullLogs ?? (r.logPreview ? [r.logPreview] : []);
        return (
          <div className="px-3 py-2 border-t border-[#30363D]/60 bg-[#0D1117]/60 text-[10px] font-mono">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`font-semibold ${r.status === "ok" ? "text-emerald-300" : r.status === "error" ? "text-red-300" : "text-amber-300"}`}>
                {r.status === "ok" ? "✓ Succeeded" : r.status === "error" ? "✕ Failed" : "↷ Skipped"}
                {r.durationMs != null && <span className="ml-2 font-normal opacity-60">{r.durationMs}ms</span>}
                {logs.length > 0 && <span className="ml-2 font-normal opacity-40">{logs.length} log line{logs.length !== 1 ? "s" : ""}</span>}
              </span>
              <button
                className="text-[#484F58] hover:text-[#7D8590] ml-2 text-[11px]"
                onClick={e => { e.stopPropagation(); setStepLogOpen(false); }}
                title="Close log"
              >✕</button>
            </div>
            {r.errorMessage && (
              <div className="text-red-300/80 break-words whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto mb-1 border-b border-[#30363D]/40 pb-1">
                {r.errorMessage}
              </div>
            )}
            {logs.length > 0 ? (
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {logs.map((line, li) => (
                  <div key={li} className="text-[#7D8590] break-words whitespace-pre-wrap leading-relaxed">
                    <span className="select-none text-[#484F58] mr-1.5">{li + 1}</span>{line}
                  </div>
                ))}
              </div>
            ) : r.status === "ok" ? (
              <div className="text-[#484F58] italic">Step completed without log output.</div>
            ) : r.status === "skipped" ? (
              <div className="text-amber-200/60 italic">Skipped — all upstream branches were skipped.</div>
            ) : null}
          </div>
        );
      })()}

      {/* Step annotation row */}
      <StepAnnotation
        step={step}
        isSelected={isSelected}
        isArchived={isArchived}
        nodes={nodes}
        edges={edges}
        onGraphChange={onGraphChange}
      />

      {/* Container body — hidden when collapsed */}
      {isContainer && !collapsed && step.branches && (
        <ContainerBody
          step={step}
          isArchived={isArchived}
          nodeStyles={nodeStyles}
          nodeIdCounter={nodeIdCounter}
          libraryCategories={libraryCategories}
          allLibraryNodes={allLibraryNodes}
          nodes={nodes}
          edges={edges}
          onGraphChange={onGraphChange}
          onDuplicateNode={onDuplicateNode}
        />
      )}
    </div>
  );
}

// ── Parallel Branch Column ─────────────────────────────────────────────────────
// A self-contained column that wires up column-level drag-over/drop so nodes
// from outside the branch can be dragged into it, even when the branch is non-empty.

function ParallelBranchColumn({
  containerId,
  branchKey,
  label,
  color,
  wait,
  brSteps,
  isArchived,
  nodeStyles,
  nodeIdCounter,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  lastNodeId,
  onGraphChange,
  onDuplicateNode,
}: {
  containerId: string;
  branchKey: string;
  label: string;
  color: string;
  wait: boolean;
  brSteps: FlowStep[];
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  nodeIdCounter: React.MutableRefObject<number>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  lastNodeId: (steps: FlowStep[]) => string;
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
}) {
  const ctx = React.useContext(FlowCanvasContext);
  const isDragActive = !!ctx.draggedId;
  const isColumnTarget =
    ctx.dropBranchContainerId === containerId && ctx.dropBranchKey === branchKey;

  function handleDragOver(e: React.DragEvent) {
    if (!isDragActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    ctx.onDragOverBranchColumn(containerId, branchKey);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear if we're actually leaving the column (not entering a child)
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      ctx.onDragLeaveBranchColumn();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctx.onDropIntoBranch(containerId, branchKey);
  }

  return (
    <div
      className={`min-w-0 transition-colors ${isColumnTarget ? "bg-[#06B6D4]/10 ring-1 ring-inset ring-[#06B6D4]/50" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="px-2 py-1.5 border-b border-[#30363D] flex items-center gap-1.5"
        style={{ background: isColumnTarget ? `${color}20` : `${color}0D` }}
      >
        <span className="text-[9px] uppercase tracking-widest font-bold truncate flex-1" style={{ color }}>
          {label}
        </span>
        {isDragActive && isColumnTarget && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-[#06B6D4]/20 text-[#06B6D4] font-semibold whitespace-nowrap">
            ↓ drop here
          </span>
        )}
        {!isDragActive && !wait && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-semibold whitespace-nowrap">
            🔥 fire &amp; forget
          </span>
        )}
      </div>
      <div className="px-2 pb-3 pt-1">
        <BranchStepList
          steps={brSteps}
          containerId={containerId}
          containerHandle={branchKey}
          lastNodeIdFn={lastNodeId}
          branchKey={branchKey}
          isArchived={isArchived}
          nodeStyles={nodeStyles}
          nodeIdCounter={nodeIdCounter}
          libraryCategories={libraryCategories}
          allLibraryNodes={allLibraryNodes}
          nodes={nodes}
          edges={edges}
          onGraphChange={onGraphChange}
          onDuplicateNode={onDuplicateNode}
        />
      </div>
    </div>
  );
}

// ── Generic Branch Column ──────────────────────────────────────────────────────
// Wraps any branch column with column-level drag-over/drop so nodes can be
// dragged into it even when the column is non-empty. Modelled on ParallelBranchColumn.

function BranchColumn({
  containerId,
  branchKey,
  className,
  style,
  children,
}: {
  containerId: string;
  branchKey: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(FlowCanvasContext);
  const isDragActive = !!ctx.draggedId;
  const isColumnTarget =
    ctx.dropBranchContainerId === containerId && ctx.dropBranchKey === branchKey;

  function handleDragOver(e: React.DragEvent) {
    if (!isDragActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    ctx.onDragOverBranchColumn(containerId, branchKey);
  }

  function handleDragLeave(e: React.DragEvent) {
    const related = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(related)) {
      ctx.onDragLeaveBranchColumn();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctx.onDropIntoBranch(containerId, branchKey);
  }

  return (
    <div
      className={`transition-colors ${isColumnTarget ? "ring-1 ring-inset ring-[#06B6D4]/50 bg-[#06B6D4]/10" : ""} ${className ?? ""}`}
      style={style}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}

// ── Container Body ─────────────────────────────────────────────────────────────

/** Per-branch collapse: shows toggle button in header; collapsed branch shows a summary chip. */
function CollapsibleBranchHeader({
  label, color, stepCount, collapsed, onToggle,
}: {
  label: React.ReactNode;
  color?: string;
  stepCount: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="px-3 py-1.5 border-b border-[#30363D] flex items-center justify-between gap-2">
      <span className="text-[9px] uppercase tracking-widest font-bold" style={color ? { color } : undefined}>
        {label}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onToggle(); }}
        className="flex items-center gap-1 text-[9px] text-[#484F58] hover:text-[#7D8590] transition-colors"
        title={collapsed ? "Expand branch" : "Collapse branch"}
      >
        {collapsed && stepCount > 0 && (
          <span className="bg-[#1C2128] border border-[#30363D] rounded-full px-1.5 py-0.5 font-semibold text-[#7D8590]">
            {stepCount} step{stepCount !== 1 ? "s" : ""}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}

function ContainerBody({
  step,
  isArchived,
  nodeStyles,
  nodeIdCounter,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  onGraphChange,
  onDuplicateNode,
}: {
  step: FlowStep;
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  nodeIdCounter: React.MutableRefObject<number>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
}) {
  const { nodeType, branches } = step;
  if (!branches) return null;

  // Per-branch collapse state (Set of collapsed branch keys)
  const [collapsedBranches, setCollapsedBranches] = React.useState<Set<string>>(new Set());
  function toggleBranch(key: string) {
    setCollapsedBranches(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function lastNodeId(branchSteps: FlowStep[]): string {
    if (branchSteps.length === 0) return step.id;
    const last = branchSteps[branchSteps.length - 1];
    return last.id;
  }

  function handleFor(branchKey: string) {
    if (nodeType === "foreach") return "body";
    if (nodeType === "condition") return branchKey;
    if (nodeType === "switch_case") return branchKey === "__default__" ? "default" : `case-${branchKey}`;
    if (nodeType === "fetch_news_headlines") return branchKey; // "hot" or "notHot"
    if (nodeType === "parallel") return branchKey; // "branch_1", "branch_2", …
    return undefined;
  }

  // ── ForEach ──
  if (nodeType === "foreach") {
    const bodySteps = branches["body"] ?? [];
    return (
      <div className="border-t border-[#A855F7]/30 rounded-b-xl overflow-hidden bg-[#A855F7]/5">
        <div className="px-3 py-1.5 flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-widest font-bold text-[#A855F7]">Loop body</span>
        </div>
        <div className="px-4 pb-3">
          <BranchStepList
            steps={bodySteps}
            containerId={step.id}
            containerHandle="body"
            lastNodeIdFn={lastNodeId}
            branchKey="body"
            isArchived={isArchived}
            nodeStyles={nodeStyles}
            nodeIdCounter={nodeIdCounter}
            libraryCategories={libraryCategories}
            allLibraryNodes={allLibraryNodes}
            nodes={nodes}
            edges={edges}
            onGraphChange={onGraphChange}
            onDuplicateNode={onDuplicateNode}
          />
        </div>
      </div>
    );
  }

  // ── Check Script Output (Passed / On Failure) ────────────────────────────
  if (nodeType === "check_script_output") {
    const yesSteps = branches["yes"] ?? [];
    const noSteps  = branches["no"]  ?? [];
    return (
      <div className="border-t border-[#2DD4BF]/30 rounded-b-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-[#30363D]">
          {/* Passed branch */}
          <BranchColumn containerId={step.id} branchKey="yes" className="bg-teal-500/5">
            <div className="px-3 py-1.5 border-b border-[#30363D]">
              <span className="text-[9px] uppercase tracking-widest font-bold text-[#2DD4BF]">✓ Passed</span>
            </div>
            <div className="px-2 pb-3 pt-1">
              <BranchStepList
                steps={yesSteps}
                containerId={step.id}
                containerHandle="yes"
                lastNodeIdFn={lastNodeId}
                branchKey="yes"
                isArchived={isArchived}
                nodeStyles={nodeStyles}
                nodeIdCounter={nodeIdCounter}
                libraryCategories={libraryCategories}
                allLibraryNodes={allLibraryNodes}
                nodes={nodes}
                edges={edges}
                onGraphChange={onGraphChange}
                onDuplicateNode={onDuplicateNode}
              />
            </div>
          </BranchColumn>

          {/* On Failure branch */}
          <BranchColumn containerId={step.id} branchKey="no" className="bg-red-500/5 border-t sm:border-t-0 border-[#30363D]">
            <div className="px-3 py-1.5 border-b border-[#30363D]">
              <span className="text-[9px] uppercase tracking-widest font-bold text-red-400">✕ On Failure</span>
            </div>
            <div className="px-2 pb-3 pt-1">
              <BranchStepList
                steps={noSteps}
                containerId={step.id}
                containerHandle="no"
                lastNodeIdFn={lastNodeId}
                branchKey="no"
                isArchived={isArchived}
                nodeStyles={nodeStyles}
                nodeIdCounter={nodeIdCounter}
                libraryCategories={libraryCategories}
                allLibraryNodes={allLibraryNodes}
                nodes={nodes}
                edges={edges}
                onGraphChange={onGraphChange}
                onDuplicateNode={onDuplicateNode}
              />
            </div>
          </BranchColumn>
        </div>
      </div>
    );
  }

  // ── Condition (Yes / No) — Y-shape: two labeled arms, each independently collapsible ──
  if (nodeType === "condition") {
    const yesSteps = branches["yes"] ?? [];
    const noSteps  = branches["no"]  ?? [];
    const yesCollapsed = collapsedBranches.has("yes");
    const noCollapsed  = collapsedBranches.has("no");
    return (
      <div className="border-t border-[#F59E0B]/30 rounded-b-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-[#30363D]">
          {/* Yes arm (true branch) */}
          <BranchColumn containerId={step.id} branchKey="yes" className="bg-emerald-500/5">
            <CollapsibleBranchHeader
              label={<>✓ Yes — True</>}
              color="#34D399"
              stepCount={yesSteps.length}
              collapsed={yesCollapsed}
              onToggle={() => toggleBranch("yes")}
            />
            {!yesCollapsed && (
              <div className="px-2 pb-3 pt-1">
                <BranchStepList
                  steps={yesSteps}
                  containerId={step.id}
                  containerHandle="yes"
                  lastNodeIdFn={lastNodeId}
                  branchKey="yes"
                  isArchived={isArchived}
                  nodeStyles={nodeStyles}
                  nodeIdCounter={nodeIdCounter}
                  libraryCategories={libraryCategories}
                  allLibraryNodes={allLibraryNodes}
                  nodes={nodes}
                  edges={edges}
                  onGraphChange={onGraphChange}
                  onDuplicateNode={onDuplicateNode}
                />
              </div>
            )}
          </BranchColumn>

          {/* No arm (false branch) */}
          <BranchColumn containerId={step.id} branchKey="no" className="bg-red-500/5 border-t sm:border-t-0 border-[#30363D]">
            <CollapsibleBranchHeader
              label={<>✕ No — False</>}
              color="#F87171"
              stepCount={noSteps.length}
              collapsed={noCollapsed}
              onToggle={() => toggleBranch("no")}
            />
            {!noCollapsed && (
              <div className="px-2 pb-3 pt-1">
                <BranchStepList
                  steps={noSteps}
                  containerId={step.id}
                  containerHandle="no"
                  lastNodeIdFn={lastNodeId}
                  branchKey="no"
                  isArchived={isArchived}
                  nodeStyles={nodeStyles}
                  nodeIdCounter={nodeIdCounter}
                  libraryCategories={libraryCategories}
                  allLibraryNodes={allLibraryNodes}
                  nodes={nodes}
                  edges={edges}
                  onGraphChange={onGraphChange}
                  onDuplicateNode={onDuplicateNode}
                />
              </div>
            )}
          </BranchColumn>
        </div>
      </div>
    );
  }

  // ── Switch / Case — scrolls horizontally on small screens ──
  if (nodeType === "switch_case") {
    const cases = (step.data.cases as Array<{ id: string; matchValue: string; label?: string }> | undefined) ?? [];
    const branchColors = ["#0078D4", "#A855F7", "#F59E0B", "#10B981", "#EF4444"];

    // If no cases configured yet, show a nudge instead of just a bare Default column
    if (cases.length === 0) {
      return (
        <div className="border-t border-[#FB923C]/30 rounded-b-xl bg-[#FB923C]/5 px-4 py-3">
          <p className="text-[11px] text-[#7D8590] italic">
            No cases defined — open the config panel to add cases.
          </p>
          <div className="mt-2">
            <div className="text-[9px] uppercase tracking-widest font-bold text-[#6B7280] mb-1">Default</div>
            <BranchStepList
              steps={branches["__default__"] ?? []}
              containerId={step.id}
              containerHandle="default"
              lastNodeIdFn={lastNodeId}
              branchKey="__default__"
              isArchived={isArchived}
              nodeStyles={nodeStyles}
              nodeIdCounter={nodeIdCounter}
              libraryCategories={libraryCategories}
              allLibraryNodes={allLibraryNodes}
              nodes={nodes}
              edges={edges}
              onGraphChange={onGraphChange}
              onDuplicateNode={onDuplicateNode}
            />
          </div>
        </div>
      );
    }

    const branchKeys = [...cases.map(c => c.id), "__default__"];

    return (
      <div className="border-t border-[#FB923C]/30 rounded-b-xl overflow-x-auto">
        <div
          className="grid divide-x divide-[#30363D]"
          style={{ gridTemplateColumns: `repeat(${branchKeys.length}, minmax(140px, 1fr))` }}
        >
          {branchKeys.map((key, bi) => {
            const caseData = cases.find(c => c.id === key);
            const label = key === "__default__" ? "Default" : (caseData?.label || caseData?.matchValue || `Case ${bi + 1}`);
            const color = branchColors[bi % branchColors.length];
            const branchSteps = branches[key] ?? [];
            const isBranchCollapsed = collapsedBranches.has(key);

            return (
              <BranchColumn key={key} containerId={step.id} branchKey={key} className="min-w-0">
                <CollapsibleBranchHeader
                  label={<span className="truncate block">{label}</span>}
                  color={color}
                  stepCount={branchSteps.length}
                  collapsed={isBranchCollapsed}
                  onToggle={() => toggleBranch(key)}
                />
                {!isBranchCollapsed && (
                  <div className="px-2 pb-3 pt-1">
                    <BranchStepList
                      steps={branchSteps}
                      containerId={step.id}
                      containerHandle={handleFor(key)}
                      lastNodeIdFn={lastNodeId}
                      branchKey={key}
                      isArchived={isArchived}
                      nodeStyles={nodeStyles}
                      nodeIdCounter={nodeIdCounter}
                      libraryCategories={libraryCategories}
                      allLibraryNodes={allLibraryNodes}
                      nodes={nodes}
                      edges={edges}
                      onGraphChange={onGraphChange}
                      onDuplicateNode={onDuplicateNode}
                    />
                  </div>
                )}
              </BranchColumn>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Parallel (fan-out branches) ────────────────────────────────────────────
  if (nodeType === "parallel") {
    const branchKeys   = Object.keys(branches).sort(); // branch_1, branch_2, …
    const branchLabels = (step.data.branchLabels as string[] | undefined) ?? [];
    const branchWait   = (step.data.branchWait   as boolean[] | undefined) ?? [];
    const branchColors = ["#06B6D4", "#A855F7", "#F59E0B", "#10B981", "#EF4444"];

    return (
      <div className="border-t border-[#06B6D4]/30 rounded-b-xl overflow-x-auto">
        <div
          className="grid divide-x divide-[#30363D]"
          style={{ gridTemplateColumns: `repeat(${branchKeys.length}, minmax(140px, 1fr))` }}
        >
          {branchKeys.map((key, bi) => {
            const label    = branchLabels[bi] ?? `Branch ${bi + 1}`;
            const wait     = branchWait[bi] !== false;
            const color    = branchColors[bi % branchColors.length];
            const brSteps  = branches[key] ?? [];

            return (
              <ParallelBranchColumn
                key={key}
                containerId={step.id}
                branchKey={key}
                label={label}
                color={color}
                wait={wait}
                brSteps={brSteps}
                isArchived={isArchived}
                nodeStyles={nodeStyles}
                nodeIdCounter={nodeIdCounter}
                libraryCategories={libraryCategories}
                allLibraryNodes={allLibraryNodes}
                nodes={nodes}
                edges={edges}
                lastNodeId={lastNodeId}
                onGraphChange={onGraphChange}
                onDuplicateNode={onDuplicateNode}
              />
            );
          })}
        </div>
        {/* Join footer */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[#06B6D4]/20 bg-[#06B6D4]/5">
          <span className="text-[9px] text-[#06B6D4]/70 font-mono">⇊ join</span>
          <span className="text-[9px] text-[#484F58]">awaited branches merged here</span>
        </div>
      </div>
    );
  }

  // ── Generate Document (On Error branch) ────────────────────────────────────
  if (nodeType === "generate_document") {
    const errorSteps = branches["onError"] ?? [];
    return (
      <div className="border-t border-red-500/30 rounded-b-xl overflow-hidden">
        <BranchColumn containerId={step.id} branchKey="onError">
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-red-400">⚠ On Error — Recovery steps</span>
          </div>
          <div className="px-3 pb-3">
            <BranchStepList
              steps={errorSteps}
              containerId={step.id}
              containerHandle="onError"
              lastNodeIdFn={lastNodeId}
              branchKey="onError"
              isArchived={isArchived}
              nodeStyles={nodeStyles}
              nodeIdCounter={nodeIdCounter}
              libraryCategories={libraryCategories}
              allLibraryNodes={allLibraryNodes}
              nodes={nodes}
              edges={edges}
              onGraphChange={onGraphChange}
              onDuplicateNode={onDuplicateNode}
            />
          </div>
        </BranchColumn>
      </div>
    );
  }

  // ── Retry (Exhausted branch) ────────────────────────────────────────────────
  if (nodeType === "retry") {
    const exhaustedSteps = branches["exhausted"] ?? [];
    return (
      <div className="border-t border-amber-500/30 rounded-b-xl overflow-hidden">
        <BranchColumn containerId={step.id} branchKey="exhausted">
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-amber-400">🔁 Exhausted — runs when all retries are used up</span>
          </div>
          <div className="px-3 pb-3">
            <BranchStepList
              steps={exhaustedSteps}
              containerId={step.id}
              containerHandle="exhausted"
              lastNodeIdFn={lastNodeId}
              branchKey="exhausted"
              isArchived={isArchived}
              nodeStyles={nodeStyles}
              nodeIdCounter={nodeIdCounter}
              libraryCategories={libraryCategories}
              allLibraryNodes={allLibraryNodes}
              nodes={nodes}
              edges={edges}
              onGraphChange={onGraphChange}
              onDuplicateNode={onDuplicateNode}
            />
          </div>
        </BranchColumn>
      </div>
    );
  }

  // ── Fetch News Headlines (hot / notHot branches) ───────────────────────────
  if (nodeType === "fetch_news_headlines") {
    const hotSteps    = branches["hot"]    ?? [];
    const notHotSteps = branches["notHot"] ?? [];
    return (
      <div className="border-t border-[#06B6D4]/30 rounded-b-xl overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-[#06B6D4]/20">
          {/* Hot branch */}
          <BranchColumn containerId={step.id} branchKey="hot" className="bg-[#06B6D4]/5">
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest font-bold text-[#06B6D4]">🔥 Hot — Run Campaign</span>
            </div>
            <div className="px-3 pb-3">
              <BranchStepList
                steps={hotSteps}
                containerId={step.id}
                containerHandle="hot"
                lastNodeIdFn={lastNodeId}
                branchKey="hot"
                isArchived={isArchived}
                nodeStyles={nodeStyles}
                nodeIdCounter={nodeIdCounter}
                libraryCategories={libraryCategories}
                allLibraryNodes={allLibraryNodes}
                nodes={nodes}
                edges={edges}
                onGraphChange={onGraphChange}
                onDuplicateNode={onDuplicateNode}
              />
            </div>
          </BranchColumn>
          {/* Not Hot branch */}
          <BranchColumn containerId={step.id} branchKey="notHot" className="bg-slate-900/30">
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400">❄️ Not Hot — Skip</span>
            </div>
            <div className="px-3 pb-3">
              <BranchStepList
                steps={notHotSteps}
                containerId={step.id}
                containerHandle="notHot"
                lastNodeIdFn={lastNodeId}
                branchKey="notHot"
                isArchived={isArchived}
                nodeStyles={nodeStyles}
                nodeIdCounter={nodeIdCounter}
                libraryCategories={libraryCategories}
                allLibraryNodes={allLibraryNodes}
                nodes={nodes}
                edges={edges}
                onGraphChange={onGraphChange}
                onDuplicateNode={onDuplicateNode}
              />
            </div>
          </BranchColumn>
        </div>
      </div>
    );
  }

  return null;
}

// ── Branch Step List ───────────────────────────────────────────────────────────

function BranchStepList({
  steps,
  containerId,
  containerHandle,
  lastNodeIdFn,
  branchKey,
  isArchived,
  nodeStyles,
  nodeIdCounter,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  onGraphChange,
  onDuplicateNode,
}: {
  steps: FlowStep[];
  containerId: string;
  containerHandle?: string;
  lastNodeIdFn: (steps: FlowStep[]) => string;
  branchKey: string;
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  nodeIdCounter: React.MutableRefObject<number>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
}) {
  const ctx = React.useContext(FlowCanvasContext);

  if (steps.length === 0) {
    const isDragActive = !!ctx.draggedId;
    return (
      <div className="flex flex-col items-center">
        <div
          className={`w-full border border-dashed rounded-lg py-3 flex items-center justify-center transition-colors ${
            isDragActive
              ? "border-[#0078D4] bg-[#0078D4]/10 cursor-copy"
              : "border-[#30363D]"
          }`}
          onDragOver={isDragActive ? (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; } : undefined}
          onDrop={isDragActive ? (e) => { e.preventDefault(); e.stopPropagation(); ctx.onDropIntoBranch(containerId, branchKey); } : undefined}
        >
          <span className="text-[10px] text-[#484F58]">
            {isDragActive ? "Drop here" : "Empty branch"}
          </span>
        </div>
        <AddButton
          afterNodeId={containerId}
          sourceHandle={containerHandle}
          branchKey={branchKey}
          isArchived={isArchived}
          nodeIdCounter={nodeIdCounter}
          nodeStyles={nodeStyles}
          libraryCategories={libraryCategories}
          allLibraryNodes={allLibraryNodes}
          nodes={nodes}
          edges={edges}
          onGraphChange={onGraphChange}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Leading "+" before first step */}
      <AddButton
        afterNodeId={containerId}
        sourceHandle={containerHandle}
        branchKey={branchKey}
        isArchived={isArchived}
        nodeIdCounter={nodeIdCounter}
        nodeStyles={nodeStyles}
        libraryCategories={libraryCategories}
        allLibraryNodes={allLibraryNodes}
        nodes={nodes}
        edges={edges}
        onGraphChange={onGraphChange}
      />

      {steps.map((step, idx) => (
        <React.Fragment key={step.id}>
          <NestedStepRenderer
            step={step}
            isArchived={isArchived}
            nodeStyles={nodeStyles}
            nodeIdCounter={nodeIdCounter}
            libraryCategories={libraryCategories}
            allLibraryNodes={allLibraryNodes}
            nodes={nodes}
            edges={edges}
            onGraphChange={onGraphChange}
            onDuplicateNode={onDuplicateNode}
            branchContainerId={containerId}
            parentBranchKey={branchKey}
          />
          {/* "+" after each step within the branch — suppressed for news node (branches have their own AddButtons) */}
          {step.nodeType !== "fetch_news_headlines" && (
            <AddButton
              afterNodeId={step.id}
              sourceHandle={undefined}
              isArchived={isArchived}
              nodeIdCounter={nodeIdCounter}
              nodeStyles={nodeStyles}
              libraryCategories={libraryCategories}
              allLibraryNodes={allLibraryNodes}
              nodes={nodes}
              edges={edges}
              onGraphChange={onGraphChange}
            />
          )}
          {idx < steps.length - 1 && <div className="h-1" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Nested Step Renderer ───────────────────────────────────────────────────────

function NestedStepRenderer({
  step,
  isArchived,
  nodeStyles,
  nodeIdCounter,
  libraryCategories,
  allLibraryNodes,
  nodes,
  edges,
  onGraphChange,
  onDuplicateNode,
  branchContainerId,
  parentBranchKey,
}: {
  step: FlowStep;
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  nodeIdCounter: React.MutableRefObject<number>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodes: StoredNode[];
  edges: StoredEdge[];
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
  branchContainerId?: string;
  parentBranchKey?: string;
}) {
  const ctx = React.useContext(FlowCanvasContext);

  return (
    <StepCard
      step={step}
      isSelected={ctx.selectedNodeId === step.id}
      isArchived={isArchived}
      nodeStyles={nodeStyles}
      nodeIdCounter={nodeIdCounter}
      libraryCategories={libraryCategories}
      allLibraryNodes={allLibraryNodes}
      nodes={nodes}
      edges={edges}
      onSelect={() => ctx.onSelectNode(step.id === ctx.selectedNodeId ? null : step.id)}
      onGraphChange={onGraphChange}
      onDuplicateNode={onDuplicateNode}
      branchContainerId={branchContainerId}
      parentBranchKey={parentBranchKey}
    />
  );
}

// ── Context for selection + drag state ────────────────────────────────────────

interface FlowCanvasCtx {
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  draggedId: string | null;
  dropTargetId: string | null;
  dropPosition: "before" | "after";
  /** Container + branch currently highlighted as a column drop target. */
  dropBranchContainerId: string | null;
  dropBranchKey: string | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, pos: "before" | "after") => void;
  onDrop: (targetId: string, pos: "before" | "after") => void;
  onDragEnd: () => void;
  /** Drop a dragged node into the first position of a specific container branch. */
  onDropIntoBranch: (containerId: string, branchKey: string) => void;
  /** Signal that a drag is hovering over a specific branch column. */
  onDragOverBranchColumn: (containerId: string, branchKey: string) => void;
  /** Clear the branch column hover state (e.g. on drag-leave). */
  onDragLeaveBranchColumn: () => void;
  /** Distinct categories from all event triggers (e.g. ["CRM", "Payments"]). Empty when unknown. */
  triggerCategories: string[];
  /** The step currently in the clipboard (null when empty). */
  copiedStep: FlowStep | null;
  /** Copy a step into the clipboard. */
  onCopyStep: (step: FlowStep) => void;
  /** Paste the clipboard step after the specified node in the sequence. */
  onPasteAfterNode: (afterNodeId: string) => void;
  /** Paste the clipboard step at the start of a container branch. */
  onPasteAtBranchStart: (containerId: string, branchKey: string) => void;
  /** ID of the most recently right-clicked step (used for keyboard shortcuts). */
  lastInteractedId: string | null;
  /** Update the last interacted step ID. */
  onSetLastInteracted: (id: string) => void;
  /** Execution result map from the last inspected run (nodeId → StepResult). */
  stepResultMap: Record<string, StepResult>;
}

const FlowCanvasContext = React.createContext<FlowCanvasCtx>({
  selectedNodeId: null,
  onSelectNode: () => {},
  draggedId: null,
  dropTargetId: null,
  dropPosition: "after",
  dropBranchContainerId: null,
  dropBranchKey: null,
  onDragStart: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
  onDropIntoBranch: () => {},
  onDragOverBranchColumn: () => {},
  onDragLeaveBranchColumn: () => {},
  triggerCategories: [],
  copiedStep: null,
  onCopyStep: () => {},
  onPasteAfterNode: () => {},
  onPasteAtBranchStart: () => {},
  lastInteractedId: null,
  onSetLastInteracted: () => {},
  stepResultMap: {},
});

// ── Main Canvas ────────────────────────────────────────────────────────────────

export default function FlowCanvas({
  nodes,
  edges,
  selectedNodeId,
  isArchived,
  isLoading = false,
  nodeStyles,
  libraryCategories,
  allLibraryNodes,
  nodeIdCounter,
  onSelectNode,
  onGraphChange,
  onDuplicateNode,
  triggerCategories = [],
  copiedStep = null,
  onCopyStep,
  stepResultMap,
}: FlowCanvasProps) {
  const tree = React.useMemo(() => graphToTree(nodes, edges), [nodes, edges]);

  // ── Drag-to-reorder state ────────────────────────────────────────────────────
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("after");
  const [dropBranchContainerId, setDropBranchContainerId] = useState<string | null>(null);
  const [dropBranchKey, setDropBranchKey] = useState<string | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
    setDropTargetId(null);
  }, []);

  const handleDragOver = useCallback((id: string, pos: "before" | "after") => {
    setDropTargetId(id);
    setDropPosition(pos);
  }, []);

  /**
   * Compute the set of edges that exist in `edges` but are NOT produced by
   * `treeToGraph(tree)` — these are "non-tree" edges such as retry back-edges
   * that have no representation in the FlowStep tree.
   *
   * We call treeToGraph(tree) here (the *current* tree, before any drag mutation)
   * to establish the canonical baseline.  Any edge in `edges` not in that
   * baseline is a non-tree edge.  We then re-apply only those non-tree edges
   * after a drag mutation so they survive the treeToGraph rewrite without
   * resurrecting stale canonical edges that the reorder intentionally replaced.
   */
  const nonTreeEdges = React.useMemo(() => {
    const { edges: canonical } = treeToGraph(tree);
    const canonicalKeys = new Set(
      canonical.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
    );
    return edges.filter(
      ed => !canonicalKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
    );
  }, [tree, edges]);

  const handleDrop = useCallback((targetId: string, pos: "before" | "after") => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDropTargetId(null);
      setDropBranchContainerId(null);
      setDropBranchKey(null);
      return;
    }
    const reordered = treeReorderStep(tree, draggedId, targetId, pos);
    if (reordered !== tree) {
      // Same-sequence reorder succeeded — apply it.
      const { nodes: n, edges: e } = treeToGraph(reordered);
      const newNodeIds = new Set(n.map(nd => nd.id));
      const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
      const extra = nonTreeEdges.filter(
        ed => newNodeIds.has(ed.source) &&
              newNodeIds.has(ed.target) &&
              !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
      );
      onGraphChange(n, extra.length > 0 ? [...e, ...extra] : e);
    } else {
      // Reorder was a no-op: dragged node is in a different sequence than the
      // target.  Find which container+branch owns the target and adopt the
      // dragged node into that branch instead.
      const parent = treeFindStepParent(tree, targetId);
      if (parent) {
        const adopted = treeMoveStepIntoBranch(tree, draggedId, parent.containerId, parent.branchKey);
        if (adopted !== tree) {
          const { nodes: n, edges: e } = treeToGraph(adopted);
          const newNodeIds = new Set(n.map(nd => nd.id));
          const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
          const extra = nonTreeEdges.filter(
            ed => newNodeIds.has(ed.source) &&
                  newNodeIds.has(ed.target) &&
                  !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
          );
          onGraphChange(n, extra.length > 0 ? [...e, ...extra] : e);
        }
      }
    }
    setDraggedId(null);
    setDropTargetId(null);
    setDropBranchContainerId(null);
    setDropBranchKey(null);
  }, [draggedId, tree, nonTreeEdges, onGraphChange]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
    setDropBranchContainerId(null);
    setDropBranchKey(null);
  }, []);

  const handleDropIntoBranch = useCallback((containerId: string, branchKey: string) => {
    if (!draggedId) return;
    const newTree = treeMoveStepIntoBranch(tree, draggedId, containerId, branchKey);
    if (newTree !== tree) {
      const { nodes: n, edges: e } = treeToGraph(newTree);
      // Carry non-tree edges (e.g. retry back-edges) into the new graph.
      const newNodeIds = new Set(n.map(nd => nd.id));
      const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
      const extra = nonTreeEdges.filter(
        ed => newNodeIds.has(ed.source) &&
              newNodeIds.has(ed.target) &&
              !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
      );
      onGraphChange(n, extra.length > 0 ? [...e, ...extra] : e);
    }
    setDraggedId(null);
    setDropTargetId(null);
    setDropBranchContainerId(null);
    setDropBranchKey(null);
  }, [draggedId, tree, nonTreeEdges, onGraphChange]);

  const handleDragOverBranchColumn = useCallback((containerId: string, branchKey: string) => {
    setDropBranchContainerId(containerId);
    setDropBranchKey(branchKey);
    setDropTargetId(null);
  }, []);

  const handleDragLeaveBranchColumn = useCallback(() => {
    setDropBranchContainerId(null);
    setDropBranchKey(null);
  }, []);

  // ── Copy / Paste ─────────────────────────────────────────────────────────────

  /** ID of the most recently right-clicked step — used as the keyboard copy/paste anchor. */
  const [lastInteractedId, setLastInteractedId] = useState<string | null>(null);

  const handleSetLastInteracted = useCallback((id: string) => {
    setLastInteractedId(id);
  }, []);

  const { toast } = useToast();

  const handleCopyStep = useCallback((step: FlowStep) => {
    onCopyStep?.(step);
    // Count total descendant steps for the toast label.
    function countSteps(s: FlowStep): number {
      let n = 1;
      if (s.branches) {
        for (const branch of Object.values(s.branches)) {
          for (const child of branch) n += countSteps(child);
        }
      }
      return n;
    }
    const total = countSteps(step);
    const label = (step.data.label as string | undefined) || step.nodeType;
    const desc = total > 1 ? `${label} + ${total - 1} nested step${total - 1 === 1 ? "" : "s"} copied` : `${label} copied`;
    toast({ description: desc, duration: 2500 });
  }, [onCopyStep, toast]);

  /** Paste the clipboard step immediately after `afterNodeId` in tree sequence. */
  const handlePasteAfterNode = useCallback((afterNodeId: string) => {
    if (!copiedStep) return;
    const cloned = deepCloneStep(copiedStep);
    const newTree = treeInsertStepAfter(tree, afterNodeId, cloned);
    if (newTree !== tree) {
      const { nodes: n, edges: e } = treeToGraph(newTree);
      const newNodeIds = new Set(n.map(nd => nd.id));
      const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
      const extra = nonTreeEdges.filter(
        ed => newNodeIds.has(ed.source) &&
              newNodeIds.has(ed.target) &&
              !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
      );
      onGraphChange(n, extra.length > 0 ? [...e, ...extra] : e);
    }
  }, [copiedStep, tree, nonTreeEdges, onGraphChange]);

  /** Paste the clipboard step at the start of `containerId[branchKey]`. */
  const handlePasteAtBranchStart = useCallback((containerId: string, branchKey: string) => {
    if (!copiedStep) return;
    const cloned = deepCloneStep(copiedStep);
    const newTree = treeInsertStepAtBranchStart(tree, containerId, branchKey, cloned);
    if (newTree !== tree) {
      const { nodes: n, edges: e } = treeToGraph(newTree);
      const newNodeIds = new Set(n.map(nd => nd.id));
      const newEdgeKeys = new Set(e.map(ed => `${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`));
      const extra = nonTreeEdges.filter(
        ed => newNodeIds.has(ed.source) &&
              newNodeIds.has(ed.target) &&
              !newEdgeKeys.has(`${ed.source}|${ed.target}|${ed.sourceHandle ?? ""}`)
      );
      onGraphChange(n, extra.length > 0 ? [...e, ...extra] : e);
    }
  }, [copiedStep, tree, nonTreeEdges, onGraphChange]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // Ctrl/Cmd+C → copy the most recently right-clicked step (falls back to selected)
  // Ctrl/Cmd+V → paste after the most recently right-clicked/interacted step
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Prefer the last right-clicked step; fall back to the currently selected node.
      const anchor = lastInteractedId ?? selectedNodeId;
      if (e.key === "c" || e.key === "C") {
        if (!anchor) return;
        const found = treeFindStep(tree, anchor);
        if (found) {
          e.preventDefault();
          handleCopyStep(found);
        }
      }
      if (e.key === "v" || e.key === "V") {
        if (!copiedStep) return;
        e.preventDefault();
        if (anchor) {
          handlePasteAfterNode(anchor);
        } else if (tree.length > 0) {
          handlePasteAfterNode(tree[tree.length - 1].id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tree, selectedNodeId, lastInteractedId, copiedStep, handleCopyStep, handlePasteAfterNode]);

  const ctx: FlowCanvasCtx = React.useMemo(() => ({
    selectedNodeId,
    onSelectNode,
    draggedId,
    dropTargetId,
    dropPosition,
    dropBranchContainerId,
    dropBranchKey,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
    onDropIntoBranch: handleDropIntoBranch,
    onDragOverBranchColumn: handleDragOverBranchColumn,
    onDragLeaveBranchColumn: handleDragLeaveBranchColumn,
    triggerCategories,
    copiedStep,
    onCopyStep: handleCopyStep,
    onPasteAfterNode: handlePasteAfterNode,
    onPasteAtBranchStart: handlePasteAtBranchStart,
    lastInteractedId,
    onSetLastInteracted: handleSetLastInteracted,
    stepResultMap: stepResultMap ?? {},
  }), [selectedNodeId, onSelectNode, draggedId, dropTargetId, dropPosition, dropBranchContainerId, dropBranchKey, handleDragStart, handleDragOver, handleDrop, handleDragEnd, handleDropIntoBranch, handleDragOverBranchColumn, handleDragLeaveBranchColumn, triggerCategories, copiedStep, handleCopyStep, handlePasteAfterNode, handlePasteAtBranchStart, lastInteractedId, handleSetLastInteracted, stepResultMap]);

  function handleCanvasClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onSelectNode(null);
  }

  if (nodes.length === 0) {
    return (
      <FlowCanvasContext.Provider value={ctx}>
        <div
          className="flex-1 overflow-auto bg-[#0D1117] flex items-center justify-center"
          onClick={handleCanvasClick}
        >
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 pointer-events-none">
              <svg className="w-6 h-6 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-xs text-[#484F58]">Loading workflow…</p>
            </div>
          ) : (
            <div className="text-center text-[#484F58] pointer-events-none">
              <p className="font-medium text-[#7D8590] text-sm">Canvas is empty</p>
              <p className="mt-1 text-xs">Add steps from the library on the left, or use Build with AI.</p>
            </div>
          )}
        </div>
      </FlowCanvasContext.Provider>
    );
  }

  return (
    <FlowCanvasContext.Provider value={ctx}>
      <div
        className="flex-1 overflow-auto bg-[#0D1117]"
        onClick={handleCanvasClick}
      >
        {/* Dot-grid background */}
        <div className="min-h-full w-full" style={{
          backgroundImage: "radial-gradient(circle, #1C2128 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}>
          <div className="max-w-2xl mx-auto py-8 px-4">
            <div className="flex flex-col">
              {tree.map((step) => {
                // condition and switch_case have no plain outgoing edge from the
                // container itself — use tree-space insertion so the new step
                // lands visually after the container block.
                const needsTreeInsert =
                  step.nodeType === "condition" || step.nodeType === "switch_case" || step.nodeType === "check_script_output";

                const handleTreeInsert = needsTreeInsert
                  ? (newNode: StoredNode) => {
                      const newStep: FlowStep = {
                        id: newNode.id,
                        nodeType: (newNode.type ?? newNode.data.nodeType) as string,
                        data: newNode.data,
                      };
                      const newTree = treeInsertStepAfter(tree, step.id, newStep);
                      const { nodes: n, edges: e } = treeToGraph(newTree);
                      onGraphChange(n, e);
                    }
                  : undefined;

                return (
                  <React.Fragment key={step.id}>
                    <StepCard
                      step={step}
                      isSelected={selectedNodeId === step.id}
                      isArchived={isArchived}
                      nodeStyles={nodeStyles}
                      nodeIdCounter={nodeIdCounter}
                      libraryCategories={libraryCategories}
                      allLibraryNodes={allLibraryNodes}
                      nodes={nodes}
                      edges={edges}
                      onSelect={() => onSelectNode(selectedNodeId === step.id ? null : step.id)}
                      onGraphChange={onGraphChange}
                      onDuplicateNode={onDuplicateNode}
                    />

                    {/* "+" after each top-level step — hidden for terminal news node */}
                    {step.nodeType !== "fetch_news_headlines" && (
                      <AddButton
                        afterNodeId={step.id}
                        sourceHandle={step.nodeType === "foreach" ? "done" : undefined}
                        label={step.nodeType === "foreach" ? "After loop" : undefined}
                        isArchived={isArchived}
                        nodeIdCounter={nodeIdCounter}
                        nodeStyles={nodeStyles}
                        libraryCategories={libraryCategories}
                        allLibraryNodes={allLibraryNodes}
                        nodes={nodes}
                        edges={edges}
                        onGraphChange={onGraphChange}
                        onInsert={handleTreeInsert}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </FlowCanvasContext.Provider>
  );
}
