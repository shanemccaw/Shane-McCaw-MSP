/**
 * KnowledgeBaseOverlay.tsx — the "?" help overlay, drawn to the prototype markup
 * (Customer Portal Shell.dc.html 4007-4104) and derivation (20023-20093).
 *
 * A right slide-out with two modes: BROWSE (a "For the page you are on" feature,
 * category groups, an Ask-Shane fall-through) and READ (an article: category,
 * title, summary, body sections, "Do it now" actions, an "Open <page>" deep link
 * and related articles). Content is `kbData.ts` — 22 articles across 8
 * categories, the prototype's verbatim copy. Actions and page links resolve
 * through `kbActionHref` / `kbPageHref`; a button whose target route is not built
 * yet is simply not drawn, so every button that renders goes somewhere real.
 */

import { useEffect, useMemo, useState } from "react";

import type { NewCreateKind } from "../newMenuCreate";
import {
  KB_ARTICLES,
  KB_CATS,
  kbActionCreateKind,
  kbActionHref,
  kbCatLabel,
  kbPageHref,
  kbPageKeyForRoute,
  kbPageName,
  kbSearch,
  type KbArticle,
} from "./kbData";

export function KnowledgeBaseOverlay({
  open,
  seedArticleId,
  location,
  onClose,
  onNavigate,
  onCreate,
  onAsk,
}: {
  open: boolean;
  /** The article to open on mount (palette KB row); null opens the browse view. */
  seedArticleId: string | null;
  location: string;
  onClose: () => void;
  onNavigate: (href: string) => void;
  /** Opens the real create form (the same one the shell's New menu opens) for
   *  actions that raise/log something rather than merely navigate. */
  onCreate: (kind: NewCreateKind) => void;
  onAsk: (query: string) => void;
}) {
  const [articleId, setArticleId] = useState<string | null>(seedArticleId);
  const [query, setQuery] = useState("");

  // Seed the reading/browse state each time the overlay opens.
  useEffect(() => {
    if (open) {
      setArticleId(seedArticleId);
      setQuery("");
    }
  }, [open, seedArticleId]);

  const article = useMemo(() => KB_ARTICLES.find((a) => a.id === articleId) ?? null, [articleId]);
  const matches = useMemo(() => kbSearch(KB_ARTICLES, query), [query]);
  const pageKey = useMemo(() => kbPageKeyForRoute(location), [location]);
  const pageArticle = useMemo(
    () => (pageKey ? KB_ARTICLES.find((a) => a.page === pageKey) ?? null : null),
    [pageKey],
  );

  if (!open) return null;

  const reading = !!article;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(2,6,23,.6)" }} />
      <div
        data-testid="pv2-kb-overlay"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 131,
          width: "min(620px,97vw)",
          display: "flex",
          flexDirection: "column",
          background: "#0b1524",
          borderLeft: "1px solid rgba(148,163,184,.2)",
          boxShadow: "-28px 0 70px rgba(2,6,23,.7)",
        }}
      >
        {/* Header */}
        <div
          style={{
            flex: "0 0 auto",
            padding: "15px 20px 13px",
            borderBottom: "1px solid rgba(30,41,59,.9)",
            display: "flex",
            flexDirection: "column",
            gap: 11,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: "9.5px", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", color: "#64748b" }}>
              Knowledge base
            </span>
            <button
              onClick={onClose}
              data-testid="pv2-kb-close"
              style={{ flex: "0 0 auto", width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#94a3b8", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
            >
              ×
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setArticleId(null);
            }}
            data-testid="pv2-kb-search"
            placeholder="Search the knowledge base"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,.22)",
              background: "#0b1a2e",
              color: "#e2e8f0",
              fontSize: "12.5px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </div>

        {reading ? (
          <ReadingView
            article={article!}
            onBack={() => setArticleId(null)}
            onOpenRelated={setArticleId}
            onNavigate={onNavigate}
            onCreate={onCreate}
            onClose={onClose}
          />
        ) : (
          <BrowseView
            matches={matches}
            pageArticle={query.trim() ? null : pageArticle}
            onOpenArticle={setArticleId}
            onAsk={() => {
              onClose();
              onAsk(`Explain this page to me: ${pageKey ?? "the portal"}`);
            }}
          />
        )}
      </div>
    </>
  );
}

