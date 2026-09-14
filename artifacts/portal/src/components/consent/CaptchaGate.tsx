import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile gate, ported (logic only, not markup) from the
 * archived consent-success.tsx — same dev-bypass shape the public checkout
 * and AssessmentPaymentPlan already use: a real token when
 * VITE_TURNSTILE_SITE_KEY is set (the server verifies it), a bypass token
 * when it isn't (the server's verifyCaptchaToken also bypasses in that case).
 */
declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

export function CaptchaGate({ onVerify }: { onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  useEffect(() => {
    if (!siteKey) {
      onVerify("DEV_BYPASS_TOKEN");
      return;
    }
    if (!window.turnstile) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    let widgetId: string | undefined;
    let cancelled = false;
    const renderWidget = () => {
      if (cancelled) return;
      if (window.turnstile && containerRef.current) {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
        });
      } else {
        setTimeout(renderWidget, 100);
      }
    };
    renderWidget();
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}
