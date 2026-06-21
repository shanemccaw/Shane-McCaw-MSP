import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Profile {
  name: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

type AlertState = { type: "success" | "error"; message: string } | null;

export default function PortalProfile() {
  const { fetchWithAuth } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState>(null);

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetchWithAuth("/api/portal/profile")
      .then(r => r.json())
      .then((data: Profile) => {
        setName(data.name ?? "");
        setEmail(data.email ?? "");
        setCompany(data.company ?? "");
        setPhone(data.phone ?? "");
        setAddress(data.address ?? "");
        setAddressCity(data.addressCity ?? "");
        setAddressState(data.addressState ?? "");
        setAddressZip(data.addressZip ?? "");
      })
      .catch(() => setAlert({ type: "error", message: "Could not load your profile. Please refresh." }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const res = await fetchWithAuth("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, phone, address, addressCity, addressState, addressZip }),
      });
      if (res.ok) {
        setAlert({ type: "success", message: "Profile updated successfully." });
      } else {
        const err = await res.json() as { error?: string };
        setAlert({ type: "error", message: err.error ?? "Could not save your profile. Please try again." });
      }
    } catch {
      setAlert({ type: "error", message: "Network error. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-[#0A2540]">Profile Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Keep your contact details up to date — they are pre-filled on contracts and purchase forms.
          </p>
        </div>

        {alert && (
          <div className={`mb-6 flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
            alert.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}>
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {alert.type === "success" ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
              )}
            </svg>
            <span>{alert.message}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-[#0A2540]">Account</h2>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-gray-50 text-sm text-muted-foreground cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Email cannot be changed here. Contact support if needed.</p>
                </div>
                <div>
                  <label htmlFor="profile-name" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="profile-company" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Company / Organization
                  </label>
                  <input
                    id="profile-company"
                    type="text"
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-[#0A2540]">Contact Details</h2>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div>
                  <label htmlFor="profile-phone" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Phone Number
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="profile-address" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                    Street Address
                  </label>
                  <input
                    id="profile-address"
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main St"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="profile-city" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      City
                    </label>
                    <input
                      id="profile-city"
                      type="text"
                      value={addressCity}
                      onChange={e => setAddressCity(e.target.value)}
                      placeholder="Springfield"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-state" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      State
                    </label>
                    <input
                      id="profile-state"
                      type="text"
                      value={addressState}
                      onChange={e => setAddressState(e.target.value)}
                      placeholder="IL"
                      maxLength={2}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors uppercase"
                    />
                  </div>
                  <div>
                    <label htmlFor="profile-zip" className="block text-xs font-semibold text-[#0A2540] mb-1.5">
                      ZIP Code
                    </label>
                    <input
                      id="profile-zip"
                      type="text"
                      value={addressZip}
                      onChange={e => setAddressZip(e.target.value)}
                      placeholder="62701"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 focus:border-[#0078D4] transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50"
              >
                {saving && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Save changes
              </button>
            </div>
          </form>
        )}
      </div>
    </PortalLayout>
  );
}
