import React, { useState } from 'react';
import { Phone, Archive, MoreHorizontal, Paperclip, AtSign, ArrowRight, Repeat2 } from 'lucide-react';

const THREADS = [
  { id: 0, ym: 'm3', short: 'SOL', name: 'M/Y Solstice', lastSender: 'Amelia', lastMsg: 'Perfect on the datterini, just check…', time: '11:04', order: '#0418', unread: 2 },
  { id: 1, ym: 'm4', short: 'LUM', name: 'M/Y Lumen',   lastSender: 'Ria',    lastMsg: 'Will chase accounts this week.',      time: '09:18', order: 'Invoice #0218' },
  { id: 2, ym: 'm2', short: 'AET', name: 'M/Y Aether',  lastSender: 'Elena',  lastMsg: 'Moving berth to Canto by Tuesday.',   time: 'Yest.', order: 'Order #0417' },
  { id: 3, ym: 'm5', short: 'COR', name: 'S/Y Corvus',  lastSender: 'Tomás',  lastMsg: 'Query on côte de bœuf pricing.',      time: 'Yest.', order: 'Order #0416' },
  { id: 4, ym: 'm1', short: 'HAL', name: 'S/Y Halcyon', lastSender: 'Marius', lastMsg: 'Thanks — deliver at 14:00 Mon.',       time: 'Fri' },
];

const MESSAGES = [
  { from: 'Amelia', side: 'left',  ym: 'm3', short: 'SOL', time: '07:18', text: 'Morning Luca. Order #0418 — we\'ve just heard the charter group wants pasta-heavy lunches so I might need to bump the datterini up. Can you hold 5kg extra?' },
  { from: 'You',    side: 'right', time: '07:42', text: 'Held. We\'ve got 42 kg in stock, can push up to 15 kg on your line.' },
  { type: 'event',  text: <>You suggested <b>Datterini × Sicily</b> as a substitute for yellow plum tomatoes — 4.0 kg @ €9.20</> },
  { from: 'Amelia', side: 'left',  ym: 'm3', short: 'SOL', time: '11:02', text: 'Perfect on the datterini, just check whether the burrata 250g works for the entrée — chef likes to do the whole wheel for the table.' },
  { from: 'Amelia', side: 'left',  ym: 'm3', short: 'SOL', time: '11:04', text: 'Let me ask and get back to you within the hour.' },
];

