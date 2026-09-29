import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import './qr-sheet-overlay.css';

// In-app QR label sheet + print. Rendered as a full-screen overlay in the current
// page (no pop-up window, so it can't be blocked). A print stylesheet hides the
// rest of the app so only the labels print. Default stock is an A4 sheet of
// 24 × 40 mm square labels (4 × 6); also supports auto-fill A4 and roll sizes.

// Per-printer calibration (mm) is remembered so you only dial it in once.
const CAL_KEY = 'cargo_qr_sheet_cal_v1';
const loadCal = () => {
  try { return JSON.parse(localStorage.getItem(CAL_KEY)) || {}; } catch { return {}; }
};

const SIZES = [
  // Herma 9642: A4, 4 × 6 = 24 labels, 40 × 40 mm, centred on the page with 8 mm
  // gaps between labels (the manufacturer layout: 13 mm side margin, 8.5 mm
  // top/bottom, 48 mm pitch). Nudge Shift ↓/→ for your printer's own offset.
  { id: 'sheet24', label: 'Herma 9642 · 24 × 40 mm (A4)', grid: { cols: 4, rows: 6, cell: 40, gapX: 8, gapY: 8 } },
  { id: 'sheetauto', label: 'A4 sheet · auto-fill' },
  { id: 'dymo', label: 'Dymo 89 × 36 mm (99012)', w: 89, h: 36 },
  { id: 'brother', label: 'Brother QL 62 × 29 mm (DK-11209)', w: 62, h: 29 },
  { id: 'label100', label: 'Label 100 × 62 mm', w: 100, h: 62 },
  { id: 'zebra', label: 'Zebra 51 × 25 mm (2 × 1")', w: 51, h: 25 },
];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Safari scales full-bleed label sheets down to its own printable area, which
// shifts labels off the pre-cut stickers. Chrome honours margin:0 and lands
// them 1:1, so we flag Safari and point the user to Chrome for sheet stock.
const IS_SAFARI = typeof navigator !== 'undefined'
  && /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent || '');

