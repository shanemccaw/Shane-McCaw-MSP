import { useState, useCallback } from "react";

export function useJsonImportExport() {
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  function exportJson(filename: string, data: unknown[]) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate(filename: string, template: unknown) {
    exportJson(filename, [template]);
  }

  const openImportDialog = useCallback(() => {
    setImportDialogOpen(true);
  }, []);

  const closeImportDialog = useCallback(() => {
    setImportDialogOpen(false);
  }, []);

  return {
    exportJson,
    downloadTemplate,
    openImportDialog,
    importDialogOpen,
    closeImportDialog,
  };
}