const MessagesView = ({ onOpenOrder }) => {
  const [activeThread, setActiveThread] = useState(0);
  const thread = THREADS[activeThread];

  return (
    <div className="sp-page" style={{ paddingRight: 0, paddingBottom: 0 }}>
      <div className="sp-page-head" style={{ marginBottom: 20 }}>
        <div>
          <div className="sp-eyebrow">16 threads · 3 unread</div>
          <h1 className="sp-page-title">Yacht <em>messages</em></h1>
          <p className="sp-page-sub">One thread per yacht, scoped to orders. The boat replies, you reply, it's on the order.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 260px', gap: 0, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r)', overflow: 'hidden', minHeight: 580 }}>

        {/* Thread list */}
        <div style={{ borderRight: '1px solid var(--line)', background: 'var(--bg-3)' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input placeholder="Search threads" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--fg)' }} />
          </div>
          {THREADS.map(t => (
            <div
              key={t.id}
              onClick={() => setActiveThread(t.id)}
              style={{
                padding: '12px 14px', borderBottom: '1px solid var(--line-soft)',
                cursor: 'pointer', display: 'flex', gap: 10,
                background: activeThread === t.id ? 'var(--card)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <div className={`sp-ym ${t.ym}`} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 11, flexShrink: 0 }}>{t.short}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 10.5, color: 'var(--muted)', flexShrink: 0 }}>{t.time}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-s)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b style={{ color: 'var(--fg-2)' }}>{t.lastSender}</b> {t.lastMsg}
                </div>
                {t.order && <div style={{ marginTop: 3, fontSize: 10.5, color: 'var(--blue)', fontWeight: 700 }}>{t.order}</div>}
              </div>
              {t.unread && (
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--red)', color: '#fff', fontSize: 10.5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
                  {t.unread}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Chat body */}
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)' }}>
          {/* Chat header */}
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`sp-ym ${thread.ym}`} style={{ width: 36, height: 36, borderRadius: 10, fontSize: 11 }}>{thread.short}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{thread.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>
                Amelia Koury, Marco Rinaldi, Kai Osterberg ·
                scoped to <a onClick={() => onOpenOrder('CGO-2026-0418')} style={{ color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer' }}>#0418</a>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="sp-icon-btn"><Phone size={13} /></button>
              <button className="sp-icon-btn"><Archive size={13} /></button>
              <button className="sp-icon-btn"><MoreHorizontal size={13} /></button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--bg-3)' }}>
            <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Monday 20 April</div>
            {MESSAGES.map((m, i) => {
              if (m.type === 'event') {
                return (
                  <div key={i} style={{ background: 'var(--card)', border: '1px dashed var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--muted-s)', display: 'flex', alignItems: 'center', gap: 10, maxWidth: '80%', margin: '0 auto' }}>
                    <Repeat2 size={13} style={{ color: 'var(--amber)', flexShrink: 0 }} />
                    <span>{m.text}</span>
                  </div>
                );
              }
              const isRight = m.side === 'right';
              return (
                <div key={i} style={{ display: 'flex', gap: 10, maxWidth: '72%', ...(isRight ? { marginLeft: 'auto', flexDirection: 'row-reverse' } : {}) }}>
                  {!isRight
                    ? <div className={`sp-ym ${m.ym}`} style={{ width: 28, height: 28, borderRadius: 8, fontSize: 10, flexShrink: 0 }}>{m.short}</div>
                    : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 10.5, flexShrink: 0 }}>LC</div>
                  }
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--muted-s)', marginBottom: 4, textAlign: isRight ? 'right' : 'left' }}>
                      <b style={{ color: 'var(--fg)' }}>{m.from}</b> · {m.time}
                    </div>
                    <div style={{
                      background: isRight ? 'var(--navy)' : 'var(--card)',
                      color: isRight ? '#fff' : 'var(--fg)',
                      border: isRight ? 'none' : '1px solid var(--line)',
                      borderRadius: isRight ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                      padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
                    }}>
                      {m.text}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Compose */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 12, padding: '7px 12px' }}>
              <button className="sp-icon-btn" style={{ width: 26, height: 26 }}><Paperclip size={13} /></button>
              <input placeholder="Message Amelia, Marco and Kai…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--fg)', fontFamily: 'inherit' }} />
              <button className="sp-icon-btn" style={{ width: 26, height: 26 }}><AtSign size={13} /></button>
              <button className="sp-pill primary" style={{ padding: '5px 12px', fontSize: 11.5 }}>Send <ArrowRight size={11} /></button>
            </div>
          </div>
        </div>

        {/* Context panel */}
        <div style={{ padding: 16 }}>
          <h4 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted-s)', margin: '0 0 12px' }}>Order context</h4>
          <div
            onClick={() => onOpenOrder('CGO-2026-0418')}
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line)', borderRadius: 10, padding: 12, marginBottom: 14, cursor: 'pointer' }}
          >
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--muted)' }}>#CGO-2026-0418</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>Charter provisioning</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-s)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              38 items · €5,127.20 · <span className="sp-status new" style={{ fontSize: 10.5, padding: '2px 7px' }}><span className="d" />Awaiting</span>
            </div>
          </div>
          <h4 style={{ fontFamily: 'Outfit', fontWeight: 600, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted-s)', margin: '16px 0 10px' }}>Participants</h4>
          {[['AK', 'Amelia Koury', 'Chief stew'], ['MR', 'Marco Rinaldi', 'Purser'], ['KO', 'Kai Osterberg', 'Bosun']].map(([init, name, role]) => (
            <div key={init} className="sp-contact-row" style={{ padding: '6px 0' }}>
              <div className="sp-cav">{init}</div>
              <div><div className="sp-cn">{name}</div><div className="sp-cr">{role}</div></div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default MessagesView;
