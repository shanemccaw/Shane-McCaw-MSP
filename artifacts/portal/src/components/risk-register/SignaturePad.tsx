import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A drawn-signature capture pad — the SOW-flow drawn-signature parity #1512
 * exists to add (`portal-rbd-document.ts:196-201`, `signatureData` is
 * `required` here, unlike the MSP-side sign path where it stays optional).
 *
 * Plain canvas + pointer events, no third-party dependency — this app has no
 * existing signature-pad package to reuse, and adding one is a real,
 * unjustified download for what freehand-stroke capture needs. Emits a PNG
 * data URL via `onChange`, `null` while the pad is empty/cleared.
 */
export function SignaturePad({
  onChange,
  disabled,
}: {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Backing store at devicePixelRatio so strokes stay crisp, CSS size fixed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 480;
    const cssHeight = 160;
    canvas.width = cssWidth * ratio;
    canvas.height = cssHeight * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1a1a1a";
    }
  }, []);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokeRef.current = true;
  }

  function commit() {
    if (!hasStrokeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsEmpty(false);
    onChange(canvas.toDataURL("image/png"));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    commit();
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    setIsEmpty(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-border/70 bg-white",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <canvas
          ref={canvasRef}
          className="h-[160px] w-full touch-none"
          data-testid="rbd-signature-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {isEmpty && (
          <span className="pointer-events-none absolute inset-x-0 bottom-2.5 text-center text-[11px] text-muted-foreground/70">
            Draw your signature above
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={handleClear}
        disabled={disabled || isEmpty}
        data-testid="rbd-signature-clear"
      >
        <Eraser className="size-3.5" /> Clear
      </Button>
    </div>
  );
}
