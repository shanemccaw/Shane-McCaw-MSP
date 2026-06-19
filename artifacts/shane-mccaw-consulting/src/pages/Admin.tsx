import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";

interface Article {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  content: string;
}

interface ShareCounts {
  [slug: string]: {
    linkedin: number;
    x: number;
    total: number;
  };
}

interface ShareData {
  counts: ShareCounts;
  total: number;
}

const STORAGE_KEY = "admin_password";
const API_BASE = "/api";

function apiHeaders(password: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${password}`,
  };
}

const EMPTY_ARTICLE: Article = {
  slug: "",
  category: "",
  title: "",
  summary: "",
  date: "",
  content: "",
};

export default function Admin() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? "");
  const [passwordInput, setPasswordInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"list" | "edit" | "shares">("list");
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<Article>(EMPTY_ARTICLE);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [sharesLoading, setSharesLoading] = useState(false);
  const { toast } = useToast();

  const fetchArticles = useCallback(async (pw: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/articles`, {
        headers: apiHeaders(pw),
      });
      if (res.status === 401) {
        setAuthed(false);
        sessionStorage.removeItem(STORAGE_KEY);
        setPassword("");
        toast({ title: "Invalid password", variant: "destructive" });
        return;
      }
      const data = await res.json() as Article[];
      setArticles(data);
      setAuthed(true);
    } catch {
      toast({ title: "Could not reach the API server", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchShares = useCallback(async (pw: string) => {
    setSharesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/shares`, {
        headers: apiHeaders(pw),
      });
      if (!res.ok) {
        toast({ title: "Could not load share analytics", variant: "destructive" });
        return;
      }
      const data = await res.json() as ShareData;
      setShareData(data);
    } catch {
      toast({ title: "Could not reach the API server", variant: "destructive" });
    } finally {
      setSharesLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (password) {
      fetchArticles(password);
    }
  }, [password, fetchArticles]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const pw = passwordInput.trim();
    if (!pw) return;
    sessionStorage.setItem(STORAGE_KEY, pw);
    setPassword(pw);
    setPasswordInput("");
  }

  function handleLogout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword("");
    setAuthed(false);
    setArticles([]);
    setShareData(null);
    setView("list");
  }

  function openShares() {
    setView("shares");
    void fetchShares(password);
  }

  function openNew() {
    setForm(EMPTY_ARTICLE);
    setEditingSlug(null);
    setView("edit");
  }

  function openEdit(article: Article) {
    setForm({ ...article });
    setEditingSlug(article.slug);
    setView("edit");
  }

  function cancelEdit() {
    setView("list");
    setForm(EMPTY_ARTICLE);
    setEditingSlug(null);
  }

  function setField(key: keyof Article, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function autoSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.slug || !form.title || !form.date) {
      toast({ title: "Slug, title, and date are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const isNew = editingSlug === null;
      const url = isNew
        ? `${API_BASE}/admin/articles`
        : `${API_BASE}/admin/articles/${editingSlug}`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: apiHeaders(password),
        body: JSON.stringify(form),
      });

      const body = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ title: body.error ?? "Save failed", variant: "destructive" });
        return;
      }

      toast({ title: isNew ? "Article created" : "Article saved" });
      setView("list");
      setForm(EMPTY_ARTICLE);
      setEditingSlug(null);
      await fetchArticles(password);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(slug: string) {
    try {
      const res = await fetch(`${API_BASE}/admin/articles/${slug}`, {
        method: "DELETE",
        headers: apiHeaders(password),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        toast({ title: body.error ?? "Delete failed", variant: "destructive" });
        return;
      }
      toast({ title: "Article deleted" });
      setDeleteTarget(null);
      await fetchArticles(password);
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0A2540] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#0078D4] rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[#0A2540]">Admin Panel</h1>
            <p className="text-sm text-gray-500 mt-1">Shane McCaw Consulting</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                placeholder="Enter admin password"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-[#0078D4] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#006ab8] transition-colors"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0A2540] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#0078D4] rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm">Shane McCaw Consulting</p>
            <p className="text-xs text-blue-300">Article Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "list" || view === "edit" ? "bg-white/10 text-white" : "text-blue-300 hover:text-white"}`}
            >
              Articles
            </button>
            <button
              onClick={openShares}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "shares" ? "bg-white/10 text-white" : "text-blue-300 hover:text-white"}`}
            >
              Share Analytics
            </button>
          </nav>
          <button
            onClick={handleLogout}
            className="text-xs text-blue-300 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {view === "shares" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-[#0A2540]">Share Analytics</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {shareData ? `${shareData.total} total share${shareData.total !== 1 ? "s" : ""} recorded` : "Loading…"}
                </p>
              </div>
              <button
                onClick={() => void fetchShares(password)}
                className="text-xs text-[#0078D4] hover:underline font-medium"
              >
                Refresh
              </button>
            </div>

            {sharesLoading ? (
              <div className="text-center py-16 text-gray-400">Loading share data…</div>
            ) : !shareData || Object.keys(shareData.counts).length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <p className="text-gray-500">No shares recorded yet.</p>
                <p className="text-xs text-gray-400 mt-2">Share events appear here as readers click the LinkedIn and X buttons on article cards.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Article</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        <span className="flex items-center justify-center gap-1.5"><FaLinkedin className="w-3.5 h-3.5 text-[#0A66C2]" /> LinkedIn</span>
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        <span className="flex items-center justify-center gap-1.5"><FaXTwitter className="w-3.5 h-3.5" /> X</span>
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(shareData.counts)
                      .sort(([, a], [, b]) => b.total - a.total)
                      .map(([slug, counts]) => {
                        const article = articles.find(a => a.slug === slug);
                        return (
                          <tr key={slug} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-4">
                              <p className="font-medium text-[#0A2540] text-sm leading-snug">
                                {article?.title ?? slug}
                              </p>
                              <p className="text-xs text-gray-400 font-mono mt-0.5">{slug}</p>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="text-sm font-semibold text-[#0A66C2]">{counts.linkedin}</span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="text-sm font-semibold text-gray-800">{counts.x}</span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-sm font-bold">
                                {counts.total}
                              </span>
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

        {view === "list" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-[#0A2540]">Articles</h2>
                <p className="text-sm text-gray-500 mt-0.5">{articles.length} article{articles.length !== 1 ? "s" : ""} published</p>
              </div>
              <button
                onClick={openNew}
                className="bg-[#0078D4] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#006ab8] transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Article
              </button>
            </div>

            {loading ? (
              <div className="text-center py-16 text-gray-400">Loading articles…</div>
            ) : articles.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <p className="text-gray-500 mb-4">No articles yet.</p>
                <button onClick={openNew} className="text-[#0078D4] font-medium text-sm hover:underline">Create your first article</button>
              </div>
            ) : (
              <div className="space-y-3">
                {articles.map((article) => (
                  <div key={article.slug} className="bg-white rounded-xl border border-gray-200 p-5 flex items-start justify-between gap-4 hover:border-gray-300 transition-colors">
                    <div className="min-w-0">
                      {article.category && (
                        <span className="inline-block text-xs font-medium text-[#0078D4] bg-blue-50 rounded-full px-2 py-0.5 mb-2">{article.category}</span>
                      )}
                      <h3 className="font-semibold text-[#0A2540] text-sm leading-snug mb-1">{article.title}</h3>
                      <p className="text-xs text-gray-500 truncate">{article.summary}</p>
                      <p className="text-xs text-gray-400 mt-1">{article.date} · <span className="font-mono">{article.slug}</span></p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`/resources/${article.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-[#0078D4] transition-colors px-2 py-1 rounded"
                        title="View article"
                      >
                        View
                      </a>
                      <button
                        onClick={() => openEdit(article)}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(article.slug)}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === "edit" && (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Articles
              </button>
              <span className="text-gray-300">/</span>
              <span className="text-sm font-medium text-[#0A2540]">{editingSlug ? "Edit Article" : "New Article"}</span>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => {
                    setField("title", e.target.value);
                    if (!editingSlug) {
                      setField("slug", autoSlug(e.target.value));
                    }
                  }}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="Article title"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Slug <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setField("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="url-friendly-slug"
                />
                {form.slug && (
                  <p className="text-xs text-gray-400 mt-1">/resources/{form.slug}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Category</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setField("category", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="e.g. Copilot AI Tips"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Date <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.date}
                  onChange={(e) => setField("date", e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  placeholder="e.g. June 19, 2026"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Summary</label>
                <textarea
                  value={form.summary}
                  onChange={(e) => setField("summary", e.target.value)}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                  placeholder="One-sentence description shown in article listings"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Body (Markdown)</label>
              <p className="text-xs text-gray-400 mb-3">Supports full Markdown — headings, bold, lists, blockquotes, etc.</p>
              <textarea
                value={form.content}
                onChange={(e) => setField("content", e.target.value)}
                rows={22}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-y leading-relaxed"
                placeholder="Write your article in Markdown…"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-[#0078D4] text-white rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-[#006ab8] transition-colors disabled:opacity-60"
              >
                {saving ? "Saving…" : editingSlug ? "Save Changes" : "Create Article"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors px-4 py-2.5"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-semibold text-[#0A2540] mb-2">Delete article?</h3>
            <p className="text-sm text-gray-500 mb-5">
              This will permanently delete <span className="font-mono font-medium">{deleteTarget}</span>. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="flex-1 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
