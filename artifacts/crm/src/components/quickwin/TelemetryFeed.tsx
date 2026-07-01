import { useEffect, useRef } from "react";

interface TelemetryFeedProps {
  lines: string[];
}

export default function TelemetryFeed({ lines }: TelemetryFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="mt-4 max-h-32 overflow-y-auto rounded-xl bg-[#0A2540] px-4 py-3 space-y-1.5 d2-custom-scrollbar">
      {lines.map((line, i) => (
        <p
          key={i}
          className="text-xs font-mono text-[#00B4D8] leading-snug"
          style={{
            opacity: 0,
            animation: "qw-fade-in 240ms cubic-bezier(0.42,0,0.58,1) forwards",
            animationDelay: `${Math.min(i * 40, 200)}ms`,
          }}
        >
          <span className="text-white/30 mr-2 select-none">›</span>
          {line}
        </p>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
