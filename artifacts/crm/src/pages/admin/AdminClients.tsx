import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  createdAt: string;
}

interface FormState {
  email: string;
  name: string;
  company: string;
  phone: string;
  password: string;
}

const EMPTY_FORM: FormState = { email: "", name: "", company: "", phone: "", password: "" };

export default function AdminClients() {
  const { fetchWithAuth } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetchWithAuth("/api/admin/clients");
    if (res.ok) setClients(await res.json() as Client[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/clients/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, company: form.company, phone: form.phone, email: form.email }),
        });
      } else {
        res = await fetchWithAuth("/api/admin/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error);
      } else {
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: Client) => {
    setEditingId(c.id);
    setForm({ email: c.email, name: c.name ?? "", company: c.company ?? "", phone: c.phone ?? "", password: "" });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#0A2540]">Client Accounts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage portal access for consulting clients.</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
          className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Client
        </button>
      </div>

      {showForm && (
        <div className="bg-[#F7F9FC] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#0A2540] mb-4">{editingId ? "Edit Client" : "Add New Client"}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {!editingId && (
              <div>
                <label className="block text-xs font-semibold text-[#0A2540] mb-1">Password *</label>
                <input type="password" required={!editingId} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Company</label>
              <input type="text" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#0A2540] mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create Client"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#F7F9FC] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-white border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
          No clients yet. Add a client account to give them portal access.
        </div>
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F9FC] border-b border-border">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name / Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Company</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Phone</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-[#F7F9FC] transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-[#0A2540]">{c.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{c.email}</p>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">{c.company ?? "—"}</td>
                  <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground hidden lg:table-cell">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3.5">
                    <button onClick={() => handleEdit(c)} className="text-xs font-semibold text-[#0078D4] hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
