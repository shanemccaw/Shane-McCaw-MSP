/**
 * PlaceholderModule — reusable stub for a real nav slot whose backend/feature
 * scope isn't defined yet (Git #4080, Feature #3768). Reuses the same
 * empty-state visual language every real module already uses for its own
 * genuine empty states (see `ScopeSla`, `Ownership`, `Sales`'s local
 * `EmptyState`), so a stub page looks like a first-class part of the console
 * rather than a different, ad-hoc "coming soon" style.
 *
 * Honest messaging only — no fabricated data, no fake functionality. Takes
 * title/description as props so the next placeholder (there will be one, per
 * the issue) reuses this instead of hand-rolling its own.
 */
import { Icon, type IconName } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";

export function PlaceholderModule({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${border.card}`,
        borderRadius: 12,
        background: surface.card,
        padding: "44px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: signal.info.tint,
          border: `1px solid ${signal.info.border}`,
          color: signal.info.strong,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={19} />
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: text.title, letterSpacing: "-.01em" }}>
        {title}
      </span>
      <span style={{ fontSize: 12.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>
        {description}
      </span>
    </div>
  );
}
