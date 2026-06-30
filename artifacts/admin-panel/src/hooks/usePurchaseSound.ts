import { useCallback, useState } from "react";

const LS_KEY = "admin_purchase_sound_muted";

function readMuted(): boolean {
  try { return localStorage.getItem(LS_KEY) === "true"; } catch { return false; }
}

function synthesizeCelebration(): void {
  try {
    const ctx = new AudioContext();
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
  } catch {}
}

export function usePurchaseSound() {
  const [muted, setMuted] = useState<boolean>(readMuted);

  const playPurchaseSound = useCallback(() => {
    if (localStorage.getItem(LS_KEY) === "true") return;
    synthesizeCelebration();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      try { localStorage.setItem(LS_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return { playPurchaseSound, muted, toggleMute };
}
