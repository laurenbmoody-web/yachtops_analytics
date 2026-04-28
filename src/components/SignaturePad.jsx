import React, { useRef, useState, useCallback } from 'react';

/**
 * Touch-and-mouse signature canvas.
 *
 * Props:
 *   onSign(dataUrl|null)  Called every stroke-end with the canvas as a PNG
 *                         data URL, or null when the user clicks Clear.
 *   width                 Canvas width in CSS px (default 560).
 *   height                Canvas height in CSS px (default 110).
 *
 * Originated inline on the legacy /return-confirm page; extracted here so
 * the new /delivery-sign/<token> flow (Sprint 9b) and the eventual
 * vessel-side signing flow (Sprint 9c) share one implementation.
 */
export default function SignaturePad({ onSign, width = 560, height = 110 }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches?.[0];
    return {
      x: (touch ? touch.clientX : e.clientX) - rect.left,
      y: (touch ? touch.clientY : e.clientY) - rect.top,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  }, []);

  const draw = useCallback((e) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1E3A5F';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasStrokes(true);
  }, [drawing]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    if (hasStrokes && canvasRef.current) {
      onSign?.(canvasRef.current.toDataURL('image/png'));
    }
  }, [hasStrokes, onSign]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onSign?.(null);
  };

  return (
    <div style={{
      position: 'relative', borderRadius: 8, overflow: 'hidden',
      border: '1px solid #E2E8F0', background: '#FAFAFA',
    }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: '100%', height,
          cursor: 'crosshair', touchAction: 'none', display: 'block',
        }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      {!hasStrokes && (
        <span style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          fontSize: 13, color: '#CBD5E1',
          pointerEvents: 'none', userSelect: 'none',
        }}>Sign here</span>
      )}
      {hasStrokes && (
        <button
          type="button"
          onClick={clear}
          style={{
            position: 'absolute', top: 8, right: 10,
            background: 'none', border: 'none',
            fontSize: 11, color: '#94A3B8',
            cursor: 'pointer', padding: '2px 6px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#DC2626'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; }}
        >
          Clear
        </button>
      )}
      <div style={{
        borderTop: '1px solid #E2E8F0', height: 0,
        position: 'absolute', bottom: 28, left: 16, right: 16,
      }} />
    </div>
  );
}
