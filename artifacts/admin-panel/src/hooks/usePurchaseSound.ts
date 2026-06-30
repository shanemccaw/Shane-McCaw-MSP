import { useCallback, useEffect, useState } from "react";

const LS_MUTED = "admin_purchase_sound_muted";
const LS_PENDING = "admin_pending_purchase_sound";

function readMuted(): boolean {
  try { return localStorage.getItem(LS_MUTED) === "true"; } catch { return false; }
}

function synthesizeCelebration(): void {
  try {
    const ctx = new AudioContext();
    // Resume is a no-op when state is already "running", but required after a
    // browser auto-suspend (e.g. returning from a background tab).
    void ctx.resume().then(() => {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + i * 0.13;
        const end = start + 0.28;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.55, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.start(start);
        osc.stop(end);
      });
      setTimeout(() => { void ctx.close(); }, 1200);
    });
  } catch {}
}

function playIfNotMuted(): void {
  try {
    if (localStorage.getItem(LS_MUTED) === "true") return;
  } catch {}
  synthesizeCelebration();
}

export function usePurchaseSound() {
  const [muted, setMuted] = useState<boolean>(readMuted);

  const playPurchaseSound = useCallback(() => {
    playIfNotMuted();
  }, []);

  // ── Service-worker message handler ──────────────────────────────────────────
  // When a push notification with playSound:true arrives, the SW posts
  // PLAY_PURCHASE_SOUND to every open admin-panel client.
  // • If the tab is visible  → play the sound immediately
  // • If the tab is hidden   → set a localStorage flag so the sound plays on
  //                            the next visibilitychange to "visible"
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type !== "PLAY_PURCHASE_SOUND") return;
      try {
        if (localStorage.getItem(LS_MUTED) === "true") return;
      } catch {}

      if (document.visibilityState === "visible") {
        synthesizeCelebration();
      } else {
        try { localStorage.setItem(LS_PENDING, "true"); } catch {}
      }
    };

    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSwMessage);
  }, []);

  // ── Visibility change handler ─────────────────────────────────────────────
  // Play any queued sound the moment Shane returns to the tab.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      try {
        if (localStorage.getItem(LS_PENDING) !== "true") return;
        localStorage.removeItem(LS_PENDING);
      } catch {
        return;
      }
      playIfNotMuted();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      try { localStorage.setItem(LS_MUTED, String(next)); } catch {}
      return next;
    });
  }, []);

  return { playPurchaseSound, muted, toggleMute };
}
