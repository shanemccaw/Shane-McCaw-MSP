import { Button } from "@/components/ui/button";

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
    <div className="mb-4 ml-9 flex flex-wrap gap-2" data-testid="support-chat-suggested-replies">
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          variant="outline"
          size="sm"
          className="h-auto whitespace-normal rounded-full px-3 py-1.5 text-left text-xs font-normal"
          disabled={disabled}
          onClick={() => onPick(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
