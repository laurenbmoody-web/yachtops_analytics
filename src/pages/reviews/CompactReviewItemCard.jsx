import React from 'react';
import Icon from '../../components/AppIcon';
import { fmtDateRange } from './reviewFormat';

// CompactReviewItemCard — a list-strip row in the split-view inbox.
//
// Unlike ReviewItemCard (the old flat-list card sized for a 720px column),
// this is a selectable list item for the 380px strip: no action buttons —
// decisions live in the right-pane footer — a single-line workload summary,
// and a navy selection border driven by the ?selected= URL param.

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

export default function CompactReviewItemCard({ item, selected, onSelect }) {
  const dept = item.department_name || '—';
  const mlc = item.mlc_override_count > 0
    ? ` · ${item.mlc_override_count} MLC`
    : '';
  const range = fmtDateRange(item.date_start, item.date_end);
  const counts = `${item.day_count} day${item.day_count === 1 ? '' : 's'} · ${item.shift_count} shift${item.shift_count === 1 ? '' : 's'}${mlc}`;
  return (
    <button
      type="button"
      className={`rv-cc${selected ? ' selected' : ''}`}
      onClick={() => onSelect?.(item.id)}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${dept} — ${range ? `${range}, ` : ''}${item.day_count} days, ${item.shift_count} shifts, submitted ${timeAgo(item.created_at)}${selected ? ' (selected)' : ''}`}
    >
      <div className="rv-cc-head">
        <div className="rv-cc-dept">{dept}</div>
        <div className="rv-cc-time">{timeAgo(item.created_at)}</div>
      </div>
      <div className="rv-cc-rota">{item.rota_name || ''}</div>
      <div className="rv-cc-strip">
        <Icon name="Calendar" size={12} />
        <span>{range || counts}</span>
      </div>
      <div className="rv-cc-counts">{counts}</div>
      <div className="rv-cc-by">
        by {item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}
      </div>
    </button>
  );
}
