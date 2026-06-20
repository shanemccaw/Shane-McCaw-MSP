import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAssignEmail } from "@/hooks/useAssignEmail";

interface EmailRow {
  email: {
    id: number;
    messageId: string;
    subject: string | null;
    senderAddress: string;
    senderDomain: string;
    bodyPreview: string | null;
    receivedAt: string;
    rawFrom: string | null;
    linkedUserId: number | null;
    ingestedAt: string;
  };
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

interface EmailList {
  emails: EmailRow[];
  total: number;
  page: number;
  limit: number;
}

interface MatchingRuleRow {
  rule: {
    id: number;
    domain: string;
    linkedUserId: number;
    createdAt: string;
  };
  clientName: string | null;
  clientEmail: string | null;
}

interface ClientOption {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

type Tab = "all" | "linked" | "unlinked";

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Returns a friendly label for a rule value — email address or @domain */
function ruleLabel(value: string) {
  return value.includes("@") ? value : `@${value}`;
}

export default function EmailActivityPage() {
  const { fetchWithAuth } = useAuth();
  const { assignEmail, assigningId } = useAssignEmail();
  const [tab, setTab] = useState<Tab>("all");
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [matchingRules, setMatchingRules] = useState<MatchingRuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const [clients, setClients] = useState<ClientOption[]>([]);

  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleUserId, setNewRuleUserId] = useState<string>("");
  const [addingRule, setAddingRule] = useState(false);

