import ServiceEditor from "./ServiceEditor";
import { Package } from "lucide-react";

interface Props {
  serviceId: number | null;
  isCreating: boolean;
  onCreated: (id: number) => void;
  onDeselect: () => void;
  allCategoryPaths: string[];
}

export default function CatalogDetailPanel({ serviceId, isCreating, onCreated, onDeselect, allCategoryPaths }: Props) {
  if (!isCreating && serviceId === null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/60 bg-background border-l border-accent">
        <Package className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm font-medium">Select a service to edit</p>
        <p className="text-xs mt-1 opacity-60">or click + New in the list panel</p>
        <p className="text-xs mt-4 opacity-40">⌘K to quick-jump</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden border-l border-accent">
      <ServiceEditor
        id={isCreating ? null : serviceId}
        panelMode
        onClose={onDeselect}
        onSaved={(id) => {
          if (isCreating) onCreated(id);
        }}
        allCategoryPaths={allCategoryPaths}
      />
    </div>
  );
}
