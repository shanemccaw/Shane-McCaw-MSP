import { cn } from "@/lib/utils";
import { contentToText, cardFrom, type ChatMessageContent } from "@/lib/chat-content-blocks";
import { ActiveCard } from "./cards/ActiveCard";

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatMessageContent;
}

export function ChatBubble({
  message,
  latest = false,
}: {
  message: ChatMessage;
  /** The newest assistant turn carries the manifest's stable selector hook. */
  latest?: boolean;
}) {
  const isAssistant = message.role === "assistant";
  const card = isAssistant ? cardFrom(message.content) : null;

  return (
    <div className={cn("mb-[14px] flex flex-col gap-[9px]", isAssistant ? "items-start" : "items-end")}>
      <div
        className={cn(
          "whitespace-pre-wrap text-[13px] leading-[1.6]",
          isAssistant ? "max-w-[620px] rounded-[12px_12px_12px_3px]" : "max-w-[76%] rounded-[12px_12px_3px_12px]",
        )}
        style={{
          padding: "10px 14px",
          background: isAssistant ? "rgba(255,255,255,.03)" : "rgba(0,120,212,.14)",
          border: `1px solid ${isAssistant ? "rgba(255,255,255,.08)" : "rgba(0,120,212,.32)"}`,
          color: isAssistant ? "#cbd5e1" : "#e2e8f0",
        }}
        data-testid={latest && isAssistant ? "support-chat-latest-reply" : undefined}
      >
        {contentToText(message.content)}
      </div>
      {card && <ActiveCard card={card} />}
    </div>
  );
}