function BrowseView({
  matches,
  pageArticle,
  onOpenArticle,
  onAsk,
}: {
  matches: readonly KbArticle[];
  pageArticle: KbArticle | null;
  onOpenArticle: (id: string) => void;
  onAsk: () => void;
}) {
  const groups = KB_CATS.map((c) => ({
    label: c.label,
    items: matches.filter((a) => a.cat === c.k),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 20px 30px", display: "flex", flexDirection: "column", gap: 16 }}>
      {pageArticle && (
        <button
          onClick={() => onOpenArticle(pageArticle.id)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "13px 15px",
            borderRadius: 11,
            border: "1px solid rgba(0,120,212,.4)",
            background: "linear-gradient(160deg,rgba(0,120,212,.12),rgba(15,23,42,.5))",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            width: "100%",
          }}
        >
          <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#60a5fa" }}>
            For the page you are on
          </span>
          <span style={{ fontSize: "13.5px", fontWeight: 800, color: "#f8fafc" }}>{pageArticle.title}</span>
          <span style={{ fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.5 }}>{pageArticle.summary}</span>
        </button>
      )}

      {groups.map((g) => (
        <div key={g.label} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#475569" }}>
            {g.label}
          </span>
          {g.items.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenArticle(a.id)}
              data-testid="pv2-kb-article-row"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "10px 12px",
                borderRadius: 9,
                border: "1px solid rgba(148,163,184,.14)",
                background: "rgba(15,23,42,.4)",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.4 }}>{a.title}</span>
              <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>{a.summary}</span>
            </button>
          ))}
        </div>
      ))}

      {matches.length === 0 && (
        <span style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
          Nothing matches that. Try the thing you are trying to do rather than what it is called.
        </span>
      )}

      <button
        onClick={onAsk}
        style={{
          alignSelf: "flex-start",
          padding: "9px 14px",
          borderRadius: 7,
          border: "1px solid rgba(0,180,216,.4)",
          background: "rgba(0,180,216,.1)",
          color: "#22d3ee",
          fontSize: "12px",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Ask Shane instead
      </button>
    </div>
  );
}

function ReadingView({
  article,
  onBack,
  onOpenRelated,
  onNavigate,
  onCreate,
  onClose,
}: {
  article: KbArticle;
  onBack: () => void;
  onOpenRelated: (id: string) => void;
  onNavigate: (href: string) => void;
  onCreate: (kind: NewCreateKind) => void;
  onClose: () => void;
}) {
  const actions = (article.actions ?? [])
    .map((a) => ({ ...a, href: kbActionHref(a.act), createKind: kbActionCreateKind(a.act) }))
    .filter((a) => a.href !== null || a.createKind !== null);
  const pageHref = kbPageHref(article.page);
  const related = (article.related ?? [])
    .map((id) => KB_ARTICLES.find((x) => x.id === id))
    .filter((a): a is KbArticle => Boolean(a));

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px 30px", display: "flex", flexDirection: "column", gap: 16 }}>
      <button
        onClick={onBack}
        style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "11.5px", fontWeight: 600, color: "#64748b", fontFamily: "inherit" }}
      >
        ← All articles
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#60a5fa" }}>
          {kbCatLabel(article.cat)}
        </span>
        <span style={{ fontSize: "19px", fontWeight: 800, color: "#f8fafc", letterSpacing: "-.015em", lineHeight: 1.3 }}>{article.title}</span>
        <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.6 }}>{article.summary}</span>
      </div>

      {article.body.map((b, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: "12.5px", fontWeight: 800, color: "#e2e8f0", letterSpacing: "-.005em" }}>{b.h}</span>
          {b.p && <span style={{ fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.75 }}>{b.p}</span>}
          {b.steps && b.steps.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {b.steps.map((t, j) => (
                <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span
                    style={{
                      flex: "0 0 19px",
                      height: 19,
                      borderRadius: 5,
                      background: "rgba(0,120,212,.16)",
                      border: "1px solid rgba(0,120,212,.35)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: 800,
                      color: "#93c5fd",
                      fontFamily: "'SF Mono',Menlo,Consolas,monospace",
                    }}
                  >
                    {j + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: "12.5px", color: "#cbd5e1", lineHeight: 1.65 }}>{t}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {actions.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "13px 15px",
            borderRadius: 11,
            border: "1px solid rgba(0,120,212,.32)",
            background: "linear-gradient(160deg,rgba(0,120,212,.09),rgba(15,23,42,.5))",
          }}
        >
          <span style={{ fontSize: "9px", fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "#60a5fa" }}>
            Do it now
          </span>
          {actions.map((ac, i) => (
            <button
              key={i}
              data-testid={`pv2-kb-action-${ac.act}`}
              onClick={() => {
                onClose();
                if (ac.createKind) {
                  onCreate(ac.createKind);
                } else {
                  onNavigate(ac.href!);
                }
              }}
              style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", borderRadius: 9, border: "1px solid rgba(0,120,212,.35)", background: "rgba(0,120,212,.1)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
            >
              <span style={{ flex: "0 0 22px", width: 22, height: 22, borderRadius: 6, background: "rgba(0,120,212,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 800, color: "#93c5fd" }}>
                →
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#93c5fd", lineHeight: 1.4 }}>{ac.label}</span>
                <span style={{ fontSize: "11px", color: "#94a3b8", lineHeight: 1.45 }}>{ac.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {pageHref && (
        <button
          onClick={() => {
            onClose();
            onNavigate(pageHref);
          }}
          style={{ alignSelf: "flex-start", padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(0,120,212,.45)", background: "rgba(0,120,212,.12)", color: "#93c5fd", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
        >
          Open {kbPageName(article.page ?? "") ?? "the page"}
        </button>
      )}

      {related.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 13, borderTop: "1px solid rgba(30,41,59,.9)" }}>
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#475569" }}>Related</span>
          {related.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenRelated(a.id)}
              style={{ display: "flex", flexDirection: "column", gap: 1, padding: "9px 11px", borderRadius: 8, border: "1px solid rgba(148,163,184,.16)", background: "rgba(15,23,42,.4)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
            >
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>{a.title}</span>
              <span style={{ fontSize: "10.5px", color: "#64748b", lineHeight: 1.45 }}>{a.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