  const LIMIT = 50;

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (tab === "linked") params.set("linked", "true");
      if (tab === "unlinked") params.set("unlinked", "true");
      const res = await fetchWithAuth(`/api/admin/emails?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as EmailList;
      setEmails(data.emails);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, tab, page]);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetchWithAuth("/api/admin/email-domain-rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMatchingRules(await res.json() as MatchingRuleRow[]);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to load rules");
    } finally {
      setRulesLoading(false);
    }
  }, [fetchWithAuth]);

  const loadClients = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/clients");
      if (!res.ok) return;
      const data = await res.json() as ClientOption[];
      setClients(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, [fetchWithAuth]);

  useEffect(() => { void loadEmails(); }, [loadEmails]);
  useEffect(() => { void loadRules(); void loadClients(); }, [loadRules, loadClients]);
  useEffect(() => { setPage(1); }, [tab]);

  async function handleAssignEmail(emailId: number, userId: number | null) {
    try {
      await assignEmail(emailId, userId);
      await loadEmails();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to assign email");
    }
  }

  async function deleteRule(ruleId: number) {
    if (!confirm("Delete this matching rule?")) return;
    try {
      const res = await fetchWithAuth(`/api/admin/email-domain-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRuleValue.trim() || !newRuleUserId) return;
    setAddingRule(true);
    try {
      const res = await fetchWithAuth("/api/admin/email-domain-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newRuleValue.trim(), userId: parseInt(newRuleUserId, 10) }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setNewRuleValue("");
      setNewRuleUserId("");
      await loadRules();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setAddingRule(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "linked", label: "Linked" },
    { key: "unlinked", label: "Unlinked" },
  ];

  return (
    <div className="p-6 max-w-[1200px] space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#0A2540]">Email Activity</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Emails ingested from Shane's M365 mailbox via Microsoft Graph — matched to clients by sender address or domain.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Email table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center">
            <div className="w-7 h-7 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">
              {tab === "unlinked"
                ? "No unlinked emails — all senders matched to a client."
                : tab === "linked"
                ? "No linked emails yet."
                : "No emails ingested yet. Configure Graph credentials to start ingesting."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/50">
                <tr>
                  {["Sender", "Subject", "Received", "Client"].map(h => (
                    <th key={h} className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest px-4 py-3">{h}</th>
                  ))}
                  <th className="px-4 py-3 text-right text-[11px] font-bold text-gray-400 uppercase tracking-widest">Assign</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {emails.map(row => (
                  <tr key={row.email.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#0A2540] truncate max-w-[200px]">
                        {row.email.rawFrom ?? row.email.senderAddress}
                      </p>
                      <p className="text-xs text-gray-400">{row.email.senderAddress}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[#0A2540] truncate max-w-[260px]">
                        {row.email.subject ?? "(no subject)"}
                      </p>
                      {row.email.bodyPreview && (
                        <p className="text-xs text-gray-400 truncate max-w-[260px]">{row.email.bodyPreview}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-[#0A2540]">{formatDate(row.email.receivedAt)}</p>
                      <p className="text-xs text-gray-400">{timeAgo(row.email.receivedAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      {row.email.linkedUserId ? (
                        <div>
                          <p className="font-medium text-[#0A2540]">{row.clientName ?? row.clientEmail}</p>
                          {row.clientCompany && <p className="text-xs text-gray-400">{row.clientCompany}</p>}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                          Unlinked
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <select
                        disabled={assigningId === row.email.id}
                        value={row.email.linkedUserId ?? ""}
                        onChange={e => {
                          const val = e.target.value;
                          void handleAssignEmail(row.email.id, val === "" ? null : parseInt(val, 10));
                        }}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#0078D4] disabled:opacity-50 max-w-[160px]"
                      >
                        <option value="">— Unassigned —</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name ?? c.email}{c.company ? ` (${c.company})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">{total} emails total</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="px-3 py-1 text-xs text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Matching Rules section */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setRulesOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50/50 transition-colors"
        >
          <div>
            <p className="text-sm font-bold text-[#0A2540]">Matching Rules</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Auto-link inbound emails to clients by exact address (e.g. <span className="font-mono">john@outlook.com</span>) or whole domain (e.g. <span className="font-mono">@contoso.com</span>). Address rules take priority over domain rules.
            </p>
          </div>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${rulesOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {rulesOpen && (
          <div className="border-t border-gray-100">
            {rulesLoading ? (
              <div className="p-6 text-center text-sm text-gray-400">Loading rules…</div>
            ) : rulesError ? (
              <div className="p-4 text-sm text-red-600">{rulesError}</div>
            ) : (
              <>
                {matchingRules.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-gray-400">No matching rules defined yet.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50/50 border-b border-gray-100">
                      <tr>
                        <th className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest px-5 py-3">Address / Domain</th>
                        <th className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest px-5 py-3">Type</th>
                        <th className="text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest px-5 py-3">Assigned Client</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {matchingRules.map(row => (
                        <tr key={row.rule.id} className="hover:bg-gray-50/50">
                          <td className="px-5 py-3 font-mono text-xs text-[#0A2540]">{ruleLabel(row.rule.domain)}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              row.rule.domain.includes("@")
                                ? "bg-purple-100 text-purple-700"
                                : "bg-blue-100 text-blue-700"
                            }`}>
                              {row.rule.domain.includes("@") ? "Address" : "Domain"}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <p className="font-medium text-[#0A2540]">{row.clientName ?? row.clientEmail}</p>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => void deleteRule(row.rule.id)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Add new rule form */}
                <form onSubmit={e => void addRule(e)} className="px-5 py-4 border-t border-gray-100 flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
                      Email address or domain
                    </label>
                    <input
                      type="text"
                      placeholder="john@outlook.com or contoso.com"
                      value={newRuleValue}
                      onChange={e => setNewRuleValue(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0A2540] w-full focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                    />
                    <p className="text-[10px] text-gray-400">
                      Full address (e.g. <span className="font-mono">john@outlook.com</span>) matches only that sender.
                      Domain (e.g. <span className="font-mono">contoso.com</span>) matches everyone from that company.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Client</label>
                    <select
                      value={newRuleUserId}
                      onChange={e => setNewRuleUserId(e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 w-52 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                    >
                      <option value="">Select client…</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name ?? c.email}{c.company ? ` (${c.company})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={addingRule || !newRuleValue.trim() || !newRuleUserId}
                    className="px-4 py-2 bg-[#0078D4] text-white text-sm font-semibold rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
                  >
                    {addingRule ? "Adding…" : "Add Rule"}
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>

      {/* Setup instructions */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="text-sm font-bold text-[#0078D4] mb-2">Setup: Connect your M365 Mailbox</h3>
        <ol className="text-xs text-blue-800 space-y-1.5 list-decimal list-inside">
          <li>Register an Azure AD app at <span className="font-mono">portal.azure.com</span> → Azure Active Directory → App registrations.</li>
          <li>Grant <span className="font-mono">Mail.Read</span> application permission (not delegated) and admin-consent it.</li>
          <li>Set three Replit Secrets: <span className="font-mono">GRAPH_TENANT_ID</span>, <span className="font-mono">GRAPH_CLIENT_ID</span>, <span className="font-mono">GRAPH_CLIENT_SECRET</span>.</li>
          <li>Set <span className="font-mono">GRAPH_MAIL_USER_ID</span> to the UPN or object ID of the mailbox user (e.g. <span className="font-mono">shane@contoso.com</span>).</li>
          <li>Redeploy — the server will register a Graph webhook subscription automatically. New inbox emails will appear here within seconds.</li>
        </ol>
      </div>
    </div>
  );
}
