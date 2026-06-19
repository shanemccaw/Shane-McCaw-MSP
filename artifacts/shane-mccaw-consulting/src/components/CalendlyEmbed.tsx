import { useEffect, useRef } from "react";

const CALENDLY_URL = "https://calendly.com/shanemccawconsulting/discovery";

interface CalendlyEmbedProps {
  minHeight?: number;
}

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: {
        url: string;
        parentElement: HTMLElement;
        prefill?: object;
        utm?: object;
      }) => void;
    };
  }
}

export function CalendlyEmbed({ minHeight = 700 }: CalendlyEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const tryInit = () => {
      if (window.Calendly && el) {
        el.innerHTML = "";
        window.Calendly.initInlineWidget({
          url: CALENDLY_URL,
          parentElement: el,
        });
      }
    };

    if (window.Calendly) {
      tryInit();
      return;
    }

    const interval = setInterval(() => {
      if (window.Calendly) {
        clearInterval(interval);
        tryInit();
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      ref={containerRef}
      className="calendly-inline-widget w-full rounded-xl overflow-hidden border border-border"
      data-url={CALENDLY_URL}
      style={{ minHeight }}
    />
  );
}
