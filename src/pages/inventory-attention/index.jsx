import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { formatDate } from '../../utils/dateFormat';
import { getAllItems } from '../inventory/utils/inventoryStorage';
import PushToBoardModal from '../inventory/components/PushToBoardModal';
import '../../styles/editorial.css';
import './attention.css';

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

// Quantity on hand for an item (rolled up).
const qtyOf = (i) => Number(i?.totalQty ?? i?.quantity ?? 0) || 0;
// Suggested reorder amount — the shortfall to par, min 1.
const shortfall = (i) => (i?.restockLevel != null ? Math.max(1, i.restockLevel - qtyOf(i)) : 1);

// Bucket an item by urgency (one bucket each): expired → below par → expiring.
const bucketOf = (i, today) => {
  const exp = i?.expiryDate ? new Date(i.expiryDate) : null;
  const validExp = exp && !Number.isNaN(exp.getTime());
  if (validExp && exp < today) return 'expired';
  const belowPar = !!i?.restockEnabled && i?.restockLevel != null && qtyOf(i) <= i.restockLevel;
  if (belowPar) return 'belowpar';
  if (validExp) {
    const days = Math.ceil((exp - today) / DAY);
    if (days >= 0 && days <= 30) return 'expiring';
  }
  return null;
};

const SECTIONS = [
  { key: 'expired', label: 'Expired', icon: 'AlertTriangle', tone: 'red' },
  { key: 'belowpar', label: 'Below par', icon: 'TrendingDown', tone: 'amber' },
  { key: 'expiring', label: 'Expiring soon', icon: 'Clock', tone: 'blue' },
];

const InventoryAttention = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [selected, setSelected] = useState(() => new Set());
  const [showPush, setShowPush] = useState(false);

  useEffect(() => {
    let alive = true;
    getAllItems().then((all) => { if (alive) setItems(Array.isArray(all) ? all : []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const buckets = useMemo(() => {
    const today = startOfToday();
    const out = { expired: [], belowpar: [], expiring: [] };
    (items || []).forEach((i) => { const b = bucketOf(i, today); if (b) out[b].push(i); });
    // Most-urgent expiry / biggest shortfall first within each group.
    out.expired.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    out.expiring.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    out.belowpar.sort((a, b) => shortfall(b) - shortfall(a));
    return out;
  }, [items]);

  const total = buckets.expired.length + buckets.belowpar.length + buckets.expiring.length;
  const byId = useMemo(() => { const m = new Map(); (items || []).forEach((i) => m.set(i.id, i)); return m; }, [items]);

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (list) => setSelected((prev) => {
    const n = new Set(prev);
    const allSel = list.length > 0 && list.every((i) => n.has(i.id));
    list.forEach((i) => { if (allSel) n.delete(i.id); else n.add(i.id); });
    return n;
  });

  const selectedItems = useMemo(
    () => [...selected].map((id) => byId.get(id)).filter(Boolean).map((i) => ({ ...i, suggestedQty: shortfall(i) })),
    [selected, byId],
  );

  const metricFor = (i, key) => {
    if (key === 'belowpar') return `${qtyOf(i)} / ${i?.restockLevel}${i?.unit ? ` ${i.unit}` : ''}`;
    return i?.expiryDate ? formatDate(i.expiryDate) : '—';
  };

  return (
    <div className="att-page">
      <Header />
      <div className="att-wrap">
        <button onClick={() => navigate('/inventory')} className="att-back">
          <Icon name="ArrowLeft" size={14} /> Back to inventory
        </button>

        <p className="editorial-meta att-meta">
          <span className="dot">●</span>
          <span>INVENTORY</span>
          <span className="bar" />
          <span className="muted">NEEDS ATTENTION</span>
          <span className="bar" />
          <span className="muted">{items === null ? '…' : `${total} ITEM${total === 1 ? '' : 'S'}`}</span>
        </p>
        <h1 className="editorial-greeting">
          ATTENTION<span className="period">,</span> <em>{total === 0 ? 'all clear' : 'act now'}</em><span className="period">.</span>
        </h1>

        {items === null ? (
          <p className="att-loading">Loading…</p>
        ) : total === 0 ? (
          <p className="att-empty">Nothing expired, expiring within 30 days, or below par. Everything's in good shape.</p>
        ) : (
          SECTIONS.map(({ key, label, icon, tone }) => {
            const list = buckets[key];
            if (!list.length) return null;
            const allSel = list.every((i) => selected.has(i.id));
            return (
              <section className="att-sec" key={key}>
                <div className="att-sec-h">
                  <span className={`att-sec-title tone-${tone}`}><Icon name={icon} size={15} /> {label} <span className="att-count">{list.length}</span></span>
                  <button className="att-selall" onClick={() => toggleGroup(list)}>{allSel ? 'Deselect all' : 'Select all'}</button>
                </div>
                <div className="att-list">
                  {list.map((i) => (
                    <label className={`att-row${selected.has(i.id) ? ' on' : ''}`} key={i.id}>
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                      <span className="att-name">{i.name}</span>
                      <span className="att-loc">{[i.location, i.subLocation].filter(Boolean).join(' › ')}</span>
                      <span className={`att-metric tone-${tone}`}>{metricFor(i, key)}</span>
                    </label>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {selected.size > 0 && (
        <div className="att-bar">
          <span className="att-bar-count">{selected.size} selected</span>
          <div className="att-bar-actions">
            <button className="att-bar-ghost" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="att-bar-prim" onClick={() => setShowPush(true)}>
              <Icon name="ShoppingCart" size={15} /> Push to provisioning
            </button>
          </div>
        </div>
      )}

      {showPush && (
        <PushToBoardModal
          items={selectedItems}
          onClose={() => setShowPush(false)}
          onDone={() => { setSelected(new Set()); }}
        />
      )}
    </div>
  );
};

export default InventoryAttention;
