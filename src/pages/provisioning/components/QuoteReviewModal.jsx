import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabaseClient';
import { applyQuotedPrices } from '../utils/provisioningStorage';
import './quote-review-modal.css';

// Quote review — runs after a manual supplier-quote PDF/photo is
// uploaded. Reuses the parseDeliveryNote edge function (same OCR + AI
// item-matching the delivery-note flow uses) to read the quote, match
// each line to a board item, and pull the unit price. The chief
// reviews / corrects the extracted prices, then applies them onto the
// board lines (estimated_unit_cost → line totals recalc).
//
// Mirrors the Cargo-supplier quote feel: "the supplier updates your
// end" — except here the update is read from the uploaded document
// instead of arriving line-by-line from the portal.

const SUPPORTED_MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', heic: 'image/heic',
};
const resolveMediaType = (file) => {
  const t = (file?.type || '').toLowerCase();
  if (Object.values(SUPPORTED_MIME).includes(t)) return t;
  const ext = (file?.name?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return SUPPORTED_MIME[ext] || null;
};

const CONF_LABEL = { high: 'High match', medium: 'Likely', low: 'Low match' };

const QuoteReviewModal = ({ list, items, file, onApplied, onClose }) => {
  const [status, setStatus] = useState('parsing'); // parsing | done | error
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);            // [{ itemId, name, price, confidence }]
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;            // parse once (file is stable)
    ranRef.current = true;
    if (!file) { setStatus('error'); setError('No quote file to read.'); return; }

    const mediaType = resolveMediaType(file);
    if (!mediaType) { setStatus('error'); setError('Unsupported file type. Use PDF, JPG, PNG, WebP or HEIC.'); return; }

    (async () => {
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const { data: result, error: fnError } = await supabase.functions.invoke('parseDeliveryNote', {
          body: { base64, mediaType, batchItems: items },
        });
        if (fnError) throw new Error(fnError?.message || 'Could not read the quote.');

        const lines = result?.line_items || [];
        const itemById = new Map((items || []).map(i => [i.id, i]));
        const matched = [];
        let unmatched = 0;
        lines.forEach((l) => {
          const ok = l.matched_item_id && l.match_confidence && l.match_confidence !== 'none' && itemById.has(l.matched_item_id);
          if (!ok) { unmatched += 1; return; }
          const it = itemById.get(l.matched_item_id);
          matched.push({
            itemId: it.id,
            name: it.name,
            unit: it.unit,
            qty: it.quantity_ordered,
            price: l.unit_price != null ? String(l.unit_price) : '',
            confidence: l.match_confidence,
          });
        });
        // Dedupe by itemId (OCR can split a line) — keep the first.
        const seen = new Set();
        const deduped = matched.filter(r => (seen.has(r.itemId) ? false : (seen.add(r.itemId), true)));
        setRows(deduped);
        setUnmatchedCount(unmatched);
        setStatus('done');
      } catch (err) {
        setError(err?.message || 'Could not read the quote.');
        setStatus('error');
      }
    })();
  }, [file, items]);

  const setPrice = (itemId, v) => setRows(prev => prev.map(r => r.itemId === itemId ? { ...r, price: v } : r));

  const applicable = rows.filter(r => r.price !== '' && !Number.isNaN(Number(r.price)));

  const handleApply = async () => {
    setApplying(true);
    try {
      const count = await applyQuotedPrices(
        applicable.map(r => ({ id: r.itemId, estimated_unit_cost: Number(r.price) })),
      );
      onApplied?.(count);
    } catch {
      setError('Could not apply the prices. Try again.');
      setApplying(false);
    }
  };

  const cur = list?.currency || '';

  return (
    <div className="qrm-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="qrm qrm-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="qrm-head">
          <div>
            <p className="qrm-eyebrow">Supplier quote</p>
            <h2 className="qrm-title">Review, <em>apply prices</em>.</h2>
            <p className="qrm-sub">{file?.name || 'Uploaded quote'}{cur ? ` · ${cur}` : ''}</p>
          </div>
          <button className="qrm-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="qrm-body">
          {status === 'parsing' && (
            <div className="qrm-state">
              <Icon name="Loader2" size={22} className="qrm-spin" />
              <p>Reading the quote and matching items…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="qrm-state">
              <Icon name="AlertTriangle" size={22} style={{ color: '#C65A1A' }} />
              <p>{error}</p>
              <p className="qrm-state-sub">The quote file is still attached — you can enter prices on the board by hand.</p>
            </div>
          )}

          {status === 'done' && (
            <>
              {rows.length === 0 ? (
                <div className="qrm-state">
                  <p>No quote lines matched this board's items.</p>
                  <p className="qrm-state-sub">The file is attached — enter prices on the board directly.</p>
                </div>
              ) : (
                <>
                  <p className="qrm-section-label">{rows.length} matched line{rows.length === 1 ? '' : 's'} — check the prices</p>
                  <div className="qrm-rows">
                    {rows.map(r => (
                      <div key={r.itemId} className="qrm-row">
                        <div className="qrm-row-main">
                          <span className="qrm-row-name">{r.name}</span>
                          <span className={`qrm-conf qrm-conf-${r.confidence}`}>{CONF_LABEL[r.confidence] || r.confidence}</span>
                        </div>
                        <div className="qrm-row-meta">
                          {r.qty != null && <span>{r.qty}{r.unit ? ` ${r.unit}` : ''}</span>}
                        </div>
                        <div className="qrm-price">
                          <span className="qrm-price-cur">{cur || '$'}</span>
                          <input
                            className="qrm-price-input"
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.price}
                            placeholder="0.00"
                            onChange={e => setPrice(r.itemId, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {unmatchedCount > 0 && (
                    <p className="qrm-unmatched">{unmatchedCount} quote line{unmatchedCount === 1 ? '' : 's'} didn't match a board item — set those by hand if needed.</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="qrm-foot">
          <button className="qrm-btn-ghost" onClick={onClose} disabled={applying}>
            {status === 'done' && rows.length > 0 ? 'Skip' : 'Close'}
          </button>
          {status === 'done' && rows.length > 0 && (
            <button className="qrm-btn-primary" onClick={handleApply} disabled={applying || applicable.length === 0}>
              {applying ? 'Applying…' : `Apply ${applicable.length} price${applicable.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuoteReviewModal;
