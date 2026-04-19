import React from 'react';
import { Inbox, Truck, Euro, FileClock, ChevronRight, MapPin, Package } from 'lucide-react';
import { ORDERS } from '../data';

const DashboardView = ({ onOpenOrder, onNav }) => {
  const attentionItems = [
    {
      time: '06:42', timeColor: 'var(--red)', sub: '4h ago',
      mark: 'm3', short: 'SOL',
      title: 'M/Y Solstice · awaiting confirmation',
      desc: <>Charter start Thu · <b style={{ color: 'var(--amber)' }}>2 subs</b> &amp; 1 price change · €5,127.20</>,
      badge: <span className="sp-action-badge rush">Rush</span>,
      onClick: () => onOpenOrder('CGO-2026-0418'),
    },
    {
      time: 'Overdue', timeColor: 'var(--red)', sub: '14 days',
      mark: 'm4', short: 'LUM',
      title: 'M/Y Lumen · invoice #0218 overdue',
      desc: '€4,160 · reminder sent Mon · purser replied but no payment',
      badge: null,
      onClick: () => onNav('invoices'),
    },
    {
      time: '14:00', timeColor: 'var(--fg-2)', sub: 'today',
      mark: 'm1', short: 'HAL',
      title: 'S/Y Halcyon · delivery ready · pick-list printed',
      desc: 'Port Vauban Q34 · driver Jean-Paul · 24 items',
      badge: null,
      onClick: () => onNav('deliveries'),
    },
    {
      time: 'Low', timeColor: 'var(--amber)', sub: 'stock',
      mark: null, short: 'FJI',
      title: 'Fiji water 330ml — 12 cases left',
      desc: 'Solstice + Aether orders will wipe stock · reorder?',
      badge: <button className="sp-pill" style={{ padding: '4px 10px', fontSize: 11.5 }}>Reorder</button>,
      onClick: () => onNav('catalogue'),
    },
  ];

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow"><span className="sp-dot" />MONDAY · 20 APR · ANTIBES · 18°C</div>
          <h1 className="sp-page-title">Morning, <em>Luca.</em></h1>
          <p className="sp-page-sub">4 new orders since 6 am. One rush for Solstice. 2 deliveries going out today — first at 14:00, Port Vauban.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill ghost"><Truck size={13} />This week</button>
          <button className="sp-pill primary" onClick={() => onNav('orders')}><Inbox size={13} />Open inbox</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="sp-kpis">
        <div className="sp-kpi blue">
          <div className="sp-kpi-label"><Inbox size={11} />NEW ORDERS</div>
          <div className="sp-kpi-value">4</div>
          <div className="sp-kpi-sub"><b>2</b> need confirmation</div>
        </div>
        <div className="sp-kpi amber">
          <div className="sp-kpi-label"><Truck size={11} />DELIVERIES TODAY</div>
          <div className="sp-kpi-value">2</div>
          <div className="sp-kpi-sub">Antibes · first 14:00</div>
        </div>
        <div className="sp-kpi green">
          <div className="sp-kpi-label"><Euro size={11} />BILLED · APR</div>
          <div className="sp-kpi-value">€ 84k</div>
          <div className="sp-kpi-sub"><span className="sp-delta up">+11%</span> vs Mar</div>
        </div>
        <div className="sp-kpi">
          <div className="sp-kpi-label"><FileClock size={11} />OUTSTANDING</div>
          <div className="sp-kpi-value">€ 12k</div>
          <div className="sp-kpi-sub"><span style={{ color: 'var(--red)' }}>1 overdue</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Attention feed */}
        <div className="sp-card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-3)' }}>
            <h3 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, margin: 0 }}>Needs your attention</h3>
            <span className="sp-cnt">6 items</span>
            <button onClick={() => onNav('orders')} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted-s)', background: 'none', border: 'none', cursor: 'pointer' }}>See all →</button>
          </div>
          {attentionItems.map((item, i) => (
            <div
              key={i} onClick={item.onClick}
              style={{ padding: '14px 18px', borderBottom: i < attentionItems.length - 1 ? '1px solid var(--line-soft)' : 'none', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', transition: 'background 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 44, textAlign: 'center' }}>
                <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 14, color: item.timeColor }}>{item.time}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{item.sub}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                {item.mark
                  ? <div className={`sp-ym ${item.mark}`} style={{ width: 34, height: 34, borderRadius: 9, fontSize: 11 }}>{item.short}</div>
                  : <div className="sp-ym" style={{ width: 34, height: 34, borderRadius: 9, fontSize: 11, background: 'linear-gradient(135deg,#A88149,#6C4F21)' }}>{item.short}</div>
                }
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{item.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-s)', marginTop: 2 }}>{item.desc}</div>
                </div>
              </div>
              {item.badge || <button className="sp-cb"><ChevronRight size={14} /></button>}
            </div>
          ))}
        </div>

        {/* Side panel */}
        <div>
          <div className="sp-delivery-card" style={{ marginBottom: 14 }}>
            <div className="dd">Next delivery · 3h 22m</div>
            <div className="time">14:00</div>
            <div className="day">Monday 20 April · today</div>
            <div className="loc">
              <b>S/Y Halcyon · Port Vauban</b>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={11} />Berth Q34 · Antibes</div>
              <div>Driver: Jean-Paul</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Package size={11} />24 items · pick-list printed</div>
            </div>
          </div>
          <div className="sp-card">
            <h4>This week at a glance</h4>
            <div className="sp-kv-list">
              {[
                ['Orders in flight', '11'],
                ['Deliveries booked', '7'],
                ['Charter starts', '2 · Solstice, Aether'],
                ['Repeat rate · 30d', '92%'],
                ['Avg confirm time', '38 min'],
              ].map(([k, v]) => (
                <div key={k} className="sp-kv">
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
