import { useCallback } from "react";
import confetti from "canvas-confetti";

export function useConfetti() {
  const fire = useCallback((opts?: confetti.Options) => {
    void confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ["#0078D4", "#00B4D8", "#0A2540", "#ffffff", "#22c55e"],
      ...opts,
    });
  }, []);

  const fireSidecannons = useCallback(() => {
    function shoot(angle: number, x: number) {
      void confetti({
        particleCount: 40,
        angle,
        spread: 55,
        origin: { x, y: 0.65 },
        colors: ["#0078D4", "#00B4D8", "#22c55e", "#ffffff", "#f59e0b"],
      });
    }
    shoot(60, 0);
    shoot(120, 1);
    setTimeout(() => { shoot(60, 0); shoot(120, 1); }, 250);
    setTimeout(() => { shoot(60, 0); shoot(120, 1); }, 500);
  }, []);

  return { fire, fireSidecannons };
}
