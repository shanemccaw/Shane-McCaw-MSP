import { Link } from "wouter";
import PortalLayout from "@/components/PortalLayout";

const BOOKINGS_URL = import.meta.env.VITE_BOOKINGS_URL as string | undefined;

export default function PortalBookMeeting() {
  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-10 max-w-2xl mx-auto">

        <div className="mb-8">
          <Link href="/portal/projects">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] hover:underline cursor-pointer">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to Projects
            </span>
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center"
          style={{ boxShadow: "0 4px 24px rgba(10,37,64,0.07)" }}>

          <div className="w-16 h-16 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
            </svg>
          </div>

          <span className="inline-block bg-[#00B4D8]/15 text-[#0078D4] font-mono text-[10px] px-2 py-0.5 rounded uppercase tracking-widest mb-3">
            Schedule a Session
          </span>

          <h1 className="text-2xl font-extrabold text-[#0A2540] mb-3 leading-tight">
            Schedule a Meeting with Shane
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto mb-8">
            Pick a time that works for you. Shane will review your project context ahead of the call so you can make the most of your time together.
          </p>

          {BOOKINGS_URL ? (
            <a
              href={BOOKINGS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 bg-[#0078D4] text-white font-bold px-8 py-3.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
              Open Booking Calendar
            </a>
          ) : (
            <div className="bg-[#F7F9FC] border border-gray-100 rounded-xl p-6 text-left">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0A2540] mb-1">Online booking isn't set up yet</p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    To schedule a meeting, email Shane directly at{" "}
                    <a
                      href="mailto:info@shanemccaw.com"
                      className="text-[#0078D4] font-semibold hover:underline"
                    >
                      info@shanemccaw.com
                    </a>{" "}
                    and he'll get back to you to find a time that works.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-10 pt-8 border-t border-gray-100 flex items-center justify-center gap-4">
            <div className="w-10 h-10 rounded-full bg-[#0078D4]/20 flex items-center justify-center text-[#0078D4] font-bold text-sm flex-shrink-0">
              SM
            </div>
            <div className="text-left">
              <p className="text-[10px] uppercase text-gray-400 tracking-wider font-semibold">Your Consultant</p>
              <p className="text-sm font-bold text-[#0A2540]">Shane McCaw</p>
              <p className="text-xs text-gray-500">Lead Microsoft 365 Architect</p>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
