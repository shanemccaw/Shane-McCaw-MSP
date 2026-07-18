import { useState, useMemo, useRef } from "react";
import { ChevronRight, ChevronDown, Plus, FolderOpen, Folder, LayoutGrid, Loader2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ServiceRow } from "@/hooks/useServices";

// ── Tree data model ──────────────────────────────────────────────────────────

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  serviceCount: number;
  totalCount: number;
  isVirtual?: boolean;
}

/**
 * Build a nested tree from service categoryPath values, plus any `virtualPaths`
 * (created by inline "add category") that have no services yet.
 */
export function buildTree(services: ServiceRow[], virtualPaths: string[] = []): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();

  function ensurePath(rawPath: string, isVirtual = false) {
    const parts = rawPath.split("/").map(p => p.trim()).filter(Boolean);
    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!nodeMap.has(currentPath)) {
        nodeMap.set(currentPath, {
          name: part, path: currentPath, children: [],
          serviceCount: 0, totalCount: 0, isVirtual,
        });
      }
      if (parentPath && nodeMap.has(parentPath)) {
        const parent = nodeMap.get(parentPath)!;
        if (!parent.children.find(c => c.path === currentPath)) {
          parent.children.push(nodeMap.get(currentPath)!);
        }
      }
    }
    return currentPath;
  }

  for (const service of services) {
    const rawPath = service.categoryPath ?? service.category ?? null;
    if (!rawPath) continue;
    const leafPath = ensurePath(rawPath, false);
    const leaf = nodeMap.get(leafPath);
    if (leaf) { leaf.serviceCount++; leaf.isVirtual = false; }
  }

  for (const vp of virtualPaths) {
    if (!vp.trim()) continue;
    ensurePath(vp.trim(), true);
    // Mark the leaf as virtual only if not already real
    const leaf = nodeMap.get(vp.trim());
    if (leaf && leaf.serviceCount === 0) leaf.isVirtual = true;
  }

  function sumCount(node: TreeNode): number {
    const childSum = node.children.reduce((s, c) => s + sumCount(c), 0);
    node.totalCount = node.serviceCount + childSum;
    return node.totalCount;
  }

  const roots = Array.from(nodeMap.values()).filter(n => {
    if (!n.path.includes("/")) return true;
    const parentPath = n.path.substring(0, n.path.lastIndexOf("/"));
    return !nodeMap.has(parentPath);
  });
  roots.forEach(r => sumCount(r));
  return roots;
}

/** Flatten tree nodes into an ordered list, respecting expand state. */
function flattenVisible(nodes: TreeNode[], expanded: Set<string>): Array<TreeNode & { depth: number }> {
  const result: Array<TreeNode & { depth: number }> = [];
  function recurse(list: TreeNode[], depth: number) {
    for (const node of list) {
      result.push({ ...node, depth });
      if (expanded.has(node.path) && node.children.length > 0) {
        recurse(node.children, depth + 1);
      }
    }
  }
  recurse(nodes, 0);
  return result;
}

/** Return the parent path of a node path (null if root). */
function parentOf(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? null : path.substring(0, idx);
}

// ── Per-node row ─────────────────────────────────────────────────────────────

interface SortableRowProps {
  node: TreeNode & { depth: number };
  selected: string | null;
  expanded: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onAddChild: (parentPath: string) => void;
  isDragOverlay?: boolean;
  isDropTarget?: boolean;
}

