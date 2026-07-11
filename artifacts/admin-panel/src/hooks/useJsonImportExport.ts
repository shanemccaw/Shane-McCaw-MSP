import { useRef } from "react";

export function useJsonImportExport() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function importJson(onRecords: (records: unknown[]) => void) {
    if (!fileInputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      fileInputRef.current = input;
    }
    const input = fileInputRef.current;
    input.value = "";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as unknown;
          if (!Array.isArray(parsed)) {
            throw new Error("JSON must be an array of records");
          }
          onRecords(parsed);
        } catch (err) {
          onRecords([{ __parseError: err instanceof Error ? err.message : "Invalid JSON" }]);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  return { exportJson, downloadTemplate, importJson };
}
