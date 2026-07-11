import { useState, useEffect } from "react";
import { useServices, useReparentCategory } from "@/hooks/useServices";
import CatalogCategoryTree from "@/components/services/CatalogCategoryTree";
import CatalogProductList from "@/components/services/CatalogProductList";
import CatalogDetailPanel from "@/components/services/CatalogDetailPanel";
import CatalogQuickJump from "@/components/services/CatalogQuickJump";

export default function ServicesPage() {
  const { data: services = [], isLoading } = useServices();
  const reparentMutation = useReparentCategory();
  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [cmdKOpen, setCmdKOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdKOpen(o => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allCategoryPaths = [...new Set(
    services.map(s => s.categoryPath ?? s.category).filter(Boolean) as string[]
  )].sort();

  function handleReparentCategory(fromPath: string, toParentPath: string | null) {
    const lastName = fromPath.includes("/") ? fromPath.split("/").pop()! : fromPath;
    const newPath = toParentPath ? `${toParentPath}/${lastName}` : lastName;
    reparentMutation.mutate(
      { fromPath, toParentPath },
      {
        onSuccess: () => {
          if (selectedCategoryPath === fromPath || selectedCategoryPath?.startsWith(fromPath + "/")) {
            setSelectedCategoryPath(
              selectedCategoryPath === fromPath
                ? newPath
                : newPath + selectedCategoryPath.slice(fromPath.length),
            );
          }
        },
      },
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <CatalogCategoryTree
        services={services}
        selectedPath={selectedCategoryPath}
        onSelect={(path) => {
          setSelectedCategoryPath(path);
          setSelectedServiceId(null);
          setIsCreating(false);
        }}
        onReparentCategory={handleReparentCategory}
        reparenting={reparentMutation.isPending}
      />
      <CatalogProductList
        services={services}
        isLoading={isLoading}
        categoryPath={selectedCategoryPath}
        selectedId={selectedServiceId}
        onSelect={(id) => {
          setSelectedServiceId(id);
          setIsCreating(false);
        }}
        onCreateNew={() => {
          setSelectedServiceId(null);
          setIsCreating(true);
        }}
      />
      <CatalogDetailPanel
        serviceId={isCreating ? null : selectedServiceId}
        isCreating={isCreating}
        onCreated={(id) => {
          setSelectedServiceId(id);
          setIsCreating(false);
        }}
        onDeselect={() => {
          setSelectedServiceId(null);
          setIsCreating(false);
        }}
        allCategoryPaths={allCategoryPaths}
      />
      <CatalogQuickJump
        open={cmdKOpen}
        onClose={() => setCmdKOpen(false)}
        services={services}
        onSelect={(id, categoryPath) => {
          setSelectedCategoryPath(categoryPath);
          setSelectedServiceId(id);
          setIsCreating(false);
          setCmdKOpen(false);
        }}
      />
    </div>
  );
}
