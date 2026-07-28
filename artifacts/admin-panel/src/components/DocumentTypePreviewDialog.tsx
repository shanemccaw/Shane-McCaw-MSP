import { X, Sparkles } from "lucide-react";
import DocumentTypePreviewContent, { type DocumentTypePreviewData } from "./DocumentTypePreviewContent";

interface DocumentTypePreviewDialogProps {
  onClose: () => void;
  docTypeLabel: string;
  preview: DocumentTypePreviewData;
}

export default function DocumentTypePreviewDialog({ onClose, docTypeLabel, preview }: DocumentTypePreviewDialogProps) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-background border border-gray-700/50 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <div>
              <div className="text-white font-semibold text-sm">Document Preview</div>
              <div className="text-gray-500 text-xs mt-0.5">{docTypeLabel} — real scoped data, no document generated</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          <DocumentTypePreviewContent docTypeLabel={docTypeLabel} preview={preview} />
        </div>
      </div>
    </div>
  );
}
