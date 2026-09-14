/**
 * Tappable follow-ups the assistant offered on its last turn (#361). Options
 * arrive as a `suggested_replies` content block; tapping one sends that exact
 * text as the next message, so a chip is a shortcut for typing.
 */
export function SuggestedReplies({
  options,
  disabled,
  onPick,
}: {
  options: string[];
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mb-[14px] flex max-w-[640px] flex-wrap gap-[7px]" data-testid="support-chat-suggested-replies">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="rounded-full text-left text-[11.5px] transition-colors disabled:cursor-default disabled:opacity-50"
          style={{ color: "#cbd5e1", border: "1px solid rgba(255,255,255,.13)", padding: "6px 12px" }}
          onMouseEnter={(e) => {
            if (disabled) return;
            e.currentTarget.style.background = "rgba(255,255,255,.05)";
            e.currentTarget.style.borderColor = "rgba(0,120,212,.45)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(255,255,255,.13)";
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
