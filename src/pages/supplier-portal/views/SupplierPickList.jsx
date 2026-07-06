// Pick list — Phase 3.
//
// The supplier's shelf-side view of one order: count each confirmed
// line off the shelf (tap, type, or scan its barcode), short-pick with
// a note when the shelf disagrees, then "Mark packed". Dispatching the
// order later decrements catalogue stock automatically (DB trigger),
// which is what turns stock_qty from a hand-maintained number into a
// true one.
//
// Scan-to-pick uses the native BarcodeDetector API where available
// (Chrome/Android — i.e. the phone in the warehouse); elsewhere the
// scan button hides and tapping does the job.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScanBarcode, PackageCheck, Check } from 'lucide-react';
import {
  fetchOrderById,
  fetchOrderItemsForPicking,
  setItemPicked,
  updateOrderStatus,
} from '../utils/supplierStorage';
import { categoryHue } from '../../../utils/catalogueConstants';
import './pick-list.css';

const PICKABLE_STATUS = 'confirmed';

const SupplierPickList = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [packing, setPacking] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const [scanning, setScanning] = useState(false);
  const [scanSupported, setScanSupported] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });

  useEffect(() => {
    setScanSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [o, lines] = await Promise.all([
          fetchOrderById(orderId),
          fetchOrderItemsForPicking(orderId),
        ]);
        if (!live) return;
        setOrder(o);
        setItems(lines);
        // Entering the pick list moves a confirmed order into "picking"
        // so the vessel's timeline reflects reality.
        if (['confirmed', 'partially_confirmed'].includes(o.status)) {
          updateOrderStatus(orderId, 'picking').catch(() => {});
        }
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [orderId]);

  const pickable = useMemo(() => items.filter(i => i.status === PICKABLE_STATUS), [items]);
  const others = useMemo(() => items.filter(i => i.status !== PICKABLE_STATUS), [items]);
  const pickedCount = pickable.filter(i => i.picked_qty != null).length;
  const allPicked = pickable.length > 0 && pickedCount === pickable.length;
  const shortCount = pickable.filter(i => i.picked_qty != null && Number(i.picked_qty) < Number(i.quantity)).length;

  const patch = (updated) => setItems(prev => prev.map(i => (i.id === updated.id ? { ...i, ...updated } : i)));

  const savePick = async (item, qty, note = undefined) => {
    try {
      const clamped = qty == null ? null : Math.max(0, qty);
      const finalNote = note !== undefined
        ? note
        : (clamped != null && clamped < Number(item.quantity) ? item.pick_note : null);
      const updated = await setItemPicked(item.id, clamped, finalNote ?? null);
      patch(updated);
    } catch (e) {
      setError(e.message);
    }
  };

  const bump = (item, delta) => {
    const current = item.picked_qty != null ? Number(item.picked_qty) : 0;
    savePick(item, current + delta);
  };

  const pickAll = (item) => {
    const full = item.picked_qty != null && Number(item.picked_qty) === Number(item.quantity);
    savePick(item, full ? null : Number(item.quantity));
  };

  const shortNote = async (item) => {
    const note = window.prompt('Why short? (shown to the yacht)', item.pick_note || 'Not enough stock on the shelf');
    if (note === null) return;
    await savePick(item, item.picked_qty ?? 0, note.trim() || null);
  };

  // ── scan-to-pick ──
  const stopScan = () => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);
      // Let the <video> mount, then attach + run the detect loop.
      requestAnimationFrame(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
        });
        const loop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) handleScannedCode(codes[0].rawValue);
          } catch { /* frame not ready — keep looping */ }
          scanLoopRef.current = requestAnimationFrame(loop);
        };
        loop();
      });
    } catch (e) {
      setError('Camera unavailable — check permissions, or tap quantities instead.');
      setScanning(false);
    }
  };

  const handleScannedCode = (code) => {
    // Debounce: the camera sees the same barcode ~30×/sec.
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 1600) return;
    lastScanRef.current = { code, at: now };

    setItems(prev => {
      const line = prev.find(i => i.status === PICKABLE_STATUS && i.catalogue?.barcode === code);
      if (!line) return prev;
      const current = line.picked_qty != null ? Number(line.picked_qty) : 0;
      const next = Math.min(current + 1, Number(line.quantity));
      if (next !== current) {
        setFlashId(line.id);
        setTimeout(() => setFlashId(null), 1000);
        if (navigator.vibrate) navigator.vibrate(60);
        setItemPicked(line.id, next, line.pick_note ?? null).catch(() => {});
        return prev.map(i => (i.id === line.id ? { ...i, picked_qty: next, picked_at: new Date().toISOString() } : i));
      }
      return prev;
    });
  };

  useEffect(() => () => stopScan(), []);

  const markPacked = async () => {
    setPacking(true);
    try {
      await updateOrderStatus(orderId, 'packed');
      navigate(`/supplier/orders/${orderId}`);
    } catch (e) {
      setError(e.message);
      setPacking(false);
    }
  };

  if (loading) {
    return <div className="sp-page"><div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>Loading pick list…</div></div>;
  }

  return (
    <div className="sp-page">
      <div className="spk-topbar">
        <button className="spk-back" onClick={() => navigate(`/supplier/orders/${orderId}`)}>
          <ArrowLeft size={13} /> Back to order
        </button>
        <div className="spk-progress-wrap">
          <div className="spk-progress-label">
            <span>{pickedCount} of {pickable.length} lines picked{shortCount ? ` · ${shortCount} short` : ''}</span>
            <span>{pickable.length ? Math.round((pickedCount / pickable.length) * 100) : 0}%</span>
          </div>
          <div className={`spk-progress ${allPicked ? 'done' : ''}`}>
            <i style={{ width: `${pickable.length ? (pickedCount / pickable.length) * 100 : 0}%` }} />
          </div>
        </div>
        {scanSupported && (
          <button className={`spk-scanbtn ${scanning ? 'active' : ''}`} onClick={scanning ? stopScan : startScan}>
            <ScanBarcode size={15} /> {scanning ? 'Stop scanning' : 'Scan to pick'}
          </button>
        )}
      </div>

      <div className="sp-page-head" style={{ marginBottom: 8 }}>
        <div>
          <div className="sp-eyebrow">Picking</div>
          <h1 className="sp-page-title">Pick <em>{order?.vessel_name || 'order'}</em></h1>
          <p className="sp-page-sub">
            Count each line off the shelf — tap ✓ for a full pick, use − / + for a short one, or scan barcodes.
          </p>
        </div>
      </div>

      <div className="spk-meta">
        Deliver <b>{order?.delivery_date ? new Date(order.delivery_date).toLocaleDateString('en-GB') : 'TBC'}</b>
        {order?.delivery_time ? <> at <b>{String(order.delivery_time).slice(0, 5)}</b></> : null}
        {order?.delivery_port ? <> · <b>{order.delivery_port}</b></> : null}
      </div>

      {error && <div className="spk-error">{error}</div>}

      {scanning && (
        <div className={`spk-scanner ${flashId ? 'spk-flash' : ''}`}>
          <video ref={videoRef} muted playsInline />
          <div className="spk-scanline" />
          <div className="spk-scanhint">Point at a product barcode — each scan picks one {`unit`}</div>
        </div>
      )}

      <div className="spk-list">
        {pickable.map(item => {
          const qty = Number(item.quantity);
          const picked = item.picked_qty != null ? Number(item.picked_qty) : null;
          const full = picked != null && picked >= qty;
          const short = picked != null && picked < qty;
          const cat = item.catalogue;
          const packBits = cat ? [cat.pack_size ? `${cat.pack_size} × ${cat.pack_unit || ''}`.trim() : null, cat.unit_size].filter(Boolean).join(' · ') : '';
          return (
            <div key={item.id} className={`spk-line ${full ? 'done' : ''} ${flashId === item.id ? 'flash' : ''}`}>
              {cat?.image_url
                ? <img className="spk-thumb" src={cat.image_url} alt="" loading="lazy" />
                : <span className="spk-thumb-ph" style={{ background: categoryHue(cat?.category) }}>
                    {(item.item_name || '?').charAt(0).toUpperCase()}
                  </span>}
              <div className="spk-line-main">
                <div className="spk-line-name">{item.item_name}</div>
                <div className="spk-line-sub">
                  {[`${qty} ${item.unit || ''}`.trim(), packBits || null, cat?.barcode ? `EAN ${cat.barcode}` : null].filter(Boolean).join(' · ')}
                </div>
                {short && (
                  <div className="spk-line-note">
                    Short pick — {item.pick_note || 'no reason yet'}{' '}
                    <a style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => shortNote(item)}>
                      {item.pick_note ? 'edit' : 'add reason'}
                    </a>
                  </div>
                )}
              </div>
              <div className="spk-counter">
                <button onClick={() => bump(item, -1)} disabled={!picked}>−</button>
                <span className={`spk-count ${full ? 'full' : short ? 'short' : ''}`}>
                  {picked != null ? picked : '—'}<small> / {qty}</small>
                </span>
                <button onClick={() => bump(item, 1)} disabled={full}>+</button>
              </div>
              <button className={`spk-pickall ${full ? 'picked' : ''}`} onClick={() => pickAll(item)}>
                {full ? <><Check size={12} style={{ verticalAlign: -2 }} /> Picked</> : 'Pick all'}
              </button>
            </div>
          );
        })}

        {others.map(item => (
          <div key={item.id} className="spk-line done">
            <span className="spk-thumb-ph" style={{ background: '#CBD5E1' }}>{(item.item_name || '?').charAt(0).toUpperCase()}</span>
            <div className="spk-line-main">
              <div className="spk-line-name">{item.item_name}</div>
              <div className="spk-line-muted">
                {item.status === 'unavailable' ? 'Marked unavailable — nothing to pick'
                  : item.status === 'substituted' ? `Substituted: ${item.substitute_description || 'see order'}`
                  : 'Awaiting confirmation — not on this pick'}
              </div>
            </div>
          </div>
        ))}

        {pickable.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No confirmed lines to pick yet — confirm lines on the order first.
          </div>
        )}
      </div>

      {pickable.length > 0 && (
        <div className="spk-foot">
          <span className="spk-foot-note">
            {allPicked
              ? (shortCount ? `Ready — ${shortCount} short pick${shortCount === 1 ? '' : 's'} will show on the delivery note.` : 'Everything picked in full.')
              : 'Pick every line (full or short) to mark the order packed.'}
          </span>
          <button className="spk-packed" disabled={!allPicked || packing} onClick={markPacked}>
            <PackageCheck size={15} /> {packing ? 'Marking…' : 'Mark packed'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SupplierPickList;