function SortableRow({
  node, selected, expanded, onSelect, onToggle, onAddChild,
  isDragOverlay = false, isDropTarget = false,
}: SortableRowProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const hasChildren = node.children.length > 0;
  const indent = node.depth * 14;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.path });

  const mergedStyle = {
    ...(!isDragOverlay ? { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 } : {}),
    paddingLeft: `${indent + 6}px`,
    paddingTop: "4px",
    paddingBottom: "4px",
  };

  return (
    <div
      ref={isDragOverlay ? undefined : setNodeRef}
      style={mergedStyle}
      className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
        isDropTarget
          ? "ring-2 ring-primary ring-inset bg-primary/10"
          : isSelected
            ? "bg-primary/15 text-primary"
            : "text-foreground/90 hover:bg-accent"
      } ${isDragOverlay ? "shadow-2xl opacity-90 cursor-grabbing pointer-events-none" : ""}`}
    >
      {/* Drag handle */}
      <div
        {...(!isDragOverlay ? attributes : {})}
        {...(!isDragOverlay ? listeners : {})}
        className="opacity-0 group-hover:opacity-40 hover:!opacity-80 cursor-grab active:cursor-grabbing text-muted-foreground/60 flex-shrink-0 p-0.5"
        title="Drag to reparent into another category"
        onClick={e => e.stopPropagation()}
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="5" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="9" cy="19" r="1.5" />
          <circle cx="15" cy="5" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="15" cy="19" r="1.5" />
        </svg>
      </div>

      <button
        type="button"
        onClick={() => { if (hasChildren) onToggle(node.path); onSelect(node.path); }}
        className="flex items-center gap-1.5 flex-1 min-w-0"
      >
        <span className="flex-shrink-0 text-muted-foreground">
          {hasChildren
            ? (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
            : <span className="w-3 h-3 inline-block" />}
        </span>
        <span className="flex-shrink-0 text-muted-foreground/60">
          {isExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
        </span>
        <span className={`text-xs font-medium truncate flex-1 ${node.isVirtual ? "italic opacity-60" : ""}`}>{node.name}</span>
        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 ml-1">{node.totalCount}</span>
      </button>

      <button
        type="button"
        title="Add child category"
        onClick={e => { e.stopPropagation(); onAddChild(node.path); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-opacity flex-shrink-0"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  services: ServiceRow[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onReparentCategory: (fromPath: string, toParentPath: string | null) => void;
  reparenting?: boolean;
}

export default function CatalogCategoryTree({
  services, selectedPath, onSelect, onReparentCategory, reparenting = false,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [virtualPaths, setVirtualPaths] = useState<string[]>([]);
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [siblingOrder, setSiblingOrder] = useState<Map<string | null, string[]>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const tree = useMemo(() => buildTree(services, virtualPaths), [services, virtualPaths]);
  const totalCount = services.length;

  const visibleNodes = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

  const orderedVisible = useMemo(() => {
    if (siblingOrder.size === 0) return visibleNodes;
    const grouped = new Map<string | null, Array<TreeNode & { depth: number }>>();
    for (const n of visibleNodes) {
      const parent = parentOf(n.path);
      const list = grouped.get(parent) ?? [];
      list.push(n);
      grouped.set(parent, list);
    }
    const result: Array<TreeNode & { depth: number }> = [];
    function emit(parentPath: string | null) {
      const children = grouped.get(parentPath) ?? [];
      const order = siblingOrder.get(parentPath);
      const sorted = order
        ? [...children].sort((a, b) => {
            const ai = order.indexOf(a.path);
            const bi = order.indexOf(b.path);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          })
        : children;
      for (const n of sorted) {
        result.push(n);
        if (expanded.has(n.path)) emit(n.path);
      }
    }
    emit(null);
    return result;
  }, [visibleNodes, siblingOrder, expanded]);

  function toggleExpand(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleAddChild(parentPath: string) {
    setAddingChildTo(parentPath);
    setNewCategoryName("");
    setExpanded(prev => new Set([...prev, parentPath]));
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function commitAdd() {
    const name = newCategoryName.trim();
    if (!name) { setAddingChildTo(null); return; }
    const newPath = addingChildTo === "__root__" ? name : `${addingChildTo!}/${name}`;
    // Persist virtual category so it appears in the tree even with 0 services
    setVirtualPaths(prev => prev.includes(newPath) ? prev : [...prev, newPath]);
    if (addingChildTo && addingChildTo !== "__root__") {
      setExpanded(prev => new Set([...prev, addingChildTo!]));
    }
    setAddingChildTo(null);
    setNewCategoryName("");
    onSelect(newPath);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragActiveId(String(event.active.id));
  }

  function handleDragOver(event: { over: { id: string | number } | null }) {
    setDropTargetId(event.over ? String(event.over.id) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    setDropTargetId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Cycle guard: cannot reparent into self or own descendant
    if (overId === activeId || overId.startsWith(activeId + "/")) return;

    const activeParent = parentOf(activeId);
    const overParent = parentOf(overId);

    if (activeParent === overParent) {
      // Same parent → sibling reorder (visual, session-local)
      const siblings = orderedVisible
        .filter(n => parentOf(n.path) === activeParent)
        .map(n => n.path);
      const oldIdx = siblings.indexOf(activeId);
      const newIdx = siblings.indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1) {
        const reordered = arrayMove(siblings, oldIdx, newIdx);
        setSiblingOrder(prev => new Map(prev).set(activeParent, reordered));
      }
    } else {
      // Different parent → reparent: make active a CHILD of overId
      // (drop onto a node → it becomes a child of that node)
      onReparentCategory(activeId, overId);
    }
  }

  const dragActiveNode = dragActiveId ? orderedVisible.find(n => n.path === dragActiveId) : null;
  const sortableIds = orderedVisible.map(n => n.path);

  // Drop target highlight only for cross-parent drags (reparent intent)
  const isDropTarget = (nodeId: string) =>
    dropTargetId === nodeId &&
    dragActiveId !== null &&
    parentOf(dragActiveId) !== parentOf(nodeId) &&
    nodeId !== dragActiveId &&
    !nodeId.startsWith(dragActiveId + "/");

  return (
    <div className="flex flex-col border-r border-accent bg-background overflow-hidden" style={{ width: 200, flexShrink: 0 }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-accent flex-shrink-0">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Categories</span>
        <div className="flex items-center gap-1">
          {reparenting && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
          <button
            type="button"
            title="Add root category"
            onClick={() => { setAddingChildTo("__root__"); setNewCategoryName(""); setTimeout(() => inputRef.current?.focus(), 30); }}
            className="text-muted-foreground/60 hover:text-primary p-0.5 rounded hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* All Products */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg mx-1 transition-colors text-xs font-medium ${selectedPath === null ? "bg-primary/15 text-primary" : "text-foreground/90 hover:bg-accent"}`}
          style={{ width: "calc(100% - 8px)" }}
        >
          <LayoutGrid className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left">All Products</span>
          <span className="text-[10px] text-muted-foreground/60">{totalCount}</span>
        </button>

        {/* Uncategorized */}
        {services.some(s => !s.categoryPath && !s.category) && (
          <button
            type="button"
            onClick={() => onSelect("__uncategorized__")}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg mx-1 transition-colors text-xs font-medium ${selectedPath === "__uncategorized__" ? "bg-primary/15 text-primary" : "text-foreground/90 hover:bg-accent"}`}
            style={{ width: "calc(100% - 8px)" }}
          >
            <Folder className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60" />
            <span className="flex-1 text-left text-muted-foreground">Uncategorized</span>
            <span className="text-[10px] text-muted-foreground/60">{services.filter(s => !s.categoryPath && !s.category).length}</span>
          </button>
        )}

        {/* Flat sortable tree (single DndContext spans the whole tree) */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {orderedVisible.map(node => (
              <SortableRow
                key={node.path}
                node={node}
                selected={selectedPath}
                expanded={expanded}
                onSelect={onSelect}
                onToggle={toggleExpand}
                onAddChild={handleAddChild}
                isDropTarget={isDropTarget(node.path)}
              />
            ))}
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {dragActiveNode && (
              <SortableRow
                node={dragActiveNode}
                selected={null}
                expanded={expanded}
                onSelect={() => {}}
                onToggle={() => {}}
                onAddChild={() => {}}
                isDragOverlay
              />
            )}
          </DragOverlay>
        </DndContext>

        {/* Inline add root category */}
        {addingChildTo === "__root__" && (
          <div className="px-2 py-2">
            <form onSubmit={e => { e.preventDefault(); commitAdd(); }}>
              <input
                ref={inputRef}
                type="text"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") { setAddingChildTo(null); setNewCategoryName(""); } }}
                placeholder="Root category name…"
                className="w-full border border-primary/50 rounded px-2 py-1 text-xs bg-accent text-foreground outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-1">Enter to create · Esc to cancel</p>
            </form>
          </div>
        )}

        {/* Inline add child category */}
        {addingChildTo && addingChildTo !== "__root__" && (
          <div className="px-2 py-2">
            <p className="text-[10px] text-muted-foreground/60 mb-1">Under: <span className="text-muted-foreground font-mono">{addingChildTo}</span></p>
            <form onSubmit={e => { e.preventDefault(); commitAdd(); }}>
              <input
                ref={inputRef}
                type="text"
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") { setAddingChildTo(null); setNewCategoryName(""); } }}
                placeholder="Child category name…"
                className="w-full border border-primary/50 rounded px-2 py-1 text-xs bg-accent text-foreground outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted-foreground/60 mt-1">Enter to create · Esc to cancel</p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
