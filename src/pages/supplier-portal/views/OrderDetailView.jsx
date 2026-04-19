import React, { useState } from 'react';
import { ArrowLeft, Printer, MoreHorizontal, MessageSquare, MapPin, User, Repeat2, ArrowUp, Check, ArrowRight } from 'lucide-react';
import { ORDERS, LINE_ITEMS } from '../data';

const TIMELINE_STEPS = [
  { label: 'Received',              tm: 'Mon 06:42' },
  { label: 'Awaiting confirmation', tm: 'You · now' },
  { label: 'Picking',               tm: 'Tue morning' },
  { label: 'Out for delivery',      tm: 'Thu 06:00' },
  { label: 'Delivered',             tm: 'Thu' },
];

const OrderDetailView = ({ orderId, onBack, confirmed, onConfirm }) => {
  const order = ORDERS.find(o => o.id === orderId) || ORDERS[0];
  const [activeFilter, setActiveFilter] = useState('All');

  const currentStep = confirmed ? 2 : 1;

  return (
    <div className="sp-page">
      <button className="sp-back" onClick={onBack}><ArrowLeft size={14} />Back to orders</button>

      {/* Detail header */}
      <div className="sp-dhead">
        <div className={`sp-ym ${order.yachtColor}`} style={{ width: 42, height: 42, borderRadius: 11, fontSize: 13 }}>{order.yachtShort}</div>
        <div style={{ flex: 1 }}>
          <h1 className="sp-dhead" style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 20, textTransform: 'uppercase', color: 'var(--navy)', margin: 0 }}>
            {order.yacht} · Charter provisioning
          </h1>
          <div className="sp-dhead sub" style={{ fontSize: 12.5, color: 'var(--muted-s)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <span className="mono">#CGO-2026-0418</span>
            <span>·</span><span>Received 06:42 · 4 hours ago</span>
            <span>·</span><span>Chief stew: Amelia Koury</span>
          </div>
        </div>
        <div className="sp-actions">
          <button className="sp-pill ghost"><Printer size={13} /></button>
          <button className="sp-pill ghost"><MoreHorizontal size={13} /></button>
          <button className="sp-pill"><MessageSquare size={13} />Message yacht</button>
        </div>
      </div>

      {/* Timeline */}
      <div className="sp-timeline">
        {TIMELINE_STEPS.map((s, i) => {
          const done    = i < currentStep;
          const current = i === currentStep;
          return (
            <div key={i} className={`sp-ts${done ? ' done' : ''}${current ? ' current' : ''}`}>
              <div className="node" />
              <div className="lbl">{s.label}</div>
              <div className="tm">{s.tm}</div>
            </div>
          );
        })}
      </div>

      <div className="sp-detail-layout">
        {/* Main column */}
        <div>
          <div className="sp-lines">
            <div className="sp-lines-head">
              <h3>Line items</h3>
              <span className="sp-cnt">38 items · 2 flagged</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {['All', 'Flagged', 'Galley', 'Interior', 'Bar'].map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(f)}
                    style={{
                      padding: '4px 10px', borderRadius: 12,
                      fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                      border: activeFilter === f ? '1px solid var(--navy)' : '1px solid var(--line)',
                      background: activeFilter === f ? 'var(--bg-2)' : 'transparent',
                      color: activeFilter === f ? 'var(--navy)' : 'var(--muted-s)',
                    }}
                  >{f}</button>
                ))}
              </div>
            </div>

            <table className="sp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 120 }}>Qty</th>
                  <th style={{ width: 140 }}>Action</th>
                  <th className="num" style={{ width: 100 }}>Unit</th>
                  <th className="num" style={{ width: 100 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let lastCat = null;
                  return LINE_ITEMS.map((l, i) => {
                    const catRow = l.cat !== lastCat ? (
                      <tr key={`cat-${i}`}>
                        <td colSpan={5} style={{ padding: '10px 14px 6px', background: 'var(--bg-3)', fontFamily: 'Outfit', fontWeight: 700, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted-s)' }}>
                          {l.cat}
                        </td>
                      </tr>
                    ) : null;
                    lastCat = l.cat;
                    return (
                      <React.Fragment key={i}>
                        {catRow}
                        <tr className={l.action === 'sub' ? 'sp-sub-row' : ''} style={{ cursor: 'default' }}>
                          <td>
                            <div className="sp-line-name">{l.name}</div>
                            <div className="sp-line-sku">{l.sku}</div>
                            {l.note && <div className="sp-line-note"><b>{l.note.who} noted:</b> {l.note.text}</div>}
                            {l.sub && (
                              <div className="sp-line-sub">
                                <Repeat2 size={12} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 1 }} />
                                <div>
                                  <b>Sub: </b>{l.sub.name} @ {l.sub.price}
                                  <div style={{ fontSize: 11, color: 'var(--muted-s)' }}>{l.sub.note}</div>
                                </div>
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                                <button style={{ padding: '4px 8px', border: 'none', background: 'var(--bg-3)', cursor: 'pointer', fontSize: 13 }}>–</button>
                                <input defaultValue={l.qty} style={{ width: 36, textAlign: 'center', border: 'none', outline: 'none', fontFamily: 'JetBrains Mono', fontSize: 12.5, padding: '4px 0' }} />
                                <button style={{ padding: '4px 8px', border: 'none', background: 'var(--bg-3)', cursor: 'pointer', fontSize: 13 }}>+</button>
                              </div>
                              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{l.unit}</span>
                            </div>
                          </td>
                          <td>
                            {l.action === 'ok'    && <span className="sp-action-badge ok"><Check size={10} />Confirm</span>}
                            {l.action === 'sub'   && <span className="sp-action-badge sub"><Repeat2 size={10} />Substitute</span>}
                            {l.action === 'price' && <span className="sp-action-badge price"><ArrowUp size={10} />Price change</span>}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12.5, fontWeight: l.oldPrice ? 700 : 400, color: l.oldPrice ? 'var(--blue)' : 'var(--fg-2)' }}>
                              {l.price || '—'}
                            </div>
                            {l.oldPrice && <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--muted)', textDecoration: 'line-through' }}>{l.oldPrice}</div>}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 12.5 }}>{l.total || '—'}</div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ minWidth: 240 }}>
                {[['Subtotal', '€ 4,218.50'], ['VAT (20%)', '€ 843.70'], ['Delivery', '€ 65.00']].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted-s)', marginBottom: 6 }}>
                    <span>{k}</span><span className="mono">{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--fg)', borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 4 }}>
                  <span>Total confirmed</span><span className="mono">€ 5,127.20</span>
                </div>
              </div>
            </div>
          </div>

          {/* Confirm bar */}
          {!confirmed ? (
            <div className="sp-confirm-bar">
              <div className="msg"><b>Ready to confirm.</b> 2 substitutions and 1 price change will be sent to the yacht for approval.</div>
              <button className="sp-big-btn reject">Reject order</button>
              <button className="sp-big-btn confirm" onClick={onConfirm}>Confirm order <ArrowRight size={14} /></button>
            </div>
          ) : (
            <div className="sp-confirm-bar" style={{ background: 'var(--green)' }}>
              <div className="msg"><b>Order confirmed.</b> Amelia has been notified. Pick list queued for Tuesday morning.</div>
              <button className="sp-big-btn" onClick={onBack}>Back to inbox <ArrowRight size={14} /></button>
            </div>
          )}
        </div>

        {/* Side panel */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sp-delivery-card">
            <div className="dd">Delivery window</div>
            <div className="time">06:00 – 08:00</div>
            <div className="day">Thursday 23 April</div>
            <div className="loc">
              <b>IYCA · Quai des Milliardaires</b>
              <div style={{ display: 'flex', gap: 5 }}><MapPin size={11} />Antibes · Berth A14</div>
              <div style={{ display: 'flex', gap: 5 }}><User size={11} />Meet: Bosun Kai (+33 6 14 ••• 832)</div>
            </div>
          </div>

          <div className="sp-card">
            <h4>Order summary</h4>
            <div className="sp-kv-list">
              {[
                ['Yacht', 'M/Y Solstice'], ['Flag · LOA', 'MT · 72 m'],
                ['Purpose', 'Charter start'], ['Pax on board', '12 guests · 18 crew'],
                ['PO reference', 'SOL-PV-0418'], ['Payment terms', 'Net 30'],
              ].map(([k, v]) => (
                <div key={k} className="sp-kv"><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>

          <div className="sp-card">
            <h4>Yacht contacts</h4>
            {[
              { init: 'AK', name: 'Amelia Koury', role: 'Chief Stewardess · ordered this' },
              { init: 'MR', name: 'Marco Rinaldi', role: 'Purser · approves pricing' },
              { init: 'KO', name: 'Kai Osterberg', role: 'Bosun · receives delivery' },
            ].map(c => (
              <div key={c.init} className="sp-contact-row">
                <div className="sp-cav">{c.init}</div>
                <div><div className="sp-cn">{c.name}</div><div className="sp-cr">{c.role}</div></div>
                <button className="sp-cb"><MessageSquare size={12} /></button>
              </div>
            ))}
          </div>

          <div className="sp-card">
            <h4>Activity</h4>
            {[
              { color: 'var(--blue)',  icon: '📥', text: <><b>Amelia</b> sent order via Cargo</>, tm: 'Mon 06:42' },
              { color: 'var(--amber)', icon: '⚠',  text: <>2 items flagged — <b>yellow plum tomatoes</b> out of season, <b>burrata 500g</b> discontinued</>, tm: 'Mon 07:14' },
              { color: 'var(--green)', icon: '✓',  text: <><b>Luca</b> suggested substitutions for both</>, tm: 'Mon 10:06' },
            ].map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: a.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{a.icon}</div>
                <div>
                  <div style={{ fontSize: 12.5 }}>{a.text}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>{a.tm}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default OrderDetailView;
