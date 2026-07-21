import { useState, useEffect } from "react";

export interface HeroHeadline {
  leadText: string;
  gradientText: string;
}

const FALLBACK_HEADLINE: HeroHeadline = {
  leadText: "Your tenant has problems. ",
  gradientText: "We find them before your CEO does.",
};

const TYPE_SPEED_MS = 35;
const DELETE_SPEED_MS = 20;
const PAUSE_MS = 2500;

/**
 * Fetches admin-authored hero headlines and types/deletes/loops through them,
 * one character at a time. Falls back to a single static headline if the API
 * returns nothing (e.g. pre-migration empty table) or fails.
 */
export function useTypewriterHeadline(): {
  leadDisplayed: string;
  gradientDisplayed: string;
  headlines: HeroHeadline[];
} {
  const [headlines, setHeadlines] = useState<HeroHeadline[]>([FALLBACK_HEADLINE]);
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [phase, setPhase] = useState<"typing" | "deleting">("typing");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/hero-headlines")
      .then((r) => (r.ok ? (r.json() as Promise<HeroHeadline[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setHeadlines(data);
        }
      })
      .catch(() => {
        // keep the fallback headline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = headlines[headlineIndex % headlines.length];
  const fullText = current.leadText + current.gradientText;

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (charCount < fullText.length) {
        timeout = setTimeout(() => setCharCount((c) => c + 1), TYPE_SPEED_MS);
      } else {
        timeout = setTimeout(() => setPhase("deleting"), PAUSE_MS);
      }
    } else {
      if (charCount > 0) {
        timeout = setTimeout(() => setCharCount((c) => c - 1), DELETE_SPEED_MS);
      } else {
        setHeadlineIndex((i) => (i + 1) % headlines.length);
        setPhase("typing");
      }
    }

    return () => clearTimeout(timeout);
  }, [charCount, phase, fullText, headlines.length]);

  const typed = fullText.slice(0, charCount);
  return {
    leadDisplayed: typed.slice(0, current.leadText.length),
    gradientDisplayed: typed.slice(current.leadText.length),
    headlines,
  };
}
