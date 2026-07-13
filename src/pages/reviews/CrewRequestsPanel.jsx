import React from 'react';
import Icon from '../../components/AppIcon';

// CrewRequestsPanel — the list strip for the "Crew requests" inbox category.
// Mirrors the rota list strip: eyebrow · title · subtitle · a column of
// selectable compact cards. Decisions live in the right pane, so cards carry
// no action buttons — selecting one drives ?selected= like every other queue.

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Human label for each request kind — the category can grow (leave, account
// changes) without the list strip needing to know their shapes.
const KIND_LABEL = { notification_email: 'Notification email' };

export default function CrewRequestsPanel({ items, loading, selectedId, onSelect, eyebrow }) {
  return (
    <section className="rv-liststrip" aria-label="Crew requests">
      <div className="rv-eyebrow">{eyebrow}</div>
      <h1 className="rv-title">
        CREW REQUESTS<span className="rv-title-comma">,</span>
        <em className="rv-title-verb"> to action</em>
        <span className="rv-title-period">.</span>
      </h1>
      <div className="rv-subtitle">
        {loading ? 'Loading…' : `${items.length} request${items.length === 1 ? '' : 's'} awaiting your decision`}
      </div>

      <div className="rv-cc-list">
        {!loading && items.length === 0 ? (
          <div className="rv-cc-empty" role="status">All clear.</div>
        ) : (
          items.map((r) => {
            const name = r.requester?.full_name || 'Crew member';
            const selected = r.id === selectedId;
            return (
              <button
                key={r.id}
                type="button"
                className={`rv-cc${selected ? ' selected' : ''}`}
                onClick={() => onSelect?.(r.id)}
                aria-current={selected ? 'true' : undefined}
                aria-label={`${name}, ${KIND_LABEL[r.kind] || 'request'}, ${timeAgo(r.requested_at)}${selected ? ' (selected)' : ''}`}
              >
                <div className="rv-cc-head">
                  <div className="rv-cc-dept">{name}</div>
                  <div className="rv-cc-time">{timeAgo(r.requested_at)}</div>
                </div>
                <div className="rv-cc-rota">{KIND_LABEL[r.kind] || 'Request'}</div>
                <div className="rv-cc-strip">
                  <Icon name="Mail" size={12} />
                  <span>{r.requested_email}</span>
                </div>
                <div className="rv-cc-by">by {name}</div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
