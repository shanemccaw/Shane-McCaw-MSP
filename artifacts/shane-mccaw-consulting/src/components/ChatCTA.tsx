import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { openChat } from "@/lib/chat";
import { cn } from "@/lib/utils";

interface ChatCTAProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  children: ReactNode;
}

/**
 * A call-to-action that opens the site's AI assistant chat bubble instead of
 * navigating. Renders as an anchor with role="button" so every existing
 * link-targeted style class applies unchanged — a drop-in replacement for the old
 * anchor/Link CTAs that used to point at the contact form and booking-calendar
 * pages, now that the public site's only front door is the chat bubble.
 */
export function ChatCTA({ children, className, onClick, onKeyDown, ...rest }: ChatCTAProps) {
  return (
    <a
      role="button"
      tabIndex={0}
      className={cn("cursor-pointer", className)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        openChat();
        onClick?.(e);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLAnchorElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openChat();
        }
        onKeyDown?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
