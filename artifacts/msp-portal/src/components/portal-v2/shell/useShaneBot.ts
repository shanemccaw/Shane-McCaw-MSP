/**
 * useShaneBot.ts — ShaneBot's client state: the thread, the typing delay, the
 * escalated flag, and the `askShane` entry point the palette, the selection chip
 * and the ⌘K handler all call.
 *
 * The reply and the Active Card are the prototype's scripted fixtures
 * (`shaneBotData.ts`); grounding them against real telemetry is a later
 * architecture task per the handoff README. `sbSend` mirrors the prototype's own
 * 1,300ms "Checking your tenant…" delay (shell 7517-7524) and flips the thread
 * to escalated once a ticket card is returned.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  SB_INITIAL_MESSAGES,
  sbReplyFor,
  type SbMessage,
} from "./shaneBotData";

/** The prototype's typing delay before a reply lands — shell 7518. */
const SB_REPLY_DELAY_MS = 1300;

export interface ShaneBotApi {
  readonly open: boolean;
  readonly messages: readonly SbMessage[];
  readonly input: string;
  readonly typing: boolean;
  readonly escalated: boolean;
  readonly contextOpen: boolean;
  setInput(v: string): void;
  send(text?: string): void;
  /** Open the panel and ask a question — shell 8270. */
  askShane(topic: string): void;
  toggle(): void;
  close(): void;
  dismissContext(): void;
}

export function useShaneBot(): ShaneBotApi {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<readonly SbMessage[]>(SB_INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const send = useCallback((text?: string) => {
    setInput((current) => {
      const t = (text ?? current).trim();
      if (!t) return current;
      const reply = sbReplyFor(t);
      setMessages((prev) => [...prev, { who: "you", text: t }]);
      setTyping(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setTyping(false);
        if (reply.card.kind === "ticket") setEscalated(true);
        setMessages((prev) => [...prev, { who: "bot", text: reply.text, card: reply.card }]);
      }, SB_REPLY_DELAY_MS);
      return "";
    });
  }, []);

  const askShane = useCallback(
    (topic: string) => {
      setOpen(true);
      send(topic);
    },
    [send],
  );

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const dismissContext = useCallback(() => setContextOpen(false), []);

  return {
    open,
    messages,
    input,
    typing,
    escalated,
    contextOpen,
    setInput,
    send,
    askShane,
    toggle,
    close,
    dismissContext,
  };
}
