// To activate this embed:
// 1. Open Microsoft 365 admin portal → Microsoft Bookings
// 2. Create a booking page for "Discovery Call"
// 3. Copy the booking page URL (looks like https://outlook.office365.com/book/shanemccaw@shanemccaw.com/...)
// 4. Set VITE_BOOKINGS_URL in Replit Secrets to that URL — no code changes needed

const PLACEHOLDER_URL = "https://outlook.office365.com/book/YOUR-BOOKINGS-PAGE";
const BOOKINGS_URL = import.meta.env.VITE_BOOKINGS_URL || PLACEHOLDER_URL;

interface MicrosoftBookingsEmbedProps {
  bookingsUrl?: string;
  minHeight?: number;
}

export function MicrosoftBookingsEmbed({
  bookingsUrl = BOOKINGS_URL,
  minHeight = 700,
}: MicrosoftBookingsEmbedProps) {
  const isPlaceholder = bookingsUrl === PLACEHOLDER_URL;

  if (isPlaceholder) {
    return (
      <div
        className="w-full rounded-xl border border-[#0078D4]/30 bg-[#0078D4]/5 flex flex-col items-center justify-center text-center p-12"
        style={{ minHeight }}
        data-testid="bookings-placeholder"
      >
        <div className="w-14 h-14 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-6">
          <svg
            className="w-7 h-7 text-[#0078D4]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-[#0A2540] mb-3">Microsoft Bookings</h3>
        <p className="text-muted-foreground text-sm max-w-sm leading-relaxed">
          Set up your Microsoft Bookings page in the M365 admin portal, then add your booking URL
          as <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">VITE_BOOKINGS_URL</code> in Replit Secrets to activate this calendar.
        </p>
      </div>
    );
  }

  return (
    <iframe
      src={bookingsUrl}
      width="100%"
      style={{ minHeight, border: "none" }}
      className="w-full rounded-xl overflow-hidden border border-border"
      title="Book a time with Shane McCaw"
      data-testid="bookings-iframe"
    />
  );
}
