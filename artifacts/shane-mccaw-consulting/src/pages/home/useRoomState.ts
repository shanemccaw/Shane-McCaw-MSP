/**
 * State machine for the home "room" — a direct port of the export's `DCLogic`
 * subclass, moved onto useReducer so every multi-field transition lands in one
 * commit (the export relied on React's `setState` merge for the same thing).
 *
 * Nothing here is persisted or sent anywhere: the whole conversation is local,
 * in-memory, and thrown away on reload. It exists to shape the copy the visitor
 * reads, not to profile them.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { DEFAULT_INDUSTRY, PILLARS, type ChapterId, type PillarId, type ProblemKey } from "./roomData";
import { classify } from "./roomModel";

export type ThreadEntry = { who: string; text: string; card?: undefined } | { card: "exposure"; who?: undefined };

export interface RoomState {
  active: ChapterId;
  industry: string;
  persona: string;
  problem: ProblemKey;
  problemText: string;
  assumed: boolean;
  industryPicked: boolean;
  clusters: string[];
  people: string[];
  useCases: string[];
  checks: Record<string, number>;
  typing: Record<string, boolean>;
  said: Record<string, string>;
  discoveryTyping: boolean;
  confirmed: Record<string, boolean>;
  autoSkipped: boolean;
  skipAll: boolean;
  pillarSkip: Record<string, boolean>;
  scrolledPast: Record<string, boolean>;
  drafts: Record<string, string>;
  threads: Record<string, ThreadEntry[]>;
}

const INITIAL: RoomState = {
  active: "hero",
  industry: DEFAULT_INDUSTRY,
  persona: "IT / M365 admin",
  problem: "sprawl",
  problemText: "",
  assumed: true,
  industryPicked: false,
  clusters: [],
  people: [],
  useCases: [],
  checks: {},
  typing: {},
  said: {},
  discoveryTyping: false,
  confirmed: {},
  autoSkipped: false,
  skipAll: false,
  pillarSkip: {},
  scrolledPast: {},
  drafts: {},
  threads: {},
};

export type MultiList = "clusters" | "people" | "useCases";

type Action =
  | { type: "chapter"; id: ChapterId }
  | { type: "industry"; name: string }
  | { type: "field"; field: "industry" | "persona" | "problem"; value: string }
  | { type: "draft"; field: string; value: string }
  | { type: "toggle"; list: MultiList; value: string }
  | { type: "addFree"; list: MultiList; field: string }
  | { type: "selectAll"; list: MultiList; values: string[] }
  | { type: "confirm"; key: string }
  | { type: "discoveryTyping"; on: boolean }
  | { type: "answer"; pillar: PillarId; check: string; value: number }
  | { type: "pillarTyping"; pillar: PillarId; on: boolean }
  | { type: "ask"; pillar: PillarId; text: string; entries: ThreadEntry[] }
  | { type: "pillarSkip"; pillar: PillarId }
  | { type: "skipAll" }
  | { type: "autoSkip" }
  | { type: "scrolledPast"; id: string }
  | { type: "reset" };

function reducer(s: RoomState, a: Action): RoomState {
  switch (a.type) {
    case "chapter":
      return s.active === a.id ? s : { ...s, active: a.id };

    case "industry":
      return {
        ...s,
        industry: a.name,
        industryPicked: true,
        assumed: false,
        clusters: [],
        people: [],
        useCases: [],
      };

    case "field": {
      const v = a.value.trim();
      if (!v) return s;
      const next: RoomState = { ...s, assumed: false, drafts: { ...s.drafts, [a.field]: "" } };
      if (a.field === "problem") {
        next.problem = classify(v);
        next.problemText = v;
      } else if (a.field === "industry") {
        next.industry = v;
        next.industryPicked = true;
      } else {
        next.persona = v;
      }
      return next;
    }

    case "draft":
      return { ...s, drafts: { ...s.drafts, [a.field]: a.value } };

    case "toggle": {
      const cur = s[a.list];
      const next = cur.includes(a.value) ? cur.filter((v) => v !== a.value) : cur.concat([a.value]);
      return { ...s, [a.list]: next, assumed: false };
    }

    case "addFree": {
      const v = (s.drafts[a.field] ?? "").trim();
      if (!v) return s;
      return {
        ...s,
        [a.list]: s[a.list].concat([v]),
        assumed: false,
        drafts: { ...s.drafts, [a.field]: "" },
      };
    }

    case "selectAll":
      return { ...s, [a.list]: a.values, assumed: false };

    case "confirm":
      return { ...s, confirmed: { ...s.confirmed, [a.key]: true }, assumed: false };

    case "discoveryTyping":
      return s.discoveryTyping === a.on ? s : { ...s, discoveryTyping: a.on };

    case "answer":
      return {
        ...s,
        checks: { ...s.checks, [a.check]: a.value },
        typing: { ...s.typing, [a.pillar]: true },
      };

    case "pillarTyping":
      return { ...s, typing: { ...s.typing, [a.pillar]: a.on } };

    case "ask":
      return {
        ...s,
        threads: { ...s.threads, [a.pillar]: (s.threads[a.pillar] ?? []).concat(a.entries) },
        said: { ...s.said, [a.pillar]: a.text },
        problem: classify(a.text),
        problemText: a.text,
        assumed: false,
        drafts: { ...s.drafts, [a.pillar]: "" },
      };

    case "pillarSkip":
      return s.pillarSkip[a.pillar] ? s : { ...s, pillarSkip: { ...s.pillarSkip, [a.pillar]: true } };

    case "skipAll":
      return { ...s, autoSkipped: true, skipAll: true };

    case "autoSkip":
      return s.autoSkipped ? s : { ...s, autoSkipped: true };

    case "scrolledPast":
      return s.scrolledPast[a.id] ? s : { ...s, scrolledPast: { ...s.scrolledPast, [a.id]: true } };

    case "reset":
      return { ...INITIAL, active: s.active };

    default:
      return s;
  }
}

export interface RoomActions {
  setChapter: (id: ChapterId) => void;
  pickIndustry: (name: string) => void;
  setField: (field: "industry" | "persona" | "problem", value: string) => void;
  draft: (field: string, value: string) => void;
  toggle: (list: MultiList, value: string) => void;
  addFree: (list: MultiList, field: string) => void;
  selectAll: (list: MultiList, values: string[]) => void;
  confirmStep: (key: string) => void;
  answerCheck: (pillar: PillarId, check: string, value: number) => void;
  askPillar: (pillar: PillarId, text: string) => void;
  skipPillar: (pillar: PillarId) => void;
  skipAll: () => void;
  autoSkip: () => void;
  markScrolledPast: (id: string) => void;
  reset: () => void;
}

export interface RoomLatches {
  /** Pillars whose findings have been unveiled. Once opened, a pillar stays open. */
  opened: React.MutableRefObject<Record<string, boolean>>;
  /** Pillar order, fixed at first layout — re-sorting mid-scroll teleports the reader. */
  order: React.MutableRefObject<string[] | null>;
}

