import { border, surface, text } from "./tokens";

export function StatusBar({ left, right }: { left: string; right: string }) {
  return (
    <div
      style={{
        flex: "0 0 auto", display: "flex", alignItems: "center", gap: 16, height: 28,
        padding: "0 20px", borderTop: `1px solid ${border.soft}`, background: surface.breadcrumb,
        fontSize: 11, color: text.label, overflow: "hidden",
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{left}</span>
      <div style={{ flex: 1 }} />
      <span style={{ whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}
