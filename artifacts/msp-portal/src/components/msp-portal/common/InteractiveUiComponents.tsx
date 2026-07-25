// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Check,
  ChevronsUpDown,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Sidebar,
  FileText,
  CheckCircle2,
  Zap,
  SlidersHorizontal,
  ShieldAlert,
  Sparkles,
  Clock,
  X,
  Code,
  Tag,
  ListFilter
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPES & DATA STRUCTURES
// ============================================================================

export interface ComboboxOption {
  value: string;
  label: string;
  category?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  badgeText?: string;
}

export interface RejectionPayload {
  targetId: string;
  targetType: string;
  category: string;
  auditNotes: string;
  rejectedByUpn: string;
}

// ============================================================================
// DEFAULT GRAPH ENDPOINTS & RESOURCE COMBBOX OPTIONS
// ============================================================================

export const DEFAULT_GRAPH_ENDPOINTS: ComboboxOption[] = [
  { value: 'GET /identity/conditionalAccess/policies', label: '/identity/conditionalAccess/policies', category: 'Identity', method: 'GET', badgeText: 'Conditional Access' },
  { value: 'POST /identity/conditionalAccess/policies', label: '/identity/conditionalAccess/policies', category: 'Identity', method: 'POST', badgeText: 'Create Policy' },
  { value: 'PATCH /users/{id}/authentication/methods', label: '/users/{id}/authentication/methods', category: 'Identity', method: 'PATCH', badgeText: 'MFA Reset' },
  { value: 'POST /users/{id}/revokeSignInSessions', label: '/users/{id}/revokeSignInSessions', category: 'Identity', method: 'POST', badgeText: 'Session Revoke' },
  { value: 'GET /security/alerts_v2', label: '/security/alerts_v2', category: 'Security / Defender', method: 'GET', badgeText: 'Defender Alerts' },
  { value: 'PATCH /security/alerts_v2/{id}', label: '/security/alerts_v2/{id}', category: 'Security / Defender', method: 'PATCH', badgeText: 'Alert Status' },
  { value: 'GET /deviceManagement/managedDevices', label: '/deviceManagement/managedDevices', category: 'Intune', method: 'GET', badgeText: 'Intune Devices' },
  { value: 'POST /deviceManagement/managedDevices/{id}/wipe', label: '/deviceManagement/managedDevices/{id}/wipe', category: 'Intune', method: 'POST', badgeText: 'Device Wipe' },
  { value: 'GET /me/messages', label: '/me/messages', category: 'Exchange', method: 'GET', badgeText: 'Mail Messages' },
  { value: 'POST /privacy/subjectRightsRequests', label: '/privacy/subjectRightsRequests', category: 'Purview', method: 'POST', badgeText: 'Data Subject' },
];

// ============================================================================
// COMPONENT 1: SEARCHABLE GRAPH ENDPOINT & RESOURCE COMBOBOX
// ============================================================================

export interface SearchableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options?: ComboboxOption[];
  placeholder?: string;
  className?: string;
}

