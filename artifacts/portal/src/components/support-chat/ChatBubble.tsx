import { Bot, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
    <div className={cn("mb-4 flex items-end gap-2", !isAssistant && "flex-row-reverse")}>
      <Avatar className="size-7 shrink-0">
        <AvatarFallback className={isAssistant ? "bg-primary text-primary-foreground" : undefined}>
          {isAssistant ? <Bot className="size-4" /> : <User className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn("flex max-w-[85%] flex-col gap-2", !isAssistant && "items-end")}>
        <div
          className={cn(
            "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isAssistant
              ? "rounded-bl-sm border border-border bg-card text-card-foreground"
              : "rounded-br-sm bg-primary text-primary-foreground",
          )}
          data-testid={latest && isAssistant ? "support-chat-latest-reply" : undefined}
        >
          {contentToText(message.content)}
        </div>
        {card && <ActiveCard card={card} />}
      </div>
    </div>
  );
}
