import React from 'react';
import Icon from '../../components/AppIcon';
import { fmtDateRange } from './reviewFormat';
import SnapshotRotaLines from './SnapshotRotaLines';

// ResolvedDetail — read-only right-pane view for a History (resolved) item.
// No rota grid, no actions: just the outcome and the submission's metadata.
// (The full rota-snapshot view could be a later enhancement.)

const OUTCOME = {
  accepted:             { label: 'Accepted', cls: 'ok', icon: 'CheckCircle' },
  accepted_with_edits:  { label: 'Accepted with edits', cls: 'ok', icon: 'CheckCircle' },
  rejected:             { label: 'Rejected', cls: 'warn', icon: 'XCircle' },
};

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

export default function ResolvedDetail({ item }) {
  if (!item) return null;
  const o = OUTCOME[item.status] || { label: item.status || 'Resolved', cls: '', icon: 'Info' };
  const range = fmtDateRange(item.date_start, item.date_end);
  const counts = `${item.day_count} day${item.day_count === 1 ? '' : 's'} · ${item.shift_count} shift${item.shift_count === 1 ? '' : 's'}`;
  return (
    <div className="rv-resolved">
      <div className="rv-resolved-eyebrow">
        {item.department_name || ''}{item.mlc_override_count > 0 ? ` · ${item.mlc_override_count} MLC override${item.mlc_override_count === 1 ? '' : 's'}` : ''}
      </div>
      <h2 className="rv-rp-title">{item.rota_name || 'Rota'}</h2>

      <div className={`rv-resolved-badge ${o.cls}`}>
        <Icon name={o.icon} size={16} />
        <span>{o.label}</span>
      </div>

      <dl className="rv-resolved-meta">
        <div>
          <dt>Submitted by</dt>
          <dd>{item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{range ? `${range} · ${counts}` : counts}</dd>
        </div>
        <div>
          <dt>Decided</dt>
          <dd>{fmtWhen(item.decided_at) || '—'}</dd>
        </div>
        {item.decision_note && (
          <div>
            <dt>{item.status === 'rejected' ? 'Reason' : 'Note'}</dt>
            <dd>{item.decision_note}</dd>
          </div>
        )}
      </dl>

      <SnapshotRotaLines
        snapshotId={item.snapshot_id}
        dateStart={item.date_start}
        dateEnd={item.date_end}
      />
    </div>
  );
}
