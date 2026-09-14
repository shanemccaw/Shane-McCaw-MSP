export function TypingIndicator() {
  return (
    <div className="flex items-center gap-[5px] px-[2px] py-1" data-testid="support-chat-typing">
      <span className="size-[5px] animate-dot-pulse rounded-full" style={{ background: "#64748b" }} />
      <span className="size-[5px] animate-dot-pulse rounded-full [animation-delay:.2s]" style={{ background: "#64748b" }} />
      <span className="size-[5px] animate-dot-pulse rounded-full [animation-delay:.4s]" style={{ background: "#64748b" }} />
    </div>
  );
}
