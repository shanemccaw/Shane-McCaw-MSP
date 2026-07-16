import { useEffect, useRef } from "react";

interface CaptchaGateProps {
  onVerify: (token: string) => void;
}

export function CaptchaGate({ onVerify }: CaptchaGateProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) {
      // Dev bypass mode
      console.warn("VITE_TURNSTILE_SITE_KEY is missing. Bypassing Turnstile.");
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

    const renderWidget = () => {
      if (window.turnstile && containerRef.current) {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            onVerify(token);
          },
        });
      } else {
        setTimeout(renderWidget, 100);
      }
    };

    renderWidget();

    return () => {
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey, onVerify]);

  if (!siteKey) {
    return (
      <div className="text-xs text-muted-foreground italic my-2">
        Dev Mode: Turnstile CAPTCHA bypassed.
      </div>
    );
  }

  return <div ref={containerRef} className="my-4 flex justify-center" />;
}
