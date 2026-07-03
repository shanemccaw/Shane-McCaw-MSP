/**
 * FlowCanvas.tsx
 *
 * Power Automate-style vertical workflow builder.
 * Receives the flat nodes+edges graph and renders it as a nested step list.
 * All mutations emit the updated flat graph via onGraphChange — the executor
 * save format is never changed.
 */

import React, { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  graphToTree,
  graphInsertStep,
  graphRemoveStep,
  graphMoveStepUp,
  graphMoveStepDown,
  treeInsertStepAfter,
  treeReorderStep,
  treeToGraph,
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

export interface FlowCanvasProps {
  nodes: StoredNode[];
  edges: StoredEdge[];
  selectedNodeId: string | null;
  isArchived: boolean;
  nodeStyles: Record<string, NodeStyle>;
  libraryCategories: LibraryCategory[];
  allLibraryNodes: LibraryNode[];
  nodeIdCounter: React.MutableRefObject<number>;
  onSelectNode: (id: string | null) => void;
  onGraphChange: (nodes: StoredNode[], edges: StoredEdge[]) => void;
  onDuplicateNode: (id: string) => void;
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
  const [open, setOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  if (isArchived) return null;

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPickerPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
    }
    setOpen(v => !v);
  }

  function handlePick(nodeType: string) {
    const style = nodeStyles[nodeType] ?? nodeStyles["action"] ?? { label: nodeType };
    const newNode: StoredNode = {
      id: `node-${++nodeIdCounter.current}`,
      type: nodeType,
      position: { x: 0, y: 0 },
      data: { nodeType, label: style.label },
    };
    if (onInsert) {
      onInsert(newNode);
    } else {
      const updated = graphInsertStep(nodes, edges, newNode, afterNodeId, sourceHandle);
      onGraphChange(updated.nodes, updated.edges);
    }
  }

  return (
    <div className="flex justify-center my-1">
      <div className="flex flex-col items-center">
        <div className="w-px h-3 bg-[#30363D]" />
        <button
          ref={btnRef}
          onClick={handleOpen}
          className="w-6 h-6 rounded-full bg-[#1C2128] border border-[#30363D] hover:border-[#0078D4] hover:bg-[#0078D4]/10 text-[#484F58] hover:text-[#0078D4] flex items-center justify-center transition-colors text-sm font-bold leading-none"
          title="Add step"
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
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const style = nodeStyles[step.nodeType] ?? nodeStyles["action"] ?? {
    bg: "#1C2128", border: "#30363D", icon: "⚡", label: step.nodeType,
  };

  const label = (step.data.label as string) || style.label;

  React.useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
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

  const isContainer = step.nodeType === "foreach" || step.nodeType === "condition" || step.nodeType === "switch_case";

  const ctx = React.useContext(FlowCanvasContext);
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
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    ctx.onDrop(step.id, e.clientY < midY ? "before" : "after");
  }

  return (
    <div
      className={`relative rounded-xl border transition-all cursor-pointer select-none ${isDragging ? "opacity-40" : ""} ${
        isSelected
          ? "border-[#0078D4] ring-1 ring-[#0078D4]/40 shadow-[0_0_0_3px_rgba(0,120,212,0.12)]"
          : `hover:border-[#484F58]`
      }`}
      style={{ borderColor: isSelected ? "#0078D4" : style.border }}
      onClick={onSelect}
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
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
              className="p-1 rounded hover:bg-black/20 text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
              title="Step actions"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-50 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1 min-w-[140px] text-xs"
                onClick={e => e.stopPropagation()}
              >
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
                <button
                  onClick={handleDuplicate}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#E6EDF3] hover:bg-[#1C2128] transition-colors"
                >
                  ⧉ Duplicate
                </button>
                <div className="border-t border-[#30363D] my-1" />
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  ✕ Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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

// ── Container Body ─────────────────────────────────────────────────────────────

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

  function lastNodeId(branchSteps: FlowStep[]): string {
    if (branchSteps.length === 0) return step.id;
    const last = branchSteps[branchSteps.length - 1];
    return last.id;
  }

  function handleFor(branchKey: string) {
    if (nodeType === "foreach") return "body";
    if (nodeType === "condition") return branchKey;
    if (nodeType === "switch_case") return branchKey === "__default__" ? "default" : `case-${branchKey}`;
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

  // ── Condition (Yes / No) — responsive: stacked on mobile, side-by-side on sm+ ──
  if (nodeType === "condition") {
    const yesSteps = branches["yes"] ?? [];
    const noSteps  = branches["no"]  ?? [];
    return (
      <div className="border-t border-[#F59E0B]/30 rounded-b-xl overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-[#30363D]">
          {/* Yes branch */}
          <div className="bg-emerald-500/5">
            <div className="px-3 py-1.5 border-b border-[#30363D]">
              <span className="text-[9px] uppercase tracking-widest font-bold text-emerald-400">✓ Yes</span>
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
          </div>

          {/* No branch */}
          <div className="bg-red-500/5 border-t sm:border-t-0 border-[#30363D]">
            <div className="px-3 py-1.5 border-b border-[#30363D]">
              <span className="text-[9px] uppercase tracking-widest font-bold text-red-400">✕ No</span>
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
          </div>
        </div>
      </div>
    );
  }

  // ── Switch / Case — scrolls horizontally on small screens ──
  if (nodeType === "switch_case") {
    const cases = (step.data.cases as Array<{ id: string; matchValue: string; label?: string }> | undefined) ?? [];
    const branchKeys = [...cases.map(c => c.id), "__default__"];
    const branchColors = ["#0078D4", "#A855F7", "#F59E0B", "#10B981", "#EF4444"];

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

            return (
              <div key={key} className="min-w-0">
                <div className="px-2 py-1.5 border-b border-[#30363D]" style={{ background: `${color}08` }}>
                  <span className="text-[9px] uppercase tracking-widest font-bold truncate block" style={{ color }}>
                    {label}
                  </span>
                </div>
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
              </div>
            );
          })}
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
  branchKey: _branchKey,
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
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <div className="w-full border border-dashed border-[#30363D] rounded-lg py-3 flex items-center justify-center">
          <span className="text-[10px] text-[#484F58]">Empty branch</span>
        </div>
        <AddButton
          afterNodeId={containerId}
          sourceHandle={containerHandle}
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
          />
          {/* "+" after each step within the branch */}
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
  onDragStart: (id: string) => void;
  onDragOver: (id: string, pos: "before" | "after") => void;
  onDrop: (targetId: string, pos: "before" | "after") => void;
  onDragEnd: () => void;
}

const FlowCanvasContext = React.createContext<FlowCanvasCtx>({
  selectedNodeId: null,
  onSelectNode: () => {},
  draggedId: null,
  dropTargetId: null,
  dropPosition: "after",
  onDragStart: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
});

// ── Main Canvas ────────────────────────────────────────────────────────────────

export default function FlowCanvas({
  nodes,
  edges,
  selectedNodeId,
  isArchived,
  nodeStyles,
  libraryCategories,
  allLibraryNodes,
  nodeIdCounter,
  onSelectNode,
  onGraphChange,
  onDuplicateNode,
}: FlowCanvasProps) {
  const tree = React.useMemo(() => graphToTree(nodes, edges), [nodes, edges]);

  // ── Drag-to-reorder state ────────────────────────────────────────────────────
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("after");

  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
    setDropTargetId(null);
  }, []);

  const handleDragOver = useCallback((id: string, pos: "before" | "after") => {
    setDropTargetId(id);
    setDropPosition(pos);
  }, []);

  const handleDrop = useCallback((targetId: string, pos: "before" | "after") => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDropTargetId(null);
      return;
    }
    const newTree = treeReorderStep(tree, draggedId, targetId, pos);
    if (newTree !== tree) {
      const { nodes: n, edges: e } = treeToGraph(newTree);
      onGraphChange(n, e);
    }
    setDraggedId(null);
    setDropTargetId(null);
  }, [draggedId, tree, onGraphChange]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTargetId(null);
  }, []);

  const ctx: FlowCanvasCtx = React.useMemo(() => ({
    selectedNodeId,
    onSelectNode,
    draggedId,
    dropTargetId,
    dropPosition,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
  }), [selectedNodeId, onSelectNode, draggedId, dropTargetId, dropPosition, handleDragStart, handleDragOver, handleDrop, handleDragEnd]);

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
          <div className="text-center text-[#484F58] pointer-events-none">
            <p className="font-medium text-[#7D8590] text-sm">Canvas is empty</p>
            <p className="mt-1 text-xs">Add steps from the library on the left, or use Build with AI.</p>
          </div>
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
                  step.nodeType === "condition" || step.nodeType === "switch_case";

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

                    {/* "+" after each top-level step */}
                    <AddButton
                      afterNodeId={step.id}
                      sourceHandle={step.nodeType === "foreach" ? "done" : undefined}
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
