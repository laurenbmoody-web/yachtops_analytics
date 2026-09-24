import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import './qr-sheet-overlay.css';

// In-app QR label sheet + print. Rendered as a full-screen overlay in the current
// page (no pop-up window, so it can't be blocked). A print stylesheet hides the
// rest of the app so only the labels print. Default stock is an A4 sheet of
// 24 × 40 mm square labels (4 × 6); also supports auto-fill A4 and roll sizes.

const SIZES = [
  { id: 'sheet24', label: 'A4 sheet · 24 labels (40 × 40 mm)', grid: { cols: 4, rows: 6, cell: 40 } },
  { id: 'sheetauto', label: 'A4 sheet · auto-fill' },
  { id: 'dymo', label: 'Dymo 89 × 36 mm (99012)', w: 89, h: 36 },
  { id: 'brother', label: 'Brother QL 62 × 29 mm (DK-11209)', w: 62, h: 29 },
  { id: 'label100', label: 'Label 100 × 62 mm', w: 100, h: 62 },
  { id: 'zebra', label: 'Zebra 51 × 25 mm (2 × 1")', w: 51, h: 25 },
];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export default function QrSheetOverlay({ title = 'QR labels', entries = [], onClose }) {
  const list = useMemo(() => (entries || []).filter((e) => e && String(e.value || '').trim()), [entries]);
  const [qr, setQr] = useState({});
  const [ready, setReady] = useState(false);
  const [stock, setStock] = useState('sheet24');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const QR = (await import('qrcode')).default;
        const m = {};
        for (const e of list) {
          try { m[e.value] = await QR.toDataURL(e.value, { margin: 1, width: 360, color: { dark: '#1C1B3A', light: '#FFFFFF' } }); } catch { /* skip */ }
        }
        if (alive) { setQr(m); setReady(true); }
      } catch { if (alive) setReady(true); }
    })();
    return () => { alive = false; };
  }, [list]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const size = SIZES.find((s) => s.id === stock) || SIZES[0];
  const pageRule = size.grid ? '@page{size:A4;margin:0}' : size.w ? `@page{size:${size.w}mm ${size.h}mm;margin:0}` : '@page{size:A4;margin:8mm}';

  const cell = (it, i) => (
    <div className="qro-cell" key={i}>
      {qr[it.value] ? <img src={qr[it.value]} alt="" /> : <div className="qro-qrph" />}
      {it.name ? <div className="nm">{it.name}</div> : null}
      {it.code ? <div className="cd">{it.code}</div> : null}
    </div>
  );

  const renderBody = () => {
    if (size.grid) {
      const per = size.grid.cols * size.grid.rows;
      const qmm = Math.round(size.grid.cell * 0.62);
      const padH = (210 - size.grid.cols * size.grid.cell) / 2;
      const padV = (297 - size.grid.rows * size.grid.cell) / 2;
      return chunk(list, per).map((pageItems, pi) => (
        <div
          key={pi}
          className="qro-page grid"
          style={{
            width: '210mm', height: '297mm', padding: `${padV}mm ${padH}mm`,
            gridTemplateColumns: `repeat(${size.grid.cols}, ${size.grid.cell}mm)`,
            gridTemplateRows: `repeat(${size.grid.rows}, ${size.grid.cell}mm)`,
            '--qmm': `${qmm}mm`,
          }}
        >
          {pageItems.map((it, i) => cell(it, i))}
        </div>
      ));
    }
    if (size.w) {
      const qpx = Math.round(Math.min(size.w, size.h) * 3.2);
      return (
        <div className="qro-tags">
          {list.map((it, i) => (
            <div className="qro-tag" key={i} style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
              {qr[it.value] ? <img src={qr[it.value]} alt="" style={{ width: qpx, height: qpx }} /> : null}
              <div className="qro-tagmeta">
                {it.name ? <div className="nm">{it.name}</div> : null}
                {it.sub ? <div className="sb">{it.sub}</div> : null}
                {it.code ? <div className="cd">{it.code}</div> : null}
              </div>
            </div>
          ))}
        </div>
      );
    }
    // auto-fill A4
    return (
      <div className="qro-page auto" style={{ width: '210mm', minHeight: '297mm' }}>
        <div className="qro-auto">
          {list.map((it, i) => (
            <div className="qro-card" key={i}>
              {qr[it.value] ? <img src={qr[it.value]} alt="" /> : <div className="qro-qrph" />}
              {it.name ? <div className="nm">{it.name}</div> : null}
              {it.sub ? <div className="sb">{it.sub}</div> : null}
              {it.code ? <div className="cd">{it.code}</div> : null}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="qro-root">
      <style>{`@media print{${pageRule}}`}</style>
      <div className="qro-bar">
        <div className="qro-l">
          <span className="qro-eyebrow">Print QR labels</span>
          <span className="qro-count">{list.length} label{list.length === 1 ? '' : 's'} · {title}</span>
        </div>
        <label className="qro-stock">Label stock
          <select value={stock} onChange={(e) => setStock(e.target.value)}>
            {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button className="qro-btn prim" onClick={() => window.print()} disabled={!ready}>
          <Icon name="Printer" size={15} /> {ready ? 'Print' : 'Preparing…'}
        </button>
        <button className="qro-btn ghost" onClick={onClose}>Close</button>
        <span className="qro-hint">Prints inside the app — no pop-up. Print at <b>100% / actual size</b> (turn off “fit to page”) so a 24 × 40 mm sheet lines up.</span>
      </div>
      <div className="qro-scroll">{renderBody()}</div>
    </div>,
    document.body,
  );
}
