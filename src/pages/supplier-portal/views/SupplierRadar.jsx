import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchSupplierOrders, fetchClients } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

// Radar — proactive "get ahead" feed. Tier 1 signals are derived entirely
// from data we already hold (order cadence per client): reorder-due when a
// client passes their usual rhythm, lapsing when they're well past it. Each
// card carries a personalised draft check-in the supplier can edit + send.
// (AIS proximity is a future card type; the layout is built to take it.)

const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(a || 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const DAY = 86400000;

const SIGNALS = {
  reorder: { label: 'Reorder due', cls: 'reorder' },
  lapsing: { label: 'Lapsing · at risk', cls: 'lapse' },
};

const draftFor = (signal, c) => {
  const who = c.contact ? c.contact.trim().split(/\s+/)[0] : 'there';
  const usuals = c.usuals.slice(0, 3).join(', ');
  if (signal === 'lapsing') {
    return `Hi ${who} — it's been a little while since ${c.vessel}'s last order with us and I wanted to check in. We'd love to help provision your next trip${usuals ? ` — I can pull your usual list (${usuals}) together in minutes` : ''}. Just let me know your next port and dates and I'll get a quote over.`;
  }
  return `Hi ${who} — hope ${c.vessel} is having a great season. You're usually due a provisioning run around now, so I wanted to get ahead of it: happy to prep your usuals${usuals ? ` — ${usuals}` : ''}, plus anything extra for guests aboard. Want me to put a quote together for your next port?`;
};

const SupplierRadar = () => {
  const navigate = useNavigate();
  const { supplier } = useSupplier();
  const supplierId = supplier?.id;

  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [drafts, setDrafts] = useState({});      // cardId -> edited text
  const [hidden, setHidden] = useState(() => loadHidden());

  const load = useCallback(() => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchSupplierOrders(supplierId, { status: 'all', limit: 500 }),
      fetchClients(supplierId),
    ])
      .then(([o, c]) => { setOrders(o || []); setClients(c || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [supplierId]);

  useEffect(() => { load(); }, [load]);

  const cards = useMemo(() => {
    // Group orders by tenant
    const byTenant = {};
    for (const o of orders) {
      if (!o.tenant_id) continue;
      (byTenant[o.tenant_id] ||= []).push(o);
    }
    const clientMeta = Object.fromEntries(clients.map((c) => [c.tenant_id, c]));
    const out = [];
    const now = Date.now();

    for (const [tenantId, list] of Object.entries(byTenant)) {
      const meta = clientMeta[tenantId];
      if (meta && meta.status === 'blocked') continue;          // never nudge blocked
      const sorted = [...list].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (sorted.length < 2) continue;                          // need a rhythm

      // cadence
      let sum = 0, n = 0;
      for (let i = 1; i < sorted.length; i++) {
        const g = (new Date(sorted[i].created_at) - new Date(sorted[i - 1].created_at)) / DAY;
        if (g >= 0) { sum += g; n += 1; }
      }
      if (!n) continue;
      const cadence = sum / n;
      const last = sorted[sorted.length - 1];
      const daysSince = Math.round((now - new Date(last.created_at)) / DAY);
      const ratio = cadence > 0 ? daysSince / cadence : 0;

      let signal = null;
      if (ratio >= 2.2) signal = 'lapsing';
      else if (ratio >= 1.0) signal = 'reorder';
      if (!signal) continue;

      const cardId = `${tenantId}:${signal}`;
      if (hidden[cardId] && hidden[cardId] > now) continue;     // snoozed/dismissed

      const lifetime = list.reduce((s, o) => s + orderTotal(o), 0);
      const avg = lifetime / list.length;

      // usuals — most frequent item names across their orders
      const freq = {};
      for (const o of list) {
        const names = new Set((o.supplier_order_items ?? []).map((i) => i.item_name).filter(Boolean));
        for (const nm of names) freq[nm] = (freq[nm] || 0) + 1;
      }
      const usuals = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([nm]) => nm);

      const vessel = meta?.vessel_name || last.vessel_name || 'this yacht';
      out.push({
        id: cardId, tenantId, signal, vessel, cadence, daysSince, avg, lifetime,
        contact: last.delivery_contact || '', usuals,
        currency: last.currency || 'EUR',
        lastOrderDate: last.delivery_date || last.created_at,
      });
    }

    // Priority: lapsing before reorder, then by avg order value
    out.sort((a, b) => {
      if (a.signal !== b.signal) return a.signal === 'lapsing' ? -1 : 1;
      return b.avg - a.avg;
    });
    return out;
  }, [orders, clients, hidden]);

  const shown = filter === 'all' ? cards : cards.filter((c) => c.signal === filter);
  const potential = shown.reduce((s, c) => s + c.avg, 0);
  const counts = { all: cards.length, reorder: cards.filter((c) => c.signal === 'reorder').length, lapsing: cards.filter((c) => c.signal === 'lapsing').length };

  const hide = (id, days) => {
    const until = days ? Date.now() + days * DAY : Number.MAX_SAFE_INTEGER;
    const next = { ...hidden, [id]: until };
    setHidden(next);
    saveHidden(next);
  };

  const send = (c) => {
    const text = drafts[c.id] ?? draftFor(c.signal, c);
    const params = new URLSearchParams({ yachtId: c.tenantId, draft: text });
    navigate(`/supplier/messages?${params.toString()}`);
  };

  if (loading) return <div className="sp-page"><div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>Scanning your clients…</div></div>;
  if (error) return <div className="sp-page"><div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div></div>;

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <p className="editorial-meta" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="dot">●</span>
            <span>{counts.all} to nudge</span>
            {shown.length > 0 && <><span className="bar" /><span className="muted">~{fmtMoney0(potential, shown[0].currency)} potential</span></>}
            <span className="bar" />
            <span className="muted">{counts.reorder} reorder due</span>
            {counts.lapsing > 0 && <><span className="bar" /><span className="muted" style={{ color: 'var(--amber)' }}>{counts.lapsing} lapsing</span></>}
          </p>
          <h1 className="editorial-greeting" style={{ fontSize: 46, letterSpacing: '-1px', margin: 0 }}>
            YOUR CLIENTS <em>radar</em>
          </h1>
          <p className="sp-page-sub" style={{ marginTop: 10 }}>Reach out before they order — each one comes with a draft check-in you can edit and send.</p>
        </div>
      </div>

      {/* Toolbar: signal filters · refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`rdr-chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All <span className="c">{counts.all}</span></button>
        <button className={`rdr-chip${filter === 'reorder' ? ' on' : ''}`} onClick={() => setFilter('reorder')}>Reorder due <span className="c">{counts.reorder}</span></button>
        <button className={`rdr-chip${filter === 'lapsing' ? ' on' : ''}`} onClick={() => setFilter('lapsing')}>Lapsing <span className="c">{counts.lapsing}</span></button>
        <button type="button" onClick={load} title="Refresh" aria-label="Refresh"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 33, height: 33, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--muted-s)', cursor: 'pointer' }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon="📡" title="All caught up" body="No clients need a nudge right now. We'll surface them here as their reorder rhythm comes due." />
      ) : (
        <div className="rdr-list">
          {shown.map((c) => {
            const sig = SIGNALS[c.signal];
            const text = drafts[c.id] ?? draftFor(c.signal, c);
            return (
              <div key={c.id} className={`rdr-card ${c.signal === 'lapsing' ? 'med' : 'hi'}`}>
                <div className="rdr-top">
                  <div className="rdr-mono">{initialsOf(c.vessel)}</div>
                  <div className="rdr-id">
                    <button type="button" className="rdr-name" onClick={() => navigate(`/supplier/clients/${c.tenantId}`)}>{c.vessel}</button>
                    <div className={`rdr-sig ${sig.cls}`}><span className="d" />{sig.label}</div>
                  </div>
                  <div className="rdr-val"><div className="n">{fmtMoney0(c.avg, c.currency)}</div><div className="l">avg order</div></div>
                </div>

                <p className="rdr-why">
                  {c.signal === 'lapsing'
                    ? <>Ordered about <b>every {Math.round(c.cadence)} days</b>, but it's been <b>{c.daysSince} days</b> — well past their rhythm. Worth a warm win-back.</>
                    : <>Orders roughly <b>every {Math.round(c.cadence)} days</b> — it's been <b>{c.daysSince} days</b> since their last order.</>}
                </p>
                <div className="rdr-meta">
                  <span>Last order <b>{fmtDate(c.lastOrderDate)}</b></span>
                  {c.usuals.length > 0 && <span>Usuals <b>{c.usuals.slice(0, 3).join(' · ')}</b></span>}
                  <span>Lifetime <b>{fmtMoney0(c.lifetime, c.currency)}</b></span>
                </div>

                <div className="rdr-ai">
                  <div className="rdr-ai-h">Drafted check-in · editable</div>
                  <textarea
                    className="rdr-ai-txt"
                    value={text}
                    onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    rows={3}
                  />
                  <div className="rdr-ai-foot">
                    <button className="rdr-btn p" onClick={() => send(c)}>Send message</button>
                    <button className="rdr-btn g" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[c.id]; return n; })}>Reset</button>
                    <span className="sp" />
                    <button className="rdr-btn t" onClick={() => hide(c.id, 7)}>Snooze 7d</button>
                    <button className="rdr-btn t" onClick={() => hide(c.id, 0)}>Dismiss</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── snooze/dismiss persistence (localStorage; server-side is a later add) ──
function loadHidden() {
  try { return JSON.parse(localStorage.getItem('cargo.radar.hidden') || '{}'); }
  catch { return {}; }
}
function saveHidden(v) {
  try { localStorage.setItem('cargo.radar.hidden', JSON.stringify(v)); }
  catch { /* storage blocked */ }
}

export default SupplierRadar;