export function useRoomState(): { state: RoomState; actions: RoomActions; latches: RoomLatches } {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const opened = useRef<Record<string, boolean>>({});
  const order = useRef<string[] | null>(null);
  const discoveryTimer = useRef<number | undefined>(undefined);
  const pillarTimers = useRef<Record<string, number>>({});

  useEffect(
    () => () => {
      window.clearTimeout(discoveryTimer.current);
      Object.values(pillarTimers.current).forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  /** Discovery's "Shane is typing" beat between one answer and the next question. */
  const discoveryBeat = useCallback(() => {
    window.clearTimeout(discoveryTimer.current);
    dispatch({ type: "discoveryTyping", on: true });
    discoveryTimer.current = window.setTimeout(() => dispatch({ type: "discoveryTyping", on: false }), 950);
  }, []);

  const actions = useMemo<RoomActions>(
    () => ({
      setChapter: (id) => dispatch({ type: "chapter", id }),

      pickIndustry: (name) => {
        discoveryBeat();
        dispatch({ type: "industry", name });
      },

      setField: (field, value) => dispatch({ type: "field", field, value }),
      draft: (field, value) => dispatch({ type: "draft", field, value }),
      toggle: (list, value) => dispatch({ type: "toggle", list, value }),
      addFree: (list, field) => dispatch({ type: "addFree", list, field }),
      selectAll: (list, values) => dispatch({ type: "selectAll", list, values }),

      confirmStep: (key) => {
        discoveryBeat();
        dispatch({ type: "confirm", key });
      },

      answerCheck: (pillar, check, value) => {
        dispatch({ type: "answer", pillar, check, value });
        window.clearTimeout(pillarTimers.current[pillar]);
        pillarTimers.current[pillar] = window.setTimeout(
          () => dispatch({ type: "pillarTyping", pillar, on: false }),
          1100,
        );
      },

      askPillar: (pillar, text) => {
        const t = text.trim();
        if (!t) return;

        // The governance pillar has one scripted answer: asking what Copilot would
        // actually find runs the simulation instead of returning a paragraph.
        if (
          pillar === "governance" &&
          /(what would copilot|what can copilot|actually find|actually see|actually reach|what it would see)/i.test(t)
        ) {
          dispatch({ type: "ask", pillar, text: t, entries: [{ who: "you", text: t }, { card: "exposure" }] });
          return;
        }

        const p = PILLARS.find((x) => x.id === pillar);
        if (!p) return;
        const hit = p.chips.find((c) => c[0].toLowerCase() === t.toLowerCase());
        let reply = hit ? hit[1] : null;
        if (!reply) {
          const rule = p.rules.find((r) => r[0].test(t.toLowerCase()));
          reply = rule ? rule[1] : p.fallback;
        }
        dispatch({
          type: "ask",
          pillar,
          text: t,
          entries: [
            { who: "you", text: t },
            { who: "shane", text: reply },
          ],
        });
      },

      skipPillar: (pillar) => dispatch({ type: "pillarSkip", pillar }),
      skipAll: () => dispatch({ type: "skipAll" }),
      autoSkip: () => dispatch({ type: "autoSkip" }),
      markScrolledPast: (id) => dispatch({ type: "scrolledPast", id }),

      reset: () => {
        opened.current = {};
        order.current = null;
        dispatch({ type: "reset" });
      },
    }),
    [discoveryBeat],
  );

  return { state, actions, latches: { opened, order } };
}
