import type { ChatCardBlock } from "@/lib/chat-content-blocks";
import { InvoiceCard } from "./InvoiceCard";
import { SubscriptionCard } from "./SubscriptionCard";
import { ScoreCard } from "./ScoreCard";
import { DataAnswerCard } from "./DataAnswerCard";
import {
  asInvoiceCardData,
  asSubscriptionCardData,
  asScoreCardData,
  asDataAnswerCardData,
} from "./types";

/**
 * Active Cards (#366) dispatcher — the four real, live card types
 * (`shanebot-engine.ts`'s `BotCardType`; contract pack §1). Whether a card
 * arrives on a given turn is a live per-turn model judgment (contract pack
 * §8) — the common case is NO card block at all, which the caller (ChatBubble)
 * already handles by simply not rendering this component. This only decides
 * what to do with an actual `card` block once one has arrived.
 *
 * An unrecognized `cardType` (a hallucinated or not-yet-built type — the
 * contract pack's five NEW types are out of scope for #2519) or a `data`
 * payload that fails its own shape guard renders nothing — same "no
 * fixture-as-fallback" honesty the server already enforces for a card with no
 * real backing data.
 */
export function ActiveCard({ card }: { card: ChatCardBlock }) {
  switch (card.cardType) {
    case "invoice": {
      const data = asInvoiceCardData(card.data);
      return data ? <InvoiceCard data={data} /> : null;
    }
    case "subscription": {
      const data = asSubscriptionCardData(card.data);
      return data ? <SubscriptionCard data={data} /> : null;
    }
    case "score": {
      const data = asScoreCardData(card.data);
      return data ? <ScoreCard data={data} /> : null;
    }
    case "data-answer": {
      const data = asDataAnswerCardData(card.data);
      return data ? <DataAnswerCard data={data} /> : null;
    }
    default:
      return null;
  }
}
