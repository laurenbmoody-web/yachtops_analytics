import React, { useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';

// SignaturePad — a small canvas the user signs with a finger / stylus / mouse.
// Emits a PNG data URL via onChange (null when cleared/empty). Self-contained:
// no external deps. Handles HiDPI scaling and resize so the stroke isn't blurry
// or offset. Used by the HOR month sign-off, but generic enough to reuse.
const SignaturePad = ({ onChange, height = 180, disabled = false, className = '' }) => {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the displayed size × DPR so strokes stay crisp.
  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a'; // slate-900 — reads as ink on the light pad
  };

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    last.current = pointFromEvent(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };

  const move = (e) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) onChange?.(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setEmpty(true);
    onChange?.(null);
  };

  return (
    <div className={className}>
      <div className="relative rounded-lg border border-border bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ height, width: '100%', touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-slate-400">Sign here</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={disabled || empty}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Icon name="Eraser" size={14} />
          Clear
        </button>
      </div>
    </div>
  );
};

export default SignaturePad;
