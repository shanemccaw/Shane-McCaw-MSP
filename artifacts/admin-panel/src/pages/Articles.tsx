import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";

interface Article {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  content: string;
  isPublished: boolean;
}

interface ShareCounts {
  [slug: string]: { linkedin: number; x: number; total: number };
}
interface ShareData { counts: ShareCounts; total: number; }

const EMPTY_ARTICLE: Article = { slug: "", category: "", title: "", summary: "", date: "", content: "", isPublished: true };

function autoSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

export default function ArticlesPage() {
  const { fetchWithAuth } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "drafts" | "edit" | "shares">("list");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<Article>(EMPTY_ARTICLE);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/articles");
      if (!res.ok) { toast({ title: "Could not load articles", variant: "destructive" }); return; }
      setArticles(await res.json() as Article[]);
    } catch {
      toast({ title: "Could not reach the API server", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  const fetchShares = useCallback(async () => {
    setSharesLoading(true);
    try {
      const res = await fetchWithAuth("/api/shares");
      if (!res.ok) { toast({ title: "Could not load share analytics", variant: "destructive" }); return; }
      setShareData(await res.json() as ShareData);
    } catch {
      toast({ title: "Could not reach the API server", variant: "destructive" });
    } finally {
      setSharesLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void fetchArticles(); }, [fetchArticles]);

  const published = articles.filter(a => a.isPublished);
  const drafts = articles.filter(a => !a.isPublished);

  function openNew() { setForm(EMPTY_ARTICLE); setEditingSlug(null); setView("edit"); }
  function openEdit(a: Article) { setForm({ ...a }); setEditingSlug(a.slug); setView("edit"); }
  function cancelEdit() { setView("list"); setForm(EMPTY_ARTICLE); setEditingSlug(null); }
  function setField(key: keyof Article, value: string) { setForm(p => ({ ...p, [key]: value })); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.slug || !form.title || !form.date) {
      toast({ title: "Slug, title, and date are required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const isNew = editingSlug === null;
      const url = isNew ? "/api/admin/articles" : `/api/admin/articles/${editingSlug}`;
      const res = await fetchWithAuth(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(form) });
      const body = await res.json() as { error?: string };
      if (!res.ok) { toast({ title: body.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: isNew ? "Article created" : "Article saved" });
      setView("list"); setForm(EMPTY_ARTICLE); setEditingSlug(null);
      await fetchArticles();
    } finally { setSaving(false); }
  }

  async function handleDelete(slug: string) {
    try {
      const res = await fetchWithAuth(`/api/admin/articles/${slug}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({ title: body.error ?? "Delete failed", variant: "destructive" }); return;
      }
      toast({ title: "Article deleted" }); setDeleteTarget(null); await fetchArticles();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  async function handleApprove(slug: string) {
    setActionLoading(slug);
    try {
      const res = await fetchWithAuth(`/api/admin/articles/${slug}/publish`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({ title: body.error ?? "Publish failed", variant: "destructive" }); return;
      }
      toast({ title: "Article published to the site" });
      await fetchArticles();
      if (drafts.length <= 1) setView("list");
    } catch { toast({ title: "Publish failed", variant: "destructive" });
    } finally { setActionLoading(null); }
  }

  async function handleDiscard(slug: string) {
    setActionLoading(slug);
    try {
      const res = await fetchWithAuth(`/api/admin/articles/${slug}/discard`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({ title: body.error ?? "Discard failed", variant: "destructive" }); return;
      }
      toast({ title: "Draft discarded" });
      await fetchArticles();
      if (drafts.length <= 1) setView("list");
    } catch { toast({ title: "Discard failed", variant: "destructive" });
    } finally { setActionLoading(null); }
  }

  const tabs = [
    { key: "list",   label: "Published",  count: published.length },
    { key: "drafts", label: "Drafts",      count: drafts.length, badge: drafts.length > 0 },
    { key: "shares", label: "Analytics",   count: null },
  ] as const;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      {view !== "edit" && (
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-[#E6EDF3]">Articles</h1>
            <div className="flex items-center gap-1 bg-[#1C2128] rounded-lg p-1">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setView(tab.key as typeof view); if (tab.key === "shares") void fetchShares(); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${view === tab.key ? "bg-[#161B22] shadow-sm text-[#E6EDF3]" : "text-[#7D8590] hover:text-[#C9D1D9]"}`}
                >
                  {tab.label}
                  {"badge" in tab && tab.badge ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold leading-none">{tab.count}</span>
                  ) : tab.count !== null ? (
                    <span className="text-[#484F58] text-[10px]">{tab.count}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          {view === "list" && (
            <button
              onClick={openNew}
              className="bg-[#0078D4] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#006CBE] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Article
            </button>
          )}
          {view === "shares" && (
            <button onClick={() => void fetchShares()} className="text-xs text-[#0078D4] hover:underline font-medium">Refresh</button>
          )}
        </div>
      )}

      {/* Drafts view */}
      {view === "drafts" && (
        <>
          {loading ? (
            <div className="text-center py-16 text-[#7D8590]">Loading drafts…</div>
          ) : drafts.length === 0 ? (
            <div className="text-center py-16 bg-[#161B22] rounded-xl border border-[#30363D]">
              <p className="text-[#7D8590]">No pending drafts.</p>
              <p className="text-xs text-[#7D8590] mt-2">AI-generated articles land here for review before going live.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {drafts.map(article => (
                <div key={article.slug} className="bg-[#1C2128] rounded-xl border border-amber-500/30 p-4 sm:p-5">
                  <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-block text-xs font-semibold text-amber-400 bg-amber-400/10 rounded-full px-2 py-0.5">Draft</span>
                        {article.category && (
                          <span className="inline-block text-xs font-medium text-[#0078D4] bg-[#0078D4]/10 rounded-full px-2 py-0.5">{article.category}</span>
                        )}
                      </div>
                      <h3 className="font-semibold text-[#E6EDF3] text-sm leading-snug mb-1">{article.title}</h3>
                      <p className="text-xs text-[#7D8590] line-clamp-2">{article.summary}</p>
                      <p className="text-xs text-[#7D8590] mt-1">{article.date} · <span className="font-mono">{article.slug}</span></p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap w-full sm:w-auto">
                      <button
                        onClick={() => openEdit(article)}
                        className="text-xs bg-[#161B22] hover:bg-[#30363D] text-[#C9D1D9] px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >Edit</button>
                      <button
                        onClick={() => void handleApprove(article.slug)}
                        disabled={actionLoading === article.slug}
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-60"
                      >{actionLoading === article.slug ? "Publishing…" : "Approve"}</button>
                      <button
                        onClick={() => void handleDiscard(article.slug)}
                        disabled={actionLoading === article.slug}
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-60"
                      >Discard</button>
                    </div>
                  </div>
                  {/* Content preview */}
                  <div className="mt-3 pt-3 border-t border-[#30363D]">
                    <p className="text-xs text-[#7D8590] font-mono line-clamp-3 whitespace-pre-wrap leading-relaxed">{article.content.slice(0, 300)}{article.content.length > 300 ? "…" : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Shares view */}
      {view === "shares" && (
        <>
          {sharesLoading ? (
            <div className="text-center py-16 text-[#7D8590]">Loading share data…</div>
          ) : !shareData || Object.keys(shareData.counts).length === 0 ? (
            <div className="text-center py-16 bg-[#161B22] rounded-xl border border-[#30363D]">
              <p className="text-[#7D8590]">No shares recorded yet.</p>
              <p className="text-xs text-[#7D8590] mt-2">Share events appear here as readers click the LinkedIn and X buttons on article cards.</p>
            </div>
          ) : (
            <div className="bg-[#161B22] rounded-xl border border-[#30363D] overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-[#161B22] border-b border-[#30363D]">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wide">Article</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wide">
                      <span className="flex items-center justify-center gap-1.5"><FaLinkedin className="w-3.5 h-3.5 text-[#0A66C2]" /> LinkedIn</span>
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wide">
                      <span className="flex items-center justify-center gap-1.5"><FaXTwitter className="w-3.5 h-3.5" /> X</span>
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-[#7D8590] uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363D]">
                  {Object.entries(shareData.counts)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([slug, counts]) => {
                      const article = articles.find(a => a.slug === slug);
                      return (
                        <tr key={slug} className="hover:bg-[#1C2128]">
                          <td className="px-5 py-4">
                            <p className="font-medium text-[#E6EDF3] text-sm">{article?.title ?? slug}</p>
                            <p className="text-xs text-[#7D8590] font-mono mt-0.5">{slug}</p>
                          </td>
                          <td className="px-4 py-4 text-center"><span className="text-sm font-semibold text-[#0A66C2]">{counts.linkedin}</span></td>
                          <td className="px-4 py-4 text-center"><span className="text-sm font-semibold">{counts.x}</span></td>
                          <td className="px-4 py-4 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-sm font-bold">{counts.total}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Published list view */}
      {view === "list" && (
        <>
          {loading ? (
            <div className="text-center py-16 text-[#7D8590]">Loading articles…</div>
          ) : published.length === 0 ? (
            <div className="text-center py-16 bg-[#161B22] rounded-xl border border-[#30363D]">
              <p className="text-[#7D8590] mb-4">No published articles yet.</p>
              <button onClick={openNew} className="text-[#0078D4] font-medium text-sm hover:underline">Create your first article</button>
            </div>
          ) : (
            <div className="space-y-3">
              {published.map(article => (
                <div key={article.slug} className="bg-[#161B22] rounded-xl border border-[#30363D] p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-start justify-between gap-3 hover:border-[#30363D] transition-colors">
                  <div className="min-w-0 flex-1">
                    {article.category && (
                      <span className="inline-block text-xs font-medium text-[#0078D4] bg-[#0078D4]/10 rounded-full px-2 py-0.5 mb-2">{article.category}</span>
                    )}
                    <h3 className="font-semibold text-[#E6EDF3] text-sm leading-snug mb-1">{article.title}</h3>
                    <p className="text-xs text-[#7D8590] truncate">{article.summary}</p>
                    <p className="text-xs text-[#7D8590] mt-1">{article.date} · <span className="font-mono">{article.slug}</span></p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap w-full sm:w-auto">
                    <a href={`/resources/${article.slug}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#7D8590] hover:text-[#0078D4] transition-colors px-2 py-1 rounded">View</a>
                    <button onClick={() => openEdit(article)}
                      className="text-xs bg-[#1C2128] hover:bg-[#30363D] text-[#C9D1D9] px-3 py-1.5 rounded-lg transition-colors font-medium">Edit</button>
                    <button onClick={() => setDeleteTarget(article.slug)}
                      className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg transition-colors font-medium">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Edit view */}
      {view === "edit" && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <button type="button" onClick={cancelEdit}
              className="text-sm text-[#7D8590] hover:text-[#C9D1D9] flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Articles
            </button>
            <span className="text-[#484F58]">/</span>
            <span className="text-sm font-medium text-[#E6EDF3]">{editingSlug ? "Edit Article" : "New Article"}</span>
            {editingSlug && !form.isPublished && (
              <span className="text-xs font-semibold text-amber-400 bg-amber-400/10 rounded-full px-2 py-0.5">Draft</span>
            )}
          </div>

          <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Title <span className="text-red-500">*</span></label>
              <input type="text" value={form.title} required
                onChange={e => { setField("title", e.target.value); if (!editingSlug) setField("slug", autoSlug(e.target.value)); }}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                placeholder="Article title" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Slug <span className="text-red-500">*</span></label>
              <input type="text" value={form.slug} required
                onChange={e => setField("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                placeholder="url-friendly-slug" />
              {form.slug && <p className="text-xs text-[#7D8590] mt-1">/resources/{form.slug}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Category</label>
              <input type="text" value={form.category} onChange={e => setField("category", e.target.value)}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                placeholder="e.g. Copilot AI Tips" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Date <span className="text-red-500">*</span></label>
              <input type="text" value={form.date} required onChange={e => setField("date", e.target.value)}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                placeholder="e.g. June 19, 2026" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Summary</label>
              <textarea value={form.summary} onChange={e => setField("summary", e.target.value)} rows={2}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                placeholder="One-sentence description shown in article listings" />
            </div>
          </div>

          <div className="bg-[#161B22] rounded-xl border border-[#30363D] p-6">
            <label className="block text-xs font-semibold text-[#7D8590] mb-1.5 uppercase tracking-wide">Body (Markdown)</label>
            <p className="text-xs text-[#7D8590] mb-3">Supports full Markdown — headings, bold, lists, blockquotes, etc.</p>
            <textarea value={form.content} onChange={e => setField("content", e.target.value)} rows={22}
              className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-y leading-relaxed"
              placeholder="Write your article in Markdown…" />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="submit" disabled={saving}
              className="bg-[#0078D4] text-white rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-[#006CBE] transition-colors disabled:opacity-60">
              {saving ? "Saving…" : editingSlug ? "Save Changes" : "Create Article"}
            </button>
            {editingSlug && !form.isPublished && (
              <button
                type="button"
                onClick={() => void handleApprove(form.slug)}
                disabled={actionLoading === form.slug}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-60"
              >
                {actionLoading === form.slug ? "Publishing…" : "Approve & Publish"}
              </button>
            )}
            <button type="button" onClick={cancelEdit}
              className="text-sm text-[#7D8590] hover:text-[#C9D1D9] px-4 py-2.5">Cancel</button>
          </div>
        </form>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold text-[#E6EDF3] mb-2">Delete article?</h3>
            <p className="text-sm text-[#7D8590] mb-5">
              This will permanently delete <span className="font-mono font-medium">{deleteTarget}</span> and remove it from the public site. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => void handleDelete(deleteTarget)}
                className="flex-1 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors">Delete</button>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-[#30363D] text-[#C9D1D9] rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#1C2128] transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
