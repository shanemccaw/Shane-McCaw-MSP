import { useEffect, useRef, useState } from "react";
import TelemetryFeed from "./TelemetryFeed";
import { QW_COPY } from "@/lib/quickWinCopy";

interface ProgressLayerProps {
  progress: number;
  score: number;
  prevScore: number;
  telemetryLines: string[];
}

export default function ProgressLayer({ progress, score, prevScore, telemetryLines }: ProgressLayerProps) {
  const [displayScore, setDisplayScore] = useState(prevScore);
  const [scoreVisible, setScoreVisible] = useState(true);

  useEffect(() => {
    if (score === prevScore) return;
    setScoreVisible(false);
    const t = setTimeout(() => {
      setDisplayScore(score);
      setScoreVisible(true);
    }, 120);
    return () => clearTimeout(t);
  }, [score, prevScore]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[#0A2540]/60 uppercase tracking-wide">
            {QW_COPY.autoStep.heading}
          </span>
          <span
            className="text-sm font-black text-[#0078D4] transition-opacity"
            style={{
              opacity: scoreVisible ? 1 : 0,
              transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)",
            }}
          >
            Score: {displayScore}
          </span>
        </div>

        <div className="w-full h-2 bg-[#F7F9FC] rounded-full overflow-hidden border border-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#0078D4] to-[#00B4D8]"
            style={{
              width: `${progress}%`,
              transition: "width 240ms cubic-bezier(0.42,0,0.58,1)",
            }}
          />
        </div>

        <p className="text-xs text-muted-foreground mt-1.5">{QW_COPY.autoStep.subtext}</p>
      </div>

      <TelemetryFeed lines={telemetryLines} />
    </div>
  );
}