export default function QrSheetOverlay({ title = 'QR labels', entries = [], onClose }) {
  const list = useMemo(() => (entries || []).filter((e) => e && String(e.value || '').trim()), [entries]);
  const [qr, setQr] = useState({});
  const [ready, setReady] = useState(false);
  const [stock, setStock] = useState('sheet24');
  // Fine-tune to the physical sheet (mm): gap between labels + a whole-sheet
  // nudge to correct printer offset. Seeded from the last saved calibration so
  // it carries over between prints; defaults match the Herma 9642 layout.
  const cal0 = loadCal();
  const [gapX, setGapX] = useState(Number.isFinite(cal0.gapX) ? cal0.gapX : 8);
  const [gapY, setGapY] = useState(Number.isFinite(cal0.gapY) ? cal0.gapY : 8);
  const [offX, setOffX] = useState(Number.isFinite(cal0.offX) ? cal0.offX : 0);
  const [offY, setOffY] = useState(Number.isFinite(cal0.offY) ? cal0.offY : 0);
  // Remember the calibration so the next print starts where this one left off.
  useEffect(() => {
    try { localStorage.setItem(CAL_KEY, JSON.stringify({ gapX, gapY, offX, offY })); } catch { /* ignore */ }
  }, [gapX, gapY, offX, offY]);
  // Placement: slot index -> label index (-1 = empty). Lets you drag a QR onto
  // a different sticker — e.g. to skip labels already used on a part-printed sheet.
  const [place, setPlace] = useState([]);
  const [dragFrom, setDragFrom] = useState(null);

  const size0 = SIZES.find((s) => s.id === stock) || SIZES[0];
  const per0 = size0.grid ? size0.grid.cols * size0.grid.rows : 0;
  useEffect(() => {
    if (!per0) { setPlace([]); return; }
    const pages = Math.max(1, Math.ceil(list.length / per0));
    const arr = new Array(pages * per0).fill(-1);
    for (let i = 0; i < list.length; i += 1) arr[i] = i;
    setPlace(arr);
  }, [list, per0]);

  const moveSlot = (to) => {
    setPlace((p) => {
      if (dragFrom == null || dragFrom === to) return p;
      const n = [...p];
      const a = n[dragFrom]; n[dragFrom] = n[to]; n[to] = a;
      return n;
    });
    setDragFrom(null);
  };

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

  const cellContent = (it) => (
    <>
      {qr[it.value] ? <img src={qr[it.value]} alt="" draggable={false} /> : <div className="qro-qrph" />}
      {it.name ? <div className="nm">{it.name}</div> : null}
      {it.code ? <div className="cd">{it.code}</div> : null}
    </>
  );

  const renderBody = () => {
    if (size.grid) {
      const { cols, rows, cell: cs } = size.grid;
      const per = cols * rows;
      const qmm = Math.round(cs * 0.62);
      const blockW = cols * cs + (cols - 1) * gapX;
      const blockH = rows * cs + (rows - 1) * gapY;
      const padH = Math.max(0, (210 - blockW) / 2) + offX;
      const padV = Math.max(0, (297 - blockH) / 2) + offY;
      const slots = place.length ? place : list.map((_, i) => i);
      const pages = Math.max(1, Math.ceil(slots.length / per));
      return Array.from({ length: pages }).map((_, pi) => (
        <div
          key={pi}
          className="qro-page grid"
          style={{
            width: '210mm', height: '297mm',
            paddingTop: `${padV}mm`, paddingLeft: `${padH}mm`,
            gridTemplateColumns: `repeat(${cols}, ${cs}mm)`,
            gridTemplateRows: `repeat(${rows}, ${cs}mm)`,
            columnGap: `${gapX}mm`, rowGap: `${gapY}mm`,
            '--qmm': `${qmm}mm`,
          }}
        >
          {Array.from({ length: per }).map((__, si) => {
            const slot = pi * per + si;
            const li = slots[slot];
            const it = li >= 0 && li != null ? list[li] : null;
            return (
              <div
                key={si}
                className={`qro-cell${it ? '' : ' empty'}${dragFrom === slot ? ' dragging' : ''}`}
                draggable={!!it}
                onDragStart={() => setDragFrom(slot)}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => moveSlot(slot)}
                title={it ? 'Drag onto another label' : 'Drop a label here'}
              >
                {it ? cellContent(it) : <span className="qro-slot-empty" aria-hidden="true" />}
              </div>
            );
          })}
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
        {size.grid && (
          <div className="qro-tune">
            <span className="qro-tune-l">Fine-tune (mm)</span>
            <label>Gap ↔<input type="number" step="0.5" value={gapX} onChange={(e) => setGapX(Number(e.target.value) || 0)} /></label>
            <label>Gap ↕<input type="number" step="0.5" value={gapY} onChange={(e) => setGapY(Number(e.target.value) || 0)} /></label>
            <label>Shift →<input type="number" step="0.5" value={offX} onChange={(e) => setOffX(Number(e.target.value) || 0)} /></label>
            <label>Shift ↓<input type="number" step="0.5" value={offY} onChange={(e) => setOffY(Number(e.target.value) || 0)} /></label>
          </div>
        )}
        {IS_SAFARI && size.grid && (
          <span className="qro-warn">
            <Icon name="AlertTriangle" size={13} />
            <span><b>Safari shrinks label sheets when printing</b>, so they won’t line up on the stickers. For exact Herma alignment, open this page in <b>Chrome</b> and print from there. (Roll/label-printer sizes are fine in Safari.)</span>
          </span>
        )}
        <span className="qro-hint">Prints inside the app — no pop-up. Print at <b>100% / actual size</b> (turn off “fit to page” / “scale to fit”). Matches the <b>Herma 9642</b> template (40 × 40 mm, 24-up). If your printer sits it high or to one side, nudge <b>Shift ↓</b> / <b>Shift →</b> until it lands on the stickers — the calibration is remembered for next time.</span>
      </div>
      <div className="qro-scroll">{renderBody()}</div>
    </div>,
    document.body,
  );
}
