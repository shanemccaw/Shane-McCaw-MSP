import { useState } from "react";
import ServicesList from "@/components/services/ServicesList";
import ServiceEditor from "@/components/services/ServiceEditor";

type Mode = { kind: "list" } | { kind: "edit"; id: number } | { kind: "create" };

export default function ServicesPage() {
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  if (mode.kind === "create") {
    return (
      <ServiceEditor
        id={null}
        onClose={() => setMode({ kind: "list" })}
        onSaved={(id) => setMode({ kind: "edit", id })}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <ServiceEditor
        id={mode.id}
        onClose={() => setMode({ kind: "list" })}
        onSaved={(id) => setMode({ kind: "edit", id })}
      />
    );
  }

  return (
    <ServicesList
      onEdit={(id) => setMode({ kind: "edit", id })}
      onCreate={() => setMode({ kind: "create" })}
    />
  );
}
