import React from 'react';
import Icon from '../../components/AppIcon';

// Middle column for the sea-time sign-off queue — compact cards, one per
// command spell awaiting the master's decision. Selecting one drives the
// CaptainSignoff right-pane via the ?selected= URL param.

const ROUTE = {
  stamp: { label: 'Verify in Cargo', icon: 'BadgeCheck', color: '#3F7A52', bg: '#E7F0E9' },
  virtual: { label: 'Sign digitally', icon: 'PenLine', color: '#7A5A12', bg: '#FBEFD9' }
};
const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };

export default function SeaTimeReviewPanel({ items = [], selectedId, onSelect, eyebrow }) {
  return (
    <section className="rv-liststrip" aria-label="Sea-time sign-offs">
      <div className="rv-eyebrow">{eyebrow || 'COMMAND'}</div>
      <h1 className="rv-title">
        SEA&nbsp;TIME<span className="rv-title-comma">,</span>
        <em className="rv-title-verb"> to sign off</em>
        <span className="rv-title-period">.</span>
      </h1>
      <div className="rv-subtitle">{items.length} sign-off{items.length === 1 ? '' : 's'} awaiting your decision</div>

      <div className="rv-cc-list">
        {items.length === 0 ? (
          <div className="rv-cc-empty" role="status">All clear.</div>
        ) : (
          items.map(it => {
            const r = ROUTE[it.unit.mode] || ROUTE.virtual;
            const days = it.unit.periods.reduce((s, e) => s + (e.days || 0), 0);
            return (
              <button
                type="button"
                key={it.id}
                className={`stq-card${it.id === selectedId ? ' on' : ''}`}
                aria-current={it.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(it.id)}
              >
                <div className="stq-top">
                  <span className="stq-name">{it.seafarer.fullName}</span>
                  <span className="stq-route" style={{ color: r.color, background: r.bg }}><Icon name={r.icon} size={11} /> {r.label}</span>
                </div>
                <div className="stq-vessel">{it.unit.name} · {it.unit.flag} · {it.unit.gt}GT</div>
                {it.unit.multi && <span className="stq-cmd">{it.unit.captainName} · {it.unit.cmdLabel?.replace('In command ', '')}</span>}
                <div className="stq-foot">
                  {it.unit.periods.length} period{it.unit.periods.length === 1 ? '' : 's'} · {days} days
                  <span className="dot" /> Requested {fmtDate(it.requestedAt)}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
