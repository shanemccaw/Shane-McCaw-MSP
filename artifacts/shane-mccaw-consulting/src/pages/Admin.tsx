import { useEffect } from "react";

export default function Admin() {
  useEffect(() => {
    window.location.replace("/admin-panel/");
  }, []);

  return (
    <div className="min-h-screen bg-[#0A2540] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm text-center">
        <div className="w-12 h-12 bg-[#0078D4] rounded-xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-[#0A2540] mb-2">Admin Panel Moved</h1>
        <p className="text-sm text-gray-500 mb-4">
          The admin panel has moved to a dedicated app.
        </p>
        <a
          href="/admin-panel/"
          className="inline-block bg-[#0078D4] text-white rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-[#006CBE] transition-colors"
        >
          Go to Admin Panel →
        </a>
      </div>
    </div>
  );
}
