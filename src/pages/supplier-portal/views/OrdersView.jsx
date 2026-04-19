import React, { useState } from 'react';
import { Inbox, Euro, Truck, FileCheck, Flag, SlidersHorizontal, Rows3, LayoutList, Columns3, MoreHorizontal, ArrowRight } from 'lucide-react';
import { ORDERS } from '../data';

const TABS = [
  { id: 'new',      label: 'New',              count: 4,  urgent: true },
  { id: 'progress', label: 'In progress',       count: 11 },
  { id: 'dispatch', label: 'Out for delivery',  count: 3  },
  { id: 'delivered',label: 'Delivered',          count: 38 },
  { id: 'issues',   label: 'Issues',             count: 2,  urgent: true },
  { id: 'all',      label: 'All' },
];

const KANBAN_COLS = [
  { key: 'new',       title: 'New',             count: 4 },
  { key: 'confirmed', title: 'Confirmed',        count: 3 },
  { key: 'picking',   title: 'Picking',          count: 4 },
  { key: 'dispatch',  title: 'Out for delivery', count: 3 },
  { key: 'delivered', title: 'Delivered',        count: 8 },
];

const OrdersView = ({ onOpenOrder }) => {
  const [activeTab, setActiveTab]   = useState('new');
  const [layout, setLayout]         = useState('table');

  return (
    <div className="sp-page">
      {/* Header */}
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow"><span className="sp-dot" />MONDAY · 20 APR</div>
          <h1 className="sp-page-title">Your orders <em>inbox</em></h1>
          <p className="sp-page-sub">4 new orders this morning. One rush — Solstice charter start Thursday.</p>
        </div>
        <div className="sp-actions">
          <button className="sp-pill ghost"><FileCheck size={13} />Export</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="sp-kpis">
        <div className="sp-kpi blue">
          <div className="sp-kpi-label"><Inbox size={11} />NEW ORDERS</div>
          <div className="sp-kpi-value">4</div>
          <div className="sp-kpi-sub">since 6 am</div>
        </div>
        <div className="sp-kpi amber">
          <div className="sp-kpi-label"><Truck size={11} />IN PROGRESS</div>
          <div className="sp-kpi-value">11</div>
          <div className="sp-kpi-sub">across 5 yachts</div>
        </div>
        <div className="sp-kpi green">
          <div className="sp-kpi-label"><FileCheck size={11} />DELIVERED · APR</div>
          <div className="sp-kpi-value">38</div>
          <div className="sp-kpi-sub"><span className="sp-delta up">+8%</span> vs Mar</div>
        </div>
        <div className="sp-kpi orange">
          <div className="sp-kpi-label"><Euro size={11} />BILLED · APR</div>
          <div className="sp-kpi-value">€ 84,210</div>
          <div className="sp-kpi-sub"><b>€12,480</b> outstanding</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sp-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`sp-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
            {t.count !== undefined && (
              <span className={`sp-tab-count${t.urgent ? ' urgent' : ''}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters + layout toggle */}
      <div className="sp-filters">
        <button className="sp-filter"><Flag size={12} />Rush only</button>
        <button className="sp-filter"><SlidersHorizontal size={12} />More filters</button>
        <div className="sp-filter-sep" />
        <div className="sp-view-toggle">
          <button className={layout === 'table'  ? 'active' : ''} onClick={() => setLayout('table')}><Rows3 size={12} />Table</button>
          <button className={layout === 'cards'  ? 'active' : ''} onClick={() => setLayout('cards')}><LayoutList size={12} />Cards</button>
          <button className={layout === 'kanban' ? 'active' : ''} onClick={() => setLayout('kanban')}><Columns3 size={12} />Board</button>
        </div>
      </div>

      {/* Table layout */}
      {layout === 'table' && (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}><input type="checkbox" /></th>
                <th>Order</th>
                <th>Yacht</th>
                <th>Received</th>
                <th>Items</th>
                <th>Deliver by</th>
                <th>Status</th>
                <th className="num">Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ORDERS.map(o => (
                <tr key={o.id} className={o.isNew ? 'is-new' : ''} onClick={() => onOpenOrder(o.id)}>
                  <td onClick={e => e.stopPropagation()}><input type="checkbox" /></td>
                  <td>
                    <span className="sp-oid">#<b>{o.id.split('-').pop()}</b></span>
                    <div className="sp-oid-full">{o.id}</div>
                  </td>
                  <td>
                    <div className="sp-yacht-cell">
                      <div className={`sp-ym ${o.yachtColor}`}>{o.yachtShort}</div>
                      <div>
                        <div className="sp-yn">{o.yacht}</div>
                        <div className="sp-ys">{o.yachtMeta}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{o.received}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{o.receivedAgo}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{o.items} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>items</span></div>
                    {o.flagged > 0 && <div style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 2 }}>⚑ {o.flagged} flagged</div>}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: o.rush ? 'var(--red)' : 'var(--fg-2)' }}>{o.deliverBy}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.deliverTime}</div>
                  </td>
                  <td><span className={`sp-status ${o.status}`}><span className="d" />{o.statusLbl}</span></td>
                  <td className="sp-amount">{o.value}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {o.status === 'new'
                      ? <button className="sp-rb primary" onClick={() => onOpenOrder(o.id)}>Review <ArrowRight size={11} /></button>
                      : <button className="sp-rb"><MoreHorizontal size={13} /></button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Card queue layout */}
      {layout === 'cards' && (
        <div className="sp-cq">
          {ORDERS.map(o => (
            <div key={o.id} className={`sp-cq-card ${o.status}`} onClick={() => onOpenOrder(o.id)}>
              <div className={`sp-ym ${o.yachtColor}`}>{o.yachtShort}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700 }}>{o.yacht}</span>
                  <span className="sp-oid-full">{o.id}</span>
                  {o.rush && <span className="sp-action-badge rush">RUSH</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted-s)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span><b>{o.items}</b> items{o.flagged ? ` · ⚑ ${o.flagged} flagged` : ''}</span>
                  <span>·</span><span>Received {o.received}</span>
                  <span>·</span><span>Deliver <b>{o.deliverBy}</b></span>
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{o.value}</div>
                <span className={`sp-status ${o.status}`}><span className="d" />{o.statusLbl}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Kanban layout */}
      {layout === 'kanban' && (
        <div className="sp-kanban">
          {KANBAN_COLS.map(col => (
            <div key={col.key} className="sp-kcol">
              <div className="sp-kcol-head">
                <h4>{col.title}</h4>
                <span className="c">{col.count}</span>
              </div>
              {ORDERS.filter(o => o.status === col.key).map(o => (
                <div key={o.id} className="sp-kcard" onClick={() => onOpenOrder(o.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <div className={`sp-ym ${o.yachtColor}`} style={{ width: 24, height: 24, borderRadius: 6, fontSize: 9 }}>{o.yachtShort}</div>
                    <span style={{ fontWeight: 700, fontSize: 12.5, flex: 1 }}>{o.yacht}</span>
                    <span className="sp-oid-full">#{o.id.split('-').pop()}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{o.items} items · {o.deliverBy}</span>
                    <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 11 }}>{o.value}</span>
                  </div>
                  {o.flagged > 0 && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>⚑ {o.flagged} item{o.flagged > 1 ? 's' : ''} flagged</div>}
                </div>
              ))}
              {ORDERS.filter(o => o.status === col.key).length === 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '10px 4px' }}>Nothing here.</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default OrdersView;