export const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  value,
  onChange,
  options = DEFAULT_GRAPH_ENDPOINTS,
  placeholder = "Search Graph API Endpoints or Resources...",
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const categories = ['All', ...Array.from(new Set(options.map((o) => o.category).filter(Boolean))) as string[]];

  const filteredOptions = options.filter((opt) => {
    const matchesSearch =
      opt.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      opt.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (opt.badgeText && opt.badgeText.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = activeCategory === 'All' || opt.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const selectedOption = options.find((o) => o.value === value);

  const getMethodBadgeClass = (method?: string) => {
    switch (method) {
      case 'GET':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'POST':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      case 'PATCH':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'DELETE':
        return 'bg-red-500/20 text-red-300 border-red-500/40';
      default:
        return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative w-full font-sans text-xs", className)}>
      {/* Combobox Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between rounded-xl bg-[#080b10] border border-[#23314a] p-2.5 text-xs text-slate-200 hover:border-[#0078d4] focus:outline-none transition-colors"
      >
        <div className="flex items-center gap-2 truncate">
          <Code className="w-4 h-4 text-[#38BDF8] shrink-0" />
          {selectedOption ? (
            <span className="flex items-center gap-2 font-mono truncate">
              {selectedOption.method && (
                <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border font-sans", getMethodBadgeClass(selectedOption.method))}>
                  {selectedOption.method}
                </span>
              )}
              <span className="text-white truncate">{selectedOption.label}</span>
            </span>
          ) : (
            <span className="text-slate-500 truncate">{value || placeholder}</span>
          )}
        </div>
        <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-[#2e3b52] bg-[#0d121a] p-3 shadow-2xl space-y-2.5 animate-in fade-in duration-150">
          {/* Search Input Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by endpoint, path, or keyword..."
              className="w-full rounded-xl bg-[#080b10] border border-[#23314a] pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#0078d4] font-mono"
              autoFocus
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-colors border cursor-pointer",
                  activeCategory === cat
                    ? "bg-[#0078d4] text-white border-[#38BDF8]"
                    : "bg-[#141b26] text-slate-400 border-[#23314a] hover:text-white"
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Options Scrollable List */}
          <div className="max-h-52 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all border text-xs",
                      isSelected
                        ? "bg-[#0078d4]/20 border-[#0078d4] text-cyan-200 font-bold"
                        : "bg-[#111722]/60 border-transparent hover:bg-[#182130] text-slate-300"
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {opt.method && (
                        <span className={cn("text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border font-mono shrink-0", getMethodBadgeClass(opt.method))}>
                          {opt.method}
                        </span>
                      )}
                      <span className="font-mono truncate">{opt.label}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {opt.badgeText && (
                        <span className="text-[9.5px] bg-[#1a2436] text-slate-400 px-2 py-0.5 rounded border border-[#2e3e5c]">
                          {opt.badgeText}
                        </span>
                      )}
                      {isSelected && <Check className="w-4 h-4 text-[#38BDF8]" />}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-500 italic">
                No matching Graph endpoints found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPONENT 2: INTERACTIVE TABLE ROW SELECTION & RIGHT DETAIL INSPECTOR
// ============================================================================

export interface TableColumn<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  className?: string;
}

export interface InteractiveSplitPaneTableProps<T extends { id: string | number }> {
  columns: TableColumn<T>[];
  data: T[];
  selectedRowId?: string | number | null;
  onSelectRow: (row: T) => void;
  renderDrawerContent: (row: T) => React.ReactNode;
  drawerTitle?: string;
  onCloseDrawer?: () => void;
  emptyText?: string;
  className?: string;
}

export function InteractiveSplitPaneTable<T extends { id: string | number }>({
  columns,
  data,
  selectedRowId,
  onSelectRow,
  renderDrawerContent,
  drawerTitle = "Resource Inspector",
  onCloseDrawer,
  emptyText = "No record entries found.",
  className,
}: InteractiveSplitPaneTableProps<T>) {
  const selectedRow = data.find((d) => d.id === selectedRowId);

  return (
    <div className={cn("grid grid-cols-12 gap-5 w-full font-sans text-xs", className)}>
      {/* Left Data Table Pane */}
      <div className={cn("transition-all duration-300", selectedRow ? "col-span-12 lg:col-span-7" : "col-span-12")}>
        <div className="rounded-2xl border border-[#23314a] bg-[#0f141c] overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141b26] border-b border-[#23314a] text-slate-400 uppercase tracking-wider font-mono text-[10px] font-bold">
                  {columns.map((col, idx) => (
                    <th key={idx} className={cn("py-3 px-3.5", col.className)}>
                      {col.header}
                    </th>
                  ))}
                  <th className="py-3 px-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2736]">
                {data.length > 0 ? (
                  data.map((row) => {
                    const isSelected = row.id === selectedRowId;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => onSelectRow(row)}
                        className={cn(
                          "cursor-pointer transition-all duration-150 hover:bg-[#161e2b]",
                          isSelected
                            ? "bg-[#0078d4]/15 border-l-4 border-l-[#38BDF8] text-white font-medium"
                            : "text-slate-300"
                        )}
                      >
                        {columns.map((col, idx) => (
                          <td key={idx} className={cn("py-3 px-3.5", col.className)}>
                            {col.cell
                              ? col.cell(row)
                              : col.accessorKey
                              ? String(row[col.accessorKey] ?? '')
                              : null}
                          </td>
                        ))}
                        <td className="py-3 px-3 text-right">
                          <ChevronRight className={cn("w-4 h-4 ml-auto transition-transform", isSelected ? "text-[#38BDF8] translate-x-1" : "text-slate-600")} />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={columns.length + 1} className="py-8 text-center text-slate-500 italic">
                      {emptyText}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Detail Inspector Drawer (Slide-In 40% Width) */}
      {selectedRow && (
        <div className="col-span-12 lg:col-span-5 animate-in slide-in-from-right-4 duration-300">
          <div className="rounded-2xl border border-[#38BDF8]/40 bg-[#0d121a] p-5 shadow-2xl space-y-4 sticky top-4">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-[#23314a] pb-3">
              <div className="flex items-center gap-2">
                <Sidebar className="w-4 h-4 text-[#38BDF8]" />
                <h3 className="text-sm font-bold text-white">{drawerTitle}</h3>
                <span className="font-mono text-[10px] bg-[#0078d4]/20 text-[#38BDF8] px-2 py-0.5 rounded border border-[#0078d4]/40">
                  ID: {selectedRow.id}
                </span>
              </div>
              {onCloseDrawer && (
                <button
                  onClick={onCloseDrawer}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Custom Content Slot */}
            <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1 custom-scrollbar">
              {renderDrawerContent(selectedRow)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT 3: MANDATORY REJECTION CONFIRMATION DIALOG
// ============================================================================

export interface RejectionConfirmDialogProps {
  isOpen: boolean;
  targetId: string;
  targetType: string;
  title?: string;
  onClose: () => void;
  onConfirmRejection: (payload: RejectionPayload) => void;
  className?: string;
}

export const RejectionConfirmDialog: React.FC<RejectionConfirmDialogProps> = ({
  isOpen,
  targetId,
  targetType,
  title = "Reject / Decline Workflow Request",
  onClose,
  onConfirmRejection,
  className,
}) => {
  const [category, setCategory] = useState<string>('Outside Scope');
  const [auditNotes, setAuditNotes] = useState<string>('');
  const [rejectedByUpn, setRejectedByUpn] = useState<string>('operator@msp-portal.com');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isNotesValid = auditNotes.trim().length >= 15;

  const handleExecuteRejection = () => {
    if (!isNotesValid || isSubmitting) return;

    setIsSubmitting(true);
    setTimeout(() => {
      onConfirmRejection({
        targetId,
        targetType,
        category,
        auditNotes,
        rejectedByUpn,
      });
      setIsSubmitting(false);
      onClose();
    }, 600);
  };

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-[#06080d]/85 backdrop-blur-md p-4 animate-in fade-in duration-200", className)}>
      <div className="w-full max-w-lg rounded-2xl border border-red-500/40 bg-[#0f141c] p-6 shadow-2xl space-y-5 text-slate-100 font-sans relative">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-red-500/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{title}</span>
                <span className="text-[10px] font-mono font-extrabold uppercase px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">
                  AUDITED REFUSAL
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Target: <strong className="text-white font-mono">{targetId}</strong> ({targetType})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rejection Form Controls */}
        <div className="space-y-4">
          {/* Category Select */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-300">
              Mandatory Rejection Category <span className="text-red-400">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl bg-[#080b10] border border-[#23314a] p-2.5 text-xs text-white focus:outline-none focus:border-red-400"
            >
              <option value="Outside Scope">Outside Scope & Contract Tier</option>
              <option value="Risk Unacceptable">Risk Unacceptable / CIS Gap Created</option>
              <option value="Duplicate Request">Duplicate or Superseded Ticket</option>
              <option value="Client Cancelled">Client Explicitly Cancelled Request</option>
              <option value="Security Violation">Potential Security Violation</option>
            </select>
          </div>

          {/* Operator UPN */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-300">
              Rejecting Operator UPN
            </label>
            <input
              type="text"
              value={rejectedByUpn}
              onChange={(e) => setRejectedByUpn(e.target.value)}
              className="w-full rounded-xl bg-[#080b10] border border-[#23314a] p-2.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-red-400"
            />
          </div>

          {/* Audit Notes Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label className="font-bold text-slate-300">
                Audit Justification Notes <span className="text-red-400">*</span>
              </label>
              <span className={cn("text-[10px] font-mono", isNotesValid ? "text-emerald-400" : "text-amber-400")}>
                {auditNotes.trim().length} / 15 chars min
              </span>
            </div>
            <textarea
              rows={3}
              value={auditNotes}
              onChange={(e) => setAuditNotes(e.target.value)}
              placeholder="Provide clear technical justification for rejecting this item (e.g. Action breaches baseline policy and client has not provided signed waiver)..."
              className={cn(
                "w-full rounded-xl bg-[#080b10] border p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none",
                isNotesValid ? "border-[#23314a] focus:border-red-400" : "border-amber-500/50"
              )}
            />
          </div>

          <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/20 text-[11px] text-red-200/80 leading-normal">
            ℹ️ Rejection telemetries are emitted directly to <strong>/portal/approvals</strong>, change control logs, and synced to PSA ticket history.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleExecuteRejection}
            disabled={!isNotesValid || isSubmitting}
            className="text-xs font-bold bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
          >
            <XCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'Logging Refusal...' : 'Confirm Audited Rejection'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};

