import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { JsonViewerContent } from "./JsonViewer";

interface JsonViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialJson?: unknown;
  title?: string;
}

export function JsonViewerDialog({ open, onOpenChange, initialJson, title }: JsonViewerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl w-[90vw] p-0 flex flex-col gap-0 bg-[#0D1117] border-[#30363D]"
        style={{ height: "82vh", maxHeight: "82vh" }}
      >
        <DialogHeader className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-[#21262D]">
          <DialogTitle className="text-sm font-semibold text-[#E6EDF3] font-mono">
            {title ?? "JSON Viewer"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden" key={JSON.stringify(initialJson)}>
          <JsonViewerContent initialJson={initialJson} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
