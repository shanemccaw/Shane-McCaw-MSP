/**
 * useQuizCatalog.ts
 *
 * Loads one industry's DB-backed quiz catalog (#271, Copilot Assessment epic
 * #183) and hands QuizScreen the four levels it renders.
 *
 * The fetch is keyed on the industry answer, which is a quiz answer rather than
 * page state — that is why this lives beside QuizScreen instead of in
 * copilot-assessment.tsx with the page's other fetches. Industry is question 2
 * of 14, so the catalog for questions 3, 4, 5 and 12 is already in hand well
 * before the customer reaches them.
 *
 * Never returns an empty catalog while an industry is selected: resolveQuizCatalog
 * falls back per level to the static content, so a pending fetch, a failed one,
 * or tables Shane has not populated yet all still render a usable quiz. `sources`
 * says which copy each level came from.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  fetchQuizCatalog,
  resolveQuizCatalog,
  type QuizCatalogPayload,
  type ResolvedQuizCatalog,
} from './quizCatalogClient';

export interface UseQuizCatalogResult extends ResolvedQuizCatalog {
  /** True while a fetch for the current industry is outstanding. */
  isLoading: boolean;
}

export function useQuizCatalog(industry: string): UseQuizCatalogResult {
  const { fetchWithAuth } = useAuth();
  const [payload, setPayload] = useState<QuizCatalogPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Which industry the held payload belongs to. Without this, switching industry
  // would keep rendering the previous industry's tiles until the new fetch
  // lands — the wrong personas for the answer already given.
  const loadedIndustry = useRef<string>('');

  useEffect(() => {
    if (!industry) {
      setPayload(null);
      loadedIndustry.current = '';
      return;
    }
    if (loadedIndustry.current === industry) return;

    let cancelled = false;
    setIsLoading(true);
    // Cleared, not left stale: until the new industry's catalog arrives the
    // static fallback for THAT industry is the honest thing to show.
    setPayload(null);
    loadedIndustry.current = industry;

    void fetchQuizCatalog(fetchWithAuth, industry).then((result) => {
      if (cancelled) return;
      setPayload(result);
      setIsLoading(false);
      if (!result) {
        console.warn(`[quiz-catalog] no catalog for "${industry}" — rendering the built-in fallback content`);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [industry, fetchWithAuth]);

  return useMemo(() => {
    const resolved = resolveQuizCatalog(payload, industry);
    return { ...resolved, isLoading };
  }, [payload, industry, isLoading]);
}
